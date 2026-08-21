// ─── Official Revive Types for Heaven Stat Engine ─────────────────────────────
export const REVIVE_TYPES = [
  { id: 'auto',   label: 'Auto-revive', color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.4)' },
  { id: 'dogtag', label: 'Dog Tags',    color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.4)' },
  { id: 'none',   label: 'No revive',   color: '#6b7280', bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.4)' },
];

export const AVAILABLE_REVIVES = ['auto', 'dogtag', 'none'];

export function getReviveType(id) {
  return REVIVE_TYPES.find(r => r.id === id) || REVIVE_TYPES[0];
}
