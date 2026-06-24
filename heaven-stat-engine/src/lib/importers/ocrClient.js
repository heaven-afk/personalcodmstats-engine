/**
 * Uploads a screenshot file to the Next.js backend endpoint for OCR parsing.
 * Returns parsed rows and warnings.
 */
export async function uploadAndParseImage(file, lobbyNumber, type) {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error(`File "${file.name}" exceeds the 20MB limit.`);
  }

  const formData = new FormData();
  formData.append('image', file);
  formData.append('lobbyNumber', lobbyNumber);
  formData.append('type', type);

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
