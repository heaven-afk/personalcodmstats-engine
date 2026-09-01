import { NextResponse } from 'next/server';
import {
  collection, addDoc, serverTimestamp
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '@/lib/firebase';

/**
 * POST /api/ocr/log
 * Internal endpoint — logs an OCR scan result to Firestore.
 * Called fire-and-forget from the OCR extract route.
 */
export async function POST(req) {
  try {
    if (!isFirebaseConfigured || !db) {
      return NextResponse.json({ ok: false, reason: 'firebase_not_configured' });
    }

    const body = await req.json();
    const { keyIndex, model, success, latencyMs, errorCode, type, lobbyNumber } = body;

    await addDoc(collection(db, 'ocrLogs'), {
      keyIndex: keyIndex ?? 0,
      model: model || 'unknown',
      success: Boolean(success),
      latencyMs: latencyMs ?? null,
      errorCode: errorCode || null,
      type: type || 'team',
      lobbyNumber: lobbyNumber ?? null,
      createdAt: serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Non-critical — swallow errors so OCR never fails because of logging
    console.warn('[OCR Log] Failed to write:', err.message);
    return NextResponse.json({ ok: false, reason: err.message });
  }
}
