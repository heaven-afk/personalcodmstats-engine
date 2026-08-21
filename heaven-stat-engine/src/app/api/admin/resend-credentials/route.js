import { NextResponse } from 'next/server';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import crypto from 'crypto';
import { buildPlatformInviteEmail } from '@/lib/email/templates';
import { sendEmail } from '@/lib/email/send';

export const dynamic = 'force-dynamic';

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
    } catch (e) {
      console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', e.message);
    }
  }

  if (serviceAccountPath && existsSync(resolve(serviceAccountPath))) {
    try {
      const parsed = JSON.parse(readFileSync(resolve(serviceAccountPath), 'utf8'));
      return initializeApp({ credential: cert(parsed) });
    } catch (e) {
      console.warn('Failed to read FIREBASE_SERVICE_ACCOUNT_PATH:', e.message);
    }
  }

  return initializeApp();
}

function getAdminAuth() {
  try {
    return getAuth(getAdminApp());
  } catch (e) {
    console.warn('getAdminAuth fallback error:', e.message);
    return null;
  }
}

function getAdminFirestore() {
  try {
    return getFirestore(getAdminApp());
  } catch (e) {
    console.warn('getAdminFirestore fallback error:', e.message);
    return null;
  }
}

async function verifyOwner(req) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

  if (!token) {
    return { error: 'Missing authorization token', status: 401 };
  }

  try {
    const adminAuth = getAdminAuth();
    if (!adminAuth) {
      // If admin auth isn't fully initialized, check fallback header or fail securely
      return { error: 'Admin Auth service not available', status: 503 };
    }
    const decoded = await adminAuth.verifyIdToken(token);

    const isOwner = decoded.role === 'owner' || (process.env.OWNER_EMAIL && decoded.email?.toLowerCase() === process.env.OWNER_EMAIL.toLowerCase());
    if (!isOwner) {
      return { error: 'Forbidden: Owner permission required', status: 403 };
    }

    return { caller: decoded, adminAuth };
  } catch (err) {
    console.error('Error verifying token in verifyOwner:', err.message);
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
    const adminDb = getAdminFirestore();

    // 1. Generate fresh secure temporary password
    const tempPassword = crypto.randomBytes(12).toString('base64url');

    // 2. Fetch or create user in Firebase Auth
    let uid = null;
    let role = 'operator';

    if (adminDb) {
      try {
        const userDoc = await adminDb.collection('allowedUsers').doc(normalizedEmail).get();
        if (userDoc.exists) {
          role = userDoc.data().role || 'operator';
        }
      } catch (dbErr) {
        console.warn('Error reading allowedUsers doc:', dbErr.message);
      }
    }

    if (adminAuth) {
      try {
        const existingAuthUser = await adminAuth.getUserByEmail(normalizedEmail);
        uid = existingAuthUser.uid;
        // Update password & custom claims in Auth
        await adminAuth.updateUser(uid, { password: tempPassword });
        await adminAuth.setCustomUserClaims(uid, { role });
      } catch (notFoundErr) {
        try {
          // Create user if not existing in Auth yet
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
    }

    // 3. Mark mustChangePassword in Firestore
    if (adminDb) {
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
    }

    // 4. Dispatch Email with new credentials
    let emailDispatched = false;
    let emailErrorMsg = null;
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
        : `New credentials generated for ${normalizedEmail}. Copy credentials to share directly.`,
    });
  } catch (err) {
    console.error('Fatal error in /api/admin/resend-credentials:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
