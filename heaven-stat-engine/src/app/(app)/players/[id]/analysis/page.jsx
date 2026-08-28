'use client';
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { usePlayer } from '../layout';
import { useAuth } from '@/contexts/AuthContext';
import { getTournaments, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getPlayerMatchResults, getTeamMatchResults } from '@/lib/firestore/matchData';
import { computePlayerInfluence } from '@/lib/engine/playerInfluence';
import MetricTooltip from '@/components/ui/MetricTooltip';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Activity, Target, Zap, TrendingUp, Info, FlaskConical } from 'lucide-react';

// ─── RatingBar (mirrors analytics/page.jsx pattern) ──────────────────────────
function RatingBar({ label, value, displayValue, metricKey, type = 'primary' }) {
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
function influenceColor(label) {
  if (!label) return 'var(--text-muted)';
  if (label === 'Elite Influence')    return '#c9a84c'; // gold
  if (label === 'High Influence')     return '#4ade80'; // green
  if (label === 'Moderate Influence') return '#60a5fa'; // blue
  return 'var(--text-secondary)';                       // low
}

// ─── Contribution bar (raw %, with baseline marker) ──────────────────────────
function ContributionBar({ pct, baselinePct, label, metricKey }) {
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

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PlayerAnalysisPage() {
  const { id } = useParams();
  const { player } = usePlayer();
  const { isOwner } = useAuth();

  const [loading, setLoading] = useState(true);
  const [influence, setInfluence] = useState(null);

  useEffect(() => {
    if (!isOwner) return; // layout handles redirect, but guard here too
    async function load() {
      try {
        const allTourneys = await getTournaments();

        // Fetch all match data across all tournaments in parallel
        const [allPlayerRes, allTeamRes, allPlayerRegs] = await Promise.all([
          Promise.all(allTourneys.map(t => getPlayerMatchResults(t.id))),
          Promise.all(allTourneys.map(t => getTeamMatchResults(t.id))),
          Promise.all(allTourneys.map(t => getPlayerRegistrations(t.id))),
        ]);

        const teamMatchHistory = [];

        allTourneys.forEach((t, tIdx) => {
          const playerResults = allPlayerRes[tIdx] || [];
          const teamResults   = allTeamRes[tIdx]   || [];
          const playerRegs    = allPlayerRegs[tIdx] || [];

          // Find this player's registrations for this tournament
          const myReg = playerRegs.find(r => r.playerId === id);
          if (!myReg) return; // player didn't participate in this tournament

          const myTeamId = myReg.teamId;
          if (!myTeamId) return;

          // Find all team matches this player's team played in this tournament
          const teamMatchesForMyTeam = teamResults.filter(tr => tr.teamId === myTeamId);

          teamMatchesForMyTeam.forEach(tm => {
            const matchKey = `${tm.day}-${tm.lobby}${tm.groupId ? '-' + tm.groupId : ''}`;

            // All player results in the same match for this team
            const allPlayerResultsThisMatch = playerResults.filter(pr =>
              pr.teamId === myTeamId &&
              pr.day === tm.day &&
              pr.lobby === tm.lobby &&
              (tm.groupId ? pr.groupId === tm.groupId : true)
            );

            const teamSize = new Set(allPlayerResultsThisMatch.map(pr => pr.playerId)).size || 1;

            // My own result for this match
            const myResult = allPlayerResultsThisMatch.find(pr => pr.playerId === id);
            const present = Boolean(myResult);

            // Team total damage: sum of all player damages in this match
            const teamTotalDamage = allPlayerResultsThisMatch.reduce((s, pr) => s + (pr.damage || 0), 0);

            teamMatchHistory.push({
              matchId: `${t.id}-${matchKey}`,
              teamId: myTeamId,
              present,
              placement: tm.placement || 0,
              teamTotalKills: tm.kills || 0,
              playerKills: myResult?.kills || 0,
              playerDamage: myResult?.damage || 0,
              teamTotalDamage,
              teamSize,
            });
          });
        });

        const result = computePlayerInfluence(id, teamMatchHistory);
        setInfluence(result);
      } catch (err) {
        console.error('Analysis load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, isOwner]);

  if (loading) return <LoadingSpinner size="lg" text="Computing player analysis…" />;

  const hasInfluence = influence?.eligible;
  const { influenceScore, label, isProvisional, sampleSize, breakdown } = influence || {};
  const labelColor = influenceColor(label);

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div>
        <h2 style={{
          fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)',
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
        }}>
          <Activity size={18} style={{ color: 'var(--gold)' }} />
          Breakdown Analysis
          <span style={{
            fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
            borderRadius: 4, background: 'rgba(201,168,76,0.12)',
            color: 'var(--gold)', border: '1px solid var(--border-gold)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Beta
          </span>
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Advanced influence metrics — only duo/trio/squad matches are included.
        </p>
      </div>

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
          /* Not applicable — solo-only */
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '32px 16px', gap: 10,
            color: 'var(--text-muted)', textAlign: 'center',
          }}>
            <Info size={28} style={{ opacity: 0.4 }} />
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Not Applicable — Solo Only</span>
            <span style={{ fontSize: '0.78rem', maxWidth: 360 }}>
              Player Influence requires at least one duo, trio, or squad match.
              All recorded matches for this player are solo.
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
                    <div style={{ marginTop: 2, color: '#f59e0b', fontSize: '0.72rem' }}>
                      ⚠ Provisional — fewer than 3 matches in one or both groups
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
              {!hasInfluence ? 'Not applicable — solo-only matches.' : 'Insufficient data.'}
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
              {!hasInfluence ? 'Not applicable — solo-only matches.' : 'Insufficient data.'}
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

      {/* ── xG Placeholder ───────────────────────────────────────────────── */}
      <div className="card" style={{ opacity: 0.7 }}>
        <h3 className="card-title mb-2 flex items-center gap-2 border-b border-border pb-2">
          <FlaskConical size={16} style={{ color: 'var(--text-muted)' }} />
          Expected Kills (xG)
          <span style={{
            fontSize: '0.62rem', fontWeight: 700, padding: '1px 6px',
            borderRadius: 4, background: 'rgba(148,163,184,0.15)',
            color: 'var(--text-muted)', border: '1px solid var(--border-md)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Coming Soon
          </span>
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Expected Kills (xG) will model how many kills a player <em>should</em> have
          earned based on their team's placements, match size, and historical field
          averages — separating luck from skill. Formula not yet finalized.
        </p>
      </div>
    </div>
  );
}
