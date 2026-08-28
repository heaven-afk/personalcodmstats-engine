'use client';

import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  Sparkles, Trophy, Shield, User, Globe, Search,
  TrendingUp, Flame, Star, ChevronRight, Activity, Calendar
} from 'lucide-react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import DeepAnalysisView from '@/components/analytics/DeepAnalysisView';
import PlayerInfluenceCard from '@/components/analytics/PlayerInfluenceCard';
import MetricTooltip from '@/components/ui/MetricTooltip';
import { cleanImageUrl } from '@/lib/utils/image';

import {
  getTournaments, getTournament, getTeamRegistrations, getPlayerRegistrations,
  getAllRegistrationsForPlayer
} from '@/lib/firestore/tournaments';
import {
  getTeamMatchResults, getBonusPoints, getPlayerMatchResults,
  getAllMatchResultsForPlayer
} from '@/lib/firestore/matchData';
import { getTeams, getPlayers, getTeam } from '@/lib/firestore/registry';
import { computeTeamAnalytics } from '@/lib/engine/analytics';
import { computePlayerStats, computePlayerAnalytics } from '@/lib/engine/playerStats';
import { computePlayerInfluence } from '@/lib/engine/playerInfluence';
import { computePlayerXGSummary, computeTeamGlobalForm } from '@/lib/engine/globalForm';
import { getActiveMapConfig } from '@/lib/utils/mapConfig';
import { useAuth } from '@/contexts/AuthContext';

