'use client';

import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { Sparkles, Trophy, Shield, User, BarChart2 } from 'lucide-react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import DeepAnalysisView from '@/components/analytics/DeepAnalysisView';

import { getTournaments, getTeamRegistrations, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getBonusPoints, getPlayerMatchResults } from '@/lib/firestore/matchData';
import { getTeams, getPlayers } from '@/lib/firestore/registry';
import { computeTeamAnalytics } from '@/lib/engine/analytics';
import { computePlayerStats, computePlayerAnalytics } from '@/lib/engine/playerStats';
import { getActiveMapConfig } from '@/lib/utils/mapConfig';

export default function GlobalDeepAnalysisPage() {
  const [selectedTournamentId, setSelectedTournamentId] = useState('');

  // Fetch all tournaments, teams, and players
  const { data: globalData, isLoading } = useSWR('global-deep-analysis-page', async () => {
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

  // Default to the newest tournament if available
  useEffect(() => {
    if (tournaments.length > 0 && !selectedTournamentId) {
      setSelectedTournamentId(tournaments[0].id);
    }
  }, [tournaments, selectedTournamentId]);

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

  if (isLoading || (selectedTournamentId && tourneyLoading)) {
    return <LoadingSpinner size="lg" />;
  }

  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles size={24} style={{ color: 'var(--gold)' }} />
            Deep Analysis Engine
          </h1>
          <p className="page-subtitle">
            Narrative Insights, Match Logs, Field Standing & Cross-Event Career Analytics
          </p>
        </div>

        {/* Global Tournament Selector Dropdown */}
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
      </div>

      {/* Main Content View */}
      {selectedTournament ? (
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
          icon={Sparkles}
          title="No tournament selected"
          text="Select a tournament from the dropdown above to view deep analysis."
        />
      )}
    </div>
  );
}
