'use client';
import { useState, useEffect, useMemo, Fragment } from 'react';
import { useTournament } from '../layout';
import { getTeamMatchResults, getBonusPoints, getPlayerMatchResults } from '@/lib/firestore/matchData';
import { getTeamRegistrations, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getTeams, getPlayers } from '@/lib/firestore/registry';
import { computeDailyStandings, computeSeasonStandings, computeTeamRanking, computeClanRanking } from '@/lib/engine/standings';
import { computePlayerStats, filterSet1Players, filterSet2Players, sortCombined } from '@/lib/engine/playerStats';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import { RankBadge, ClassBadge } from '@/components/ui/Badge';
import { BarChart3, ArrowUpDown, ArrowUp, ArrowDown, Shield } from 'lucide-react';

const TABS = [
  { key: 'daily',      label: 'Daily' },
  { key: 'season',     label: 'Season' },
  { key: 'teamRank',   label: 'Team Ranking' },
  { key: 'clanRank',   label: 'Clan Ranking' },
  { key: 'set1',       label: 'Player Set 1' },
  { key: 'set2',       label: 'Player Set 2' },
  { key: 'combined',   label: 'Combined' },
  { key: 'details',    label: 'Details' },
];

function SortableTH({ label, field, sortKey, sortDir, onSort }) {
  const active = sortKey === field;
  return (
    <th className="sortable-th" onClick={() => onSort(field)} style={{ cursor: 'pointer' }}>
      <span className="th-content">
        {label}
        {active
          ? (sortDir === 'asc' ? <ArrowUp size={11} className="sort-icon-active" /> : <ArrowDown size={11} className="sort-icon-active" />)
          : <ArrowUpDown size={11} className="sort-icon-neutral" />}
      </span>
    </th>
  );
}

