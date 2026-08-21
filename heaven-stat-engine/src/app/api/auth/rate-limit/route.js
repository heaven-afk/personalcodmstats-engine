import { NextResponse } from 'next/server';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ─── Tunable Rate Limiting Parameters ─────────────────────────────────────────
export const MAX_ATTEMPTS = 5;      // Max failed attempts before lockout
export const WINDOW_MINUTES = 15;   // Sliding attempt window in minutes
export const LOCKOUT_MINUTES = 15;  // Duration of lockout in minutes

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

function getAdminFirestore() {
  return getFirestore(getAdminApp());
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { action, email } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const adminDb = getAdminFirestore();
    const docRef = adminDb.collection('loginRateLimits').doc(normalizedEmail);
    const nowMs = Date.now();

    // ─── Action: CHECK ────────────────────────────────────────────────────────
    if (action === 'check') {
      const snap = await docRef.get();
      if (!snap.exists) {
        return NextResponse.json({ locked: false });
      }

      const data = snap.data();
      const lockedUntilMs = data.lockedUntil ? (data.lockedUntil.toMillis ? data.lockedUntil.toMillis() : new Date(data.lockedUntil).getTime()) : null;

      if (lockedUntilMs && lockedUntilMs > nowMs) {
        const retryAfterSeconds = Math.ceil((lockedUntilMs - nowMs) / 1000);
        const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);
        return NextResponse.json(
          {
            locked: true,
            retryAfterSeconds,
            retryAfterMinutes,
            message: `Too many failed login attempts. Account temporarily locked. Try again in ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? '' : 's'}.`,
          },
          { status: 403 }
        );
      }

      // If lockout expired or window expired, check if we need to clean up
      const firstAttemptAtMs = data.firstAttemptAt ? (data.firstAttemptAt.toMillis ? data.firstAttemptAt.toMillis() : new Date(data.firstAttemptAt).getTime()) : null;
      if (firstAttemptAtMs && (nowMs - firstAttemptAtMs) > (WINDOW_MINUTES * 60 * 1000) && (!lockedUntilMs || lockedUntilMs <= nowMs)) {
        await docRef.delete();
      }

      return NextResponse.json({ locked: false });
    }

    // ─── Action: RECORD FAILURE ───────────────────────────────────────────────
    if (action === 'record-failure') {
      const snap = await docRef.get();
      let failedAttempts = 1;
      let firstAttemptAt = Timestamp.fromMillis(nowMs);
      let lockedUntil = null;

      if (snap.exists) {
        const data = snap.data();
        const firstAttemptAtMs = data.firstAttemptAt ? (data.firstAttemptAt.toMillis ? data.firstAttemptAt.toMillis() : new Date(data.firstAttemptAt).getTime()) : nowMs;
        const isWindowExpired = (nowMs - firstAttemptAtMs) > (WINDOW_MINUTES * 60 * 1000);

        if (isWindowExpired) {
          // Restart window
          failedAttempts = 1;
          firstAttemptAt = Timestamp.fromMillis(nowMs);
        } else {
          failedAttempts = (data.failedAttempts || 0) + 1;
          firstAttemptAt = data.firstAttemptAt || Timestamp.fromMillis(nowMs);
        }

        if (failedAttempts >= MAX_ATTEMPTS) {
          const lockDurationMs = LOCKOUT_MINUTES * 60 * 1000;
          lockedUntil = Timestamp.fromMillis(nowMs + lockDurationMs);
        }
      }

      await docRef.set({
        email: normalizedEmail,
        failedAttempts,
        firstAttemptAt,
        lockedUntil,
        updatedAt: Timestamp.fromMillis(nowMs),
      });

      if (lockedUntil) {
        const retryAfterMinutes = LOCKOUT_MINUTES;
        return NextResponse.json({
          locked: true,
          failedAttempts,
          retryAfterMinutes,
          message: `Too many failed login attempts. Account temporarily locked. Try again in ${retryAfterMinutes} minutes.`,
        });
      }

      const remainingAttempts = Math.max(0, MAX_ATTEMPTS - failedAttempts);
      return NextResponse.json({
        locked: false,
        failedAttempts,
        remainingAttempts,
      });
    }

    // ─── Action: RESET (On successful login) ──────────────────────────────────
    if (action === 'reset') {
      await docRef.delete();
      return NextResponse.json({ success: true, message: 'Rate limit reset' });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error('Error in /api/auth/rate-limit:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
