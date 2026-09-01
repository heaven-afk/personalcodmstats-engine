/**
 * Uploads a screenshot file to the Next.js backend endpoint for OCR parsing.
 * Returns parsed rows and warnings.
 * @param {File} file - The image file to parse
 * @param {number} lobbyNumber - The lobby number
 * @param {string} type - 'team' or 'player'
 * @param {number} [keyIndex=0] - Which Gemini API key to use (0 = key1, 1 = key2). Alternate per image for parallel throughput.
 */
export async function uploadAndParseImage(file, lobbyNumber, type, keyIndex = 0) {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error(`File "${file.name}" exceeds the 20MB limit.`);
  }

  const formData = new FormData();
  formData.append('image', file);
  formData.append('lobbyNumber', lobbyNumber);
  formData.append('type', type);
  formData.append('keyIndex', keyIndex.toString());

  const res = await fetch('/api/ocr/extract', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || `Server responded with status ${res.status}`);
  }

  return await res.json();
}
