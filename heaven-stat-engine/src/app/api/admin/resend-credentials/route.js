import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

async function getAdminApp() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');

  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (serviceAccountKey) {
    try {
      const parsed = JSON.parse(serviceAccountKey);
      return initializeApp({ credential: cert(parsed) });
    } catch (e) {
      console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', e.message);
    }
  }

  if (serviceAccountPath) {
    try {
      const { readFileSync, existsSync } = await import('fs');
      const { resolve } = await import('path');
      if (existsSync(resolve(serviceAccountPath))) {
        const parsed = JSON.parse(readFileSync(resolve(serviceAccountPath), 'utf8'));
        return initializeApp({ credential: cert(parsed) });
      }
    } catch (e) {
      console.warn('Failed to read FIREBASE_SERVICE_ACCOUNT_PATH:', e.message);
    }
  }

  return initializeApp();
}

async function getAdminAuth() {
  const { getAuth } = await import('firebase-admin/auth');
  return getAuth(await getAdminApp());
}

async function getAdminFirestore() {
  const { getFirestore } = await import('firebase-admin/firestore');
  return getFirestore(await getAdminApp());
}

async function verifyOwner(req) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

  if (!token) {
    return { error: 'Missing authorization token', status: 401 };
  }

  try {
    const adminAuth = await getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(token);

    const isOwner =
      decoded.role === 'owner' ||
      (process.env.OWNER_EMAIL &&
        decoded.email?.toLowerCase() === process.env.OWNER_EMAIL.toLowerCase());
    if (!isOwner) {
      return { error: 'Forbidden: Owner permission required', status: 403 };
    }

    return { caller: decoded, adminAuth };
  } catch (err) {
    console.error('Error verifying token:', err.message);
    return { error: 'Authentication failed: ' + err.message, status: 401 };
  }
}

export async function POST(req) {
  try {
    const authCheck = await verifyOwner(req);
    if (authCheck.error) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { adminAuth } = authCheck;
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const adminDb = await getAdminFirestore();

    // 1. Generate fresh secure temporary password
    const tempPassword = crypto.randomBytes(12).toString('base64url');

    // 2. Fetch role from Firestore
    let uid = null;
    let role = 'operator';
    try {
      const userDoc = await adminDb.collection('allowedUsers').doc(normalizedEmail).get();
      if (userDoc.exists) {
        role = userDoc.data().role || 'operator';
      }
    } catch (dbErr) {
      console.warn('Error reading allowedUsers doc:', dbErr.message);
    }

    // 3. Update or create user in Firebase Auth
    try {
      const existingAuthUser = await adminAuth.getUserByEmail(normalizedEmail);
      uid = existingAuthUser.uid;
      await adminAuth.updateUser(uid, { password: tempPassword });
      await adminAuth.setCustomUserClaims(uid, { role });
    } catch {
      try {
        const createdUser = await adminAuth.createUser({
          email: normalizedEmail,
          password: tempPassword,
          displayName: normalizedEmail,
        });
        uid = createdUser.uid;
        await adminAuth.setCustomUserClaims(uid, { role });
      } catch (createErr) {
        console.warn('Error creating user in Auth:', createErr.message);
      }
    }

    // 4. Mark mustChangePassword in Firestore
    try {
      await adminDb.collection('allowedUsers').doc(normalizedEmail).set(
        {
          email: normalizedEmail,
          role,
          mustChangePassword: true,
          uid,
          lastCredentialsSentAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (setErr) {
      console.warn('Error saving allowedUsers state:', setErr.message);
    }

    // 5. Dispatch Email with new credentials
    let emailDispatched = false;
    let emailErrorMsg = null;
    try {
      const { buildPlatformInviteEmail } = await import('@/lib/email/templates');
      const { sendEmail } = await import('@/lib/email/send');
      const emailTemplate = buildPlatformInviteEmail({ toEmail: normalizedEmail, tempPassword, role });
      const sendResult = await sendEmail({
        to: normalizedEmail,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
      });
      if (sendResult?.success) {
        emailDispatched = true;
      } else {
        emailErrorMsg = sendResult?.error?.message || sendResult?.error || sendResult?.reason;
      }
    } catch (emailErr) {
      console.warn('Failed to send credentials email:', emailErr.message);
      emailErrorMsg = emailErr.message;
    }

    return NextResponse.json({
      success: true,
      email: normalizedEmail,
      tempPassword,
      role,
      emailSent: emailDispatched,
      emailError: emailErrorMsg,
      message: emailDispatched
        ? `New credentials sent to ${normalizedEmail}!`
        : `Credentials generated for ${normalizedEmail}. Copy them to share manually.`,
    });
  } catch (err) {
    console.error('Fatal error in /api/admin/resend-credentials:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
