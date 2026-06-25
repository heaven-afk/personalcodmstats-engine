export function cleanImageUrl(url) {
  if (!url) return '';
  let clean = url.trim();
  
  // 1. Rewrite http to https
  if (clean.startsWith('http://')) {
    clean = clean.replace('http://', 'https://');
  }
  
  // 2. Handle Imgur page to direct link conversions
  // Matches: imgur.com/abc123yz
  const imgurPattern = /^https?:\/\/(?:www\.|i\.)?imgur\.com\/([a-zA-Z0-9]+)$/;
  if (imgurPattern.test(clean)) {
    const match = clean.match(imgurPattern);
    if (match && match[1]) {
      return `https://i.imgur.com/${match[1]}.png`;
    }
  }

  // 3. Handle Imgur gallery/album links if they pasted one
  // Matches: imgur.com/a/abc123yz or imgur.com/gallery/abc123yz
  const imgurGalleryPattern = /^https?:\/\/(?:www\.)?imgur\.com\/(?:a|gallery)\/([a-zA-Z0-9]+)$/;
  if (imgurGalleryPattern.test(clean)) {
    const match = clean.match(imgurGalleryPattern);
    if (match && match[1]) {
      return `https://i.imgur.com/${match[1]}.png`;
    }
  }

  return clean;
}