function useSort(data, defaultKey = null, defaultDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = useMemo(() => {
    if (!sortKey || !data) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [data, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, handleSort };
}

export default function StandingsPage() {
  const { tournament } = useTournament();
  const [tab, setTab] = useState('daily');
  const [selectedDay, setSelectedDay] = useState(1);
  const [loading, setLoading] = useState(true);

  const [teamResults, setTeamResults] = useState([]);
  const [bonusPoints, setBonusPoints] = useState([]);
  const [playerResults, setPlayerResults] = useState([]);
  const [teamRegs, setTeamRegs] = useState([]);
  const [playerRegs, setPlayerRegs] = useState([]);
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);

  const { structure = {}, scoring = {} } = tournament;
  const totalDays = structure.totalDays || 6;

  useEffect(() => {
    async function load() {
      try {
        const [tr, bp, pr, tRegs, pRegs, allTeams, allPlayers] = await Promise.all([
          getTeamMatchResults(tournament.id),
          getBonusPoints(tournament.id),
          getPlayerMatchResults(tournament.id),
          getTeamRegistrations(tournament.id),
          getPlayerRegistrations(tournament.id),
          getTeams(),
          getPlayers(),
        ]);
        // Enrich team results with teamName/clanName from global registry
        const teamMap = Object.fromEntries(allTeams.map((t) => [t.id, t]));
        const enrichedTeamResults = tr.map((r) => ({
          ...r,
          teamName: teamMap[r.teamId]?.teamName || r.teamName || r.teamId,
          clanName: teamMap[r.teamId]?.clanName || '',
        }));
        const enrichedBonuses = bp.map((b) => ({
          ...b,
          teamName: teamMap[b.teamId]?.teamName || b.teamId,
          clanName: teamMap[b.teamId]?.clanName || '',
        }));
        setTeamResults(enrichedTeamResults);
        setBonusPoints(enrichedBonuses);
        setPlayerResults(pr);
        setTeamRegs(tRegs);
        setPlayerRegs(pRegs);
        setTeams(allTeams);
        setPlayers(allPlayers);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    }
    load();
  }, [tournament.id]);

  const daily = useMemo(() => computeDailyStandings(teamResults, bonusPoints, scoring, selectedDay), [teamResults, bonusPoints, scoring, selectedDay]);
  const season = useMemo(() => computeSeasonStandings(teamResults, bonusPoints, scoring), [teamResults, bonusPoints, scoring]);
  const teamRanking = useMemo(() => computeTeamRanking(teamResults, bonusPoints, scoring), [teamResults, bonusPoints, scoring]);
  const clanRanking = useMemo(() => computeClanRanking(teamRanking), [teamRanking]);

  const playerStats = useMemo(() => computePlayerStats(playerResults, playerRegs, tournament), [playerResults, playerRegs, tournament]);
  const set1Players = useMemo(() => filterSet1Players(playerStats), [playerStats]);
  const set2Players = useMemo(() => filterSet2Players(playerStats), [playerStats]);
  const combined = useMemo(() => sortCombined(playerStats), [playerStats]);

  const teamMap = useMemo(() => {
    return Object.fromEntries(teams.map((t) => [t.id, t]));
  }, [teams]);

  if (loading) return <LoadingSpinner size="lg" />;

  const renderTeamTable = (data, showRank = false) => (
    <TeamTable data={data} scoring={scoring} showRank={showRank} teamMap={teamMap} />
  );

  return (
    <div>
      {/* Tab bar */}
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Daily */}
      {tab === 'daily' && (
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
            {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => (
              <button key={d} className={`btn btn-sm ${d === selectedDay ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSelectedDay(d)}>Day {d}</button>
            ))}
          </div>
          {daily.length === 0
            ? <EmptyState icon={BarChart3} title="No data" text={`Enter match data for Day ${selectedDay} to see standings.`} />
            : renderTeamTable(daily.map((r, i) => ({ ...r, rank: i + 1 })), true)}
        </div>
      )}

      {/* Season */}
      {tab === 'season' && (
        season.length === 0
          ? <EmptyState icon={BarChart3} title="No season data" text="Enter match data to see season standings." />
          : <SeasonTable data={season} totalDays={totalDays} teamMap={teamMap} />
      )}

      {/* Team Ranking */}
      {tab === 'teamRank' && (
        teamRanking.length === 0
          ? <EmptyState icon={BarChart3} title="No rankings yet" text="Enter match data to generate team rankings." />
          : renderTeamTable(teamRanking, true)
      )}

      {/* Clan Ranking */}
      {tab === 'clanRank' && (
        clanRanking.length === 0
          ? <EmptyState icon={BarChart3} title="No clan data" text="Teams need clan assignments for clan rankings." />
          : <ClanTable data={clanRanking} />
      )}

      {/* Set 1 Players */}
      {tab === 'set1' && (
        set1Players.length === 0
          ? <EmptyState icon={BarChart3} title="No Class 1 players" text="Register and enter data for Class 1 players." />
          : <PlayerTable data={set1Players} totalDays={totalDays} />
      )}

      {/* Set 2 Players */}
      {tab === 'set2' && (
        set2Players.length === 0
          ? <EmptyState icon={BarChart3} title="No Class 2 players" text="Register and enter data for Class 2 players." />
          : <PlayerTable data={set2Players} totalDays={totalDays} showOnlyActiveDays />
      )}

      {/* Combined */}
      {tab === 'combined' && (
        combined.length === 0
          ? <EmptyState icon={BarChart3} title="No player data" text="Enter player match data to see combined standings." />
          : <CombinedTable data={combined} />
      )}

      {/* Details */}
      {tab === 'details' && (
        combined.length === 0
          ? <EmptyState icon={BarChart3} title="No data" text="Enter player match data to see details." />
          : <DetailsTable data={combined} totalDays={totalDays} />
      )}
    </div>
  );
}

// ── Sub-tables ────────────────────────────────────────────────────────────────
function TeamTable({ data, scoring, showRank, teamMap }) {
  const { sorted, sortKey, sortDir, handleSort } = useSort(data, 'totalPts');
  const TH = ({ label, field }) => <SortableTH label={label} field={field} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />;
  return (
    <div className="data-table-container">
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              {showRank && <th style={{ width: 48 }}>RK</th>}
              <TH label="Team" field="teamName" />
              <TH label="Clan" field="clanName" />
              <TH label="Wins" field="wins" />
              <TH label="Matches" field="matches" />
              <TH label="Events" field="events" />
              <TH label="Place Pts" field="placementPts" />
              <TH label="Kills" field="kills" />
              <TH label="Bonus Pts" field="bonusPts" />
              <TH label="Total Pts" field="totalPts" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const team = teamMap?.[row.teamId];
              const logoSrc = team?.logo || team?.logoUrl;
              return (
                <tr key={row.teamId || i}>
                  {showRank && <td><RankBadge rank={row.rank ?? i + 1} /></td>}
                  <td style={{ fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {logoSrc ? (
                        <img src={logoSrc} alt="" className="team-logo-thumbnail" width={20} height={20} />
                      ) : (
                        <Shield size={16} className="text-gold flex-shrink-0" />
                      )}
                      <span>{row.teamName}</span>
                    </div>
                  </td>
                <td style={{ color: 'var(--text-muted)' }}>{row.clanName || '—'}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.wins}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.matches}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.events ?? '—'}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.placementPts}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.kills}</td>
                <td style={{ fontFamily: 'var(--font-mono)', color: row.bonusPts !== 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{row.bonusPts}</td>
                <td className="col-gold">{row.totalPts}</td>
              </tr>
             );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SeasonTable({ data, totalDays, teamMap }) {
  const { sorted, sortKey, sortDir, handleSort } = useSort(data, 'totalPts');
  const TH = ({ label, field }) => <SortableTH label={label} field={field} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />;
  return (
    <div className="data-table-container">
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Clan</th>
              {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => (
                <th key={d} colSpan={5} style={{ background: 'var(--bg-header)', textAlign: 'center', borderLeft: '1px solid var(--border-md)', color: d % 2 === 0 ? 'var(--lobby-blue)' : 'var(--text-secondary)' }}>Day {d}</th>
              ))}
              <th colSpan={6} style={{ textAlign: 'center', background: '#1a2845', color: 'var(--gold)' }}>Season Total</th>
            </tr>
            <tr>
              <th></th><th></th>
              {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => (
                <Fragment key={`day-header-cols-${d}`}>
                  <th style={{ fontSize: '0.7rem' }}>W</th>
                  <th style={{ fontSize: '0.7rem' }}>M</th>
                  <th style={{ fontSize: '0.7rem' }}>PlcPts</th>
                  <th style={{ fontSize: '0.7rem' }}>Kills</th>
                  <th style={{ fontSize: '0.7rem' }}>Total</th>
                </Fragment>
              ))}
              <TH label="Wins" field="wins" />
              <TH label="Matches" field="matches" />
              <TH label="Events" field="events" />
              <TH label="PlcPts" field="placementPts" />
              <TH label="Kills" field="kills" />
              <TH label="Total Pts" field="totalPts" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const team = teamMap?.[row.teamId];
              const logoSrc = team?.logo || team?.logoUrl;
              return (
                <tr key={row.teamId || i}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {logoSrc ? (
                        <img src={logoSrc} alt="" className="team-logo-thumbnail" width={20} height={20} />
                      ) : (
                        <Shield size={16} className="text-gold flex-shrink-0" />
                      )}
                      <span>{row.teamName}</span>
                    </div>
                  </td>
                <td style={{ color: 'var(--text-muted)' }}>{row.clanName || '—'}</td>
                {Array.from({ length: totalDays }, (_, idx) => idx + 1).map((d) => {
                  const pd = row.perDay?.[d] || {};
                  return (
                    <Fragment key={`${row.teamId}-d-${d}`}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{pd.wins ?? 0}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{pd.matches ?? 0}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{pd.placePts ?? 0}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{pd.kills ?? 0}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 600 }}>{pd.totalPts ?? 0}</td>
                    </Fragment>
                  );
                })}
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.wins}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.matches}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.events}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.placementPts}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.kills}</td>
                <td className="col-gold">{row.totalPts}</td>
              </tr>
             );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClanTable({ data }) {
  const { sorted, sortKey, sortDir, handleSort } = useSort(data, 'totalPts');
  const TH = ({ label, field }) => <SortableTH label={label} field={field} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />;
  return (
    <div className="data-table-container">
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>RK</th>
              <TH label="Clan" field="clanName" />
              <TH label="Teams" field="teamCount" />
              <TH label="Wins" field="wins" />
              <TH label="Matches" field="matches" />
              <TH label="Events" field="events" />
              <TH label="Place Pts" field="placementPts" />
              <TH label="Kills" field="kills" />
              <TH label="Total Pts" field="totalPts" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.clanName}>
                <td><RankBadge rank={row.rank} /></td>
                <td style={{ fontWeight: 600 }}>{row.clanName}</td>
                <td>{row.teamCount}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.wins}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.matches}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.events}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.placementPts}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.kills}</td>
                <td className="col-gold">{row.totalPts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlayerTable({ data, totalDays }) {
  const { sorted, sortKey, sortDir, handleSort } = useSort(data, 'totalKills');
  const TH = ({ label, field }) => <SortableTH label={label} field={field} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />;
  return (
    <div className="data-table-container">
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>#</th>
              <TH label="Pro Name" field="playerName" />
              <TH label="IGN" field="ign" />
              <TH label="Team" field="teamName" />
              <th>Class</th>
              {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => (
                <th key={d} style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>D{d}</th>
              ))}
              <TH label="Matches" field="totalMatches" />
              <TH label="Events" field="events" />
              <TH label="Total Kills" field="totalKills" />
              <TH label="Avg Dmg" field="avgDamage" />
              <TH label="Avg Acc%" field="avgAccuracy" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.playerId || i}>
                <td><RankBadge rank={i + 1} /></td>
                <td style={{ fontWeight: 600 }}>{row.playerName}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{row.ign}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{row.teamName}</td>
                <td><ClassBadge playerClass={row.class} /></td>
                {Array.from({ length: totalDays }, (_, idx) => idx + 1).map((d) => (
                  <td key={d} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', textAlign: 'center', background: row[`d${d}`] > 0 ? undefined : 'var(--bg-alt-row)' }}>
                    {row[`d${d}`] || '—'}
                  </td>
                ))}
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.totalMatches}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.events}</td>
                <td className="col-total-kills">{row.totalKills}</td>
                <td className="col-avg-red">{row.avgDamage}</td>
                <td className="col-avg-red">{row.avgAccuracy}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CombinedTable({ data }) {
  const { sorted, sortKey, sortDir, handleSort } = useSort(data, 'totalKills');
  const TH = ({ label, field }) => <SortableTH label={label} field={field} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />;
  return (
    <div className="data-table-container">
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Class</th>
              <TH label="Pro Name" field="playerName" />
              <TH label="IGN" field="ign" />
              <TH label="Team" field="teamName" />
              <TH label="Clan" field="clanName" />
              <TH label="Gender" field="gender" />
              <TH label="Region" field="region" />
              <TH label="Country" field="country" />
              <TH label="Device" field="device" />
              <TH label="Model" field="deviceModel" />
              <TH label="Matches" field="totalMatches" />
              <TH label="Events" field="events" />
              <TH label="K/M" field="killsPerMatch" />
              <TH label="K/E" field="killsPerEvent" />
              <TH label="Total Kills" field="totalKills" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.playerId || i}>
                <td>{i + 1}</td>
                <td><ClassBadge playerClass={row.class} /></td>
                <td style={{ fontWeight: 600 }}>{row.playerName}</td>
                <td style={{ color: 'var(--text-muted)' }}>{row.ign}</td>
                <td>{row.teamName}</td>
                <td style={{ color: 'var(--text-muted)' }}>{row.clanName || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{row.gender || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{row.region || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{row.country || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{row.device || '—'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{row.deviceModel || '—'}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.totalMatches}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.events}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.killsPerMatch}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.killsPerEvent}</td>
                <td className="col-total-kills">{row.totalKills}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailsTable({ data, totalDays }) {
  const { sorted, sortKey, sortDir, handleSort } = useSort(data, 'totalKills');
  const TH = ({ label, field }) => <SortableTH label={label} field={field} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />;
  return (
    <div className="data-table-container">
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th><th>Class</th>
              <TH label="Pro Name" field="playerName" />
              <TH label="IGN" field="ign" />
              <TH label="Team" field="teamName" />
              <TH label="Clan" field="clanName" />
              {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => (
                <th key={d} style={{ fontSize: '0.72rem' }}>D{d} Kills</th>
              ))}
              <TH label="Matches" field="totalMatches" />
              <TH label="Events" field="events" />
              <TH label="K/M" field="killsPerMatch" />
              <TH label="K/E" field="killsPerEvent" />
              <TH label="Total Kills" field="totalKills" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.playerId || i}>
                <td>{i + 1}</td>
                <td><ClassBadge playerClass={row.class} /></td>
                <td style={{ fontWeight: 600 }}>{row.playerName}</td>
                <td style={{ color: 'var(--text-muted)' }}>{row.ign}</td>
                <td>{row.teamName}</td>
                <td style={{ color: 'var(--text-muted)' }}>{row.clanName || '—'}</td>
                {Array.from({ length: totalDays }, (_, idx) => idx + 1).map((d) => (
                  <td key={d} style={{ fontFamily: 'var(--font-mono)', textAlign: 'center', fontSize: '0.82rem' }}>
                    {row[`d${d}`] || '—'}
                  </td>
                ))}
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.totalMatches}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.events}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.killsPerMatch}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.killsPerEvent}</td>
                <td className="col-total-kills">{row.totalKills}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
