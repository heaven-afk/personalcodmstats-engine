import { NextResponse } from 'next/server';

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

// In-memory throttle: max 1 reset request per email per 2 minutes
const resetThrottle = new Map();
const THROTTLE_MS = 2 * 60 * 1000;

export async function POST(req) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Throttle: 1 request per email per 2 minutes
    const lastSent = resetThrottle.get(normalizedEmail);
    if (lastSent && Date.now() - lastSent < THROTTLE_MS) {
      return NextResponse.json({
        success: true,
        message: 'If that email is on our system, a reset link has been sent.',
      });
    }

    const app = await getAdminApp();
    const { getAuth } = await import('firebase-admin/auth');
    const { getFirestore } = await import('firebase-admin/firestore');

    const adminAuth = getAuth(app);
    const adminDb = getFirestore(app);

    // Verify email is on the allowlist
    const allowedDoc = await adminDb.collection('allowedUsers').doc(normalizedEmail).get();
    if (!allowedDoc.exists) {
      return NextResponse.json({
        success: true,
        message: 'If that email is on our system, a reset link has been sent.',
      });
    }

    // Generate Firebase password reset link
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const actionCodeSettings = {
      url: `${baseUrl.replace(/\/$/, '')}/login`,
      handleCodeInApp: false,
    };

    let resetLink;
    try {
      resetLink = await adminAuth.generatePasswordResetLink(normalizedEmail, actionCodeSettings);
    } catch (authErr) {
      console.warn('[forgot-password] Could not generate reset link:', authErr.message);
      return NextResponse.json({
        success: true,
        message: 'If that email is on our system, a reset link has been sent.',
      });
    }

    resetThrottle.set(normalizedEmail, Date.now());

    // Dispatch the reset email
    const { buildPasswordResetEmail } = await import('@/lib/email/templates');
    const { sendEmail } = await import('@/lib/email/send');

    const emailTemplate = buildPasswordResetEmail({ toEmail: normalizedEmail, resetLink });
    await sendEmail({
      to: normalizedEmail,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
    });

    return NextResponse.json({
      success: true,
      message: 'If that email is on our system, a reset link has been sent.',
    });
  } catch (err) {
    console.error('Fatal error in /api/auth/forgot-password:', err);
    return NextResponse.json({
      success: true,
      message: 'If that email is on our system, a reset link has been sent.',
    });
  }
}