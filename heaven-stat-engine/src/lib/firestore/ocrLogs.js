import {
  collection, addDoc, getDocs, query, where,
  orderBy, limit, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';

const COLLECTION = 'ocrLogs';

/**
 * Log a single OCR scan result — called from the API route via a fire-and-forget
 * fetch to an internal logging endpoint (keeps the route server-side).
 */
export async function logOcrScan({ keyIndex, model, success, latencyMs, errorCode, type, lobbyNumber }) {
  if (!isFirebaseConfigured || !db) return;
  try {
    await addDoc(collection(db, COLLECTION), {
      keyIndex: keyIndex ?? 0,
      model: model || 'unknown',
      success: Boolean(success),
      latencyMs: latencyMs ?? null,
      errorCode: errorCode || null,
      type: type || 'team',
      lobbyNumber: lobbyNumber ?? null,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[ocrLogs] Failed to write log:', err.message);
  }
}

/**
 * Fetch OCR log entries for the last N days. Owner-only.
 */
export async function fetchOcrLogs(days = 1) {
  if (!isFirebaseConfigured || !db) return [];
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const q = query(
      collection(db, COLLECTION),
      where('createdAt', '>=', Timestamp.fromDate(since)),
      orderBy('createdAt', 'desc'),
      limit(500)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
    estimatedCostUsd: 0, modelBreakdown: {},
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

  return { total: logs.length, success, failed, successRate, avgLatencyMs, key1Count, key2Count, estimatedCostUsd, modelBreakdown };
}
