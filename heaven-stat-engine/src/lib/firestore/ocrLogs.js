import {
  collection, addDoc, getDocs, query,
  orderBy, limit, serverTimestamp
} from 'firebase/firestore';
import { db, isFirebaseConfigured, auth } from '../firebase';

const COLLECTION = 'ocrLogs';

/**
 * Log a single OCR scan result to Firestore.
 * Automatically picks up the active authenticated user's email/name.
 */
export async function logOcrScan({
  keyIndex = 0,
  model = 'gemini-2.5-flash',
  success = true,
  latencyMs = null,
  errorCode = null,
  type = 'team',
  lobbyNumber = null,
  fileName = '',
  tournamentId = null,
  userEmail = null,
  userName = null,
  userId = null,
}) {
  if (!isFirebaseConfigured || !db) return;
  try {
    const currentAuthUser = typeof window !== 'undefined' ? auth?.currentUser : null;
    const resolvedEmail = userEmail || currentAuthUser?.email || 'unknown';
    const resolvedName = userName || currentAuthUser?.displayName || (resolvedEmail.split('@')[0]) || 'User';
    const resolvedUid = userId || currentAuthUser?.uid || null;

    await addDoc(collection(db, COLLECTION), {
      keyIndex: keyIndex ?? 0,
      model: model || 'gemini-2.5-flash',
      success: Boolean(success),
      latencyMs: latencyMs ?? null,
      errorCode: errorCode || null,
      type: type || 'team',
      lobbyNumber: lobbyNumber ?? null,
      fileName: fileName || '',
      tournamentId: tournamentId || null,
      userEmail: resolvedEmail,
      userName: resolvedName,
      userId: resolvedUid,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[ocrLogs] Failed to write log:', err.message);
  }
}

/**
 * Fetch OCR log entries for the last N days across all users. Owner-only.
 * Fetches recent logs ordered by createdAt and filters by date in memory
 * to avoid requiring complex composite indexes in Firestore.
 */
export async function fetchOcrLogs(days = 1) {
  if (!isFirebaseConfigured || !db) return [];
  try {
    const q = query(
      collection(db, COLLECTION),
      orderBy('createdAt', 'desc'),
      limit(500)
    );
    const snap = await getDocs(q);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filter by date cutoff
    return docs.filter(doc => {
      if (!doc.createdAt) return true;
      const docDate = doc.createdAt?.toDate ? doc.createdAt.toDate() : new Date(doc.createdAt);
      return docDate >= since;
    });
  } catch (err) {
    console.warn('[ocrLogs] Failed to fetch logs:', err.message);
    return [];
  }
}

/**
 * Compute summary stats from a list of OCR log entries.
 */
export function computeOcrStats(logs) {
  if (!logs.length) return {
    total: 0, success: 0, failed: 0, successRate: 0,
    avgLatencyMs: 0, key1Count: 0, key2Count: 0,
    estimatedCostUsd: 0, modelBreakdown: {}, userBreakdown: {},
  };

  const success = logs.filter(l => l.success).length;
  const failed = logs.length - success;
  const successRate = Math.round((success / logs.length) * 100);

  const latencies = logs.filter(l => l.latencyMs).map(l => l.latencyMs);
  const avgLatencyMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;

  const key1Count = logs.filter(l => l.keyIndex === 0).length;
  const key2Count = logs.filter(l => l.keyIndex === 1).length;

  // Very rough cost estimate: ~0.0002 USD per scan on gemini-2.5-flash paid tier
  const estimatedCostUsd = parseFloat((logs.length * 0.0002).toFixed(4));

  const modelBreakdown = {};
  logs.forEach(l => {
    if (l.model) modelBreakdown[l.model] = (modelBreakdown[l.model] || 0) + 1;
  });

  const userBreakdown = {};
  logs.forEach(l => {
    const userLabel = l.userEmail || l.userName || 'Unknown User';
    userBreakdown[userLabel] = (userBreakdown[userLabel] || 0) + 1;
  });

  return {
    total: logs.length,
    success,
    failed,
    successRate,
    avgLatencyMs,
    key1Count,
    key2Count,
    estimatedCostUsd,
    modelBreakdown,
    userBreakdown,
  };
}
