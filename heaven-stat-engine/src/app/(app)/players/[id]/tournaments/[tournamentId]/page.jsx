'use client';
import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePlayer } from '../../layout';
import { getTournament, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getPlayerMatchResults } from '@/lib/firestore/matchData';
import { computePlayerStats, computePlayerAnalytics } from '@/lib/engine/playerStats';
import { computeTournamentPlayerRecords } from '@/lib/engine/playerRecords';
import { computeTournamentPlayerInfluence } from '@/lib/engine/playerInfluence';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { TierBadge } from '@/components/ui/Badge';
import MetricTooltip from '@/components/ui/MetricTooltip';
import {
  ChevronLeft, Trophy, Users, Star, Zap, Target, Crosshair,
  TrendingUp, Activity, Award, ExternalLink, Info, Shield,
} from 'lucide-react';

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBar({ value, max = 100, color = 'var(--gold)' }) {
  const pct = Math.min(100, Math.max(0, ((value ?? 0) / max) * 100));
  return (
    <div style={{
      height: 6, borderRadius: 4, background: 'rgba(255,255,255,0.07)',
      overflow: 'hidden', flex: 1, minWidth: 80,
    }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: color, borderRadius: 4,
        transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)',
      }} />
    </div>
  );
}

function ScoreRow({ label, value, max = 100, labelBadge, color, metricKey, nullMessage }) {
  const style = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
  };
  if (value === null && nullMessage) {
    return (
      <div style={style}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 110 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
          {metricKey && <MetricTooltip metricKey={metricKey} />}
        </div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic', flex: 1 }}>
          {nullMessage}
        </span>
      </div>
    );
  }
  return (
    <div style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 110, flexShrink: 0 }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
        {metricKey && <MetricTooltip metricKey={metricKey} />}
      </div>
      <ScoreBar value={value} max={max} color={color || 'var(--gold)'} />
      <span style={{
        fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.88rem',
        color: 'var(--text-primary)', minWidth: 32, textAlign: 'right', flexShrink: 0,
      }}>
        {typeof value === 'number' ? Math.round(value) : '—'}
      </span>
      {labelBadge && (
        <span style={{
          fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px',
          borderRadius: 5, background: 'rgba(201,168,76,0.15)',
          color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)',
          whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {labelBadge}
        </span>
      )}
    </div>
  );
}

