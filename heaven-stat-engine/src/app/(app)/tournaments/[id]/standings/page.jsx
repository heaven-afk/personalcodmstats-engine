'use client';
import { useState, useEffect, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { useTournament } from '../layout';
import { getTeamMatchResults, getBonusPoints, getPlayerMatchResults } from '@/lib/firestore/matchData';
import { getTeamRegistrations, getPlayerRegistrations, createTournament, addTeamRegistration, addPlayerRegistration } from '@/lib/firestore/tournaments';
import { getGroups, createGroup } from '@/lib/firestore/groups';
import { getTeams, getPlayers } from '@/lib/firestore/registry';
import { computeDailyStandings, computeSeasonStandings, computeTeamRanking, computeClanRanking } from '@/lib/engine/standings';
import { computePlayerStats, filterSet1Players, filterSet2Players, sortCombined } from '@/lib/engine/playerStats';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import { RankBadge, ClassBadge } from '@/components/ui/Badge';
import { BarChart3, ArrowUpDown, ArrowUp, ArrowDown, Shield, AlertTriangle, Trophy, CheckCircle, ArrowRight, Zap, Plus } from 'lucide-react';
import { cleanImageUrl } from '@/lib/utils/image';
import toast from 'react-hot-toast';

import useSWR from 'swr';

const BASE_TABS = [
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
  const router = useRouter();
  const [tab, setTab] = useState('daily');
  const [selectedDay, setSelectedDay] = useState(1);

  // Qualifier groups state
  const [selectedGroupId, setSelectedGroupId] = useState('');

  // Advancement modal state
  const [showAdvancementModal, setShowAdvancementModal] = useState(false);
  const [advancementMode, setAdvancementMode] = useState('group'); // 'group' | 'tournament'
  const [targetGroupId, setTargetGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [createNewGroupInline, setCreateNewGroupInline] = useState(false);
  const [newTournamentName, setNewTournamentName] = useState('');
  const [advancing, setAdvancing] = useState(false);

  const isQualifier = tournament?.type === 'qualifier';

  const { data, isLoading, mutate } = useSWR(
    tournament?.id ? ['tournament-standings', tournament.id, isQualifier] : null,
    async () => {
      const [tr, bp, pr, tRegs, pRegs, allTeams, allPlayers, gList] = await Promise.all([
        getTeamMatchResults(tournament.id),
        getBonusPoints(tournament.id),
        getPlayerMatchResults(tournament.id),
        getTeamRegistrations(tournament.id),
        getPlayerRegistrations(tournament.id),
        getTeams(),
        getPlayers(),
        isQualifier ? getGroups(tournament.id) : Promise.resolve([]),
      ]);

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

      return {
        teamResults: enrichedTeamResults,
        bonusPoints: enrichedBonuses,
        playerResults: pr,
        teamRegs: tRegs,
        playerRegs: pRegs,
        teams: allTeams,
        players: allPlayers,
        groups: gList,
      };
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  const teamResults   = data?.teamResults   || [];
  const bonusPoints   = data?.bonusPoints   || [];
  const playerResults = data?.playerResults || [];
  const teamRegs      = data?.teamRegs      || [];
  const playerRegs    = data?.playerRegs    || [];
  const teams         = data?.teams         || [];
  const players       = data?.players       || [];
  const groups        = data?.groups        || [];

  useEffect(() => {
    if (isQualifier && groups.length > 0 && !selectedGroupId) {
      setSelectedGroupId(groups[0].id);
    }
  }, [isQualifier, groups, selectedGroupId]);

  const selectedGroup = isQualifier ? groups.find(g => g.id === selectedGroupId) : null;
  const activeStructure = isQualifier ? (selectedGroup?.structure || {}) : (tournament?.structure || {});
  const totalDays = activeStructure.totalDays || 6;

  // Tabs list including Kill Table for Qualifier
  const TABS = useMemo(() => {
    if (!isQualifier) return BASE_TABS;
    return [
      ...BASE_TABS,
      { key: 'killTable', label: 'Kill Table (All Groups)' }
    ];
  }, [isQualifier]);

  // Group scoped data filtering for per-group tabs
  const groupTeamResults = useMemo(() => {
    if (!isQualifier || !selectedGroupId) return teamResults;
    return teamResults.filter(r => r.groupId === selectedGroupId);
  }, [teamResults, isQualifier, selectedGroupId]);

  const groupBonuses = useMemo(() => {
    if (!isQualifier || !selectedGroupId) return bonusPoints;
    const groupTeamIds = new Set(teamRegs.filter(r => r.groupId === selectedGroupId).map(r => r.teamId));
    return bonusPoints.filter(b => b.groupId === selectedGroupId || (!b.groupId && groupTeamIds.has(b.teamId)));
  }, [bonusPoints, isQualifier, selectedGroupId, teamRegs]);

  const groupPlayerResults = useMemo(() => {
    if (!isQualifier || !selectedGroupId) return playerResults;
    return playerResults.filter(r => r.groupId === selectedGroupId);
  }, [playerResults, isQualifier, selectedGroupId]);

  const groupPlayerRegs = useMemo(() => {
    if (!isQualifier || !selectedGroupId) return playerRegs;
    return playerRegs.filter(p => p.groupId === selectedGroupId);
  }, [playerRegs, isQualifier, selectedGroupId]);

  // Compute standings per group using EXACT unmodified core engine functions
  const daily = useMemo(() => computeDailyStandings(groupTeamResults, groupBonuses, tournament.scoring, selectedDay), [groupTeamResults, groupBonuses, tournament.scoring, selectedDay]);
  const season = useMemo(() => computeSeasonStandings(groupTeamResults, groupBonuses, tournament.scoring), [groupTeamResults, groupBonuses, tournament.scoring]);
  const teamRanking = useMemo(() => computeTeamRanking(groupTeamResults, groupBonuses, tournament.scoring), [groupTeamResults, groupBonuses, tournament.scoring]);
  const clanRanking = useMemo(() => computeClanRanking(teamRanking), [teamRanking]);

  // Group-scoped player stats
  const groupPlayerStats = useMemo(() => computePlayerStats(groupPlayerResults, groupPlayerRegs, tournament), [groupPlayerResults, groupPlayerRegs, tournament]);
  const set1Players = useMemo(() => filterSet1Players(groupPlayerStats), [groupPlayerStats]);
  const set2Players = useMemo(() => filterSet2Players(groupPlayerStats), [groupPlayerStats]);
  const combined = useMemo(() => sortCombined(groupPlayerStats), [groupPlayerStats]);

  // Unfiltered Shared Kill Table across ALL groups combined
  const allGroupPlayerStats = useMemo(() => {
    if (!isQualifier) return [];
    return computePlayerStats(playerResults, playerRegs, tournament);
  }, [isQualifier, playerResults, playerRegs, tournament]);

  const sharedKillTable = useMemo(() => {
    if (!isQualifier) return [];
    const groupMap = Object.fromEntries(groups.map(g => [g.id, g.groupName]));
    const regGroupMap = Object.fromEntries(playerRegs.map(p => [p.playerId, p.groupId]));
    
    return allGroupPlayerStats.map(ps => ({
      ...ps,
      groupId: regGroupMap[ps.playerId] || null,
      groupName: groupMap[regGroupMap[ps.playerId]] || '—',
    })).sort((a, b) => b.totalKills - a.totalKills);
  }, [isQualifier, allGroupPlayerStats, groups, playerRegs]);

  const teamMap = useMemo(() => {
    return Object.fromEntries(teams.map((t) => [t.id, t]));
  }, [teams]);

  // Advancement calculation: top N teams from current group's teamRanking
  const advancementCount = selectedGroup?.advancementCount || 2;
  const advancingTeams = useMemo(() => {
    if (!isQualifier || !selectedGroup || teamRanking.length === 0) return [];
    return teamRanking.slice(0, advancementCount);
  }, [isQualifier, selectedGroup, teamRanking, advancementCount]);

  const handleAdvancementSubmit = async () => {
    if (advancingTeams.length === 0) {
      toast.error('No advancing teams available.');
      return;
    }
    setAdvancing(true);
    try {
      const advancingTeamIds = advancingTeams.map(t => t.teamId);

      if (advancementMode === 'group') {
        let destGroupId = targetGroupId;
        if (createNewGroupInline) {
          if (!newGroupName.trim()) {
            toast.error('Please enter a target group name');
            setAdvancing(false);
            return;
          }
          const createdG = await createGroup(tournament.id, {
            groupName: newGroupName.trim(),
            structure: selectedGroup?.structure || { totalDays: 6, lobbiesPerDay: 4, playerClasses: [] },
            advancementCount: 2,
            status: 'setup',
          });
          destGroupId = createdG.id;
        } else if (!destGroupId) {
          toast.error('Please select a target group');
          setAdvancing(false);
          return;
        }

        // Copy team & player registrations to target group
        const targetRegs = await getTeamRegistrations(tournament.id);
        const targetGroupRegs = targetRegs.filter(r => r.groupId === destGroupId);
        let nextSlot = targetGroupRegs.length + 1;

        const sourceTeamRegs = teamRegs.filter(r => r.groupId === selectedGroupId && advancingTeamIds.includes(r.teamId));
        for (const reg of sourceTeamRegs) {
          await addTeamRegistration(tournament.id, {
            teamId: reg.teamId,
            teamName: reg.teamName,
            clanName: reg.clanName,
            slot: nextSlot++,
            tier: reg.tier || '',
            groupId: destGroupId,
          });

          const teamPlayers = playerRegs.filter(p => p.teamId === reg.teamId && p.groupId === selectedGroupId);
          for (const p of teamPlayers) {
            await addPlayerRegistration(tournament.id, {
              playerId: p.playerId,
              slot: p.slot || 1,
              class: p.class || '',
              teamId: p.teamId,
              teamName: p.teamName || reg.teamName,
              ign: p.ign || '',
              professionalName: p.professionalName || '',
              gender: p.gender || '',
              region: p.region || '',
              country: p.country || '',
              device: p.device || '',
              deviceModel: p.deviceModel || '',
              groupId: destGroupId,
            });
          }
        }

        toast.success(`Advanced ${advancingTeams.length} teams into target group!`);
        setShowAdvancementModal(false);
        await mutate();

      } else {
        // Option B: Advance into a new Standard tournament
        if (!newTournamentName.trim()) {
          toast.error('Please enter a new tournament name');
          setAdvancing(false);
          return;
        }

        const newT = await createTournament({
          name: newTournamentName.trim(),
          season: tournament.season || '2026 Season 1',
          description: `Seeded from ${selectedGroup?.groupName || 'Qualifier'} advancement`,
          type: 'standard',
          scoring: tournament.scoring || { killPointValue: 2, placementPoints: [], bonusTypes: [] },
          structure: selectedGroup?.structure || { totalDays: 6, lobbiesPerDay: 4, playerClasses: [] },
        });

        const sourceTeamRegs = teamRegs.filter(r => r.groupId === selectedGroupId && advancingTeamIds.includes(r.teamId));
        let nextSlot = 1;
        for (const reg of sourceTeamRegs) {
          await addTeamRegistration(newT.id, {
            teamId: reg.teamId,
            teamName: reg.teamName,
            clanName: reg.clanName,
            slot: nextSlot++,
            tier: reg.tier || '',
          });

          const teamPlayers = playerRegs.filter(p => p.teamId === reg.teamId && p.groupId === selectedGroupId);
          for (const p of teamPlayers) {
            await addPlayerRegistration(newT.id, {
              playerId: p.playerId,
              slot: p.slot || 1,
              class: p.class || '',
              teamId: p.teamId,
              teamName: p.teamName || reg.teamName,
              ign: p.ign || '',
              professionalName: p.professionalName || '',
              gender: p.gender || '',
              region: p.region || '',
              country: p.country || '',
              device: p.device || '',
              deviceModel: p.deviceModel || '',
            });
          }
        }

        toast.success(`Created tournament "${newT.name}" with ${advancingTeams.length} advancing teams!`);
        setShowAdvancementModal(false);
        router.push(`/tournaments/${newT.id}`);
      }
    } catch (err) {
      toast.error('Advancement failed: ' + err.message);
    } finally {
      setAdvancing(false);
    }
  };

  const hasDuplicates = useMemo(() => {
    const teamSeen = new Set();
    for (const r of teamResults) {
      const key = `${r.teamId}-${r.day}-${r.lobby}`;
      if (teamSeen.has(key)) return true;
      teamSeen.add(key);
    }
    const playerSeen = new Set();
    for (const r of playerResults) {
      const key = `${r.playerId}-${r.day}-${r.lobby}`;
      if (playerSeen.has(key)) return true;
      playerSeen.add(key);
    }
    return false;
  }, [teamResults, playerResults]);

  if (isLoading) return <LoadingSpinner size="lg" text="Loading standings..." />;

  const renderTeamTable = (data, showRank = false, isTeamRankTab = false) => (
    <TeamTable
      data={data}
      scoring={scoring}
      showRank={showRank}
      teamMap={teamMap}
      advancingTeamIds={isQualifier && isTeamRankTab && selectedGroup?.status === 'completed' ? advancingTeams.map(t => t.teamId) : []}
    />
  );

  return (
    <div>
      {hasDuplicates && (
        <div className="card" style={{
          border: '1px solid var(--border-gold)',
          background: 'rgba(201,168,76,0.05)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 18px',
          marginBottom: 20,
          borderRadius: 'var(--r-md)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <AlertTriangle style={{ color: 'var(--gold)' }} size={20} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
              <strong>Duplicate entries detected in database!</strong> This can skew standings and increase match counts.
            </span>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => router.push(`/tournaments/${tournament.id}/config`)}
            style={{ fontSize: '0.75rem' }}
          >
            Clean Database
          </button>
        </div>
      )}

      {/* Qualifier Group Selector Tabs (rendered for per-group tabs) */}
      {isQualifier && groups.length > 0 && tab !== 'killTable' && (
        <div className="card" style={{ marginBottom: 20, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--gold)' }}>Select Group Standings:</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {groups.map(g => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { setSelectedGroupId(g.id); setSelectedDay(1); }}
                    className={`btn btn-sm ${selectedGroupId === g.id ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontWeight: selectedGroupId === g.id ? 700 : 500 }}
                  >
                    {g.groupName} ({g.status || 'setup'})
                  </button>
                ))}
              </div>
            </div>

            {selectedGroup && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {selectedGroup.groupName} · Status: <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{selectedGroup.status || 'setup'}</span> · Top {selectedGroup.advancementCount || 2} Advance
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Tab bar */}
      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
            style={t.key === 'killTable' ? { color: 'var(--gold)', fontWeight: 700 } : {}}
          >
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
        <div>
          {teamRanking.length === 0
            ? <EmptyState icon={BarChart3} title="No rankings yet" text="Enter match data to generate team rankings." />
            : renderTeamTable(teamRanking, true, true)}

          {/* PART 7: Advancement Panel for Completed Qualifier Groups */}
          {isQualifier && selectedGroup?.status === 'completed' && (
            <div className="card" style={{ marginTop: 24, border: '1px solid #10b981', background: 'rgba(16,185,129,0.06)' }}>
              <div className="flex-between" style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle size={22} style={{ color: '#10b981' }} />
                  <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                      {selectedGroup.groupName} Completed — Advancement Ready
                    </h3>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                      Top {advancementCount} teams qualify to advance to the next stage.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ background: '#10b981', borderColor: '#10b981', color: '#000', fontWeight: 700 }}
                  onClick={() => setShowAdvancementModal(true)}
                >
                  <ArrowRight size={15} /> Send Advancing Teams to Next Stage
                </button>
              </div>

              {/* Advancing teams preview list */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {advancingTeams.map((t, idx) => (
                  <div
                    key={t.teamId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      background: 'rgba(16,185,129,0.15)',
                      border: '1px solid rgba(16,185,129,0.4)',
                      borderRadius: 8,
                      fontSize: '0.85rem',
                      fontWeight: 600,
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#10b981' }}>#{idx + 1}</span>
                    <span>{t.teamName}</span>
                    <span className="badge" style={{ background: '#10b981', color: '#000', fontSize: '0.65rem', fontWeight: 800 }}>
                      ADVANCES
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
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

      {/* PART 6: Shared Kill Table Across All Groups Combined */}
      {tab === 'killTable' && isQualifier && (
        sharedKillTable.length === 0
          ? <EmptyState icon={BarChart3} title="No Kill Data" text="Enter player match results to view the shared kill table across all groups." />
          : <SharedKillTable data={sharedKillTable} />
      )}

      {/* PART 7: Advancement Modal */}
      {showAdvancementModal && (
        <Modal title="Send Advancing Teams to Next Stage" onClose={() => setShowAdvancementModal(false)} size="md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
              Advancing top {advancingTeams.length} teams from <strong>{selectedGroup?.groupName}</strong>:
            </p>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {advancingTeams.map(t => (
                <div key={t.teamId} style={{ padding: '6px 12px', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {t.teamName} ({t.totalPts} pts)
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border-md)', paddingTop: 14 }}>
              <label className="form-label" style={{ marginBottom: 10, display: 'block' }}>Choose Advancement Destination:</label>
              
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => setAdvancementMode('group')}
                  style={{
                    flex: 1, padding: 12, borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                    border: `1px solid ${advancementMode === 'group' ? 'var(--gold)' : 'var(--border-md)'}`,
                    background: advancementMode === 'group' ? 'rgba(201,168,76,0.12)' : 'var(--bg-alt-row)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: advancementMode === 'group' ? 'var(--gold)' : 'var(--text-primary)' }}>
                    Option A: Another Qualifier Group
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Advance teams into another group in this tournament</div>
                </button>

                <button
                  type="button"
                  onClick={() => setAdvancementMode('tournament')}
                  style={{
                    flex: 1, padding: 12, borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                    border: `1px solid ${advancementMode === 'tournament' ? 'var(--gold)' : 'var(--border-md)'}`,
                    background: advancementMode === 'tournament' ? 'rgba(201,168,76,0.12)' : 'var(--bg-alt-row)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: advancementMode === 'tournament' ? 'var(--gold)' : 'var(--text-primary)' }}>
                    Option B: New Standard Tournament
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Create a new Standard tournament seeded with these teams</div>
                </button>
              </div>

              {advancementMode === 'group' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="flex-between">
                    <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Target Group:</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.75rem', color: 'var(--gold)' }}
                      onClick={() => setCreateNewGroupInline(v => !v)}
                    >
                      {createNewGroupInline ? 'Select Existing Group' : '+ Create New Group'}
                    </button>
                  </div>

                  {createNewGroupInline ? (
                    <div className="form-field">
                      <label className="form-label" style={{ fontSize: '0.75rem' }}>New Group Name</label>
                      <input
                        className="form-input"
                        placeholder="e.g. Qualifier Finals"
                        value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                      />
                    </div>
                  ) : (
                    <div className="form-field">
                      <select
                        className="form-select"
                        value={targetGroupId}
                        onChange={e => setTargetGroupId(e.target.value)}
                      >
                        <option value="">-- Select Target Group --</option>
                        {groups.filter(g => g.id !== selectedGroupId).map(g => (
                          <option key={g.id} value={g.id}>{g.groupName} ({g.status || 'setup'})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              ) : (
                <div className="form-field">
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>New Tournament Name</label>
                  <input
                    className="form-input"
                    placeholder="e.g. MGL Season 9 — Main Event"
                    value={newTournamentName}
                    onChange={e => setNewTournamentName(e.target.value)}
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowAdvancementModal(false)} disabled={advancing}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={handleAdvancementSubmit} disabled={advancing}>
                {advancing ? 'Processing Advancement...' : 'Confirm Advancement'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Sub-tables ────────────────────────────────────────────────────────────────
function TeamTable({ data, scoring, showRank, teamMap, advancingTeamIds = [] }) {
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
              const logoSrc = cleanImageUrl(team?.logo || team?.logoUrl);
              const isAdvancing = advancingTeamIds.includes(row.teamId);
              return (
                <tr key={row.teamId || i} style={isAdvancing ? { background: 'rgba(16,185,129,0.08)' } : {}}>
                  {showRank && <td><RankBadge rank={row.rank ?? i + 1} /></td>}
                  <td style={{ fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {logoSrc ? (
                        <img src={logoSrc} alt="" className="team-logo-thumbnail" width={20} height={20} referrerPolicy="no-referrer" />
                      ) : (
                        <Shield size={16} className="text-gold flex-shrink-0" />
                      )}
                      <span>{row.teamName}</span>
                      {isAdvancing && (
                        <span className="badge" style={{ background: '#10b981', color: '#000', fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px' }}>
                          ADVANCES
                        </span>
                      )}
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
              const logoSrc = cleanImageUrl(team?.logo || team?.logoUrl);
              return (
                <tr key={row.teamId || i}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {logoSrc ? (
                        <img src={logoSrc} alt="" className="team-logo-thumbnail" width={20} height={20} referrerPolicy="no-referrer" />
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

// ── PART 6: Shared Kill Table (All Groups Combined) ───────────────────────────
function SharedKillTable({ data }) {
  const { sorted, sortKey, sortDir, handleSort } = useSort(data, 'totalKills');
  const TH = ({ label, field }) => <SortableTH label={label} field={field} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />;
  return (
    <div className="data-table-container">
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>RK</th>
              <TH label="Group" field="groupName" />
              <TH label="Pro Name" field="playerName" />
              <TH label="IGN" field="ign" />
              <TH label="Team" field="teamName" />
              <th>Class</th>
              <TH label="Matches" field="totalMatches" />
              <TH label="Events" field="events" />
              <TH label="K/M" field="killsPerMatch" />
              <TH label="Total Kills" field="totalKills" />
              <TH label="Avg Dmg" field="avgDamage" />
              <TH label="Avg Acc%" field="avgAccuracy" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.playerId || i}>
                <td><RankBadge rank={i + 1} /></td>
                <td>
                  <span className="badge badge-gold" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                    {row.groupName}
                  </span>
                </td>
                <td style={{ fontWeight: 600 }}>{row.playerName}</td>
                <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{row.ign}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{row.teamName}</td>
                <td><ClassBadge playerClass={row.class} /></td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.totalMatches}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.events}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.killsPerMatch}</td>
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
