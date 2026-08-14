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

export async function POST(req) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const adminAuth = getAdminAuth();
    const decoded = await adminAuth.verifyIdToken(token);

    // Only owner can assign roles
    const isOwner = decoded.role === 'owner' || decoded.email === 'ogadizion01@gmail.com';
    if (!isOwner) {
      return NextResponse.json({ error: 'Forbidden: Owner permission required' }, { status: 403 });
    }

    const body = await req.json();
    const { targetUid, targetEmail, role } = body;

    if (!['owner', 'operator'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role. Must be "owner" or "operator".' }, { status: 400 });
    }

    let uid = targetUid;
    if (!uid && targetEmail) {
      const user = await adminAuth.getUserByEmail(targetEmail);
      uid = user.uid;
    }

    if (!uid) {
      return NextResponse.json({ error: 'targetUid or targetEmail is required' }, { status: 400 });
    }

    await adminAuth.setCustomUserClaims(uid, { role });

    return NextResponse.json({
      success: true,
      message: `Role "${role}" successfully set for user ${uid}`,
      uid,
      role
    });
  } catch (err) {
    console.error('Error setting user role:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
