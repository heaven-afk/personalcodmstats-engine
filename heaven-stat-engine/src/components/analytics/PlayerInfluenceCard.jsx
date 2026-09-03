'use client';
import { useState } from 'react';
import MetricTooltip from '@/components/ui/MetricTooltip';
import { Activity, Target, Zap, TrendingUp, Info, FlaskConical, ArrowUp, ArrowDown, Minus, AlertTriangle } from 'lucide-react';

// ─── RatingBar (mirrors analytics/page.jsx pattern) ──────────────────────────
export function RatingBar({ label, value, displayValue, metricKey, type = 'primary' }) {
  const pct = Math.min(100, ((value || 0) / 10) * 100); // value is 0–10
  return (
    <div className="rating-bar-row">
      <span className="rating-bar-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {metricKey && <MetricTooltip metricKey={metricKey} />}
      </span>
      <div className="rating-bar-track">
        <div className={`rating-bar-fill ${type}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="rating-bar-val">
        {displayValue ?? (value != null ? value.toFixed(1) : '—')}
      </span>
    </div>
  );
}

// ─── Influence label → color ──────────────────────────────────────────────────
export function influenceColor(label) {
  if (!label) return 'var(--text-muted)';
  if (label === 'Elite Influence')    return '#c9a84c'; // gold
  if (label === 'High Influence')     return '#4ade80'; // green
  if (label === 'Moderate Influence') return '#60a5fa'; // blue
  return 'var(--text-secondary)';                       // low
}

// ─── Contribution bar (raw %, with baseline marker) ──────────────────────────
export function ContributionBar({ pct, baselinePct, label, metricKey }) {
  const fill = Math.min(100, pct);
  const aboveBaseline = pct >= baselinePct;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {label}
          {metricKey && <MetricTooltip metricKey={metricKey} />}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '1rem',
          color: aboveBaseline ? '#4ade80' : 'var(--text-secondary)',
        }}>
          {pct}%
        </span>
      </div>

      {/* Track with baseline marker */}
      <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'var(--bg-alt-row)', overflow: 'visible' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${fill}%`, borderRadius: 4,
          background: aboveBaseline
            ? 'linear-gradient(90deg, rgba(74,222,128,0.35), rgba(74,222,128,0.7))'
            : 'linear-gradient(90deg, rgba(96,165,250,0.35), rgba(96,165,250,0.6))',
          transition: 'width 0.4s ease',
        }} />
        {/* Baseline tick */}
        <div style={{
          position: 'absolute', top: -3, bottom: -3,
          left: `${Math.min(100, baselinePct)}%`,
          width: 2, background: 'var(--gold)', borderRadius: 1,
        }} title={`Baseline: ${baselinePct}%`} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Baseline: <strong style={{ color: 'var(--gold)' }}>{baselinePct}%</strong>
        </span>
      </div>
    </div>
  );
}

