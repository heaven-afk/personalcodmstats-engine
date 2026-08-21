import { NextResponse } from 'next/server';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

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

export async function GET(req) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const adminAuth = getAdminAuth();
    await adminAuth.verifyIdToken(token);

    const { searchParams } = new URL(req.url);
    const identifier = searchParams.get('query') || searchParams.get('email') || searchParams.get('uid');

    if (!identifier) {
      return NextResponse.json({ error: 'Search query (email or UID) is required' }, { status: 400 });
    }

    const clean = identifier.trim();

    // 1. Try lookup by email
    if (clean.includes('@')) {
      const normEmail = clean.toLowerCase();
      try {
        const userRecord = await adminAuth.getUserByEmail(normEmail);
        return NextResponse.json({
          uid: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName || userRecord.email,
        });
      } catch {
        // Try Firestore allowedUsers
        try {
          const adminDb = getAdminFirestore();
          const doc = await adminDb.collection('allowedUsers').doc(normEmail).get();
          if (doc.exists && doc.data()?.uid) {
            return NextResponse.json({
              uid: doc.data().uid,
              email: normEmail,
              displayName: doc.data().username || normEmail,
            });
          }
        } catch {}
        return NextResponse.json({ error: 'No user found with that email address' }, { status: 404 });
      }
    }

    // 2. Try lookup by UID
    try {
      const userRecord = await adminAuth.getUser(clean);
      return NextResponse.json({
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName || userRecord.email,
      });
    } catch {
      return NextResponse.json({
        uid: clean,
        email: null,
        displayName: clean,
      });
    }
  } catch (err) {
    console.error('Error looking up user:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
