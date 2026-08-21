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
    console.error('verifyOwner error:', err.message);
    return { error: 'Authentication failed: ' + err.message, status: 401 };
  }
}

// POST: Create or sync user in Firebase Auth with temp password + custom claims
export async function POST(req) {
  try {
    const authCheck = await verifyOwner(req);
    if (authCheck.error) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { adminAuth } = authCheck;
    const body = await req.json();
    const { email, role = 'operator', username } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!['owner', 'operator'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role. Must be "owner" or "operator".' }, { status: 400 });
    }

    let uid = null;
    let isNewAccount = false;
    let tempPassword = null;

    try {
      const existingUser = await adminAuth.getUserByEmail(normalizedEmail);
      if (existingUser) {
        uid = existingUser.uid;
        await adminAuth.setCustomUserClaims(existingUser.uid, { role });
      }
    } catch {
      isNewAccount = true;
      tempPassword = crypto.randomBytes(12).toString('base64url');

      const createdUser = await adminAuth.createUser({
        email: normalizedEmail,
        password: tempPassword,
        displayName: username || normalizedEmail,
        emailVerified: false,
      });

      uid = createdUser.uid;
      await adminAuth.setCustomUserClaims(uid, { role });
    }

    if (isNewAccount && tempPassword) {
      try {
        const adminDb = await getAdminFirestore();
        await adminDb.collection('allowedUsers').doc(normalizedEmail).set(
          { email: normalizedEmail, role, mustChangePassword: true, uid },
          { merge: true }
        );
      } catch (dbErr) {
        console.warn('Could not update Firestore mustChangePassword flag:', dbErr.message);
      }

      let emailDispatched = false;
      try {
        const { buildPlatformInviteEmail } = await import('@/lib/email/templates');
        const { sendEmail } = await import('@/lib/email/send');
        const emailTemplate = buildPlatformInviteEmail({ toEmail: normalizedEmail, tempPassword, role });
        const sendResult = await sendEmail({
          to: normalizedEmail,
          subject: emailTemplate.subject,
          html: emailTemplate.html,
        });
        if (sendResult?.success) emailDispatched = true;
      } catch (emailErr) {
        console.warn('Failed to send platform invite email:', emailErr.message);
      }

      return NextResponse.json({
        success: true,
        email: normalizedEmail,
        uid,
        role,
        isNewAccount: true,
        emailSent: emailDispatched,
        tempPassword: emailDispatched ? undefined : tempPassword,
        message: emailDispatched
          ? `Account created for ${normalizedEmail} with role "${role}" and invite email dispatched.`
          : `Account created for ${normalizedEmail}. Email was not sent. Copy credentials to share manually.`,
      });
    }

    return NextResponse.json({
      success: true,
      email: normalizedEmail,
      uid,
      role,
      isNewAccount: false,
      message: `User ${normalizedEmail} claim synchronized with role "${role}"`,
    });
  } catch (err) {
    console.error('Error in POST /api/admin/users:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH: Update user role in Firebase Auth
export async function PATCH(req) {
  try {
    const authCheck = await verifyOwner(req);
    if (authCheck.error) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { adminAuth } = authCheck;
    const body = await req.json();
    const { email, role } = body;

    if (!email || !role) {
      return NextResponse.json({ error: 'Email and role are required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!['owner', 'operator'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role. Must be "owner" or "operator".' }, { status: 400 });
    }

    try {
      const authUser = await adminAuth.getUserByEmail(normalizedEmail);
      if (authUser) {
        await adminAuth.setCustomUserClaims(authUser.uid, { role });
        await adminAuth.revokeRefreshTokens(authUser.uid);
      }
    } catch {}

    return NextResponse.json({
      success: true,
      message: `Auth claim for ${normalizedEmail} updated to "${role}"`,
    });
  } catch (err) {
    console.error('Error updating allowed user role:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: Revoke token & claims on removal
export async function DELETE(req) {
  try {
    const authCheck = await verifyOwner(req);
    if (authCheck.error) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { adminAuth } = authCheck;
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email query parameter is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (process.env.OWNER_EMAIL && normalizedEmail === process.env.OWNER_EMAIL.toLowerCase()) {
      return NextResponse.json({ error: 'Cannot remove primary owner account' }, { status: 400 });
    }

    try {
      const authUser = await adminAuth.getUserByEmail(normalizedEmail);
      if (authUser) {
        await adminAuth.setCustomUserClaims(authUser.uid, {});
        await adminAuth.revokeRefreshTokens(authUser.uid);
      }
    } catch {}

    return NextResponse.json({
      success: true,
      message: `Tokens and claims revoked for ${normalizedEmail}`,
    });
  } catch (err) {
    console.error('Error revoking user claims:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
