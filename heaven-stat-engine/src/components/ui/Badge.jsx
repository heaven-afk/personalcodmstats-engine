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

export function ClassBadge({ playerClass }) {
  const isClass2 = playerClass?.includes('2');
  return (
    <span className={`badge ${isClass2 ? 'badge-class2' : 'badge-class1'}`}>
      {playerClass || '—'}
    </span>
  );
}

export function RankBadge({ rank }) {
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