function StatChip({ label, value }) {
  return (
    <div style={{
      padding: '12px 16px', background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function AchievementBadge({ icon: Icon, label, color, bg, border }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '5px 12px', borderRadius: 999,
      background: bg || 'rgba(201,168,76,0.15)',
      border: `1px solid ${border || 'rgba(201,168,76,0.4)'}`,
      color: color || 'var(--gold)',
      fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {Icon && <Icon size={13} />}
      {label}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlayerTournamentDeepDivePage() {
  const { id, tournamentId } = useParams();
  const router = useRouter();
  const { player } = usePlayer();

  const [loading, setLoading]             = useState(true);
  const [tournament, setTournament]       = useState(null);
  const [teamResults, setTeamResults]     = useState([]);
  const [playerResults, setPlayerResults] = useState([]);
  const [playerRegs, setPlayerRegs]       = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const [t, tr, pr, preg] = await Promise.all([
          getTournament(tournamentId),
          getTeamMatchResults(tournamentId).catch(() => []),
          getPlayerMatchResults(tournamentId).catch(() => []),
          getPlayerRegistrations(tournamentId).catch(() => []),
        ]);
        if (!t) { router.replace(`/players/${id}`); return; }
        setTournament(t);
        setTeamResults(tr);
        setPlayerResults(pr);
        setPlayerRegs(preg);
      } catch (err) {
        console.error('Deep-dive load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, tournamentId, router]);

  // ── Derived analytics ─────────────────────────────────────────────────────
  const { thisPlayer, playerAnalyticsData, records, influence } = useMemo(() => {
    if (!tournament || !playerResults.length) return {};
    const pStats = computePlayerStats(playerResults, playerRegs, tournament);
    const pad    = computePlayerAnalytics(pStats, teamResults);
    const me     = pad.find(p => p.playerId === id) || null;
    const recs   = computeTournamentPlayerRecords(pad, playerResults, teamResults, tournament);
    const inf    = computeTournamentPlayerInfluence(id, tournament, teamResults, playerResults);
    return { thisPlayer: me, playerAnalyticsData: pad, records: recs, influence: inf };
  }, [tournament, playerResults, playerRegs, teamResults, id]);

  // ── Loading / empty states ─────────────────────────────────────────────────
  if (loading) return <LoadingSpinner size="lg" text="Loading tournament data…" />;

  if (!tournament || !thisPlayer) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
        <Trophy size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
        <div style={{ fontSize: '1rem', marginBottom: 16 }}>
          No data found for this player in this tournament.
        </div>
        <Link href={`/players/${id}`} className="btn btn-secondary btn-sm">
          ← Back to Player
        </Link>
      </div>
    );
  }

  // ── Computed values ───────────────────────────────────────────────────────
  const scores    = thisPlayer.scores    || {};
  const labels    = thisPlayer.labels    || {};
  const analytics = thisPlayer.analytics || {};
  const fieldSize = playerAnalyticsData?.length ?? 0;

  // Squad MVP: highest mvpScore (blended) or RATING fallback within same team
  const squadMates = (playerAnalyticsData || []).filter(p => p.teamId === thisPlayer.teamId);
  const squadMVPId = [...squadMates].sort(
    (a, b) => (b.mvpScore ?? b.scores?.RATING ?? 0) - (a.mvpScore ?? a.scores?.RATING ?? 0)
  )[0]?.playerId;
  const isSquadMVP = squadMVPId === id && squadMates.length > 1;

  // Achievement flags
  const isTournamentMVP = records?.mvp?.playerId === id;
  const isTopFragger    = records?.topKills?.playerId === id;
  const isBestAvgDmg    = records?.bestAvgDamage?.playerId === id;
  const isBestAvgAcc    = records?.bestAvgAccuracy?.playerId === id;
  const isBestExec      = records?.bestExecution?.playerId === id;
  const isPeakKills     = records?.peakKillsMatch?.playerId === id;
  const isPeakDamage    = records?.peakDamageMatch?.playerId === id;
  const isPeakAccuracy  = records?.peakAccuracyMatch?.playerId === id;

  const hasBadges = isTournamentMVP || isSquadMVP || isTopFragger || isBestAvgDmg
    || isBestAvgAcc || isBestExec || isPeakKills || isPeakDamage || isPeakAccuracy;

  // Influence
  const infScore  = influence?.influenceScore ?? null;
  const infContrib = influence?.killsContribution ?? null;
  const infLabel  = infScore == null ? null
    : infScore < 3 ? 'Low Influence'
    : infScore < 6 ? 'Moderate Influence'
    : infScore < 8 ? 'High Influence'
    : 'Elite Influence';

  // Avatar
  const initial = (player?.professionalName || player?.ign || '?')[0].toUpperCase();

  return (
    <div className="space-y-6" style={{ maxWidth: 820, margin: '0 auto' }}>

      {/* ─── Header ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <button
          className="btn btn-secondary btn-sm p-2"
          style={{ flexShrink: 0, marginTop: 4 }}
          onClick={() => router.push(`/players/${id}`)}
        >
          <ChevronLeft size={16} />
        </button>

        {/* Avatar */}
        <div style={{ flexShrink: 0 }}>
          {player?.photoUrl ? (
            <img
              src={player.photoUrl}
              alt={player.professionalName}
              style={{
                width: 56, height: 56, borderRadius: '50%', objectFit: 'cover',
                border: '2px solid var(--border-gold)',
                boxShadow: '0 0 16px rgba(201,168,76,0.25)',
              }}
            />
          ) : (
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'linear-gradient(135deg,rgba(201,168,76,0.25),rgba(59,130,246,0.2))',
              border: '2px solid var(--border-gold)', color: 'var(--gold)',
              fontWeight: 800, fontSize: '1.3rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {initial}
            </div>
          )}
        </div>

        {/* Name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              {player?.professionalName}
            </h1>
            {player?.rankedTier && <TierBadge tier={player.rankedTier} />}
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>
            IGN: {thisPlayer.ign || player?.currentIGN || player?.ign || '—'}
            {player?.country && ` · ${player.country}`}
          </p>

          {/* Tournament context chips */}
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Link
              href={`/tournaments/${tournamentId}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: '0.82rem', fontWeight: 700, color: 'var(--gold)', textDecoration: 'none',
              }}
            >
              <Trophy size={13} />
              {tournament.name}
              <ExternalLink size={10} style={{ opacity: 0.6 }} />
            </Link>
            {tournament.season && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Season {tournament.season}
              </span>
            )}
            {thisPlayer.teamName && (
              <Link
                href={`/teams/${thisPlayer.teamId}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: '0.75rem', color: 'var(--text-secondary)', textDecoration: 'none',
                }}
              >
                <Shield size={11} />
                {thisPlayer.teamName}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ─── Headline Badges ──────────────────────────────────────────────── */}
      {hasBadges && (
        <div className="card" style={{
          background: 'linear-gradient(135deg,rgba(201,168,76,0.07),rgba(15,23,42,0.97))',
          border: '1px solid rgba(201,168,76,0.22)',
        }}>
          <div style={{
            fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em',
            color: 'var(--text-muted)', marginBottom: 12, fontWeight: 700,
          }}>
            Achievements This Tournament
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {isTournamentMVP && (
              <AchievementBadge icon={Trophy} label="Tournament MVP"
                color="#C9A84C" bg="rgba(201,168,76,0.18)" border="rgba(201,168,76,0.5)" />
            )}
            {isSquadMVP && (
              <AchievementBadge icon={Users} label="Squad MVP"
                color="#38BDF8" bg="rgba(56,189,248,0.12)" border="rgba(56,189,248,0.35)" />
            )}
            {isTopFragger && (
              <AchievementBadge icon={Zap} label="Top Fragger"
                color="#F97316" bg="rgba(249,115,22,0.12)" border="rgba(249,115,22,0.35)" />
            )}
            {isBestAvgDmg && (
              <AchievementBadge icon={Activity} label="Best Avg Damage"
                color="#A855F7" bg="rgba(168,85,247,0.12)" border="rgba(168,85,247,0.35)" />
            )}
            {isBestAvgAcc && (
              <AchievementBadge icon={Target} label="Best Avg Accuracy"
                color="#22C55E" bg="rgba(34,197,94,0.12)" border="rgba(34,197,94,0.35)" />
            )}
            {isBestExec && (
              <AchievementBadge icon={Crosshair} label="Best Execution"
                color="#EF4444" bg="rgba(239,68,68,0.12)" border="rgba(239,68,68,0.35)" />
            )}
            {isPeakKills && (
              <AchievementBadge icon={Star} label="Peak Kill Match"
                color="#F59E0B" bg="rgba(245,158,11,0.12)" border="rgba(245,158,11,0.35)" />
            )}
            {isPeakDamage && (
              <AchievementBadge icon={Activity} label="Peak Damage Match"
                color="#8B5CF6" bg="rgba(139,92,246,0.12)" border="rgba(139,92,246,0.35)" />
            )}
            {isPeakAccuracy && (
              <AchievementBadge icon={Target} label="Peak Accuracy Match"
                color="#10B981" bg="rgba(16,185,129,0.12)" border="rgba(16,185,129,0.35)" />
            )}
          </div>
        </div>
      )}

      {/* ─── Composite Scores ─────────────────────────────────────────────── */}
      <div className="card" style={{
        background: 'linear-gradient(135deg,rgba(30,41,59,0.7),rgba(15,23,42,0.97))',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        {/* RATING hero row */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.08)',
          flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <div style={{
              fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.07em',
              color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4,
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              Tournament Rating <MetricTooltip metricKey="RATING" />
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: '2.4rem', color: 'var(--gold)',
              }}>
                {scores.FINAL_RATING?.toFixed(1) ?? '—'}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', color: 'var(--text-muted)' }}>
                / 1000
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                ({scores.RATING?.toFixed(1) ?? '—'}/100)
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 4 }}>Field Rank</div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '1.6rem', color: 'var(--text-primary)',
            }}>
              #{thisPlayer.analyticsRank ?? '—'}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              of {fieldSize} player{fieldSize !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Component score rows */}
        <ScoreRow
          label="POWER"
          value={scores.POWER}
          labelBadge={labels.powerLabel}
          color="#EF4444"
          metricKey="Power"
        />
        <ScoreRow
          label="PLACEMENT"
          value={scores.PLACEMENT}
          labelBadge={analytics.hasPlacementData ? labels.placementLabel : null}
          color="#0EA5E9"
          metricKey="Placement"
          nullMessage="No placement data for this format (kills-only or solo event)"
        />
        <ScoreRow
          label="CONVERSION"
          value={scores.CONVERSION}
          labelBadge={labels.conversionLabel}
          color="#22C55E"
          metricKey="Conversion"
        />

        {/* FORM — special row with F.MI sub-text (first player-side display) */}
        <div style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 110, flexShrink: 0 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>FORM</span>
              <MetricTooltip metricKey="F.MI" />
            </div>
            <ScoreBar value={scores.FORM} color="#F59E0B" />
            <span style={{
              fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: '0.88rem',
              color: 'var(--text-primary)', minWidth: 32, textAlign: 'right', flexShrink: 0,
            }}>
              {scores.FORM != null ? Math.round(scores.FORM) : '—'}
            </span>
            {labels.formLabel && (
              <span style={{
                fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                background: 'rgba(245,158,11,0.15)', color: '#F59E0B',
                border: '1px solid rgba(245,158,11,0.35)', whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {labels.formLabel}
              </span>
            )}
          </div>
          {analytics.forwardMI != null && (
            <div style={{ marginTop: 5, paddingLeft: 115, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              F.MI:{' '}
              <strong style={{
                color: analytics.forwardMI >= 1 ? 'var(--success)' : 'var(--danger)',
                fontFamily: 'var(--font-mono)',
              }}>
                {analytics.forwardMI}
              </strong>
              {' — '}
              {analytics.forwardMI > 1
                ? `second-half KPM was ${Math.round((analytics.forwardMI - 1) * 100)}% higher than first-half`
                : analytics.forwardMI < 1
                  ? `second-half KPM was ${Math.round((1 - analytics.forwardMI) * 100)}% lower than first-half`
                  : 'perfectly consistent across both halves'}
            </div>
          )}
        </div>

        {/* Identity + Playstyle chips */}
        <div style={{
          marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', flexWrap: 'wrap', gap: 8,
        }}>
          {thisPlayer.identity && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 12px', borderRadius: 999,
              background: 'rgba(201,168,76,0.12)', border: '1px solid rgba(201,168,76,0.3)',
              fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold)',
            }}>
              <Award size={13} />
              {thisPlayer.identity}
            </div>
          )}
          {labels.playstyle && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 12px', borderRadius: 999,
              background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.3)',
              fontSize: '0.78rem', fontWeight: 700, color: '#38BDF8',
            }}>
              <TrendingUp size={13} />
              {labels.playstyle}
            </div>
          )}
        </div>
      </div>

      {/* ─── Player Influence ─────────────────────────────────────────────── */}
      <div className="card" style={{
        background: 'linear-gradient(135deg,rgba(139,92,246,0.08),rgba(15,23,42,0.97))',
        border: '1px solid rgba(139,92,246,0.22)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.07)',
          flexWrap: 'wrap', gap: 8,
        }}>
          <h2 style={{
            margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Activity size={16} style={{ color: '#A855F7' }} />
            Player Influence
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              tournament-scoped
            </span>
          </h2>
          {infScore != null && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontWeight: 900, fontSize: '1.8rem', color: '#A855F7',
              }}>
                {infScore.toFixed(1)}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>/10</span>
            </div>
          )}
        </div>

        {infScore == null ? (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 14px',
            background: 'rgba(255,255,255,0.03)', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <Info size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Insufficient data — Influence requires at least 1 squad match with team kill data.
              Solo and kills-only formats are not scored.
            </span>
          </div>
        ) : (
          <>
            {infLabel && (
              <div style={{ marginBottom: 14 }}>
                <span style={{
                  fontSize: '0.82rem', fontWeight: 700, padding: '4px 12px', borderRadius: 999,
                  background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)',
                  color: '#A855F7',
                }}>
                  {infLabel}
                </span>
              </div>
            )}

            {infContrib && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Contribution bar with baseline marker */}
                <div>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', marginBottom: 6,
                    fontSize: '0.78rem', color: 'var(--text-secondary)',
                  }}>
                    <span>Kill Contribution</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                      {infContrib.percent}%
                    </span>
                  </div>
                  <div style={{ position: 'relative', height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.07)' }}>
                    <div style={{ height: '100%', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${Math.min(100, infContrib.percent)}%`,
                        background: infContrib.percent >= infContrib.baselinePercent
                          ? 'linear-gradient(90deg, #A855F7, #7C3AED)'
                          : 'rgba(168,85,247,0.45)',
                        borderRadius: 4, transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)',
                      }} />
                    </div>
                    {/* Baseline marker tick */}
                    <div style={{
                      position: 'absolute', top: -3, bottom: -3,
                      left: `${Math.min(99, infContrib.baselinePercent)}%`,
                      width: 2, background: 'rgba(255,255,255,0.45)', borderRadius: 1,
                      transform: 'translateX(-50%)',
                    }} />
                  </div>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', marginTop: 5,
                    fontSize: '0.7rem', color: 'var(--text-muted)',
                  }}>
                    <span>0%</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ width: 8, height: 2, background: 'rgba(255,255,255,0.35)', display: 'inline-block', borderRadius: 1 }} />
                      Baseline {infContrib.baselinePercent}% (equal share)
                    </span>
                    <span>100%</span>
                  </div>
                </div>

                {/* Summary line */}
                <div style={{
                  padding: '8px 12px', background: 'rgba(255,255,255,0.03)',
                  borderRadius: 7, border: '1px solid rgba(255,255,255,0.06)',
                  fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.55,
                }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{infContrib.percent}%</strong> of team kills
                  {' vs. '}
                  <strong style={{ color: 'var(--text-primary)' }}>{infContrib.baselinePercent}%</strong> equal-share baseline
                  {' → '}
                  {infContrib.percent > infContrib.baselinePercent
                    ? <span style={{ color: '#A855F7', fontWeight: 700 }}>
                        above baseline by {Math.round(infContrib.percent - infContrib.baselinePercent)}pp
                      </span>
                    : infContrib.percent < infContrib.baselinePercent
                      ? <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>
                          below baseline by {Math.round(infContrib.baselinePercent - infContrib.percent)}pp
                        </span>
                      : <span style={{ fontWeight: 700 }}>exactly at baseline</span>
                  }
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Raw Performance Stats ────────────────────────────────────────── */}
      <div className="card">
        <h2 style={{
          margin: '0 0 14px', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)',
          display: 'flex', alignItems: 'center', gap: 8,
          paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <Star size={16} style={{ color: 'var(--gold)' }} />
          Performance Stats
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
          <StatChip label="Total Kills"   value={thisPlayer.totalKills} />
          <StatChip label="Matches"       value={thisPlayer.totalMatches} />
          <StatChip label="Kills / Match" value={thisPlayer.killsPerMatch} />
          <StatChip label="Avg Damage"    value={thisPlayer.avgDamage} />
          <StatChip
            label="Avg Accuracy"
            value={thisPlayer.avgAccuracy > 0 ? `${thisPlayer.avgAccuracy}%` : '—'}
          />
          <StatChip
            label="Kill Share"
            value={thisPlayer.killSharePct > 0 ? `${thisPlayer.killSharePct}%` : '—'}
          />
        </div>

        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10,
        }}>
          <StatChip label="KPM" value={analytics.KPM} />
          <StatChip label="DPM" value={analytics.DPM} />
          {analytics.hasPlacementData && (
            <>
              <StatChip label="Avg Placement" value={analytics.avgPlacement} />
              <StatChip
                label="Top 3 Rate"
                value={analytics.top3Rate != null ? `${analytics.top3Rate}%` : '—'}
              />
              <StatChip
                label="Win Rate"
                value={analytics.winRate != null ? `${analytics.winRate}%` : '—'}
              />
              <StatChip
                label="Conversion"
                value={analytics.conversionRate != null ? `${analytics.conversionRate}%` : '—'}
              />
            </>
          )}
          <StatChip label="Std Dev CS" value={analytics.stdDevCS} />
        </div>
      </div>

      {/* ─── Team Context ─────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <h2 style={{
          margin: '0 0 12px', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)',
          display: 'flex', alignItems: 'center', gap: 8,
          paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <Shield size={16} style={{ color: 'var(--text-muted)' }} />
          Team Context
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{
              fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 3,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              Team
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                {thisPlayer.teamName || '—'}
              </span>
              {thisPlayer.teamId && (
                <Link
                  href={`/teams/${thisPlayer.teamId}`}
                  style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}
                >
                  <ExternalLink size={12} />
                </Link>
              )}
            </div>
          </div>
          {thisPlayer.teamId && (
            <Link
              href={`/teams/${thisPlayer.teamId}`}
              className="btn btn-secondary btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem' }}
            >
              <Shield size={13} /> View Team Page
            </Link>
          )}
        </div>

        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link
            href={`/tournaments/${tournamentId}/analytics`}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem' }}
          >
            <Activity size={13} /> Full Tournament Analytics
          </Link>
          <Link
            href={`/tournaments/${tournamentId}`}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem' }}
          >
            <Trophy size={13} /> Tournament Overview
          </Link>
        </div>
      </div>

    </div>
  );
}