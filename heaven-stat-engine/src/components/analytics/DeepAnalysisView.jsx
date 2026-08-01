'use client';

import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import useSWR from 'swr';
import html2canvas from 'html2canvas';
import {
  Shield, User, Download, Sparkles, TrendingUp, TrendingDown,
  Trophy, Target, ChevronDown, ChevronUp, MapPin, BarChart2,
  Calendar, Flame, Award, AlertCircle, AlertTriangle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Cell
} from 'recharts';

import { PlaystyleBadge, RatingBadge, RankBadge, ClassBadge } from '@/components/ui/Badge';
import MetricTooltip from '@/components/ui/MetricTooltip';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { cleanImageUrl } from '@/lib/utils/image';
import { AVAILABLE_MAPS } from '@/lib/constants/maps';
import { getMapForMatch, filterResultsByMap } from '@/lib/utils/mapConfig';

import { computeTeamAnalytics, getTeamRatingRankLabel } from '@/lib/engine/analytics';
import { computePlayerAnalytics, computePlayerStats } from '@/lib/engine/playerStats';
import { detectTeamInsights, detectPlayerInsights, computePercentile, formatPercentileBand, generateDeterministicTemplate } from '@/lib/engine/insightRules';

import { getTournaments, getTeamRegistrations, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getBonusPoints, getPlayerMatchResults } from '@/lib/firestore/matchData';
import { getTeams, getPlayers } from '@/lib/firestore/registry';

// ─── Local Narrative Cache Helper ─────────────────────────────────────────────
function getCachedNarrative(cacheKey) {
  try {
    const item = localStorage.getItem(`narrative_${cacheKey}`);
    return item ? JSON.parse(item) : null;
  } catch { return null; }
}

function setCachedNarrative(cacheKey, narrative) {
  try {
    localStorage.setItem(`narrative_${cacheKey}`, JSON.stringify(narrative));
  } catch {}
}

// ─── Narrative Callout Box Component ──────────────────────────────────────────
function NarrativeCallout({ facts, entityName, cacheKey }) {
  const [narrative, setNarrative] = useState('');
  const [loading, setLoading] = useState(false);
  const [isFallback, setIsFallback] = useState(false);

  const factsHash = useMemo(() => JSON.stringify(facts), [facts]);

  useEffect(() => {
    if (!facts || facts.length === 0) {
      setNarrative('');
      return;
    }

    const fullKey = `${cacheKey}_${factsHash}`;
    const cached = getCachedNarrative(fullKey);
    if (cached) {
      setNarrative(cached.narrative);
      setIsFallback(cached.fallback || false);
      return;
    }

    let isMounted = true;
    setLoading(true);

    fetch('/api/insights/phrase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facts, entityName })
    })
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return;
        const text = data.narrative || generateDeterministicTemplate(facts, entityName);
        setNarrative(text);
        setIsFallback(data.fallback || false);
        setCachedNarrative(fullKey, { narrative: text, fallback: data.fallback });
      })
      .catch(() => {
        if (!isMounted) return;
        const fallbackText = generateDeterministicTemplate(facts, entityName);
        setNarrative(fallbackText);
        setIsFallback(true);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => { isMounted = false; };
  }, [facts, factsHash, entityName, cacheKey]);

  if (!facts || facts.length === 0) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.12) 0%, rgba(15, 23, 42, 0.9) 100%)',
      border: '1px solid rgba(201, 168, 76, 0.3)',
      borderRadius: 12,
      padding: '16px 20px',
      marginBottom: 24,
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Sparkles size={18} style={{ color: 'var(--gold)' }} />
        <span style={{ fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--gold)' }}>
          Narrative Performance Insights
        </span>
        {isFallback && (
          <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
            Rule-Based
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          <LoadingSpinner size="sm" /> Generating analyst insights...
        </div>
      ) : (
        <p style={{
          fontSize: '0.92rem',
          lineHeight: 1.6,
          color: 'var(--text-primary)',
          fontStyle: 'italic',
          fontWeight: 500,
          margin: 0
        }}>
          "{narrative}"
        </p>
      )}
    </div>
  );
}