// ─── xG Card component ───────────────────────────────────────────────────────
export function XGCard({ xgSummary }) {
  const isUnranked = !xgSummary || xgSummary.confidence === 'unranked';
  const isProvisional = xgSummary?.confidence === 'provisional';

  const delta = xgSummary?.avgDelta ?? null;
  const overperformed = delta != null && delta > 0;
  const underperformed = delta != null && delta < 0;

  const deltaColor  = overperformed ? '#4ade80' : underperformed ? '#f87171' : 'var(--text-muted)';
  const DeltaIcon   = overperformed ? ArrowUp   : underperformed ? ArrowDown  : Minus;

  return (
    <div className="card">
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)',
      }}>
        <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FlaskConical size={16} style={{ color: 'var(--gold)' }} />
          Expected Kills (xG)
          <MetricTooltip metricKey="player_xg" />
        </h3>
        {!isUnranked && isProvisional && (
          <span style={{
            fontSize: '0.68rem', color: 'var(--text-muted)',
            background: 'var(--bg-alt-row)', border: '1px solid var(--border-md)',
            borderRadius: 6, padding: '2px 8px',
          }}>
            Provisional — {xgSummary.matchCount} matches
          </span>
        )}
      </div>

      {isUnranked ? (
        /* Insufficient history */
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '32px 16px', gap: 10,
          color: 'var(--text-muted)', textAlign: 'center',
        }}>
          <Info size={28} style={{ opacity: 0.4 }} />
          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Insufficient History</span>
          <span style={{ fontSize: '0.78rem', maxWidth: 380 }}>
            xG requires at least 3 matches with accuracy and damage data recorded.
            Once enough data is available the model will calibrate automatically.
          </span>
        </div>
      ) : (
        <>
          {/* Hero metrics */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 12, marginBottom: 20,
          }}>
            {/* Avg xG */}
            <div style={{
              padding: '14px 16px', background: 'var(--bg-alt-row)',
              border: '1px solid var(--border-md)', borderRadius: 10,
            }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>Avg xG / Match</div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.5rem',
                color: 'var(--gold)',
              }}>
                {xgSummary.avgXG ?? '—'}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>expected kills</div>
            </div>

            {/* Avg Delta */}
            <div style={{
              padding: '14px 16px', background: 'var(--bg-alt-row)',
              border: `1px solid ${overperformed ? 'rgba(74,222,128,0.3)' : underperformed ? 'rgba(248,113,113,0.3)' : 'var(--border-md)'}`,
              borderRadius: 10,
            }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>Avg Δ (Actual − xG)</div>
              <div style={{
                fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.5rem',
                color: deltaColor,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <DeltaIcon size={16} />
                {delta != null ? (delta > 0 ? '+' : '') + delta : '—'}
              </div>
              <div style={{ fontSize: '0.65rem', color: deltaColor, marginTop: 2, opacity: 0.8 }}>
                {overperformed ? 'overperforming' : underperformed ? 'underperforming' : 'on baseline'}
              </div>
            </div>

            {/* Baselines */}
            <div style={{
              padding: '14px 16px', background: 'var(--bg-alt-row)',
              border: '1px solid var(--border-md)', borderRadius: 10,
            }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>Decayed Baselines</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {[['Kills', xgSummary.decayedKills], ['Accuracy', xgSummary.decayedAccuracy ? xgSummary.decayedAccuracy + '%' : null], ['Damage', xgSummary.decayedDamage]].map(([lbl, val]) => (
                  <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{lbl}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', fontWeight: 600 }}>{val ?? '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent match xG history (up to 8) */}
          {xgSummary.matchXGs?.length > 0 && (
            <div>
              <div style={{
                fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
              }}>
                Recent Matches
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ fontSize: '0.78rem' }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Actual</th>
                      <th>xG</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {xgSummary.matchXGs.slice(0, 8).map((m, i) => {
                      const d = m.delta;
                      const dColor = d > 0 ? '#4ade80' : d < 0 ? '#f87171' : 'var(--text-muted)';
                      return (
                        <tr key={i}>
                          <td style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{m.kills}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold)' }}>{m.xG}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: dColor, fontWeight: 700 }}>
                            {d > 0 ? '+' : ''}{d}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Reusable PlayerInfluenceCard Component ─────────────────────────────
export default function PlayerInfluenceCard({ influence, xgSummary, scopeLabel = 'Advanced influence metrics — only duo/trio/squad matches are included.' }) {
  const hasInfluence = influence?.eligible;
  const { influenceScore, label, isProvisional, sampleSize, breakdown } = influence || {};
  const labelColor = influenceColor(label);

  return (
    <div className="space-y-6">
      {/* ── Player Influence Card ─────────────────────────────────────────── */}
      <div className="card">
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)',
        }}>
          <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <TrendingUp size={16} style={{ color: 'var(--gold)' }} />
            Player Influence
            <MetricTooltip metricKey="player_influence" />
          </h3>
          {isProvisional && (
            <span style={{
              fontSize: '0.68rem', color: 'var(--text-muted)',
              background: 'var(--bg-alt-row)', border: '1px solid var(--border-md)',
              borderRadius: 6, padding: '2px 8px',
            }}>
              Provisional — {sampleSize?.with ?? 0} / {sampleSize?.without ?? 0} matches
            </span>
          )}
        </div>

        {!hasInfluence ? (
          /* Insufficient or no match records */
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '32px 16px', gap: 10,
            color: 'var(--text-muted)', textAlign: 'center',
          }}>
            <Info size={28} style={{ opacity: 0.4 }} />
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>No Match Data Available</span>
            <span style={{ fontSize: '0.78rem', maxWidth: 360 }}>
              Player Influence requires at least one match result recorded for this player and their team.
            </span>
          </div>
        ) : (
          <>
            {/* Score hero */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
              <div style={{
                width: 88, height: 88, borderRadius: '50%',
                background: 'var(--bg-alt-row)',
                border: `3px solid ${labelColor}`,
                boxShadow: `0 0 24px ${labelColor}33`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontWeight: 800,
                  fontSize: '1.8rem', color: labelColor, lineHeight: 1,
                }}>
                  {influenceScore != null ? influenceScore.toFixed(1) : '—'}
                </span>
                <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: 2 }}>/10</span>
              </div>

              <div>
                {label && (
                  <div style={{
                    fontSize: '1.05rem', fontWeight: 700, color: labelColor, marginBottom: 4,
                  }}>
                    {label}
                  </div>
                )}
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  <span>
                    Present in <strong style={{ color: 'var(--text-secondary)' }}>{sampleSize?.with}</strong> matches
                    {' '}· Absent in <strong style={{ color: 'var(--text-secondary)' }}>{sampleSize?.without}</strong> matches
                  </span>
                  {isProvisional && (
                    <div style={{ marginTop: 2, color: '#f59e0b', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AlertTriangle size={12} style={{ color: '#f59e0b', flexShrink: 0 }} /> Provisional — fewer than 3 matches in one or both groups
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sub-score breakdown bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <RatingBar
                label="Positional Finish"
                value={breakdown?.positionalScore ?? 0}
                metricKey="player_influence"
                type="primary"
              />
              <RatingBar
                label="Team Kills Uplift"
                value={breakdown?.teamKillsScore ?? 0}
                metricKey="player_influence"
                type="primary"
              />
              <RatingBar
                label="Kills Contribution"
                value={breakdown?.killsContribution?.score ?? 0}
                metricKey="kills_contribution"
                type="secondary"
              />
              <RatingBar
                label="Damage Contribution"
                value={breakdown?.damageContribution?.score ?? 0}
                metricKey="damage_contribution"
                type="secondary"
              />
            </div>
          </>
        )}
      </div>

      {/* ── Contribution Cards (2-col grid) ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Kills Contribution */}
        <div className="card">
          <h3 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
            <Target size={16} style={{ color: '#4ade80' }} />
            Kills Contribution
          </h3>

          {!hasInfluence || !breakdown?.killsContribution ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              No team match data recorded for kills contribution.
            </p>
          ) : (
            <div className="space-y-4">
              <ContributionBar
                pct={breakdown.killsContribution.percent}
                baselinePct={breakdown.killsContribution.baselinePercent}
                label="Avg Kill Share"
                metricKey="kills_contribution"
              />
              <div style={{
                padding: '10px 12px', background: 'var(--bg-alt-row)',
                borderRadius: 8, border: '1px solid var(--border-md)',
                fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6,
              }}>
                This player accounts for an average of{' '}
                <strong style={{ color: breakdown.killsContribution.percent >= breakdown.killsContribution.baselinePercent ? '#4ade80' : 'var(--text-secondary)' }}>
                  {breakdown.killsContribution.percent}%
                </strong>
                {' '}of team kills. The equal-share baseline for their team size is{' '}
                <strong style={{ color: 'var(--gold)' }}>{breakdown.killsContribution.baselinePercent}%</strong>.
              </div>
            </div>
          )}
        </div>

        {/* Damage Contribution */}
        <div className="card">
          <h3 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
            <Zap size={16} style={{ color: '#f59e0b' }} />
            Damage Contribution
          </h3>

          {!hasInfluence || !breakdown?.damageContribution ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              No team match data recorded for damage contribution.
            </p>
          ) : (
            <div className="space-y-4">
              <ContributionBar
                pct={breakdown.damageContribution.percent}
                baselinePct={breakdown.damageContribution.baselinePercent}
                label="Avg Damage Share"
                metricKey="damage_contribution"
              />
              <div style={{
                padding: '10px 12px', background: 'var(--bg-alt-row)',
                borderRadius: 8, border: '1px solid var(--border-md)',
                fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6,
              }}>
                This player dealt an average of{' '}
                <strong style={{ color: breakdown.damageContribution.percent >= breakdown.damageContribution.baselinePercent ? '#4ade80' : 'var(--text-secondary)' }}>
                  {breakdown.damageContribution.percent}%
                </strong>
                {' '}of total team damage. Baseline: <strong style={{ color: 'var(--gold)' }}>{breakdown.damageContribution.baselinePercent}%</strong>.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── xG Card ──────────────────────────────────────────────────────── */}
      <XGCard xgSummary={xgSummary} />
    </div>
  );
}
