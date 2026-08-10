import MetricTooltip from './MetricTooltip';

export function StatusBadge({ status }) {
  const map = {
    setup:     { label: 'Setup',     cls: 'badge-setup' },
    active:    { label: 'Active',    cls: 'badge-active' },
    completed: { label: 'Completed', cls: 'badge-completed' },
    archived:  { label: 'Archived',  cls: 'badge-archived' },
  };
  const { label, cls } = map[status] || { label: status, cls: '' };
  return <span className={`badge ${cls}`}>{label}</span>;
}

// ─── Tier Badge ─────────────────────────────────────────────────────────────
// Displays a ranked tier label (Tier 1 / Tier 2 / Tier 3) with distinct
// gold / silver / bronze colour treatment.
export function TierBadge({ tier, size = 'sm' }) {
  if (!tier) return null;
  const map = {
    'Tier 1': { icon: '🏅', bg: 'linear-gradient(135deg,#b8860b,#d4a017)', border: '#C9A84C', color: '#fff', label: 'Tier 1' },
    'Tier 2': { icon: '🥈', bg: 'linear-gradient(135deg,#6b7280,#9ca3af)', border: '#9ca3af', color: '#fff', label: 'Tier 2' },
    'Tier 3': { icon: '🥉', bg: 'linear-gradient(135deg,#92400e,#b45309)', border: '#b45309', color: '#fff', label: 'Tier 3' },
  };
  const cfg = map[tier];
  if (!cfg) return null;
  const fontSize = size === 'xs' ? '0.6rem' : size === 'sm' ? '0.68rem' : '0.78rem';
  const padding  = size === 'xs' ? '2px 6px'  : size === 'sm' ? '3px 8px'  : '4px 10px';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      borderRadius: 99, color: cfg.color, fontSize, fontWeight: 800,
      padding, letterSpacing: '0.04em', textTransform: 'uppercase',
      boxShadow: `0 1px 4px ${cfg.border}55`,
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

export function ClassBadge({ playerClass }) {
  const isClass2 = playerClass?.includes('2');
  return (
    <span className={`badge ${isClass2 ? 'badge-class2' : 'badge-class1'}`}>
      {playerClass || '—'}
    </span>
  );
}

export function RankBadge({ rank, label }) {
  if (label) {
    const isPositive = ['Elite Rank', 'Top Rank', 'Pro Rank'].includes(label);
    return (
      <span className={`badge ${isPositive ? 'badge-positive' : 'badge-neutral-rating'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
        {label}
        <MetricTooltip metricKey={label} />
      </span>
    );
  }
  const cls = rank === 1 ? 'badge-rank1' : rank === 2 ? 'badge-rank2' : rank === 3 ? 'badge-rank3' : '';
  return <span className={`rank-badge ${cls}`}>{rank}</span>;
}

export function PlaystyleBadge({ label }) {
  const cls = label === 'Aggressive' ? 'badge-aggressive' : label === 'Passive' ? 'badge-passive' : 'badge-balanced';
  return (
    <span className={`badge ${cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      {label}
      <MetricTooltip metricKey={label} />
    </span>
  );
}

export function RatingBadge({ label, type }) {
  // type: power | placement | conversion
  const positiveLabels = ['Dominant', 'Strong', 'Elite', 'Solid', 'Excellent', 'Good'];
  const positive = positiveLabels.includes(label);
  return (
    <span className={`badge ${positive ? 'badge-positive' : 'badge-neutral-rating'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      {label}
      <MetricTooltip metricKey={label} />
    </span>
  );
}
