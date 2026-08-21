import { NextResponse } from 'next/server';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import crypto from 'crypto';
import { buildPlatformInviteEmail } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email/send';

function getAdminApp() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (serviceAccountKey) {
    try {
      const parsed = JSON.parse(serviceAccountKey);
      return initializeApp({ credential: cert(parsed) });
    } catch {}
  }

  if (serviceAccountPath && existsSync(resolve(serviceAccountPath))) {
    try {
      const parsed = JSON.parse(readFileSync(resolve(serviceAccountPath), 'utf8'));
      return initializeApp({ credential: cert(parsed) });
    } catch {}
  }

  return initializeApp();
}

function getAdminAuth() {
  return getAuth(getAdminApp());
}

function getAdminFirestore() {
  return getFirestore(getAdminApp());
}

async function verifyOwner(req) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

  if (!token) {
    return { error: 'Missing authorization token', status: 401 };
  }

  const adminAuth = getAdminAuth();
  const decoded = await adminAuth.verifyIdToken(token);

  const isOwner = decoded.role === 'owner' || (process.env.OWNER_EMAIL && decoded.email?.toLowerCase() === process.env.OWNER_EMAIL.toLowerCase());
  if (!isOwner) {
    return { error: 'Forbidden: Owner permission required', status: 403 };
  }

  return { caller: decoded, adminAuth };
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
    const adminDb = getAdminFirestore();

    // 1. Generate fresh secure temporary password
    const tempPassword = crypto.randomBytes(12).toString('base64url');

    // 2. Fetch or create user in Firebase Auth
    let uid = null;
    let role = 'operator';

    const userDoc = await adminDb.collection('allowedUsers').doc(normalizedEmail).get();
    if (userDoc.exists) {
      role = userDoc.data().role || 'operator';
    }

    try {
      const existingAuthUser = await adminAuth.getUserByEmail(normalizedEmail);
      uid = existingAuthUser.uid;
      // Update password & custom claims in Auth
      await adminAuth.updateUser(uid, { password: tempPassword });
      await adminAuth.setCustomUserClaims(uid, { role });
    } catch (notFoundErr) {
      // Create user if not existing in Auth yet
      const createdUser = await adminAuth.createUser({
        email: normalizedEmail,
        password: tempPassword,
        displayName: normalizedEmail,
      });
      uid = createdUser.uid;
      await adminAuth.setCustomUserClaims(uid, { role });
    }

    // 3. Mark mustChangePassword in Firestore
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

    // 4. Dispatch Email with new credentials
    let emailDispatched = false;
    try {
      const emailTemplate = buildPlatformInviteEmail({
        toEmail: normalizedEmail,
        tempPassword,
        role,
      });
      const sendResult = await sendEmail({
        to: normalizedEmail,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
      });
      if (sendResult?.success) {
        emailDispatched = true;
      }
    } catch (emailErr) {
      console.warn('Failed to send credentials email:', emailErr);
    }

    return NextResponse.json({
      success: true,
      email: normalizedEmail,
      tempPassword,
      role,
      emailSent: emailDispatched,
      message: emailDispatched
        ? `New credentials sent to ${normalizedEmail}!`
        : `New credentials generated for ${normalizedEmail}. Copy credentials to share directly.`,
    });
  } catch (err) {
    console.error('Error in /api/admin/resend-credentials:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