// ─── Main Deep Analysis View Component ────────────────────────────────────────
export default function DeepAnalysisView({
  tournament,
  teamMatchResults = [],
  playerMatchResults = [],
  bonusPoints = [],
  teamAnalyticsData = [],
  playerAnalyticsData = [],
  teamsRegistry = [],
  playersRegistry = [],
  activeMapConfig = null,
}) {
  // Navigation & Selection state
  const [entityType, setEntityType] = useState('team'); // 'team' | 'player'
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [scope, setScope] = useState('tournament'); // 'tournament' | 'career'
  const [isExporting, setIsExporting] = useState(false);

  // Expanded row state for career view
  const [expandedCareerRow, setExpandedCareerRow] = useState(null);

  // Initialize selected entity ID if not set
  useEffect(() => {
    if (entityType === 'team' && teamAnalyticsData.length > 0) {
      if (!teamAnalyticsData.some(t => t.teamId === selectedEntityId)) {
        setSelectedEntityId(teamAnalyticsData[0]?.teamId || '');
      }
    } else if (entityType === 'player' && playerAnalyticsData.length > 0) {
      if (!playerAnalyticsData.some(p => p.playerId === selectedEntityId)) {
        setSelectedEntityId(playerAnalyticsData[0]?.playerId || '');
      }
    }
  }, [entityType, teamAnalyticsData, playerAnalyticsData, selectedEntityId]);

  // Lookup selected team / player analytics for current tournament
  const currentTeam = useMemo(() => {
    if (entityType !== 'team') return null;
    return teamAnalyticsData.find(t => t.teamId === selectedEntityId) || null;
  }, [entityType, teamAnalyticsData, selectedEntityId]);

  const currentPlayer = useMemo(() => {
    if (entityType !== 'player') return null;
    return playerAnalyticsData.find(p => p.playerId === selectedEntityId) || null;
  }, [entityType, playerAnalyticsData, selectedEntityId]);

  // Registries lookup maps
  const teamRegMap = useMemo(() => {
    return Object.fromEntries(teamsRegistry.map(t => [t.id, t]));
  }, [teamsRegistry]);

  const playerRegMap = useMemo(() => {
    return Object.fromEntries(playersRegistry.map(p => [p.id, p]));
  }, [playersRegistry]);

  // Handle Export to PNG
  const handleExport = async () => {
    const el = document.getElementById('deep-analysis-capture');
    if (!el) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(el, {
        backgroundColor: '#0D1B2A',
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const name = entityType === 'team' ? (currentTeam?.teamName || 'team') : (currentPlayer?.ign || 'player');
      const link = document.createElement('a');
      link.download = `${name.toLowerCase().replace(/\s+/g, '_')}_deep_analysis.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Export PNG error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  // Cross-tournament SWR query for Career Scope
  const { data: careerGlobalData, isLoading: careerLoading } = useSWR(
    scope === 'career' ? 'deep-analysis-career-global' : null,
    async () => {
      const [allTournaments, registryTeams, registryPlayers] = await Promise.all([
        getTournaments(), getTeams(), getPlayers(),
      ]);
      const [allTeamRes, allTeamBonuses, allPlayerRes, allTeamRegs, allPlayerRegs] = await Promise.all([
        Promise.all(allTournaments.map(t => getTeamMatchResults(t.id))),
        Promise.all(allTournaments.map(t => getBonusPoints(t.id))),
        Promise.all(allTournaments.map(t => getPlayerMatchResults(t.id))),
        Promise.all(allTournaments.map(t => getTeamRegistrations(t.id))),
        Promise.all(allTournaments.map(t => getPlayerRegistrations(t.id))),
      ]);
      return {
        allTournaments,
        registryTeams,
        registryPlayers,
        allTeamRes,
        allTeamBonuses,
        allPlayerRes,
        allTeamRegs,
        allPlayerRegs,
      };
    },
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  // Compute Career History for selected entity
  const careerHistory = useMemo(() => {
    if (scope !== 'career' || !careerGlobalData || !selectedEntityId) return [];
    const { allTournaments, allTeamRes, allTeamBonuses, allPlayerRes, allTeamRegs, allPlayerRegs } = careerGlobalData;

    const list = [];

    allTournaments.forEach((tourney, idx) => {
      const scoring = tourney.scoring || {};
      const tRes = allTeamRes[idx] || [];
      const tBonuses = allTeamBonuses[idx] || [];
      const pRes = allPlayerRes[idx] || [];
      const pRegs = allPlayerRegs[idx] || [];
      const mapCfg = tourney.mapConfig || null;

      if (entityType === 'team') {
        const teamAnalytics = computeTeamAnalytics(tRes, tBonuses, scoring);
        const item = teamAnalytics.find(t => t.teamId === selectedEntityId);
        if (item) {
          list.push({
            tournament: tourney,
            tournamentId: tourney.id,
            tournamentName: tourney.name || 'Tournament',
            date: tourney.createdAt ? new Date(tourney.createdAt.seconds ? tourney.createdAt.seconds * 1000 : tourney.createdAt).toLocaleDateString() : '—',
            rank: item.analyticsRank,
            totalPts: item.totalPts,
            kills: item.kills,
            wins: item.wins,
            matches: item.matches,
            rating: item.scores?.FINAL_RATING || 0,
            identity: item.identity || 'Balanced',
            analyticsItem: item,
            matchResults: tRes.filter(r => r.teamId === selectedEntityId),
            mapConfig: mapCfg,
            scoring,
          });
        }
      } else {
        // Player career
        const pReg = pRegs.find(r => r.playerId === selectedEntityId);
        const pMatches = pRes.filter(r => r.playerId === selectedEntityId);
        if (pMatches.length > 0 || pReg) {
          const computedPStats = computePlayerStats(pRes, pRegs, tourney);
          const computedPAnalytics = computePlayerAnalytics(computedPStats, tRes);
          const pItem = computedPAnalytics.find(p => p.playerId === selectedEntityId);
          if (pItem) {
            list.push({
              tournament: tourney,
              tournamentId: tourney.id,
              tournamentName: tourney.name || 'Tournament',
              date: tourney.createdAt ? new Date(tourney.createdAt.seconds ? tourney.createdAt.seconds * 1000 : tourney.createdAt).toLocaleDateString() : '—',
              rank: pItem.analyticsRank,
              totalKills: pItem.totalKills,
              matches: pItem.totalMatches,
              rating: pItem.scores?.FINAL_RATING || pItem.scores?.RATING * 10 || 0,
              identity: pItem.identity || 'Balanced',
              analyticsItem: pItem,
              playerMatchResults: pMatches,
              teamMatchResults: tRes,
              mapConfig: mapCfg,
              scoring,
            });
          }
        }
      }
    });

    // Chronological order for trend chart
    return list;
  }, [scope, careerGlobalData, entityType, selectedEntityId]);

  // Render selection toolbar
  return (
    <div>
      {/* Selector & Scope Bar */}
      <div className="card" style={{ marginBottom: 24, padding: '16px 20px' }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justify: 'space-between',
          gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flex: 1 }}>
            {/* Entity Type Toggle */}
            <div style={{ display: 'inline-flex', background: 'var(--bg-header)', padding: 3, borderRadius: 8, border: '1px solid var(--border)' }}>
              <button
                className={`btn btn-sm ${entityType === 'team' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                onClick={() => { setEntityType('team'); setExpandedCareerRow(null); }}
              >
                <Shield size={14} style={{ marginRight: 6 }} /> Teams
              </button>
              <button
                className={`btn btn-sm ${entityType === 'player' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                onClick={() => { setEntityType('player'); setExpandedCareerRow(null); }}
              >
                <User size={14} style={{ marginRight: 6 }} /> Players
              </button>
            </div>

            {/* Entity Dropdown Search Picker */}
            <select
              className="form-select"
              style={{ minWidth: 220, margin: 0, fontSize: '0.85rem' }}
              value={selectedEntityId}
              onChange={(e) => setSelectedEntityId(e.target.value)}
            >
              {entityType === 'team' ? (
                teamAnalyticsData.map(t => (
                  <option key={t.teamId} value={t.teamId}>
                    {t.teamName} (Rank #{t.analyticsRank})
                  </option>
                ))
              ) : (
                playerAnalyticsData.map(p => (
                  <option key={p.playerId} value={p.playerId}>
                    {p.ign || p.playerName} ({p.teamName ? `${p.teamName}` : 'Free Agent'})
                  </option>
                ))
              )}
            </select>

            {/* Scope Toggle */}
            <div style={{ display: 'inline-flex', background: 'var(--bg-header)', padding: 3, borderRadius: 8, border: '1px solid var(--border)' }}>
              <button
                className={`btn btn-sm ${scope === 'tournament' ? 'btn-gold' : 'btn-ghost'}`}
                style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                onClick={() => setScope('tournament')}
              >
                <Trophy size={14} style={{ marginRight: 6 }} /> This Tournament
              </button>
              <button
                className={`btn btn-sm ${scope === 'career' ? 'btn-gold' : 'btn-ghost'}`}
                style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                onClick={() => setScope('career')}
              >
                <TrendingUp size={14} style={{ marginRight: 6 }} /> Career
              </button>
            </div>
          </div>

          {/* PNG Export Button */}
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleExport}
            disabled={isExporting}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}
          >
            <Download size={14} />
            {isExporting ? 'Exporting PNG...' : 'Download PNG'}
          </button>
        </div>
      </div>

      {/* Captured Deep Analysis View Container */}
      <div id="deep-analysis-capture" style={{ padding: 4, borderRadius: 12 }}>
        {scope === 'tournament' ? (
          <>
            <TournamentSummaryOverview
              tournament={tournament}
              teamAnalyticsData={teamAnalyticsData}
              playerAnalyticsData={playerAnalyticsData}
              teamMatchResults={teamMatchResults}
              playerMatchResults={playerMatchResults}
              activeMapConfig={activeMapConfig}
              teamRegMap={teamRegMap}
            />
            {entityType === 'team' ? (
              <TournamentTeamView
                team={currentTeam}
                tournamentField={teamAnalyticsData}
                teamMatchResults={teamMatchResults}
                activeMapConfig={activeMapConfig}
                teamReg={teamRegMap[currentTeam?.teamId]}
              />
            ) : (
              <TournamentPlayerView
                player={currentPlayer}
                tournamentField={playerAnalyticsData}
                playerMatchResults={playerMatchResults}
                teamMatchResults={teamMatchResults}
                activeMapConfig={activeMapConfig}
                playerReg={playerRegMap[currentPlayer?.playerId]}
              />
            )}
          </>
        ) : (
          <CareerDeepAnalysisView
            entityType={entityType}
            entityId={selectedEntityId}
            currentTeam={currentTeam}
            currentPlayer={currentPlayer}
            careerHistory={careerHistory}
            loading={careerLoading}
            expandedRow={expandedCareerRow}
            setExpandedRow={setExpandedCareerRow}
          />
        )}
      </div>
    </div>
  );
}

// ─── 0. TOURNAMENT SUMMARY OVERVIEW COMPONENT ──────────────────────────────────
function TournamentSummaryOverview({
  tournament,
  teamAnalyticsData = [],
  playerAnalyticsData = [],
  teamMatchResults = [],
  playerMatchResults = [],
  activeMapConfig = null,
  teamRegMap = {},
}) {
  const [showSummary, setShowSummary] = useState(true);

  // 1. Overall Best Performing Team (#1 in analyticsRank or highest points)
  const bestOverallTeam = useMemo(() => {
    if (!teamAnalyticsData || teamAnalyticsData.length === 0) return null;
    return [...teamAnalyticsData].sort((a, b) => (a.analyticsRank || 999) - (b.analyticsRank || 999))[0];
  }, [teamAnalyticsData]);

  // 2. Best Player Overall (MVP)
  const bestPlayerMVP = useMemo(() => {
    if (!playerAnalyticsData || playerAnalyticsData.length === 0) return null;
    return [...playerAnalyticsData].sort((a, b) => (a.analyticsRank || 999) - (b.analyticsRank || 999))[0];
  }, [playerAnalyticsData]);

  // 3. Map Performers (Per AVAILABLE_MAPS + any custom maps in results)
  const mapPerformers = useMemo(() => {
    if (!teamMatchResults || teamMatchResults.length === 0) return [];

    // Helper to resolve map name for a match row
    const getMatchMap = (r) => {
      const explicitMap = r.map || r.mapName || r.map_name || getMapForMatch(activeMapConfig, r.day, r.lobby);
      if (explicitMap && explicitMap !== '—') return explicitMap;
      if (activeMapConfig?.map) return activeMapConfig.map;
      return 'Isolated'; // Standard fallback map for CoDM Battle Royale
    };

    // Collect all maps that have recorded results
    const playedMapNames = new Set();
    teamMatchResults.forEach(r => {
      playedMapNames.add(getMatchMap(r));
    });

    const mapList = Array.from(playedMapNames);

    const list = [];
    mapList.forEach(mapName => {
      // Filter matches for this map
      const mapMatches = teamMatchResults.filter(r => getMatchMap(r) === mapName);

      if (mapMatches.length === 0) return;

      // Group by teamId
      const teamStatsMap = {};
      mapMatches.forEach(m => {
        if (!m.teamId) return;
        if (!teamStatsMap[m.teamId]) {
          const tAnalytic = teamAnalyticsData.find(t => t.teamId === m.teamId);
          teamStatsMap[m.teamId] = {
            teamId: m.teamId,
            teamName: tAnalytic?.teamName || m.teamName || m.teamId,
            matchesCount: 0,
            totalKills: 0,
            wins: 0,
            totalPts: 0,
            placements: [],
          };
        }
        const pts = m.totalPts ?? ((m.kills || 0) * 2 + (m.placementPts || 0));
        teamStatsMap[m.teamId].matchesCount++;
        teamStatsMap[m.teamId].totalKills += (m.kills || 0);
        teamStatsMap[m.teamId].totalPts += pts;
        if (m.placement === 1) teamStatsMap[m.teamId].wins++;
        if (m.placement > 0) teamStatsMap[m.teamId].placements.push(m.placement);
      });

      const teamList = Object.values(teamStatsMap);
      if (teamList.length === 0) return;

      // Sort teams on this map by Total Pts, then Kills, then Avg Placement
      teamList.sort((a, b) => {
        if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts;
        if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills;
        const avgA = a.placements.reduce((s, p) => s + p, 0) / (a.placements.length || 1);
        const avgB = b.placements.reduce((s, p) => s + p, 0) / (b.placements.length || 1);
        return avgA - avgB;
      });

      const topTeam = teamList[0];
      const avgPlacement = topTeam.placements.length > 0
        ? (topTeam.placements.reduce((s, p) => s + p, 0) / topTeam.placements.length).toFixed(1)
        : '—';

      list.push({
        mapName,
        matchesCount: mapMatches.length,
        topTeam,
        avgPlacement,
      });
    });

    return list;
  }, [teamMatchResults, activeMapConfig, teamAnalyticsData]);

  // Overall tournament totals
  const totalMatchesCount = useMemo(() => {
    const lobbies = new Set();
    teamMatchResults.forEach(r => lobbies.add(`D${r.day}_L${r.lobby}`));
    return lobbies.size;
  }, [teamMatchResults]);

  const totalTournamentKills = useMemo(() => {
    return teamMatchResults.reduce((s, r) => s + (r.kills || 0), 0);
  }, [teamMatchResults]);

  if (!bestOverallTeam && mapPerformers.length === 0) return null;

  const bestOverallLogo = cleanImageUrl(teamRegMap[bestOverallTeam?.teamId]?.logo || teamRegMap[bestOverallTeam?.teamId]?.logoUrl || bestOverallTeam?.logo);

  return (
    <div className="card" style={{
      marginBottom: 24,
      background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.08) 0%, rgba(15, 23, 42, 0.95) 100%)',
      border: '1px solid rgba(201, 168, 76, 0.3)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      padding: '20px 22px',
    }}>
      {/* Summary Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'rgba(201, 168, 76, 0.2)', border: '1px solid rgba(201, 168, 76, 0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Trophy size={20} style={{ color: 'var(--gold)' }} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              Tournament Summary & Top Performers
            </h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Overall champions, map-specific dominators, and key tournament metrics
            </span>
          </div>
        </div>

        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setShowSummary(v => !v)}
          style={{ fontSize: '0.78rem', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {showSummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showSummary ? 'Collapse Summary' : 'Expand Summary'}
        </button>
      </div>

      {showSummary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Quick Metrics Bar */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 12,
            background: 'rgba(15, 23, 42, 0.6)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '12px 16px'
          }}>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Teams Field</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                {teamAnalyticsData.length} teams
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Matches Played</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--cyan)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                {totalMatchesCount} matches
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tournament Kills</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--success)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                🔥 {totalTournamentKills}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Maps Contested</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                {mapPerformers.length} map{mapPerformers.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {/* Cards Grid: Overall Best Team + MVP + Map-Specific Best Teams */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            {/* 1. Best Overall Team */}
            {bestOverallTeam && (
              <div className="card" style={{
                background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.15) 0%, rgba(30, 41, 59, 0.8) 100%)',
                border: '1.5px solid var(--gold)',
                padding: '16px 18px',
                position: 'relative'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: 'var(--gold)', background: 'rgba(201, 168, 76, 0.2)', padding: '2px 8px', borderRadius: 4,
                    display: 'inline-flex', alignItems: 'center', gap: 4
                  }}>
                    <Trophy size={11} /> OVERALL CHAMPION
                  </span>
                  <RankBadge rank={1} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  {bestOverallLogo ? (
                    <img src={bestOverallLogo} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} referrerPolicy="no-referrer" />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: 8, background: 'rgba(201,168,76,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Shield size={26} style={{ color: 'var(--gold)' }} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {bestOverallTeam.teamName}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--gold)', fontWeight: 600, marginTop: 2 }}>
                      Rating: {bestOverallTeam.scores?.FINAL_RATING?.toFixed(1) || 0} pts
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(201, 168, 76, 0.2)', fontSize: '0.78rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Total Pts:</span>{' '}
                    <strong style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{bestOverallTeam.totalPts}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Kills:</span>{' '}
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>{bestOverallTeam.kills}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Win%:</span>{' '}
                    <strong style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{bestOverallTeam.analytics?.winRate}%</strong>
                  </div>
                </div>
              </div>
            )}

            {/* 2. Top Player MVP */}
            {bestPlayerMVP && (
              <div className="card" style={{
                background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, rgba(30, 41, 59, 0.8) 100%)',
                border: '1.5px solid #38BDF8',
                padding: '16px 18px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: '#38BDF8', background: 'rgba(56, 189, 248, 0.2)', padding: '2px 8px', borderRadius: 4,
                    display: 'inline-flex', alignItems: 'center', gap: 4
                  }}>
                    <Award size={11} /> TOURNAMENT MVP
                  </span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38BDF8', background: 'rgba(56, 189, 248, 0.15)', padding: '2px 6px', borderRadius: 4 }}>
                    #1 Player
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 8, background: 'rgba(56, 189, 248, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <User size={26} style={{ color: '#38BDF8' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {bestPlayerMVP.ign || bestPlayerMVP.playerName}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      Team: <strong style={{ color: 'var(--text-primary)' }}>{bestPlayerMVP.teamName || '—'}</strong>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(56, 189, 248, 0.2)', fontSize: '0.78rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Kills:</span>{' '}
                    <strong style={{ color: '#38BDF8', fontFamily: 'var(--font-mono)' }}>{bestPlayerMVP.totalKills}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>KPM:</span>{' '}
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>{bestPlayerMVP.analytics?.KPM}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>DPM:</span>{' '}
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>{bestPlayerMVP.analytics?.DPM}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* 3. Map-Specific Best Performing Teams */}
            {mapPerformers.map(mp => {
              const mapLogo = cleanImageUrl(teamRegMap[mp.topTeam.teamId]?.logo || teamRegMap[mp.topTeam.teamId]?.logoUrl);
              return (
                <div key={mp.mapName} className="card" style={{
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(30, 41, 59, 0.8) 100%)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  padding: '16px 18px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{
                      fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
                      color: 'var(--success)', background: 'rgba(16, 185, 129, 0.15)', padding: '2px 8px', borderRadius: 4,
                      display: 'inline-flex', alignItems: 'center', gap: 4
                    }}>
                      <MapPin size={11} /> BEST {mp.mapName.toUpperCase()} TEAM
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {mp.matchesCount} match{mp.matchesCount === 1 ? '' : 'es'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {mapLogo ? (
                      <img src={mapLogo} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} referrerPolicy="no-referrer" />
                    ) : (
                      <div style={{ width: 44, height: 44, borderRadius: 8, background: 'rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Shield size={24} style={{ color: 'var(--success)' }} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {mp.topTeam.teamName}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--success)', fontWeight: 600, marginTop: 2 }}>
                        {mp.topTeam.totalPts} Map Pts ({mp.topTeam.wins} win{mp.topTeam.wins === 1 ? '' : 's'})
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(16, 185, 129, 0.2)', fontSize: '0.78rem' }}>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Map Pts:</span>{' '}
                      <strong style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{mp.topTeam.totalPts}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Map Kills:</span>{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>{mp.topTeam.totalKills}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-muted)' }}>Avg Place:</span>{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>#{mp.avgPlacement}</strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 1. TOURNAMENT SCOPED - TEAM VIEW ─────────────────────────────────────────
function TournamentTeamView({ team, tournamentField, teamMatchResults, activeMapConfig, teamReg }) {
  if (!team) {
    return <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Select a team to view deep analysis.</div>;
  }

  // Detect layer 1 facts
  const facts = useMemo(() => detectTeamInsights(team, tournamentField, []), [team, tournamentField]);

  // Filter match log for this team
  const matches = useMemo(() => {
    return teamMatchResults
      .filter(r => r.teamId === team.teamId)
      .sort((a, b) => a.day !== b.day ? a.day - b.day : a.lobby - b.lobby);
  }, [teamMatchResults, team.teamId]);

  // Calculate best/worst match
  const { bestMatch, worstMatch } = useMemo(() => {
    if (matches.length === 0) return { bestMatch: null, worstMatch: null };
    const sorted = [...matches].sort((a, b) => (b.totalPts ?? (b.kills * 2 + (b.placementPts || 0))) - (a.totalPts ?? (a.kills * 2 + (a.placementPts || 0))));
    return { bestMatch: sorted[0], worstMatch: sorted[sorted.length - 1] };
  }, [matches]);

  const logoUrl = cleanImageUrl(teamReg?.logo || teamReg?.logoUrl || team.logo);

  return (
    <div>
      {/* 2a. Header */}
      <div className="card" style={{ marginBottom: 20, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {logoUrl ? (
              <img src={logoUrl} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover' }} referrerPolicy="no-referrer" />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 10, background: 'rgba(201,168,76,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Shield size={32} style={{ color: 'var(--gold)' }} />
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  {team.teamName}
                </h2>
                <RankBadge rank={team.analyticsRank} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)', background: 'rgba(201,168,76,0.12)', padding: '2px 8px', borderRadius: 4 }}>
                  {getTeamRatingRankLabel(team.scores?.FINAL_RATING || 0)} ({team.scores?.FINAL_RATING?.toFixed(1)})
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>•</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--cyan)' }}>Identity: {team.identity}</span>
                <PlaystyleBadge label={team.labels?.playstyle || 'Balanced'} />
              </div>
            </div>
          </div>

          {/* Quick Score Pill Summary */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center', padding: '8px 14px', background: 'var(--bg-header)', borderRadius: 8 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>PPM</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{team.analytics?.PPM}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px 14px', background: 'var(--bg-header)', borderRadius: 8 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>KPM</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{team.analytics?.KPM}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px 14px', background: 'var(--bg-header)', borderRadius: 8 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Win Rate</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{team.analytics?.winRate}%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Narrative Callout */}
      <NarrativeCallout facts={facts} entityName={team.teamName} cacheKey={`team_${team.teamId}`} />

      {/* 2c. Best & Worst Highlights */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Best Match */}
        <div style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '16px',
          padding: '18px 22px',
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(6, 78, 59, 0.35) 45%, rgba(15, 23, 42, 0.85) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(52, 211, 153, 0.35)',
          boxShadow: 'inset 0 0 24px rgba(16, 185, 129, 0.12), 0 10px 30px -5px rgba(0, 0, 0, 0.4)',
          transition: 'transform 0.25s ease, box-shadow 0.25s ease',
        }}>
          {/* Liquid Ambient Glow Orb */}
          <div style={{
            position: 'absolute',
            top: '-30px',
            right: '-30px',
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(52, 211, 153, 0.3) 0%, rgba(16, 185, 129, 0) 70%)',
            pointerEvents: 'none',
            filter: 'blur(20px)',
          }} />

          {/* Header Badge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: '20px',
              background: 'rgba(16, 185, 129, 0.22)',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
              fontSize: '0.7rem',
              fontWeight: 800,
              letterSpacing: '0.08em',
              color: '#34D399',
              textTransform: 'uppercase',
            }}>
              <Trophy size={13} style={{ color: '#34D399' }} />
              BEST MATCH
            </div>
            <span style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.6)', fontWeight: 600 }}>
              Peak Performance
            </span>
          </div>

          {bestMatch ? (
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
                Day {bestMatch.day}, Lobby {bestMatch.lobby}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.85)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255, 255, 255, 0.08)', padding: '3px 9px', borderRadius: '6px' }}>
                  🏆 Place #{bestMatch.placement}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255, 255, 255, 0.08)', padding: '3px 9px', borderRadius: '6px' }}>
                  ⚡ {bestMatch.kills} kills
                </span>
              </div>
              <div style={{
                marginTop: 12,
                fontSize: '1.4rem',
                fontWeight: 900,
                fontFamily: 'var(--font-mono)',
                background: 'linear-gradient(90deg, #F59E0B 0%, #FBBF24 50%, #34D399 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                display: 'inline-block',
              }}>
                {bestMatch.totalPts ?? (bestMatch.kills * 2 + (bestMatch.placementPts || 0))} pts
              </div>
            </div>
          ) : <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', fontStyle: 'italic' }}>No match data available</div>}
        </div>

        {/* Worst Match */}
        <div style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '16px',
          padding: '18px 22px',
          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.18) 0%, rgba(153, 27, 27, 0.35) 45%, rgba(15, 23, 42, 0.85) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(248, 113, 113, 0.35)',
          boxShadow: 'inset 0 0 24px rgba(239, 68, 68, 0.12), 0 10px 30px -5px rgba(0, 0, 0, 0.4)',
          transition: 'transform 0.25s ease, box-shadow 0.25s ease',
        }}>
          {/* Liquid Ambient Glow Orb */}
          <div style={{
            position: 'absolute',
            top: '-30px',
            right: '-30px',
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(248, 113, 113, 0.3) 0%, rgba(239, 68, 68, 0) 70%)',
            pointerEvents: 'none',
            filter: 'blur(20px)',
          }} />

          {/* Header Badge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: '20px',
              background: 'rgba(239, 68, 68, 0.22)',
              border: '1px solid rgba(248, 113, 113, 0.4)',
              boxShadow: '0 2px 8px rgba(239, 68, 68, 0.25)',
              fontSize: '0.7rem',
              fontWeight: 800,
              letterSpacing: '0.08em',
              color: '#F87171',
              textTransform: 'uppercase',
            }}>
              <AlertTriangle size={13} style={{ color: '#F87171' }} />
              WORST MATCH
            </div>
            <span style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.6)', fontWeight: 600 }}>
              Low Score
            </span>
          </div>

          {worstMatch ? (
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
                Day {worstMatch.day}, Lobby {worstMatch.lobby}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.85)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255, 255, 255, 0.08)', padding: '3px 9px', borderRadius: '6px' }}>
                  📉 Place #{worstMatch.placement}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255, 255, 255, 0.08)', padding: '3px 9px', borderRadius: '6px' }}>
                  ⚡ {worstMatch.kills} kills
                </span>
              </div>
              <div style={{
                marginTop: 12,
                fontSize: '1.4rem',
                fontWeight: 900,
                fontFamily: 'var(--font-mono)',
                color: '#94A3B8',
                display: 'inline-block',
              }}>
                {worstMatch.totalPts ?? (worstMatch.kills * 2 + (worstMatch.placementPts || 0))} pts
              </div>
            </div>
          ) : <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', fontStyle: 'italic' }}>No match data available</div>}
        </div>
      </div>

      {/* 2e. Percentile Context Cards */}
      <div style={{ marginBottom: 20 }}>
        <h4 style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
          Field Percentile Standing
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {(() => {
            const allPPM = tournamentField.map(t => t.analytics?.PPM || 0);
            const allKPM = tournamentField.map(t => t.analytics?.KPM || 0);
            const allWinRate = tournamentField.map(t => t.analytics?.winRate || 0);
            const allKillPct = tournamentField.map(t => t.analytics?.killPct || 0);

            const ppmPct = computePercentile(team.analytics?.PPM || 0, allPPM);
            const kpmPct = computePercentile(team.analytics?.KPM || 0, allKPM);
            const winPct = computePercentile(team.analytics?.winRate || 0, allWinRate);
            const killPct = computePercentile(team.analytics?.killPct || 0, allKillPct);

            return [
              { label: 'PPM', val: team.analytics?.PPM, pct: ppmPct },
              { label: 'KPM', val: team.analytics?.KPM, pct: kpmPct },
              { label: 'Win Rate', val: `${team.analytics?.winRate}%`, pct: winPct },
              { label: 'Kill%', val: `${team.analytics?.killPct}%`, pct: killPct },
            ].map(item => (
              <div key={item.label} className="card" style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.label}</div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', margin: '2px 0 4px 0' }}>{item.val}</div>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: item.pct >= 75 ? 'var(--gold)' : (item.pct >= 50 ? 'var(--cyan)' : 'var(--text-muted)') }}>
                  → {formatPercentileBand(item.pct)} of field
                </span>
              </div>
            ));
          })()}
        </div>
      </div>

      {/* 2d. Per-Map Breakdown */}
      {matches?.length > 0 || activeMapConfig ? (
        <div className="card" style={{ marginBottom: 20, padding: 18 }}>
          <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <MapPin size={16} className="text-gold" /> Per-Map Breakdown
          </h4>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Map</th>
                  <th>Matches</th>
                  <th>Avg Placement</th>
                  <th>KPM</th>
                  <th>Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {AVAILABLE_MAPS.map(mapName => {
                  const mapFiltered = filterResultsByMap(matches, activeMapConfig, mapName);
                  if (mapFiltered.length === 0) {
                    return (
                      <tr key={mapName}>
                        <td style={{ fontWeight: 600 }}>{mapName}</td>
                        <td>0</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                      </tr>
                    );
                  }
                  const avgPl = (mapFiltered.reduce((s, r) => s + (r.placement || 0), 0) / mapFiltered.length).toFixed(1);
                  const totalKills = mapFiltered.reduce((s, r) => s + (r.kills || 0), 0);
                  const kpm = (totalKills / mapFiltered.length).toFixed(2);
                  const wins = mapFiltered.filter(r => r.placement === 1).length;
                  const winRate = ((wins / mapFiltered.length) * 100).toFixed(1);

                  return (
                    <tr key={mapName}>
                      <td style={{ fontWeight: 600, color: 'var(--gold)' }}>{mapName}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{mapFiltered.length}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{avgPl}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{kpm}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>{winRate}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20, padding: 14, fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          No map configuration assigned to this tournament.
        </div>
      )}

      {/* 2b. Match-by-Match Log */}
      <div className="card" style={{ padding: 18 }}>
        <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
          Match-by-Match Log ({matches.length} matches)
        </h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Lobby</th>
                <th>Map</th>
                <th>Placement</th>
                <th>Kills</th>
                <th>Place Pts</th>
                <th>Kill Pts</th>
                <th className="col-gold">Total Pts</th>
              </tr>
            </thead>
            <tbody>
              {matches.length === 0 ? (
                <tr><td colSpan={8} className="empty-row">No matches recorded for this team yet.</td></tr>
              ) : matches.map((m, idx) => {
                const mapName = getMapForMatch(activeMapConfig, m.day, m.lobby) || '—';
                const placePts = m.placementPts ?? 0;
                const killPts = (m.kills || 0) * 2;
                const totPts = m.totalPts ?? (placePts + killPts);

                return (
                  <tr key={`match-${m.id || idx}`}>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>D{m.day}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>L{m.lobby}</td>
                    <td style={{ color: mapName !== '—' ? 'var(--gold)' : 'var(--text-muted)' }}>{mapName}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: m.placement === 1 ? 800 : 400, color: m.placement === 1 ? 'var(--gold)' : undefined }}>
                      {m.placement === 1 ? '🏆 1st' : `#${m.placement}`}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{m.kills}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{placePts}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{killPts}</td>
                    <td className="col-gold" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{totPts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── 2. TOURNAMENT SCOPED - PLAYER VIEW ───────────────────────────────────────
function TournamentPlayerView({ player, tournamentField, playerMatchResults, teamMatchResults, activeMapConfig, playerReg }) {
  if (!player) {
    return <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>Select a player to view deep analysis.</div>;
  }

  // Detect player facts
  const facts = useMemo(() => detectPlayerInsights(player, tournamentField, []), [player, tournamentField]);

  // Lookup placement for each match
  const placementMap = useMemo(() => {
    const map = {};
    (teamMatchResults || []).forEach(r => {
      map[`${r.day}_${r.lobby}_${r.teamId}`] = r.placement;
    });
    return map;
  }, [teamMatchResults]);

  // Filter matches played by this player
  const matches = useMemo(() => {
    return (playerMatchResults || [])
      .filter(r => r.playerId === player.playerId)
      .map(r => ({
        ...r,
        teamPlacement: placementMap[`${r.day}_${r.lobby}_${r.teamId}`] || '—'
      }))
      .sort((a, b) => a.day !== b.day ? a.day - b.day : a.lobby - b.lobby);
  }, [playerMatchResults, player.playerId, placementMap]);

  // Highlights sorted primarily by Kills
  const { bestMatch, worstMatch } = useMemo(() => {
    if (matches.length === 0) return { bestMatch: null, worstMatch: null };
    const sorted = [...matches].sort((a, b) => (b.kills || 0) - (a.kills || 0));
    return { bestMatch: sorted[0], worstMatch: sorted[sorted.length - 1] };
  }, [matches]);

  // Kill Distribution Histogram Buckets
  const killBuckets = useMemo(() => {
    const buckets = { '0 kills': 0, '1-3 kills': 0, '4-6 kills': 0, '7+ kills': 0 };
    matches.forEach(m => {
      const k = m.kills || 0;
      if (k === 0) buckets['0 kills']++;
      else if (k <= 3) buckets['1-3 kills']++;
      else if (k <= 6) buckets['4-6 kills']++;
      else buckets['7+ kills']++;
    });
    return Object.entries(buckets).map(([name, count]) => ({ name, count }));
  }, [matches]);

  return (
    <div>
      {/* 3a. Header */}
      <div className="card" style={{ marginBottom: 20, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: 10, background: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <User size={32} style={{ color: '#38BDF8' }} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                  {player.ign || player.playerName}
                </h2>
                {player.class && <ClassBadge label={player.class} />}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Team: <strong>{player.teamName || '—'}</strong></span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>•</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)' }}>Rating: {player.scores?.FINAL_RATING || Math.round(player.scores?.RATING * 10) || 0}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>•</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--cyan)' }}>Identity: {player.identity || 'Balanced'}</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center', padding: '8px 14px', background: 'var(--bg-header)', borderRadius: 8 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>KPM</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{player.analytics?.KPM}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px 14px', background: 'var(--bg-header)', borderRadius: 8 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>DPM</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{player.analytics?.DPM}</div>
            </div>
            <div style={{ textAlign: 'center', padding: '8px 14px', background: 'var(--bg-header)', borderRadius: 8 }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total Kills</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>{player.totalKills}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Narrative Callout */}
      <NarrativeCallout facts={facts} entityName={player.ign || player.playerName} cacheKey={`player_${player.playerId}`} />

      {/* 3c & 3d. Best/Worst Highlights & Kill Histogram */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
        {/* Best Match */}
        <div style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '16px',
          padding: '18px 22px',
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(6, 78, 59, 0.35) 45%, rgba(15, 23, 42, 0.85) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(52, 211, 153, 0.35)',
          boxShadow: 'inset 0 0 24px rgba(16, 185, 129, 0.12), 0 10px 30px -5px rgba(0, 0, 0, 0.4)',
          transition: 'transform 0.25s ease, box-shadow 0.25s ease',
        }}>
          {/* Liquid Ambient Glow Orb */}
          <div style={{
            position: 'absolute',
            top: '-30px',
            right: '-30px',
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(52, 211, 153, 0.3) 0%, rgba(16, 185, 129, 0) 70%)',
            pointerEvents: 'none',
            filter: 'blur(20px)',
          }} />

          {/* Header Badge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: '20px',
              background: 'rgba(16, 185, 129, 0.22)',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              boxShadow: '0 2px 8px rgba(16, 185, 129, 0.25)',
              fontSize: '0.7rem',
              fontWeight: 800,
              letterSpacing: '0.08em',
              color: '#34D399',
              textTransform: 'uppercase',
            }}>
              <Flame size={13} style={{ color: '#34D399' }} />
              BEST KILLS MATCH
            </div>
            <span style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.6)', fontWeight: 600 }}>
              Frag Peak
            </span>
          </div>

          {bestMatch ? (
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
                Day {bestMatch.day}, Lobby {bestMatch.lobby}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.85)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255, 255, 255, 0.08)', padding: '3px 9px', borderRadius: '6px' }}>
                  Team Place: #{bestMatch.teamPlacement}
                </span>
              </div>
              <div style={{
                marginTop: 12,
                fontSize: '1.3rem',
                fontWeight: 900,
                fontFamily: 'var(--font-mono)',
                background: 'linear-gradient(90deg, #F59E0B 0%, #FBBF24 50%, #34D399 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                display: 'inline-block',
              }}>
                🔥 {bestMatch.kills} kills <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)', WebkitTextFillColor: 'initial' }}>({bestMatch.damage || 0} dmg)</span>
              </div>
            </div>
          ) : <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', fontStyle: 'italic' }}>No match data available</div>}
        </div>

        {/* Worst Match */}
        <div style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '16px',
          padding: '18px 22px',
          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.18) 0%, rgba(153, 27, 27, 0.35) 45%, rgba(15, 23, 42, 0.85) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(248, 113, 113, 0.35)',
          boxShadow: 'inset 0 0 24px rgba(239, 68, 68, 0.12), 0 10px 30px -5px rgba(0, 0, 0, 0.4)',
          transition: 'transform 0.25s ease, box-shadow 0.25s ease',
        }}>
          {/* Liquid Ambient Glow Orb */}
          <div style={{
            position: 'absolute',
            top: '-30px',
            right: '-30px',
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(248, 113, 113, 0.3) 0%, rgba(239, 68, 68, 0) 70%)',
            pointerEvents: 'none',
            filter: 'blur(20px)',
          }} />

          {/* Header Badge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: '20px',
              background: 'rgba(239, 68, 68, 0.22)',
              border: '1px solid rgba(248, 113, 113, 0.4)',
              boxShadow: '0 2px 8px rgba(239, 68, 68, 0.25)',
              fontSize: '0.7rem',
              fontWeight: 800,
              letterSpacing: '0.08em',
              color: '#F87171',
              textTransform: 'uppercase',
            }}>
              <AlertTriangle size={13} style={{ color: '#F87171' }} />
              LOWEST KILLS MATCH
            </div>
            <span style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.6)', fontWeight: 600 }}>
              Low Frag
            </span>
          </div>

          {worstMatch ? (
            <div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
                Day {worstMatch.day}, Lobby {worstMatch.lobby}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.85)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255, 255, 255, 0.08)', padding: '3px 9px', borderRadius: '6px' }}>
                  Team Place: #{worstMatch.teamPlacement}
                </span>
              </div>
              <div style={{
                marginTop: 12,
                fontSize: '1.3rem',
                fontWeight: 900,
                fontFamily: 'var(--font-mono)',
                color: '#94A3B8',
                display: 'inline-block',
              }}>
                😐 {worstMatch.kills} kills <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>({worstMatch.damage || 0} dmg)</span>
              </div>
            </div>
          ) : <div style={{ color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.8rem', fontStyle: 'italic' }}>No match data available</div>}
        </div>

        {/* 3d. Kill Distribution Histogram */}
        <div className="card" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--gold)', letterSpacing: '0.05em', marginBottom: 6 }}>
            KILL DISTRIBUTION HISTOGRAM
          </div>
          <ResponsiveContainer width="100%" height={110}>
            <BarChart data={killBuckets} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fill: '#94A3B8', fontSize: 10 }} />
              <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 11 }} />
              <Bar dataKey="count" fill="#38BDF8" radius={[3, 3, 0, 0]}>
                {killBuckets.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === 3 ? '#22C55E' : (index === 0 ? '#64748B' : '#38BDF8')} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 3f. Percentile Context Cards */}
      <div style={{ marginBottom: 20 }}>
        <h4 style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
          Player Field Standing
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {(() => {
            const allKPM = tournamentField.map(p => p.analytics?.KPM || 0);
            const allDPM = tournamentField.map(p => p.analytics?.DPM || 0);
            const allWinRate = tournamentField.map(p => p.analytics?.winRate || 0);
            const allConv = tournamentField.map(p => p.analytics?.conversionRate || 0);

            const kpmPct = computePercentile(player.analytics?.KPM || 0, allKPM);
            const dpmPct = computePercentile(player.analytics?.DPM || 0, allDPM);
            const winPct = computePercentile(player.analytics?.winRate || 0, allWinRate);
            const convPct = computePercentile(player.analytics?.conversionRate || 0, allConv);

            return [
              { label: 'KPM', val: player.analytics?.KPM, pct: kpmPct },
              { label: 'DPM', val: player.analytics?.DPM, pct: dpmPct },
              { label: 'Win Rate', val: `${player.analytics?.winRate}%`, pct: winPct },
              { label: 'Conversion', val: `${player.analytics?.conversionRate}%`, pct: convPct },
            ].map(item => (
              <div key={item.label} className="card" style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.label}</div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', margin: '2px 0 4px 0' }}>{item.val}</div>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: item.pct >= 75 ? 'var(--gold)' : (item.pct >= 50 ? 'var(--cyan)' : 'var(--text-muted)') }}>
                  → {formatPercentileBand(item.pct)} of field
                </span>
              </div>
            ));
          })()}
        </div>
      </div>

      {/* 3e. Per-Map Breakdown */}
      {matches?.length > 0 || activeMapConfig ? (
        <div className="card" style={{ marginBottom: 20, padding: 18 }}>
          <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <MapPin size={16} className="text-gold" /> Per-Map Player Breakdown
          </h4>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Map</th>
                  <th>Matches</th>
                  <th>Avg Kills</th>
                  <th>Avg Damage</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {AVAILABLE_MAPS.map(mapName => {
                  const mapFiltered = filterResultsByMap(matches, activeMapConfig, mapName);
                  if (mapFiltered.length === 0) {
                    return (
                      <tr key={mapName}>
                        <td style={{ fontWeight: 600 }}>{mapName}</td>
                        <td>0</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                      </tr>
                    );
                  }
                  const avgKills = (mapFiltered.reduce((s, r) => s + (r.kills || 0), 0) / mapFiltered.length).toFixed(2);
                  const avgDmg = Math.round(mapFiltered.reduce((s, r) => s + (r.damage || 0), 0) / mapFiltered.length);
                  const accCount = mapFiltered.filter(r => r.accuracy != null && r.accuracy > 0);
                  const avgAcc = accCount.length > 0 ? (accCount.reduce((s, r) => s + r.accuracy, 0) / accCount.length).toFixed(1) + '%' : '—';

                  return (
                    <tr key={mapName}>
                      <td style={{ fontWeight: 600, color: 'var(--gold)' }}>{mapName}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{mapFiltered.length}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{avgKills}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{avgDmg}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{avgAcc}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* 3b. Match-by-Match Log */}
      <div className="card" style={{ padding: 18 }}>
        <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
          Player Match-by-Match Log ({matches.length} matches)
        </h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Lobby</th>
                <th>Map</th>
                <th>Team Placement</th>
                <th className="col-gold">Kills</th>
                <th>Damage</th>
                <th>Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {matches.length === 0 ? (
                <tr><td colSpan={7} className="empty-row">No match results recorded for this player yet.</td></tr>
              ) : matches.map((m, idx) => {
                const mapName = getMapForMatch(activeMapConfig, m.day, m.lobby) || '—';
                return (
                  <tr key={`p-match-${m.id || idx}`}>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>D{m.day}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>L{m.lobby}</td>
                    <td style={{ color: mapName !== '—' ? 'var(--gold)' : 'var(--text-muted)' }}>{mapName}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {m.teamPlacement === 1 ? '🏆 1st' : `#${m.teamPlacement}`}
                    </td>
                    <td className="col-gold" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{m.kills || 0}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{m.damage || 0}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>{m.accuracy != null && m.accuracy > 0 ? `${m.accuracy}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── 3. CAREER SCOPE VIEW (EXPANDABLE ROWS) ───────────────────────────────────
function CareerDeepAnalysisView({
  entityType,
  entityId,
  currentTeam,
  currentPlayer,
  careerHistory,
  loading,
  expandedRow,
  setExpandedRow
}) {
  if (loading) return <LoadingSpinner size="lg" />;

  const entityName = entityType === 'team'
    ? (currentTeam?.teamName || 'Team')
    : (currentPlayer?.ign || currentPlayer?.playerName || 'Player');

  // Summary statistics
  const totalTournaments = careerHistory.length;
  const careerTotalKills = careerHistory.reduce((sum, h) => sum + (h.kills || h.totalKills || 0), 0);
  const bestRatingItem = [...careerHistory].sort((a, b) => b.rating - a.rating)[0];
  const avgRating = totalTournaments > 0
    ? (careerHistory.reduce((sum, h) => sum + h.rating, 0) / totalTournaments).toFixed(1)
    : 0;

  // Chart data
  const chartData = careerHistory.map((h, i) => ({
    name: h.tournamentName.slice(0, 10),
    fullName: h.tournamentName,
    rating: Math.round(h.rating),
  }));

  // Detect career facts
  const careerFacts = useMemo(() => {
    if (entityType === 'team' && currentTeam) {
      return detectTeamInsights(currentTeam, [], careerHistory);
    } else if (entityType === 'player' && currentPlayer) {
      return detectPlayerInsights(currentPlayer, [], careerHistory);
    }
    return [];
  }, [entityType, currentTeam, currentPlayer, careerHistory]);

  return (
    <div>
      {/* Narrative Callout */}
      <NarrativeCallout facts={careerFacts} entityName={entityName} cacheKey={`career_${entityType}_${entityId}`} />

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        <div className="card" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tournaments Played</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{totalTournaments}</div>
        </div>
        <div className="card" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Career Total Kills</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{careerTotalKills}</div>
        </div>
        <div className="card" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Best Rating</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--success)', fontFamily: 'var(--font-mono)' }}>
            {bestRatingItem ? `${Math.round(bestRatingItem.rating)} (${bestRatingItem.tournamentName})` : '—'}
          </div>
        </div>
        <div className="card" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Career Avg Rating</div>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--cyan)', fontFamily: 'var(--font-mono)' }}>{avgRating}</div>
        </div>
      </div>

      {/* Trajectory Trend Chart */}
      <div className="card" style={{ marginBottom: 24, padding: 20 }}>
        <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          <TrendingUp size={16} className="text-gold" /> Rating Trajectory Over Time
        </h4>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <YAxis domain={[0, 1000]} tick={{ fill: '#94A3B8', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1E293B', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#F1F5F9' }} />
              <Line type="monotone" dataKey="rating" stroke="#C9A84C" strokeWidth={3} dot={{ fill: '#C9A84C', r: 5 }} name="Rating" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20, fontSize: '0.8rem' }}>No tournament rating history available.</div>
        )}
      </div>

      {/* Expanded Tournament-by-Tournament Table */}
      <div className="card" style={{ padding: 18 }}>
        <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
          Tournament History ({careerHistory.length} events)
        </h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Tournament</th>
                <th>Date</th>
                <th>Rank Achieved</th>
                <th>{entityType === 'team' ? 'Total Pts' : 'Kills'}</th>
                <th>Rating</th>
                <th>Identity</th>
              </tr>
            </thead>
            <tbody>
              {careerHistory.length === 0 ? (
                <tr><td colSpan={7} className="empty-row">No career tournament records found.</td></tr>
              ) : careerHistory.map((row) => {
                const isExpanded = expandedRow === row.tournamentId;
                return (
                  <Fragment key={row.tournamentId}>
                    <tr
                      style={{ cursor: 'pointer', background: isExpanded ? 'var(--bg-alt-row)' : undefined }}
                      onClick={() => setExpandedRow(isExpanded ? null : row.tournamentId)}
                      className="clickable-row"
                    >
                      <td style={{ color: 'var(--text-muted)' }}>
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--gold)' }}>{row.tournamentName}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{row.date}</td>
                      <td><RankBadge rank={row.rank} /></td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{entityType === 'team' ? row.totalPts : row.totalKills}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--gold)' }}>{Math.round(row.rating)}</td>
                      <td><span style={{ fontSize: '0.78rem', color: 'var(--cyan)' }}>{row.identity}</span></td>
                    </tr>

                    {/* Part 2: In-place Expanded Mini Deep-Dive */}
                    {isExpanded && (
                      <tr key={`${row.tournamentId}-expanded`}>
                        <td colSpan={7} style={{ padding: 0, background: 'rgba(15, 23, 42, 0.65)' }}>
                          <ExpandedTournamentMiniDive row={row} entityType={entityType} />
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

// ─── PART 2: EXPANDED IN-PLACE MINI DEEP-DIVE COMPONENT ──────────────────────
function ExpandedTournamentMiniDive({ row, entityType }) {
  const { analyticsItem, matchResults, playerMatchResults, mapConfig } = row;

  // Single-sentence narrative
  const facts = useMemo(() => {
    if (entityType === 'team') return detectTeamInsights(analyticsItem, [], []);
    return detectPlayerInsights(analyticsItem, [], []);
  }, [analyticsItem, entityType]);

  const singleSentence = useMemo(() => {
    return generateDeterministicTemplate(facts, row.analyticsItem?.teamName || row.analyticsItem?.ign || 'This entity');
  }, [facts, row]);

  // Highlights
  const rawMatches = entityType === 'team' ? (matchResults || []) : (playerMatchResults || []);
  const sorted = [...rawMatches].sort((a, b) => {
    if (entityType === 'team') return (b.totalPts || 0) - (a.totalPts || 0);
    return (b.kills || 0) - (a.kills || 0);
  });
  const bestMatch = sorted[0];
  const worstMatch = sorted[sorted.length - 1];

  return (
    <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
      {/* 1-sentence narrative callout */}
      <div style={{ fontSize: '0.85rem', fontStyle: 'italic', color: 'var(--gold)', marginBottom: 14 }}>
        "{singleSentence}"
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
        {/* Best Match */}
        <div style={{
          position: 'relative',
          overflow: 'hidden',
          padding: '12px 16px',
          borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(6, 78, 59, 0.35) 45%, rgba(15, 23, 42, 0.85) 100%)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(52, 211, 153, 0.35)',
          boxShadow: 'inset 0 0 16px rgba(16, 185, 129, 0.12)',
        }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#34D399', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <Trophy size={12} /> BEST MATCH
          </div>
          {bestMatch ? (
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#FFFFFF' }}>
              Day {bestMatch.day}, Lobby {bestMatch.lobby} — {entityType === 'team' ? `🏆 Place #${bestMatch.placement}` : `🔥 ${bestMatch.kills} kills`}
            </div>
          ) : <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>—</div>}
        </div>

        {/* Worst Match */}
        <div style={{
          position: 'relative',
          overflow: 'hidden',
          padding: '12px 16px',
          borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.18) 0%, rgba(153, 27, 27, 0.35) 45%, rgba(15, 23, 42, 0.85) 100%)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(248, 113, 113, 0.35)',
          boxShadow: 'inset 0 0 16px rgba(239, 68, 68, 0.12)',
        }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#F87171', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <AlertTriangle size={12} /> WORST MATCH
          </div>
          {worstMatch ? (
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#FFFFFF' }}>
              Day {worstMatch.day}, Lobby {worstMatch.lobby} — {entityType === 'team' ? `Place #${worstMatch.placement}` : `😐 ${worstMatch.kills} kills`}
            </div>
          ) : <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.5)' }}>—</div>}
        </div>

        {/* Map Breakdown Mini */}
        <div style={{ padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8 }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--gold)', textTransform: 'uppercase', marginBottom: 4 }}>MAP BREAKDOWN</div>
          {rawMatches?.length > 0 || mapConfig ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {AVAILABLE_MAPS.map(m => {
                const count = filterResultsByMap(rawMatches, mapConfig, m).length;
                return count > 0 ? `${m}: ${count} match(es)  ` : null;
              }).filter(Boolean).join(' | ') || 'No map data'}
            </div>
          ) : <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No map config set</div>}
        </div>
      </div>
    </div>
  );
}
