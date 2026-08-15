import { NextResponse } from 'next/server';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

function getAdminAuth() {
  if (getApps().length > 0) {
    return getAuth(getApps()[0]);
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

  if (serviceAccountKey) {
    try {
      const parsed = JSON.parse(serviceAccountKey);
      const app = initializeApp({ credential: cert(parsed) });
      return getAuth(app);
    } catch {}
  }

  if (serviceAccountPath && existsSync(resolve(serviceAccountPath))) {
    try {
      const parsed = JSON.parse(readFileSync(resolve(serviceAccountPath), 'utf8'));
      const app = initializeApp({ credential: cert(parsed) });
      return getAuth(app);
    } catch {}
  }

  const app = initializeApp();
  return getAuth(app);
}

async function verifyOwner(req) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

  if (!token) {
    return { error: 'Missing authorization token', status: 401 };
  }

  const adminAuth = getAdminAuth();
  const decoded = await adminAuth.verifyIdToken(token);

  const isOwner = decoded.role === 'owner' || decoded.email === 'ogadizion01@gmail.com';
  if (!isOwner) {
    return { error: 'Forbidden: Owner permission required', status: 403 };
  }

  return { caller: decoded, adminAuth };
}

// POST: Sync user custom claims on add
export async function POST(req) {
  try {
    const authCheck = await verifyOwner(req);
    if (authCheck.error) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const { adminAuth } = authCheck;
    const body = await req.json();
    const { email, role = 'operator' } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!['owner', 'operator'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role. Must be "owner" or "operator".' }, { status: 400 });
    }

    // Try setting custom claim if account already exists in Firebase Auth
    let uid = null;
    try {
      const authUser = await adminAuth.getUserByEmail(normalizedEmail);
      if (authUser) {
        uid = authUser.uid;
        await adminAuth.setCustomUserClaims(authUser.uid, { role });
      }
    } catch {
      // User might not have signed up in Firebase Auth yet — claim will sync at login
    }

    return NextResponse.json({
      success: true,
      email: normalizedEmail,
      uid,
      role,
      message: `User ${normalizedEmail} claim synchronized with role "${role}"`
    });
  } catch (err) {
    console.error('Error syncing allowed user claim:', err);
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
      message: `Auth claim for ${normalizedEmail} updated to "${role}"`
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

    // Prevent deleting owner account
    if (normalizedEmail === 'ogadizion01@gmail.com') {
      return NextResponse.json({ error: 'Cannot remove primary owner account' }, { status: 400 });
    }

    // Revoke Firebase Auth tokens & custom claims
    try {
      const authUser = await adminAuth.getUserByEmail(normalizedEmail);
      if (authUser) {
        await adminAuth.setCustomUserClaims(authUser.uid, {});
        await adminAuth.revokeRefreshTokens(authUser.uid);
      }
    } catch {}

    return NextResponse.json({
      success: true,
      message: `Tokens and claims revoked for ${normalizedEmail}`
    });
  } catch (err) {
    console.error('Error revoking user claims:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
