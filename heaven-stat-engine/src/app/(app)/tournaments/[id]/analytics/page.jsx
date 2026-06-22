'use client';
import { useState, useEffect, useMemo, Fragment } from 'react';
import { useTournament } from '../layout';
import { getTeamMatchResults, getBonusPoints } from '@/lib/firestore/matchData';
import { getTeams } from '@/lib/firestore/registry';
import { computeTeamAnalytics } from '@/lib/engine/analytics';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import { PlaystyleBadge, RatingBadge, RankBadge } from '@/components/ui/Badge';
import MetricTooltip from '@/components/ui/MetricTooltip';
import { BarChart3, ChevronDown, ChevronUp, TrendingUp, Shield } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line,
  CartesianGrid, Legend,
} from 'recharts';

function RatingBar({ label, value, displayValue, type }) {
  return (
    <div className="rating-bar-row">
      <span className="rating-bar-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {label}
        <MetricTooltip metricKey={label} />
      </span>
      <div className="rating-bar-track">
        <div className={`rating-bar-fill ${type}`} style={{ width: `${Math.min(100, value || 0)}%` }} />
      </div>
      <span className="rating-bar-val">{Math.round(displayValue ?? value ?? 0)}</span>
    </div>
  );
}

export default function AnalyticsPage() {
  const { tournament } = useTournament();
  const [loading, setLoading] = useState(true);
  const [teamResults, setTeamResults] = useState([]);
  const [bonusPoints, setBonusPoints] = useState([]);
  const [teams, setTeams] = useState([]);
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [compLeftId, setCompLeftId] = useState('');
  const [compRightId, setCompRightId] = useState('');

  const { scoring = {} } = tournament;

  useEffect(() => {
    async function load() {
      try {
        const [tr, bp, allTeams] = await Promise.all([
          getTeamMatchResults(tournament.id),
          getBonusPoints(tournament.id),
          getTeams(),
        ]);
        const teamMap = Object.fromEntries(allTeams.map((t) => [t.id, t]));
        const enriched = tr.map((r) => ({
          ...r,
          teamName: teamMap[r.teamId]?.teamName || r.teamName || r.teamId,
          clanName: teamMap[r.teamId]?.clanName || '',
        }));
        const enrichedBp = bp.map((b) => ({
          ...b,
          teamName: teamMap[b.teamId]?.teamName || b.teamId,
        }));
        setTeamResults(enriched);
        setBonusPoints(enrichedBp);
        setTeams(allTeams);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    }
    load();
  }, [tournament.id]);

  const analyticsData = useMemo(
    () => computeTeamAnalytics(teamResults, bonusPoints, scoring),
    [teamResults, bonusPoints, scoring]
  );

  const compLeftTeam = useMemo(() => analyticsData.find(t => t.teamId === compLeftId) || null, [compLeftId, analyticsData]);
  const compRightTeam = useMemo(() => analyticsData.find(t => t.teamId === compRightId) || null, [compRightId, analyticsData]);

  const teamMap = useMemo(() => {
    return Object.fromEntries(teams.map((t) => [t.id, t]));
  }, [teams]);

  if (loading) return <LoadingSpinner size="lg" />;
  if (analyticsData.length === 0) return (
    <EmptyState icon={BarChart3} title="No analytics data" text="Enter match data for multiple days to compute analytics." />
  );

  // Season-level summary stats
  const avgPPM = (analyticsData.reduce((s, t) => s + (t.analytics?.PPM || 0), 0) / analyticsData.length).toFixed(2);
  const avgKPM = (analyticsData.reduce((s, t) => s + (t.analytics?.KPM || 0), 0) / analyticsData.length).toFixed(2);
  const mostConsistent = [...analyticsData].sort((a, b) => (a.analytics?.stdDevCS || 999) - (b.analytics?.stdDevCS || 999))[0];
  const highestMomentum = [...analyticsData].sort((a, b) => (b.analytics?.forwardMI || 0) - (a.analytics?.forwardMI || 0))[0];

  // Team rating chart data
  const ratingChartData = analyticsData.slice(0, 15).map((t) => ({
    name: t.teamName?.slice(0, 12) || t.teamId,
    rating: t.scores?.FINAL_RATING || 0,
    power: t.scores?.POWER || 0,
    placement: t.scores?.PLACEMENT || 0,
    conversion: t.scores?.CONVERSION || 0,
  }));

  return (
    <div>
      {/* Season summary bar */}
      <div className="card-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-card-icon gold"><BarChart3 size={20} /></div>
          <div>
            <div className="stat-card-value">{avgPPM}</div>
            <div className="stat-card-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Avg PPM
              <MetricTooltip metricKey="PPM" />
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon red"><BarChart3 size={20} /></div>
          <div>
            <div className="stat-card-value">{avgKPM}</div>
            <div className="stat-card-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Avg KPM
              <MetricTooltip metricKey="KPM" />
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon cyan"><TrendingUp size={20} /></div>
          <div>
            <div className="stat-card-value" style={{ fontSize: '1rem' }}>{mostConsistent?.teamName || '—'}</div>
            <div className="stat-card-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Most Consistent (StDev {mostConsistent?.analytics?.stdDevCS?.toFixed(1) || 0})
              <MetricTooltip metricKey="Consistency Score" />
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon green"><TrendingUp size={20} /></div>
          <div>
            <div className="stat-card-value" style={{ fontSize: '1rem' }}>{highestMomentum?.teamName || '—'}</div>
            <div className="stat-card-label" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              Highest Momentum (F.MI {highestMomentum?.analytics?.forwardMI?.toFixed(2) || 0})
              <MetricTooltip metricKey="Momentum Index" />
            </div>
          </div>
        </div>
      </div>

      {/* Team Rating comparison chart */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 className="card-title" style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          Team Rating Comparison
          <MetricTooltip metricKey="Team Rating" />
        </h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={ratingChartData} margin={{ top: 4, right: 16, bottom: 40, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} domain={[0, 1000]} />
            <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9' }} />
            <Legend wrapperStyle={{ color: '#94A3B8', fontSize: 12 }} />
            <Bar dataKey="rating" fill="#C9A84C" name="Team Rating" radius={[3, 3, 0, 0]} />
            <Bar dataKey="power" fill="#C00000" name="Power" radius={[3, 3, 0, 0]} />
            <Bar dataKey="placement" fill="#0070C0" name="Placement" radius={[3, 3, 0, 0]} />
            <Bar dataKey="conversion" fill="#22C55E" name="Conversion" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tournament-scoped Head-to-Head Comparison Widget */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
          <Shield size={18} className="text-gold" />
          Head-to-Head Team Comparison
        </h3>
        
        {/* Dropdowns */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <select
            className="form-select"
            style={{ flex: 1, marginTop: 0 }}
            value={compLeftId}
            onChange={e => setCompLeftId(e.target.value)}
          >
            <option value="">— Select Team A —</option>
            {analyticsData.map(t => (
              <option key={t.teamId} value={t.teamId} disabled={t.teamId === compRightId}>
                {t.teamName}
              </option>
            ))}
          </select>
          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-muted)', padding: '4px 8px', background: 'var(--bg-header)', borderRadius: 4 }}>VS</span>
          <select
            className="form-select"
            style={{ flex: 1, marginTop: 0 }}
            value={compRightId}
            onChange={e => setCompRightId(e.target.value)}
          >
            <option value="">— Select Team B —</option>
            {analyticsData.map(t => (
              <option key={t.teamId} value={t.teamId} disabled={t.teamId === compLeftId}>
                {t.teamName}
              </option>
            ))}
          </select>
        </div>

        {/* Comparison display */}
        {compLeftTeam && compRightTeam ? (
          <div className="space-y-4">
            {/* Headers with Logos */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 12 }}>
              {/* Left Team Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#C9A84C' }}>{compLeftTeam.teamName}</span>
                {(() => {
                  const team = teamMap[compLeftTeam.teamId];
                  const logoSrc = team?.logo || team?.logoUrl;
                  return logoSrc ? (
                    <img src={logoSrc} alt="" className="team-logo-thumbnail" width={28} height={28} style={{ borderRadius: 6, objectFit: 'cover' }} />
                  ) : (
                    <Shield size={22} style={{ color: '#C9A84C' }} />
                  );
                })()}
              </div>

              {/* Tally Indicator */}
              <div style={{ fontSize: '0.65rem', fontWeight: 800, padding: '3px 8px', background: 'var(--bg-header)', borderRadius: 4, color: 'var(--text-muted)' }}>COMPARE</div>

              {/* Right Team Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10 }}>
                {(() => {
                  const team = teamMap[compRightTeam.teamId];
                  const logoSrc = team?.logo || team?.logoUrl;
                  return logoSrc ? (
                    <img src={logoSrc} alt="" className="team-logo-thumbnail" width={28} height={28} style={{ borderRadius: 6, objectFit: 'cover' }} />
                  ) : (
                    <Shield size={22} style={{ color: '#38BDF8' }} />
                  );
                })()}
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#38BDF8' }}>{compRightTeam.teamName}</span>
              </div>
            </div>

            {/* Stat Comparison Rows */}
            {(() => {
              const renderCompRow = (label, lv, rv, decimalPlaces = 0, isPercent = false) => {
                const l = Number(lv) || 0, r = Number(rv) || 0;
                const leftWins = l > r;
                const rightWins = r > l;
                const maxVal = Math.max(l, r) || 1;
                const fmt = (v) => {
                  const s = Number(v).toFixed(decimalPlaces);
                  return isPercent ? `${s}%` : s;
                };
                return (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>
                      <span style={{ color: leftWins ? '#C9A84C' : 'var(--text-secondary)' }}>{fmt(l)}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
                      <span style={{ color: rightWins ? '#38BDF8' : 'var(--text-secondary)' }}>{fmt(r)}</span>
                    </div>
                    <div style={{ display: 'flex', width: '100%', gap: 12 }}>
                      <div style={{ width: '50%', height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 99, display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(l / maxVal) * 100}%`, background: leftWins ? '#C9A84C' : 'var(--text-muted)', borderRadius: 99 }} />
                      </div>
                      <div style={{ width: '50%', height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(r / maxVal) * 100}%`, background: rightWins ? '#38BDF8' : 'var(--text-muted)', borderRadius: 99 }} />
                      </div>
                    </div>
                  </div>
                );
              };

              return (
                <div>
                  {renderCompRow('Total Points', compLeftTeam.totalPts, compRightTeam.totalPts, 0)}
                  {renderCompRow('Team Rating', compLeftTeam.scores?.TEAM_RATING, compRightTeam.scores?.TEAM_RATING, 1)}
                  {renderCompRow('Lobby Wins', compLeftTeam.wins, compRightTeam.wins, 0)}
                  {renderCompRow('Matches Played', compLeftTeam.matches, compRightTeam.matches, 0)}
                  {renderCompRow('Total Kills', compLeftTeam.kills, compRightTeam.kills, 0)}
                  {renderCompRow('Placement Points', compLeftTeam.placementPts, compRightTeam.placementPts, 0)}
                </div>
              );
            })()}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '0.8rem', color: 'var(--text-muted)', border: '1px dashed var(--border)', borderRadius: 8 }}>
            Select two teams above to compare their performance in this tournament.
          </div>
        )}
      </div>

      {/* Analytics master table */}
      <div className="data-table-container">
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 48 }}>RK</th>
                <th>Team</th>
                <th>Clan</th>
                <th>Wins</th>
                <th>Matches</th>
                <th>Events</th>
                <th>Place Pts</th>
                <th>Kills</th>
                <th className="col-gold">Total Pts</th>
                <th className="col-gold">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Team Rating
                    <MetricTooltip metricKey="Team Rating" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    PPM
                    <MetricTooltip metricKey="PPM" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    KPM
                    <MetricTooltip metricKey="KPM" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Kill%
                    <MetricTooltip metricKey="Kill%" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Avg Place
                    <MetricTooltip metricKey="Avg Place" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Top3 Rate%
                    <MetricTooltip metricKey="Top3 Rate%" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Place Eff%
                    <MetricTooltip metricKey="Place Eff%" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Win Rate%
                    <MetricTooltip metricKey="Win Rate%" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    CR%
                    <MetricTooltip metricKey="CR%" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    F.MI
                    <MetricTooltip metricKey="F.MI" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    St.Dev CS
                    <MetricTooltip metricKey="St.Dev CS" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Playstyle
                    <MetricTooltip metricKey="Playstyle" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Power
                    <MetricTooltip metricKey="Power" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Placement
                    <MetricTooltip metricKey="Placement" />
                  </span>
                </th>
                <th>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    Conversion
                    <MetricTooltip metricKey="Conversion" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {analyticsData.map((row) => {
                const a = row.analytics || {};
                const s = row.scores || {};
                const l = row.labels || {};
                const isExpanded = expandedTeam === row.teamId;
                return (
                  <Fragment key={row.teamId}>
                    <tr
                      style={{ cursor: 'pointer' }}
                      onClick={() => setExpandedTeam(isExpanded ? null : row.teamId)}
                      className="clickable-row"
                    >
                      <td><RankBadge rank={row.analyticsRank} /></td>
                      <td style={{ fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ display: 'flex', alignItems: 'center' }}>
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </span>
                          {(() => {
                            const team = teamMap?.[row.teamId];
                            const logoSrc = team?.logo || team?.logoUrl;
                            return logoSrc ? (
                              <img src={logoSrc} alt="" className="team-logo-thumbnail" width={20} height={20} />
                            ) : (
                              <Shield size={16} className="text-gold flex-shrink-0" />
                            )
                          })()}
                          <span>{row.teamName}</span>
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{row.clanName || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{row.wins}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{row.matches}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{row.events}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{row.placementPts}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{row.kills}</td>
                      <td className="col-gold">{row.totalPts}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--gold)' }}>{s.FINAL_RATING?.toFixed(1)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.PPM}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.KPM}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.killPct}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.avgPlace}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.top3Rate}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.placementEfficiency}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.winRate}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.conversionRate}%</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: (a.forwardMI || 0) >= 1 ? 'var(--success)' : 'var(--danger)' }}>{a.forwardMI}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{a.stdDevCS}</td>
                      <td><PlaystyleBadge label={l.playstyle || '—'} /></td>
                      <td><RatingBadge label={l.powerLabel || '—'} type="power" /></td>
                      <td><RatingBadge label={l.placementLabel || '—'} type="placement" /></td>
                      <td><RatingBadge label={l.conversionLabel || '—'} type="conversion" /></td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${row.teamId}-expanded`}>
                        <td colSpan={24} style={{ padding: 0, background: 'var(--bg-alt-row)' }}>
                          <TeamDeepDive team={row} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TeamDeepDive({ team }) {
  const a = team.analytics || {};
  const s = team.scores || {};
  const l = team.labels || {};
  const perDay = team.perDay || {};

  const activeDays = Object.keys(perDay).map(Number).sort((a, b) => a - b);
  const ppmChartData = activeDays.map((d) => {
    const pd = perDay[d] || {};
    return {
      day: `D${d}`,
      ppm: pd.matches > 0 ? Math.round((pd.totalPts / pd.matches) * 100) / 100 : 0,
      totalPts: pd.totalPts || 0,
    };
  });

  return (
    <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr 280px', gap: 24 }}>
      {/* Points Per Day chart */}
      <div>
        <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Points Per Day</h4>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={ppmChartData}>
            <XAxis dataKey="day" tick={{ fill: '#94A3B8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} />
            <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9', fontSize: 12 }} />
            <Bar dataKey="totalPts" fill="#C9A84C" radius={[3, 3, 0, 0]} name="Total Pts" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* PPM consistency line chart */}
      <div>
        <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>PPM Consistency</h4>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={ppmChartData}>
            <XAxis dataKey="day" tick={{ fill: '#94A3B8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94A3B8', fontSize: 11 }} />
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9', fontSize: 12 }} />
            <Line type="monotone" dataKey="ppm" stroke="#00B0F0" strokeWidth={2} dot={{ fill: '#00B0F0', r: 4 }} name="PPM" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Rating component bars + labels */}
      <div>
        <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rating Components</h4>
        <div className="rating-bar-wrap" style={{ marginBottom: 16 }}>
          <RatingBar label="POWER" value={s.POWER} type="power" />
          <RatingBar label="PLACEMENT" value={s.PLACEMENT} type="placement" />
          <RatingBar label="CONVERSION" value={s.CONVERSION} type="conversion" />
          <RatingBar label="TEAM RATING" value={s.TEAM_RATING} displayValue={s.FINAL_RATING} type="overall" />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <PlaystyleBadge label={l.playstyle || '—'} />
          <RatingBadge label={l.powerLabel || '—'} type="power" />
          <RatingBadge label={l.placementLabel || '—'} type="placement" />
          <RatingBadge label={l.conversionLabel || '—'} type="conversion" />
        </div>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            ['PPM', a.PPM], ['KPM', a.KPM], ['Avg Place', a.avgPlace], ['Kill%', `${a.killPct}%`],
            ['Win Rate', `${a.winRate}%`], ['Top3 Rate', `${a.top3Rate}%`],
            ['F.MI', a.forwardMI], ['St.Dev CS', a.stdDevCS],
          ].map(([label, val]) => (
            <div key={label} style={{ padding: '6px 10px', background: 'var(--bg-card)', borderRadius: 6 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 2, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                {label}
                <MetricTooltip metricKey={label} />
              </div>
              <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text-primary)' }}>{val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
