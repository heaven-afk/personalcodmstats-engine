/**
 * Safe utility to check if a user is in a tournament's editor list.
 * Handles strings (uid or email), objects ({ uid, email }), and protects against null/undefined.
 */
export function isUserAssignedEditor(editorUids, userUid, userEmail) {
  if (!Array.isArray(editorUids) || editorUids.length === 0) return false;
  const cleanEmail = userEmail ? String(userEmail).toLowerCase().trim() : null;
  const cleanUid = userUid ? String(userUid).trim() : null;

  return editorUids.some((item) => {
    if (!item) return false;
    if (typeof item === 'string') {
      const cleanItem = item.trim();
      if (cleanUid && cleanItem === cleanUid) return true;
      if (cleanEmail && cleanItem.toLowerCase() === cleanEmail) return true;
      return false;
    }
    if (typeof item === 'object') {
      const itemUid = item.uid ? String(item.uid).trim() : null;
      const itemEmail = item.email ? String(item.email).toLowerCase().trim() : null;
      if (cleanUid && itemUid === cleanUid) return true;
      if (cleanEmail && itemEmail === cleanEmail) return true;
      return false;
    }
    return false;
  });
}
