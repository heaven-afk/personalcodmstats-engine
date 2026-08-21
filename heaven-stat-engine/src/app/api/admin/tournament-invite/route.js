import { NextResponse } from 'next/server';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { buildTournamentInviteEmail } from '@/lib/email/templates';
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

export async function POST(req) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : '';

    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const adminAuth = getAdminAuth();
    const adminDb = getAdminFirestore();
    const decoded = await adminAuth.verifyIdToken(token);

    const body = await req.json();
    const { tournamentId, tournamentName, inviteeEmail, inviteeUid } = body;

    if (!tournamentId) {
      return NextResponse.json({ error: 'tournamentId is required' }, { status: 400 });
    }

    // Verify caller has edit access to this tournament
    const isOwner = decoded.role === 'owner' || (process.env.OWNER_EMAIL && decoded.email?.toLowerCase() === process.env.OWNER_EMAIL.toLowerCase());
    let canEdit = isOwner;

    if (!canEdit) {
      try {
        const tourneyDoc = await adminDb.collection('tournaments').doc(tournamentId).get();
        if (tourneyDoc.exists) {
          const editorUids = tourneyDoc.data()?.editorUids || [];
          if (editorUids.includes(decoded.uid)) {
            canEdit = true;
          }
        }
      } catch (err) {
        console.warn('Error checking tournament editor access in API:', err);
      }
    }

    if (!canEdit) {
      return NextResponse.json({ error: 'Forbidden: Edit access required' }, { status: 403 });
    }

    // Resolve invitee email
    let targetEmail = inviteeEmail;
    if (!targetEmail && inviteeUid) {
      try {
        const userRecord = await adminAuth.getUser(inviteeUid);
        targetEmail = userRecord.email;
      } catch {}
    }

    if (!targetEmail) {
      return NextResponse.json({ error: 'Could not resolve email for invitee' }, { status: 400 });
    }

    // Send email
    const emailTemplate = buildTournamentInviteEmail({
      toEmail: targetEmail,
      tournamentName: tournamentName || 'Tournament',
      tournamentId,
    });

    const sendRes = await sendEmail({
      to: targetEmail,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
    });

    return NextResponse.json({
      success: true,
      email: targetEmail,
      sendResult: sendRes,
    });
  } catch (err) {
    console.error('Error sending tournament invite email:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
