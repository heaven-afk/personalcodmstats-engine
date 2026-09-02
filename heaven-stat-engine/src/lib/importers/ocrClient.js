import { logOcrScan } from '@/lib/firestore/ocrLogs';

/**
 * Uploads a screenshot file to the Next.js backend endpoint for OCR parsing.
 * Returns parsed rows and warnings.
 * Automatically logs scan metrics to Firestore for the Admin Dashboard.
 *
 * @param {File} file - The image file to parse
 * @param {number} lobbyNumber - The lobby number
 * @param {string} type - 'team' or 'player'
 * @param {number} [keyIndex=0] - Which Gemini API key to use (0 = key1, 1 = key2).
 * @param {Object} [metadata={}] - Optional metadata (tournamentId, userEmail, userName)
 */
export async function uploadAndParseImage(file, lobbyNumber, type, keyIndex = 0, metadata = {}) {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error(`File "${file.name}" exceeds the 20MB limit.`);
  }

  const startTime = Date.now();
  const formData = new FormData();
  formData.append('image', file);
  formData.append('lobbyNumber', lobbyNumber);
  formData.append('type', type);
  formData.append('keyIndex', keyIndex.toString());

  try {
    const res = await fetch('/api/ocr/extract', {
      method: 'POST',
      body: formData,
    });

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const errorMsg = errorData.message || errorData.error || `Server responded with status ${res.status}`;

      // Log failure to Firestore
      logOcrScan({
        keyIndex,
        model: 'gemini-2.5-flash',
        success: false,
        latencyMs,
        errorCode: errorData.error || `HTTP_${res.status}`,
        type,
        lobbyNumber,
        fileName: file.name,
        tournamentId: metadata.tournamentId || null,
        userEmail: metadata.userEmail || null,
        userName: metadata.userName || null,
      });

      throw new Error(errorMsg);
    }

    const data = await res.json();

    // Log success to Firestore
    logOcrScan({
      keyIndex: data.keyIndex ?? keyIndex,
      model: data.model || 'gemini-2.5-flash',
      success: true,
      latencyMs,
      type,
      lobbyNumber,
      fileName: file.name,
      tournamentId: metadata.tournamentId || null,
      userEmail: metadata.userEmail || null,
      userName: metadata.userName || null,
    });

    return data;
  } catch (err) {
    // If it was a network error not caught above
    if (!err.message?.includes('Server responded')) {
      const latencyMs = Date.now() - startTime;
      logOcrScan({
        keyIndex,
        model: 'gemini-2.5-flash',
        success: false,
        latencyMs,
        errorCode: 'network_error',
        type,
        lobbyNumber,
        fileName: file.name,
        tournamentId: metadata.tournamentId || null,
        userEmail: metadata.userEmail || null,
        userName: metadata.userName || null,
      });
    }
    throw err;
  }
}