export default function AnalysisBoardPage() {
  const { isOwner, isOperator } = useAuth();

  // Top Section Tab state: 'tournament' | 'player' | 'team' | 'global'
  const [activeTab, setActiveTab] = useState('tournament');
  const [selectedTournamentId, setSelectedTournamentId] = useState('');

  // Player Analysis state (Global)
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');

  // Team Analysis state (Global)
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [teamSearchQuery, setTeamSearchQuery] = useState('');

  // Safety fallback for non-owners
  useEffect(() => {
    if (!isOwner && (activeTab === 'player' || activeTab === 'team')) {
      setActiveTab('tournament');
    }
  }, [isOwner, activeTab]);

  // Fetch all tournaments, teams, and players up front
  const { data: globalData, isLoading } = useSWR('analysis-board-global-data', async () => {
    const [tournaments, registryTeams, registryPlayers] = await Promise.all([
      getTournaments(),
      getTeams(),
      getPlayers(),
    ]);

    return {
      tournaments,
      registryTeams,
      registryPlayers,
    };
  }, { revalidateOnFocus: false, dedupingInterval: 60000 });

  const tournaments = globalData?.tournaments || [];
  const registryTeams = globalData?.registryTeams || [];
  const registryPlayers = globalData?.registryPlayers || [];

  // Default selections
  useEffect(() => {
    if (tournaments.length > 0 && !selectedTournamentId) {
      setSelectedTournamentId(tournaments[0].id);
    }
    if (registryPlayers.length > 0 && !selectedPlayerId) {
      setSelectedPlayerId(registryPlayers[0].id);
    }
    if (registryTeams.length > 0 && !selectedTeamId) {
      setSelectedTeamId(registryTeams[0].id);
    }
  }, [tournaments, registryPlayers, registryTeams, selectedTournamentId, selectedPlayerId, selectedTeamId]);

  const selectedTournament = useMemo(() => {
    return tournaments.find(t => t.id === selectedTournamentId) || null;
  }, [tournaments, selectedTournamentId]);

  // Fetch match results for selected tournament
  const { data: tourneyData, isLoading: tourneyLoading } = useSWR(
    selectedTournamentId ? `analysis-tourney-${selectedTournamentId}` : null,
    async () => {
      const [tRes, pRes, pRegs, bonuses] = await Promise.all([
        getTeamMatchResults(selectedTournamentId),
        getPlayerMatchResults(selectedTournamentId),
        getPlayerRegistrations(selectedTournamentId),
        getBonusPoints(selectedTournamentId),
      ]);
      return { tRes, pRes, pRegs, bonuses };
    },
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  );

  const teamMatchResults = tourneyData?.tRes || [];
  const playerMatchResults = tourneyData?.pRes || [];
  const playerRegs = tourneyData?.pRegs || [];
  const bonusPoints = tourneyData?.bonuses || [];

  // Compute Analytics Data for selected tournament
  const teamAnalyticsData = useMemo(() => {
    if (!selectedTournament) return [];
    return computeTeamAnalytics(teamMatchResults, bonusPoints, selectedTournament.scoring || {});
  }, [selectedTournament, teamMatchResults, bonusPoints]);

  const playerAnalyticsData = useMemo(() => {
    if (!selectedTournament || playerMatchResults.length === 0) return [];
    const pStats = computePlayerStats(playerMatchResults, playerRegs, selectedTournament);
    return computePlayerAnalytics(pStats, teamMatchResults);
  }, [selectedTournament, playerMatchResults, playerRegs, teamMatchResults]);

  const activeMapConfig = useMemo(() => {
    if (!selectedTournament) return null;
    return getActiveMapConfig(selectedTournament, null);
  }, [selectedTournament]);

  if (isLoading) {
    return <LoadingSpinner size="lg" text="Loading Analysis Board…" />;
  }

  return (
    <div className="space-y-6">
      {/* ── Page Header & Tabs ────────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: 12 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles size={24} style={{ color: 'var(--gold)' }} />
            Analysis Board
          </h1>
          <p className="page-subtitle">
            Tactical Insights, Player Influence, Career Form & Tournament Intelligence
          </p>
        </div>

        {/* Global Tournament Selector Dropdown (When on Tournament Tab) */}
        {activeTab === 'tournament' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Tournament:</span>
            <select
              className="form-select"
              style={{ margin: 0, minWidth: 220, fontSize: '0.85rem' }}
              value={selectedTournamentId}
              onChange={e => setSelectedTournamentId(e.target.value)}
            >
              {tournaments.length === 0 ? (
                <option value="">No Tournaments Available</option>
              ) : (
                tournaments.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} (Season {t.season})
                  </option>
                ))
              )}
            </select>
          </div>
        )}
      </div>

      {/* ── Section Navigation Tab Bar ─────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'var(--bg-card)',
        padding: '6px',
        borderRadius: 12,
        border: '1px solid var(--border)',
        overflowX: 'auto',
      }}>
        {/* Tab 1: Tournament Analysis */}
        <button
          className="btn"
          style={{
            padding: '8px 16px',
            fontSize: '0.84rem',
            fontWeight: 700,
            borderRadius: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            border: activeTab === 'tournament' ? '1px solid var(--border-gold)' : '1px solid transparent',
            background: activeTab === 'tournament' ? 'rgba(201,168,76,0.15)' : 'transparent',
            color: activeTab === 'tournament' ? 'var(--gold)' : 'var(--text-muted)',
            transition: 'all 0.2s ease',
          }}
          onClick={() => setActiveTab('tournament')}
        >
          <Trophy size={15} />
          Tournament Analysis
        </button>

        {/* Tab 2: Player Analysis (Owner Only) */}
        {isOwner && (
          <button
            className="btn"
            style={{
              padding: '8px 16px',
              fontSize: '0.84rem',
              fontWeight: 700,
              borderRadius: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: activeTab === 'player' ? '1px solid var(--border-gold)' : '1px solid transparent',
              background: activeTab === 'player' ? 'rgba(201,168,76,0.15)' : 'transparent',
              color: activeTab === 'player' ? 'var(--gold)' : 'var(--text-muted)',
              transition: 'all 0.2s ease',
            }}
            onClick={() => setActiveTab('player')}
          >
            <User size={15} />
            Player Analysis
          </button>
        )}

        {/* Tab 3: Team Analysis (Owner Only) */}
        {isOwner && (
          <button
            className="btn"
            style={{
              padding: '8px 16px',
              fontSize: '0.84rem',
              fontWeight: 700,
              borderRadius: 8,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: activeTab === 'team' ? '1px solid var(--border-gold)' : '1px solid transparent',
              background: activeTab === 'team' ? 'rgba(201,168,76,0.15)' : 'transparent',
              color: activeTab === 'team' ? 'var(--gold)' : 'var(--text-muted)',
              transition: 'all 0.2s ease',
            }}
            onClick={() => setActiveTab('team')}
          >
            <Shield size={15} />
            Team Analysis
          </button>
        )}

        {/* Tab 4: Global Placeholder */}
        <button
          className="btn"
          style={{
            padding: '8px 16px',
            fontSize: '0.84rem',
            fontWeight: 700,
            borderRadius: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            border: activeTab === 'global' ? '1px solid var(--border-gold)' : '1px solid transparent',
            background: activeTab === 'global' ? 'rgba(201,168,76,0.15)' : 'transparent',
            color: activeTab === 'global' ? 'var(--gold)' : 'var(--text-muted)',
            transition: 'all 0.2s ease',
          }}
          onClick={() => setActiveTab('global')}
        >
          <Globe size={15} />
          Global
          <span style={{
            fontSize: '0.62rem',
            padding: '1px 6px',
            borderRadius: 4,
            background: 'rgba(255,255,255,0.06)',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>
            Soon
          </span>
        </button>
      </div>

      {/* ── TAB 1: Tournament Analysis ───────────────────────────────────── */}
      {activeTab === 'tournament' && (
        <div>
          {tourneyLoading ? (
            <LoadingSpinner size="lg" text="Loading tournament deep analytics…" />
          ) : selectedTournament ? (
            <DeepAnalysisView
              tournament={selectedTournament}
              teamMatchResults={teamMatchResults}
              playerMatchResults={playerMatchResults}
              bonusPoints={bonusPoints}
              teamAnalyticsData={teamAnalyticsData}
              playerAnalyticsData={playerAnalyticsData}
              teamsRegistry={registryTeams}
              playersRegistry={registryPlayers}
              activeMapConfig={activeMapConfig}
            />
          ) : (
            <EmptyState
              icon={Trophy}
              title="No tournament selected"
              text="Select a tournament from the dropdown above to view deep analysis."
            />
          )}
        </div>
      )}

      {/* ── TAB 2: Player Analysis (Global) ───────────────────────────────── */}
      {activeTab === 'player' && isOwner && (
        <GlobalPlayerAnalysisSection
          playersRegistry={registryPlayers}
          selectedPlayerId={selectedPlayerId}
          onSelectPlayer={setSelectedPlayerId}
          searchQuery={playerSearchQuery}
          onSearchChange={setPlayerSearchQuery}
        />
      )}

      {/* ── TAB 3: Team Analysis (Global) ─────────────────────────────────── */}
      {activeTab === 'team' && isOwner && (
        <GlobalTeamAnalysisSection
          teamsRegistry={registryTeams}
          selectedTeamId={selectedTeamId}
          onSelectTeam={setSelectedTeamId}
          searchQuery={teamSearchQuery}
          onSearchChange={setTeamSearchQuery}
        />
      )}

      {/* ── TAB 4: Global Placeholder ─────────────────────────────────────── */}
      {activeTab === 'global' && (
        <div className="card" style={{
          padding: '48px 24px',
          textAlign: 'center',
          background: 'linear-gradient(135deg, rgba(201,168,76,0.08) 0%, rgba(15,23,42,0.9) 100%)',
          border: '1px solid rgba(201,168,76,0.25)',
          borderRadius: 16,
        }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'rgba(201,168,76,0.12)',
            border: '1px solid var(--border-gold)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 0 24px rgba(201,168,76,0.2)',
          }}>
            <Globe size={32} style={{ color: 'var(--gold)' }} />
          </div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>
            Cross-Tournament Global Intelligence
          </h2>
          <span style={{
            display: 'inline-block',
            fontSize: '0.7rem',
            fontWeight: 700,
            padding: '3px 10px',
            borderRadius: 6,
            background: 'rgba(201,168,76,0.15)',
            color: 'var(--gold)',
            border: '1px solid var(--border-gold)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: 16,
          }}>
            Coming Soon
          </span>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: 500, margin: '0 auto', lineHeight: 1.6 }}>
            Platform-wide meta analysis, map dominance heatmaps, unified global rating leaderboards,
            and predictive cross-event simulation models will appear here.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Global Player Analysis Section Component ────────────────────────────────
function GlobalPlayerAnalysisSection({
  playersRegistry = [],
  selectedPlayerId,
  onSelectPlayer,
  searchQuery,
  onSearchChange,
}) {
  const [loading, setLoading] = useState(false);
  const [influence, setInfluence] = useState(null);
  const [xgSummary, setXgSummary] = useState(null);

  const filteredPlayers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return playersRegistry;
    return playersRegistry.filter(p =>
      (p.ign || '').toLowerCase().includes(q) ||
      (p.professionalName || '').toLowerCase().includes(q) ||
      (p.currentIGN || '').toLowerCase().includes(q) ||
      (p.teamName || '').toLowerCase().includes(q)
    );
  }, [playersRegistry, searchQuery]);

  const currentPlayer = useMemo(() => {
    return playersRegistry.find(p => p.id === selectedPlayerId) || null;
  }, [playersRegistry, selectedPlayerId]);

  // Load global player influence & xG across all tournaments
  useEffect(() => {
    if (!selectedPlayerId) return;

    let isMounted = true;
    setLoading(true);

    async function loadGlobalPlayerData() {
      try {
        const [myPlayerRegs, myPlayerMatches] = await Promise.all([
          getAllRegistrationsForPlayer(selectedPlayerId),
          getAllMatchResultsForPlayer(selectedPlayerId),
        ]);

        const tourneyIdSet = new Set();
        myPlayerRegs.forEach(r => { if (r.tournamentId) tourneyIdSet.add(r.tournamentId); });
        myPlayerMatches.forEach(m => { if (m.tournamentId) tourneyIdSet.add(m.tournamentId); });
        const relevantTourneyIds = Array.from(tourneyIdSet);

        const [relevantTourneys, allTeamRes, allPlayerRes] = await Promise.all([
          Promise.all(relevantTourneyIds.map(tId => getTournament(tId))),
          Promise.all(relevantTourneyIds.map(tId => getTeamMatchResults(tId))),
          Promise.all(relevantTourneyIds.map(tId => getPlayerMatchResults(tId))),
        ]);

        const teamMatchHistory = [];
        const playerMatchesForXG = [];

        relevantTourneys.forEach((t, tIdx) => {
          if (!t) return;
          const playerResults = allPlayerRes[tIdx] || [];
          const teamResults   = allTeamRes[tIdx]   || [];

          const myReg = myPlayerRegs.find(r => r.tournamentId === t.id);
          const myTeamId = myReg?.teamId || playerResults.find(pr => pr.playerId === selectedPlayerId)?.teamId;
          if (!myTeamId) return;

          let eventDate = null;
          if (t.eventStartDate) {
            eventDate = new Date(t.eventStartDate);
          } else if (t.createdAt?.seconds) {
            eventDate = new Date(t.createdAt.seconds * 1000);
          } else if (t.createdAt?.toDate) {
            eventDate = t.createdAt.toDate();
          } else {
            eventDate = new Date(0);
          }

          const myPlayerResults = playerResults.filter(pr => pr.playerId === selectedPlayerId);
          myPlayerResults.forEach(pr => {
            playerMatchesForXG.push({
              kills:    pr.kills    || 0,
              accuracy: pr.accuracy || null,
              damage:   pr.damage   || null,
              date:     eventDate,
            });
          });

          const teamMatchesForMyTeam = teamResults.filter(tr => tr.teamId === myTeamId);

          teamMatchesForMyTeam.forEach(tm => {
            const matchKey = `${tm.day}-${tm.lobby}${tm.groupId ? '-' + tm.groupId : ''}`;
            const allPlayerResultsThisMatch = playerResults.filter(pr =>
              pr.teamId === myTeamId &&
              pr.day === tm.day &&
              pr.lobby === tm.lobby &&
              (tm.groupId ? pr.groupId === tm.groupId : true)
            );

            const teamSize = new Set(allPlayerResultsThisMatch.map(pr => pr.playerId)).size || 1;
            const myResult = allPlayerResultsThisMatch.find(pr => pr.playerId === selectedPlayerId);
            const present = Boolean(myResult);
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

        if (!isMounted) return;

        const inf = computePlayerInfluence(selectedPlayerId, teamMatchHistory);
        setInfluence(inf);

        const xg = computePlayerXGSummary(playerMatchesForXG);
        setXgSummary(xg);
      } catch (err) {
        console.error('Global player analysis load error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadGlobalPlayerData();

    return () => { isMounted = false; };
  }, [selectedPlayerId]);

  return (
    <div className="space-y-6">
      {/* ── Player Selection Header ───────────────────────────────────────── */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <User size={18} style={{ color: 'var(--gold)' }} />
              Global Player Intelligence
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2, margin: 0 }}>
              Select a player to examine career Influence ratings and Expected Kills (xG) across all events
            </p>
          </div>

          {/* Search & Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 220 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Filter players…"
                className="form-input text-xs"
                style={{ paddingLeft: 30, height: 36, margin: 0 }}
                value={searchQuery}
                onChange={e => onSearchChange(e.target.value)}
              />
            </div>

            <select
              className="form-select"
              style={{ margin: 0, minWidth: 200, height: 36, fontSize: '0.85rem' }}
              value={selectedPlayerId}
              onChange={e => onSelectPlayer(e.target.value)}
            >
              {filteredPlayers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.professionalName ? `${p.professionalName} (${p.currentIGN || p.ign || '—'})` : (p.currentIGN || p.ign || 'Player')}
                </option>
              ))}
            </select>

            {currentPlayer && (
              <Link
                href={`/players/${currentPlayer.id}`}
                className="btn btn-secondary btn-sm"
                style={{ height: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                Profile <ChevronRight size={14} />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Selected Player Content ────────────────────────────────────────── */}
      {loading ? (
        <LoadingSpinner size="lg" text="Computing global player breakdown…" />
      ) : currentPlayer ? (
        <PlayerInfluenceCard
          influence={influence}
          xgSummary={xgSummary}
          scopeLabel="Global career influence metrics across all tournaments."
        />
      ) : (
        <EmptyState
          icon={User}
          title="No player selected"
          text="Select a player from the dropdown above to inspect career influence metrics."
        />
      )}
    </div>
  );
}

// ─── Global Team Analysis Section Component ──────────────────────────────────
function GlobalTeamAnalysisSection({
  teamsRegistry = [],
  selectedTeamId,
  onSelectTeam,
  searchQuery,
  onSearchChange,
}) {
  const [loading, setLoading] = useState(false);
  const [teamData, setTeamData] = useState(null);

  const filteredTeams = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return teamsRegistry;
    return teamsRegistry.filter(t =>
      (t.teamName || '').toLowerCase().includes(q) ||
      (t.clanName || '').toLowerCase().includes(q)
    );
  }, [teamsRegistry, searchQuery]);

  const currentTeam = useMemo(() => {
    return teamsRegistry.find(t => t.id === selectedTeamId) || null;
  }, [teamsRegistry, selectedTeamId]);

  // Fetch team career summary data across all tournaments
  useEffect(() => {
    if (!selectedTeamId) return;

    let isMounted = true;
    setLoading(true);

    async function loadGlobalTeamStats() {
      try {
        const [teamDoc, allTourneys] = await Promise.all([
          getTeam(selectedTeamId),
          getTournaments(),
        ]);

        const [allTeamRegs, allTeamRes, allBonuses] = await Promise.all([
          Promise.all(allTourneys.map(t => getTeamRegistrations(t.id))),
          Promise.all(allTourneys.map(t => getTeamMatchResults(t.id))),
          Promise.all(allTourneys.map(t => getBonusPoints(t.id))),
        ]);

        const teamMatchResultsByTournament = {};
        allTourneys.forEach((tourney, idx) => {
          teamMatchResultsByTournament[tourney.id] = allTeamRes[idx] || [];
        });

        const gf = computeTeamGlobalForm(selectedTeamId, allTourneys, teamMatchResultsByTournament);

        const participationHistory = [];
        let totalWins = 0;
        let totalMatches = 0;
        let totalPlacePts = 0;
        let totalKillPts = 0;
        let totalBonusPts = 0;
        let totalPts = 0;

        allTourneys.forEach((tourney, i) => {
          const regs = allTeamRegs[i] || [];
          const res = allTeamRes[i] || [];
          const bonuses = allBonuses[i] || [];

          const teamMatches = res.filter(r => r.teamId === selectedTeamId);
          const isReg = regs.some(r => r.teamId === selectedTeamId);

          if (isReg || teamMatches.length > 0) {
            const wins = teamMatches.filter(m => m.placement === 1).length;
            const matchesCount = teamMatches.length;

            const tPlacePts = teamMatches.reduce((s, m) => s + (m.placementPts || 0), 0);
            const tKillPts = teamMatches.reduce((s, m) => s + ((m.kills || 0) * (tourney.scoring?.killPointValue || 2)), 0);
            const tBonusPts = bonuses.filter(b => b.teamId === selectedTeamId).reduce((s, b) => s + (b.amount || 0), 0);
            const tourneyTotal = tPlacePts + tKillPts + tBonusPts;

            totalWins += wins;
            totalMatches += matchesCount;
            totalPlacePts += tPlacePts;
            totalKillPts += tKillPts;
            totalBonusPts += tBonusPts;
            totalPts += tourneyTotal;

            participationHistory.push({
              id: tourney.id,
              name: tourney.name,
              season: tourney.season,
              status: tourney.status,
              wins,
              matches: matchesCount,
              placementPts: tPlacePts,
              killPts: tKillPts,
              bonusPts: tBonusPts,
              totalPts: tourneyTotal,
            });
          }
        });

        if (!isMounted) return;

        setTeamData({
          team: teamDoc || currentTeam,
          globalForm: gf,
          participationHistory,
          careerStats: {
            wins: totalWins,
            matches: totalMatches,
            tournaments: participationHistory.length,
            placementPts: totalPlacePts,
            killPts: totalKillPts,
            bonusPts: totalBonusPts,
            totalPts,
          },
        });
      } catch (err) {
        console.error('Global team analysis load error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadGlobalTeamStats();

    return () => { isMounted = false; };
  }, [selectedTeamId, currentTeam]);

  const logoUrl = cleanImageUrl(teamData?.team?.logoUrl || teamData?.team?.logo);

  return (
    <div className="space-y-6">
      {/* ── Team Selection Header ─────────────────────────────────────────── */}
      <div className="card" style={{ padding: 18 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={18} style={{ color: 'var(--gold)' }} />
              Global Team Intelligence
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2, margin: 0 }}>
              Career trajectory, global form and performance history across all tournaments
            </p>
          </div>

          {/* Search & Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', width: 220 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Filter teams…"
                className="form-input text-xs"
                style={{ paddingLeft: 30, height: 36, margin: 0 }}
                value={searchQuery}
                onChange={e => onSearchChange(e.target.value)}
              />
            </div>

            <select
              className="form-select"
              style={{ margin: 0, minWidth: 200, height: 36, fontSize: '0.85rem' }}
              value={selectedTeamId}
              onChange={e => onSelectTeam(e.target.value)}
            >
              {filteredTeams.map(t => (
                <option key={t.id} value={t.id}>
                  {t.teamName} {t.clanName ? `[${t.clanName}]` : ''}
                </option>
              ))}
            </select>

            {currentTeam && (
              <Link
                href={`/teams/${currentTeam.id}`}
                className="btn btn-secondary btn-sm"
                style={{ height: 36, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                Profile <ChevronRight size={14} />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Selected Team Content ──────────────────────────────────────────── */}
      {loading ? (
        <LoadingSpinner size="lg" text="Aggregating global team history…" />
      ) : teamData ? (
        <div className="space-y-6">
          {/* Identity & Hero Header */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: 10,
                  flexShrink: 0,
                  background: 'var(--bg-header)',
                  border: '2px solid var(--border-gold)',
                  boxShadow: '0 0 16px rgba(201, 168, 76, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  {logoUrl ? (
                    <img src={logoUrl} alt={teamData.team.teamName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                  ) : (
                    <Shield size={28} style={{ color: 'var(--gold)' }} />
                  )}
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                      {teamData.team.teamName}
                    </h2>
                    {teamData.globalForm && teamData.globalForm.confidence !== 'unranked' && (
                      <span className="badge" style={{
                        background: 'rgba(201, 168, 76, 0.15)',
                        color: 'var(--gold)',
                        border: '1px solid var(--border-gold)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: '0.75rem',
                      }}>
                        <Flame size={12} /> Global Form: {teamData.globalForm.decayedForm} ({teamData.globalForm.trend === 'up' ? '↑' : teamData.globalForm.trend === 'down' ? '↓' : '→'})
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 3, margin: 0 }}>
                    Clan: <strong style={{ color: 'var(--text-secondary)' }}>{teamData.team.clanName || 'No Clan'}</strong>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Career Summary Stats Grid */}
          <div className="card">
            <h3 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <Star size={18} className="text-gold fill-gold" />
              Career Summary
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Total Points</div>
                <div className="text-xl font-bold font-mono text-gold mt-1">{teamData.careerStats.totalPts}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Lobby Wins</div>
                <div className="text-xl font-bold font-mono text-success mt-1">{teamData.careerStats.wins}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Matches</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{teamData.careerStats.matches}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Tournaments</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{teamData.careerStats.tournaments}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Place Pts</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{teamData.careerStats.placementPts}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Kill Pts</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{teamData.careerStats.killPts}</div>
              </div>
            </div>
          </div>

          {/* Tournament Participation Table */}
          <div className="card">
            <h3 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <Calendar size={18} className="text-gold" />
              Tournament History
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tournament</th>
                    <th>Season</th>
                    <th>Status</th>
                    <th>Wins</th>
                    <th>Matches</th>
                    <th>Place Pts</th>
                    <th>Kill Pts</th>
                    <th>Bonus Pts</th>
                    <th>Total Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {teamData.participationHistory.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="empty-row">No tournament history found for this team.</td>
                    </tr>
                  ) : (
                    teamData.participationHistory.map(h => (
                      <tr key={h.id}>
                        <td>
                          <Link href={`/tournaments/${h.id}`} className="font-semibold text-text-primary hover:text-gold transition">
                            {h.name}
                          </Link>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{h.season || '—'}</td>
                        <td>
                          <span style={{
                            fontSize: '0.7rem',
                            padding: '2px 8px',
                            borderRadius: 4,
                            background: h.status === 'completed' ? 'rgba(74,222,128,0.15)' : 'rgba(201,168,76,0.15)',
                            color: h.status === 'completed' ? '#4ade80' : 'var(--gold)',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                          }}>
                            {h.status || 'Active'}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{h.wins}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{h.matches}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{h.placementPts}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{h.killPts}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{h.bonusPts}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--gold)' }}>{h.totalPts}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={Shield}
          title="No team selected"
          text="Select a team from the dropdown above to inspect career summary stats."
        />
      )}
    </div>
  );
}
