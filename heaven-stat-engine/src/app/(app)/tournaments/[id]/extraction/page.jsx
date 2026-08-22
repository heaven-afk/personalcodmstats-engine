'use client';
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTournament } from '../layout';
import { getTournaments, getTeamRegistrations, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getPlayerMatchResults, getBonusPoints } from '@/lib/firestore/matchData';
import { getGroups } from '@/lib/firestore/groups';
import { computeTeamRanking, computeClanRanking, computeDailyStandings } from '@/lib/engine/standings';
import { computePlayerStats, computePlayerAnalytics } from '@/lib/engine/playerStats';
import { computeTeamAnalytics } from '@/lib/engine/analytics';
import { computeTeamGlobalForm, computePlayerGlobalForm } from '@/lib/engine/globalForm';
import DataTable from '@/components/ui/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import Papa from 'papaparse';
import {
  Download, Copy, Table, List, Search, Trophy, Users, Zap, Globe,
  FileSpreadsheet, Sparkles, MapPin, Shield, Check, Flame, Award, ChevronRight, X
} from 'lucide-react';
import { AVAILABLE_MAPS } from '@/lib/constants/maps';
import { getActiveMapConfig, filterResultsByMap, getMapForMatch } from '@/lib/utils/mapConfig';
import { REVIVE_TYPES, getReviveType } from '@/lib/constants/revives';
import { getActiveReviveConfig, getReviveTypeForMatch, filterResultsByRevive } from '@/lib/utils/reviveConfig';

// ─── Categories & Presets Definition ──────────────────────────────────────────
const PRESET_CATEGORIES = [
  {
    id: 'standings',
    name: 'Standings & Rankings',
    icon: Trophy,
    color: '#eab308',
    presets: [
      {
        id: 'top-teams-avg',
        name: 'Top Teams by Average Rank',
        badge: 'Avg Rank',
        desc: 'Teams ranked primarily by Average Rank / Finishing Position (lower is better), including Total Points and wins.',
      },
      {
        id: 'top-teams-pts',
        name: 'Top Teams by Points',
        badge: 'Total Rank',
        desc: 'Team season standings ranked by total points, placement pts, kills, and tiebreakers.',
      },
      {
        id: 'clan-rankings',
        name: 'Clan Aggregated Rankings',
        badge: 'Clans',
        desc: 'Clan standings based on active team member point aggregates & average output.',
      },
      {
        id: 'daily-pts-matrix',
        name: 'Daily Points Matrix',
        badge: 'Matrix',
        desc: 'Full day-by-day points breakdown table across all competition days.',
      },
      {
        id: 'group-standings',
        name: 'Group-by-Group Standings',
        badge: 'Qualifiers',
        desc: 'Detailed group standings with advancement thresholds and rankings.',
        qualifierOnly: true,
      },
    ],
  },
  {
    id: 'players',
    name: 'Player Leaderboards',
    icon: Users,
    color: '#38bdf8',
    presets: [
      {
        id: 'top-players-combined',
        name: 'Combined Player Leaderboard',
        badge: 'All Classes',
        desc: 'All registered players ranked by total kills, matches, damage, and accuracy.',
      },
      {
        id: 'top-players-set1',
        name: 'Top Players (Class 1 / Set 1)',
        badge: 'Class 1',
        desc: 'Players registered under Class 1 ranked by total kills and efficiency.',
      },
      {
        id: 'top-players-set2',
        name: 'Top Players (Class 2 / Set 2)',
        badge: 'Class 2',
        desc: 'Players registered under Class 2 ranked by total kills and efficiency.',
      },
      {
        id: 'player-damage-leaders',
        name: 'Damage & Accuracy Leaders',
        badge: 'Firepower',
        desc: 'Top firepower leaders ranked by total combat damage, DPM, and accuracy %.',
      },
    ],
  },
  {
    id: 'analytics',
    name: 'Deep Analytics & Metrics',
    icon: Sparkles,
    color: '#c084fc',
    presets: [
      {
        id: 'player-deep-analytics',
        name: 'Player Deep Analytics & Ratings',
        badge: 'Advanced',
        desc: 'Full advanced player index: Rating (0-1000), Power, Conversion, Placement, KPM, DPM, Win Rate, and Consistency.',
      },
      {
        id: 'team-analytics',
        name: 'Full Team Analytics & Playstyles',
        badge: 'Advanced',
        desc: 'Enriched team analytics including Team Rating, PPM, KPM, Kill %, Consistency, and Playstyle labels.',
      },
      {
        id: 'map-performance',
        name: 'Map Performance Breakdown',
        badge: 'Maps',
        desc: 'Team performance metrics segmented across Isolated, Blackout, Krai, and custom maps.',
      },
      {
        id: 'revive-performance',
        name: 'Revive Mechanism Breakdown',
        badge: 'Revives',
        desc: 'Performance metrics broken down by Auto-Revive, Dog Tags, and Single Life matches.',
      },
    ],
  },
  {
    id: 'global',
    name: 'Global Form & Trends',
    icon: Globe,
    color: '#4ade80',
    presets: [
      {
        id: 'global-form-teams',
        name: 'Global Form (Teams)',
        badge: 'Cross-Event',
        desc: 'Cross-tournament rolling form, recency-decayed scores, confidence, and trends for teams.',
      },
      {
        id: 'global-form-players',
        name: 'Global Form (Players)',
        badge: 'Cross-Event',
        desc: 'Cross-tournament rolling form, recency-decayed scores, confidence, and trends for players.',
      },
    ],
  },
  {
    id: 'roster',
    name: 'Registries & Rosters',
    icon: FileSpreadsheet,
    color: '#fb923c',
    presets: [
      {
        id: 'player-roster',
        name: 'Full Player Roster',
        badge: 'Roster',
        desc: 'Complete roster of registered players with IGN, pro name, team, region, country, and device.',
      },
      {
        id: 'team-registry',
        name: 'Full Team Registry',
        badge: 'Registry',
        desc: 'Master list of registered teams, clans, slots, and tier assignments.',
      },
    ],
  },
];

export default function ExtractionPage() {
  const { id: tournamentId } = useParams();
  const { tournament } = useTournament();
  const { structure = {}, scoring = {} } = tournament || {};
  const isQualifier = tournament?.type === 'qualifier';

  const [activePreset, setActivePreset] = useState('top-teams-avg');
  const [searchQuery, setSearchQuery] = useState('');
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState('all');
  const [selectedMap, setSelectedMap] = useState('all');
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('all');

  // Raw database tables
  const [teamRegs, setTeamRegs] = useState([]);
  const [playerRegs, setPlayerRegs] = useState([]);
  const [teamResults, setTeamResults] = useState([]);
  const [playerResults, setPlayerResults] = useState([]);
  const [bonusPoints, setBonusPoints] = useState([]);
  const [allTournamentsData, setAllTournamentsData] = useState({ tournaments: [], teamRes: {}, playerRes: {} });

  useEffect(() => {
    async function loadData() {
      try {
        const [tReg, pReg, tRes, pRes, bPts, gList, allT] = await Promise.all([
          getTeamRegistrations(tournamentId),
          getPlayerRegistrations(tournamentId),
          getTeamMatchResults(tournamentId),
          getPlayerMatchResults(tournamentId),
          getBonusPoints(tournamentId),
          getGroups(tournamentId),
          getTournaments(),
        ]);
        setTeamRegs(tReg);
        setPlayerRegs(pReg);
        setTeamResults(tRes);
        setPlayerResults(pRes);
        setBonusPoints(bPts);
        setGroups(gList || []);

        const allTTeamRes = await Promise.all(allT.map(t => getTeamMatchResults(t.id)));
        const allTPlayerRes = await Promise.all(allT.map(t => getPlayerMatchResults(t.id)));
        const tResMap = {};
        const pResMap = {};
        allT.forEach((t, i) => {
          tResMap[t.id] = allTTeamRes[i] || [];
          pResMap[t.id] = allTPlayerRes[i] || [];
        });
        setAllTournamentsData({ tournaments: allT, teamRes: tResMap, playerRes: pResMap });
      } catch (err) {
        toast.error('Failed to load raw tournament data: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [tournamentId]);

  const selectedGroupObj = isQualifier && selectedGroupId !== 'all' ? groups.find(g => g.id === selectedGroupId) : null;
  const activeStructure = selectedGroupObj?.structure || structure;
  const activeTotalDays = activeStructure.totalDays || 6;
  const activeMapConfig = useMemo(() => getActiveMapConfig(tournament, selectedGroupObj), [tournament, selectedGroupObj]);
  const activeReviveConfig = useMemo(() => getActiveReviveConfig(tournament, selectedGroupObj), [tournament, selectedGroupObj]);

  // All flat presets for quick lookup
  const allPresets = useMemo(() => {
    const list = [];
    PRESET_CATEGORIES.forEach(cat => {
      cat.presets.forEach(p => {
        if (!p.qualifierOnly || isQualifier) {
          list.push({ ...p, categoryName: cat.name, categoryIcon: cat.icon, categoryColor: cat.color });
        }
      });
    });
    return list;
  }, [isQualifier]);

  const activePresetObj = useMemo(() => {
    return allPresets.find(p => p.id === activePreset) || allPresets[0];
  }, [allPresets, activePreset]);

  // Filtered categories for sidebar based on search query
  const filteredCategories = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) {
      return PRESET_CATEGORIES.map(cat => ({
        ...cat,
        presets: cat.presets.filter(p => !p.qualifierOnly || isQualifier),
      })).filter(cat => cat.presets.length > 0);
    }
    return PRESET_CATEGORIES.map(cat => ({
      ...cat,
      presets: cat.presets.filter(p => {
        if (p.qualifierOnly && !isQualifier) return false;
        return p.name.toLowerCase().includes(q) ||
          p.desc.toLowerCase().includes(q) ||
          p.badge.toLowerCase().includes(q) ||
          cat.name.toLowerCase().includes(q);
      }),
    })).filter(cat => cat.presets.length > 0);
  }, [searchQuery, isQualifier]);

  // ─── Data Extraction Logic ───────────────────────────────────────────────────
  const getExtractData = () => {
    if (!tournament) return { rows: [], columns: [] };

    const activeTeamRegs = (isQualifier && selectedGroupId !== 'all')
      ? teamRegs.filter(r => r.groupId === selectedGroupId)
      : teamRegs;
    const groupTeamIds = new Set(activeTeamRegs.map(r => r.teamId));

    const activePlayerRegs = (isQualifier && selectedGroupId !== 'all')
      ? playerRegs.filter(r => r.groupId === selectedGroupId)
      : playerRegs;

    let activeTeamResults = (isQualifier && selectedGroupId !== 'all')
      ? teamResults.filter(r => r.groupId === selectedGroupId)
      : teamResults;

    let activePlayerResults = (isQualifier && selectedGroupId !== 'all')
      ? playerResults.filter(r => r.groupId === selectedGroupId)
      : playerResults;

    let activeBonusPoints = (isQualifier && selectedGroupId !== 'all')
      ? bonusPoints.filter(b => b.groupId === selectedGroupId || (!b.groupId && groupTeamIds.has(b.teamId)))
      : bonusPoints;

    if (selectedMap !== 'all' && activeMapConfig) {
      activeTeamResults = filterResultsByMap(activeTeamResults, activeMapConfig, selectedMap);
      activePlayerResults = filterResultsByMap(activePlayerResults, activeMapConfig, selectedMap);
      activeBonusPoints = filterResultsByMap(activeBonusPoints, activeMapConfig, selectedMap);
    }

    switch (activePreset) {
      // 1. Top Teams by Average Rank (AVG RANK from Analytics)
      case 'top-teams-avg': {
        const analyticsList = computeTeamAnalytics(activeTeamResults, activeBonusPoints, scoring);
        
        // Sort primarily by AVG RANK (lower number is better: 2.5 > 4.5 > 7.5), then tiebreak by Total Points, Wins, Kills
        const sortedByAvgRank = [...analyticsList].sort((a, b) => {
          const aAvg = a.analytics?.avgRank ?? 999;
          const bAvg = b.analytics?.avgRank ?? 999;
          if (aAvg !== bAvg) return aAvg - bAvg; // Lower average rank is better
          if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts; // Higher total points
          if (b.wins !== a.wins) return b.wins - a.wins; // More wins
          return (b.kills || 0) - (a.kills || 0); // More kills
        });

        const sliced = limit > 0 ? sortedByAvgRank.slice(0, limit) : sortedByAvgRank;
        const mapped = sliced.map((t, i) => {
          const a = t.analytics || {};
          const s = t.scores || {};
          const avgRankVal = a.avgRank != null ? a.avgRank : (t.matches > 0 ? (t.sumOfPositions / t.matches).toFixed(2) : '—');
          return {
            'RK': i + 1,
            'Team': t.teamName,
            'Clan': t.clanName || '—',
            'Wins': t.wins,
            'Matches': t.matches,
            'Events': t.events || 0,
            'Place Pts': t.placementPts,
            'Kills': t.kills,
            'Total Pts': t.totalPts,
            'Team Rating': s.FINAL_RATING != null ? Number(s.FINAL_RATING.toFixed(1)) : '—',
            'Avg Rank': avgRankVal,
            'Peak Rank': a.peakRank != null ? `#${a.peakRank}` : '—',
            'Podium Rate %': a.podiumRate != null ? `${a.podiumRate}%` : '—',
            'PPM': a.PPM || 0,
            'KPM': a.KPM || 0,
          };
        });

        return {
          rows: mapped,
          columns: [
            { header: 'RK', accessor: 'RK', width: 50 },
            { header: 'Team', accessor: 'Team' },
            { header: 'Clan', accessor: 'Clan' },
            { header: 'Wins', accessor: 'Wins' },
            { header: 'Matches', accessor: 'Matches' },
            { header: 'Events', accessor: 'Events' },
            { header: 'Place Pts', accessor: 'Place Pts' },
            { header: 'Kills', accessor: 'Kills' },
            { header: 'Total Pts', accessor: 'Total Pts' },
            { header: 'Team Rating', accessor: 'Team Rating' },
            { header: 'Avg Rank', accessor: 'Avg Rank' },
            { header: 'Peak Rank', accessor: 'Peak Rank' },
            { header: 'Podium %', accessor: 'Podium Rate %' },
            { header: 'PPM', accessor: 'PPM' },
            { header: 'KPM', accessor: 'KPM' },
          ],
        };
      }

      // 2. Overall Team Standings by Total Points
      case 'top-teams-pts': {
        const ranking = selectedDay === 'all'
          ? computeTeamRanking(activeTeamResults, activeBonusPoints, scoring)
          : computeDailyStandings(activeTeamResults, activeBonusPoints, scoring, Number(selectedDay));
        const sliced = limit > 0 ? ranking.slice(0, limit) : ranking;
        const mapped = sliced.map((t, i) => {
          const matches = t.matches || 0;
          const ppm = matches > 0 ? (t.totalPts / matches).toFixed(2) : '0.00';
          const kpm = matches > 0 ? (t.kills / matches).toFixed(2) : '0.00';
          const winRate = matches > 0 ? `${Math.round((t.wins / matches) * 100)}%` : '0%';
          return {
            Rank: t.rank || i + 1,
            Team: t.teamName,
            Clan: t.clanName || '—',
            'Total Pts': t.totalPts,
            'Avg Pts / Match (PPM)': ppm,
            Wins: t.wins,
            Matches: matches,
            'Win Rate': winRate,
            'Avg Kills / Match (KPM)': kpm,
            'Place Pts': t.placementPts,
            Kills: t.kills,
            'Kill Pts': t.killPts,
            'Bonus Pts': t.bonusPts,
          };
        });

        return {
          rows: mapped,
          columns: [
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Team Name', accessor: 'Team' },
            { header: 'Clan', accessor: 'Clan' },
            { header: 'Total Pts', accessor: 'Total Pts' },
            { header: 'Avg Pts / Match (PPM)', accessor: 'Avg Pts / Match (PPM)' },
            { header: 'Wins', accessor: 'Wins' },
            { header: 'Matches', accessor: 'Matches' },
            { header: 'Win %', accessor: 'Win Rate' },
            { header: 'Place Pts', accessor: 'Place Pts' },
            { header: 'Kills', accessor: 'Kills' },
            { header: 'Kill Pts', accessor: 'Kill Pts' },
            { header: 'Bonus', accessor: 'Bonus Pts' },
          ],
        };
      }

      // 2. Clan Aggregated Rankings
      case 'clan-rankings': {
        const ranking = selectedDay === 'all'
          ? computeTeamRanking(activeTeamResults, activeBonusPoints, scoring)
          : computeDailyStandings(activeTeamResults, activeBonusPoints, scoring, Number(selectedDay));
        const clans = computeClanRanking(ranking);
        const sliced = limit > 0 ? clans.slice(0, limit) : clans;
        const mapped = sliced.map((c, i) => ({
          Rank: c.rank || i + 1,
          Clan: c.clanName,
          'Team Count': c.teamCount,
          Wins: c.wins,
          Matches: c.matches,
          'Total Pts': c.totalPts,
          'Avg Pts / Team': c.teamCount > 0 ? (c.totalPts / c.teamCount).toFixed(1) : '0.0',
          'Best Member Rank': c.bestRank === Infinity ? '—' : `#${c.bestRank}`,
        }));

        return {
          rows: mapped,
          columns: [
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Clan Name', accessor: 'Clan' },
            { header: 'Teams Count', accessor: 'Team Count' },
            { header: 'Wins', accessor: 'Wins' },
            { header: 'Matches', accessor: 'Matches' },
            { header: 'Total Pts', accessor: 'Total Pts' },
            { header: 'Avg Pts / Team', accessor: 'Avg Pts / Team' },
            { header: 'Best Member Rank', accessor: 'Best Member Rank' },
          ],
        };
      }

      // 3. Daily Points Matrix
      case 'daily-pts-matrix': {
        const collation = computeTeamRanking(activeTeamResults, activeBonusPoints, scoring);
        const days = Array.from({ length: activeTotalDays }, (_, i) => i + 1);
        const mapped = collation.map((t, i) => {
          const row = {
            Rank: i + 1,
            Team: t.teamName,
            Clan: t.clanName || '—',
          };
          days.forEach(d => {
            row[`Day ${d}`] = t.perDay[d]?.totalPts ?? 0;
          });
          row['Total Pts'] = t.totalPts;
          row['Avg / Day'] = days.length > 0 ? (t.totalPts / days.length).toFixed(1) : '0.0';
          return row;
        });

        const columns = [
          { header: 'Rank', accessor: 'Rank', width: 55 },
          { header: 'Team Name', accessor: 'Team' },
          { header: 'Clan', accessor: 'Clan' },
          ...days.map(d => ({ header: `Day ${d}`, accessor: `Day ${d}` })),
          { header: 'Total Pts', accessor: 'Total Pts' },
          { header: 'Avg / Day', accessor: 'Avg / Day' },
        ];

        return { rows: mapped, columns };
      }

      // 4. Qualifier Group Standings
      case 'group-standings': {
        if (!isQualifier || groups.length === 0) return { rows: [], columns: [] };
        const rows = [];
        groups.forEach(g => {
          if (selectedGroupId !== 'all' && g.id !== selectedGroupId) return;
          const gResults = teamResults.filter(r => r.groupId === g.id);
          const gBonus = bonusPoints.filter(b => b.groupId === g.id);
          const gRanking = computeTeamRanking(gResults, gBonus, scoring);
          const advCount = g.advancementCount || 2;
          gRanking.forEach((t, i) => {
            const matches = t.matches || 0;
            const isAdvancing = (i + 1) <= advCount;
            rows.push({
              Group: g.groupName,
              Rank: i + 1,
              Team: t.teamName,
              Clan: t.clanName || '—',
              Wins: t.wins,
              Matches: matches,
              'Place Pts': t.placementPts,
              Kills: t.kills,
              'Total Pts': t.totalPts,
              'Advance Status': isAdvancing ? `QUALIFIED (Top ${advCount})` : 'Eliminated',
            });
          });
        });

        return {
          rows,
          columns: [
            { header: 'Group', accessor: 'Group' },
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Team', accessor: 'Team' },
            { header: 'Clan', accessor: 'Clan' },
            { header: 'Wins', accessor: 'Wins' },
            { header: 'Matches', accessor: 'Matches' },
            { header: 'Place Pts', accessor: 'Place Pts' },
            { header: 'Kills', accessor: 'Kills' },
            { header: 'Total Pts', accessor: 'Total Pts' },
            { header: 'Advance Status', accessor: 'Advance Status' },
          ],
        };
      }

      // 5. Combined Player Leaderboard
      case 'top-players-combined': {
        const filteredResults = selectedDay === 'all'
          ? activePlayerResults
          : activePlayerResults.filter(r => r.day === Number(selectedDay));
        const stats = computePlayerStats(filteredResults, activePlayerRegs, tournament);
        const sorted = [...stats].sort((a, b) => b.totalKills - a.totalKills);
        const sliced = limit > 0 ? sorted.slice(0, limit) : sorted;
        const mapped = sliced.map((p, i) => ({
          Rank: i + 1,
          'Pro Name': p.playerName || p.ign,
          IGN: p.ign,
          Team: p.teamName || '—',
          Class: p.class || 'Standard',
          Kills: p.totalKills,
          Matches: p.totalMatches,
          Events: p.events,
          'Kills / Match': p.killsPerMatch,
          'Total Damage': p.totalDamage,
          'Avg Damage': p.avgDamage,
          'Avg Accuracy %': p.avgAccuracy ? `${Math.round(p.avgAccuracy * 100)}%` : '—',
        }));

        return {
          rows: mapped,
          columns: [
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Pro Name', accessor: 'Pro Name' },
            { header: 'IGN', accessor: 'IGN' },
            { header: 'Team', accessor: 'Team' },
            { header: 'Class', accessor: 'Class' },
            { header: 'Kills', accessor: 'Kills' },
            { header: 'Matches', accessor: 'Matches' },
            { header: 'Kills/Match', accessor: 'Kills / Match' },
            { header: 'Total Damage', accessor: 'Total Damage' },
            { header: 'Avg Damage', accessor: 'Avg Damage' },
            { header: 'Accuracy %', accessor: 'Avg Accuracy %' },
          ],
        };
      }

      // 6. Top Players Set 1
      case 'top-players-set1': {
        const filteredResults = selectedDay === 'all'
          ? activePlayerResults
          : activePlayerResults.filter(r => r.day === Number(selectedDay));
        const stats = computePlayerStats(filteredResults, activePlayerRegs, tournament);
        const filtered = stats
          .filter(p => p.class && p.class.toLowerCase().includes('1'))
          .sort((a, b) => b.totalKills - a.totalKills);
        const sliced = limit > 0 ? filtered.slice(0, limit) : filtered;
        const mapped = sliced.map((p, i) => ({
          Rank: i + 1,
          'Pro Name': p.playerName,
          IGN: p.ign,
          Team: p.teamName,
          Kills: p.totalKills,
          Matches: p.totalMatches,
          Events: p.events,
          'Kills / Match': p.killsPerMatch,
          'Total Damage': p.totalDamage,
          'Avg Damage': p.avgDamage,
          'Avg Accuracy %': p.avgAccuracy ? `${Math.round(p.avgAccuracy * 100)}%` : '—',
        }));

        return {
          rows: mapped,
          columns: [
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Pro Name', accessor: 'Pro Name' },
            { header: 'IGN', accessor: 'IGN' },
            { header: 'Team', accessor: 'Team' },
            { header: 'Kills', accessor: 'Kills' },
            { header: 'Matches', accessor: 'Matches' },
            { header: 'Events', accessor: 'Events' },
            { header: 'Kills/Match', accessor: 'Kills / Match' },
            { header: 'Avg Damage', accessor: 'Avg Damage' },
            { header: 'Accuracy %', accessor: 'Avg Accuracy %' },
          ],
        };
      }

      // 7. Top Players Set 2
      case 'top-players-set2': {
        const filteredResults = selectedDay === 'all'
          ? activePlayerResults
          : activePlayerResults.filter(r => r.day === Number(selectedDay));
        const stats = computePlayerStats(filteredResults, activePlayerRegs, tournament);
        const filtered = stats
          .filter(p => p.class && p.class.toLowerCase().includes('2'))
          .sort((a, b) => b.totalKills - a.totalKills);
        const sliced = limit > 0 ? filtered.slice(0, limit) : filtered;
        const mapped = sliced.map((p, i) => ({
          Rank: i + 1,
          'Pro Name': p.playerName,
          IGN: p.ign,
          Team: p.teamName,
          Kills: p.totalKills,
          Matches: p.totalMatches,
          Events: p.events,
          'Kills / Match': p.killsPerMatch,
          'Total Damage': p.totalDamage,
          'Avg Damage': p.avgDamage,
          'Avg Accuracy %': p.avgAccuracy ? `${Math.round(p.avgAccuracy * 100)}%` : '—',
        }));

        return {
          rows: mapped,
          columns: [
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Pro Name', accessor: 'Pro Name' },
            { header: 'IGN', accessor: 'IGN' },
            { header: 'Team', accessor: 'Team' },
            { header: 'Kills', accessor: 'Kills' },
            { header: 'Matches', accessor: 'Matches' },
            { header: 'Events', accessor: 'Events' },
            { header: 'Kills/Match', accessor: 'Kills / Match' },
            { header: 'Avg Damage', accessor: 'Avg Damage' },
            { header: 'Accuracy %', accessor: 'Avg Accuracy %' },
          ],
        };
      }

      // 8. Player Damage & Firepower Leaders
      case 'player-damage-leaders': {
        const filteredResults = selectedDay === 'all'
          ? activePlayerResults
          : activePlayerResults.filter(r => r.day === Number(selectedDay));
        const stats = computePlayerStats(filteredResults, activePlayerRegs, tournament);
        const sorted = [...stats].sort((a, b) => b.totalDamage - a.totalDamage);
        const sliced = limit > 0 ? sorted.slice(0, limit) : sorted;
        const mapped = sliced.map((p, i) => {
          const dmgPerKill = p.totalKills > 0 ? Math.round(p.totalDamage / p.totalKills) : '—';
          return {
            Rank: i + 1,
            'Pro Name': p.playerName || p.ign,
            IGN: p.ign,
            Team: p.teamName || '—',
            Class: p.class || 'Standard',
            'Total Damage': p.totalDamage,
            'Avg Damage (DPM)': p.avgDamage,
            'Total Kills': p.totalKills,
            'Kills / Match': p.killsPerMatch,
            'Accuracy %': p.avgAccuracy ? `${Math.round(p.avgAccuracy * 100)}%` : '—',
            'Damage / Kill': dmgPerKill,
          };
        });

        return {
          rows: mapped,
          columns: [
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Pro Name', accessor: 'Pro Name' },
            { header: 'IGN', accessor: 'IGN' },
            { header: 'Team', accessor: 'Team' },
            { header: 'Total Damage', accessor: 'Total Damage' },
            { header: 'DPM', accessor: 'Avg Damage (DPM)' },
            { header: 'Kills', accessor: 'Total Kills' },
            { header: 'Kills/Match', accessor: 'Kills / Match' },
            { header: 'Accuracy %', accessor: 'Accuracy %' },
            { header: 'Dmg / Kill', accessor: 'Damage / Kill' },
          ],
        };
      }

      // 9. Full Player Deep Analytics & Ratings
      case 'player-deep-analytics': {
        const pStats = computePlayerStats(activePlayerResults, activePlayerRegs, tournament);
        const analytics = computePlayerAnalytics(pStats, activeTeamResults);
        const sliced = limit > 0 ? analytics.slice(0, limit) : analytics;
        const mapped = sliced.map((p, i) => ({
          Rank: i + 1,
          'Pro Name': p.playerName || p.ign,
          IGN: p.ign,
          Team: p.teamName || '—',
          Class: p.class || 'Standard',
          'Player Rating': p.scores?.FINAL_RATING || 0,
          'Power Score': p.scores?.POWER || 0,
          'Placement Score': p.scores?.PLACEMENT ?? '—',
          'Conversion Score': p.scores?.CONVERSION || 0,
          'Form Score': p.scores?.FORM || 0,
          KPM: p.analytics?.KPM || 0,
          DPM: p.analytics?.DPM || 0,
          'Win Rate %': `${Math.round((p.analytics?.winRate || 0) * 100)}%`,
          'Top 3 Rate %': `${Math.round((p.analytics?.top3Rate || 0) * 100)}%`,
          'Consistency Index': p.analytics?.stdDevCS || 0,
          'Momentum Index': p.analytics?.forwardMI || 0,
        }));

        return {
          rows: mapped,
          columns: [
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Pro Name', accessor: 'Pro Name' },
            { header: 'IGN', accessor: 'IGN' },
            { header: 'Team', accessor: 'Team' },
            { header: 'Rating (0-1000)', accessor: 'Player Rating' },
            { header: 'Power', accessor: 'Power Score' },
            { header: 'Placement', accessor: 'Placement Score' },
            { header: 'Conversion', accessor: 'Conversion Score' },
            { header: 'KPM', accessor: 'KPM' },
            { header: 'DPM', accessor: 'DPM' },
            { header: 'Win %', accessor: 'Win Rate %' },
            { header: 'Consistency', accessor: 'Consistency Index' },
          ],
        };
      }

      // 10. Full Team Analytics & Playstyles
      case 'team-analytics': {
        const filteredResults = selectedDay === 'all'
          ? activeTeamResults
          : activeTeamResults.filter(r => r.day === Number(selectedDay));
        const filteredBonuses = selectedDay === 'all'
          ? activeBonusPoints
          : activeBonusPoints.filter(b => b.day === Number(selectedDay));
        const analytics = computeTeamAnalytics(filteredResults, filteredBonuses, scoring);
        const sliced = limit > 0 ? analytics.slice(0, limit) : analytics;
        const mapped = sliced.map(t => ({
          Rank: t.analyticsRank,
          Team: t.teamName,
          Clan: t.clanName || '—',
          'Team Rating': t.scores?.FINAL_RATING || 0,
          Wins: t.wins,
          Matches: t.matches,
          PPM: t.analytics?.PPM || 0,
          KPM: t.analytics?.KPM || 0,
          'Kill Share %': `${Math.round((t.analytics?.killPct || 0) * 100)}%`,
          'Avg Place': t.analytics?.avgPlace || 0,
          'Top 3 Rate %': `${Math.round((t.analytics?.top3Rate || 0) * 100)}%`,
          'Win Rate %': `${Math.round((t.analytics?.winRate || 0) * 100)}%`,
          'Momentum Index': t.analytics?.forwardMI || 0,
          'Consistency (StdDev)': t.analytics?.stdDevCS || 0,
          Playstyle: t.labels?.playstyle || 'Balanced',
          'Power Tier': t.labels?.powerLabel || 'Average',
          'Placement Tier': t.labels?.placementLabel || 'Developing',
          'Conversion Tier': t.labels?.conversionLabel || 'Average',
        }));

        return {
          rows: mapped,
          columns: [
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Team', accessor: 'Team' },
            { header: 'Clan', accessor: 'Clan' },
            { header: 'Rating (0-1000)', accessor: 'Team Rating' },
            { header: 'PPM', accessor: 'PPM' },
            { header: 'KPM', accessor: 'KPM' },
            { header: 'Avg Place', accessor: 'Avg Place' },
            { header: 'Win %', accessor: 'Win Rate %' },
            { header: 'Playstyle', accessor: 'Playstyle' },
            { header: 'Power Tier', accessor: 'Power Tier' },
          ],
        };
      }

      // 11. Map Performance Breakdown
      case 'map-performance': {
        const teamMapAgg = {};
        activeTeamResults.forEach(r => {
          const map = getMapForMatch(activeMapConfig, r.day, r.lobby, r) || 'Isolated';
          const teamName = r.teamName || r.teamId;
          const key = `${map}_${r.teamId}`;
          if (!teamMapAgg[key]) {
            teamMapAgg[key] = {
              map,
              teamName,
              matches: 0,
              wins: 0,
              top3: 0,
              placementSum: 0,
              kills: 0,
              placePts: 0,
            };
          }
          const item = teamMapAgg[key];
          item.matches++;
          if (r.placement === 1) item.wins++;
          if (r.placement > 0 && r.placement <= 3) item.top3++;
          if (r.placement > 0) item.placementSum += r.placement;
          item.kills += Number(r.kills) || 0;
        });

        const rows = Object.values(teamMapAgg).map(item => {
          const avgPlace = item.matches > 0 ? (item.placementSum / item.matches).toFixed(1) : '—';
          const winRate = item.matches > 0 ? `${Math.round((item.wins / item.matches) * 100)}%` : '0%';
          const kpm = item.matches > 0 ? (item.kills / item.matches).toFixed(2) : '0.00';
          return {
            Map: item.map,
            Team: item.teamName,
            Matches: item.matches,
            Wins: item.wins,
            'Top 3s': item.top3,
            'Win Rate': winRate,
            'Avg Place': avgPlace,
            'Total Kills': item.kills,
            'Kills / Match': kpm,
          };
        });

        rows.sort((a, b) => a.Map.localeCompare(b.Map) || b.Wins - a.Wins || b['Total Kills'] - a['Total Kills']);
        const sliced = limit > 0 ? rows.slice(0, limit) : rows;

        return {
          rows: sliced,
          columns: [
            { header: 'Map Name', accessor: 'Map' },
            { header: 'Team', accessor: 'Team' },
            { header: 'Matches', accessor: 'Matches' },
            { header: 'Wins', accessor: 'Wins' },
            { header: 'Top 3s', accessor: 'Top 3s' },
            { header: 'Win Rate', accessor: 'Win Rate' },
            { header: 'Avg Placement', accessor: 'Avg Place' },
            { header: 'Total Kills', accessor: 'Total Kills' },
            { header: 'KPM', accessor: 'Kills / Match' },
          ],
        };
      }

      // 12. Revive Mechanism Breakdown
      case 'revive-performance': {
        const teamRevAgg = {};
        activeTeamResults.forEach(r => {
          const revId = getReviveTypeForMatch(activeReviveConfig, r.day, r.lobby, r) || 'auto';
          const revLabel = getReviveType(revId)?.label || revId;
          const teamName = r.teamName || r.teamId;
          const key = `${revId}_${r.teamId}`;
          if (!teamRevAgg[key]) {
            teamRevAgg[key] = {
              revive: revLabel,
              teamName,
              matches: 0,
              wins: 0,
              placementSum: 0,
              kills: 0,
            };
          }
          const item = teamRevAgg[key];
          item.matches++;
          if (r.placement === 1) item.wins++;
          if (r.placement > 0) item.placementSum += r.placement;
          item.kills += Number(r.kills) || 0;
        });

        const rows = Object.values(teamRevAgg).map(item => {
          const avgPlace = item.matches > 0 ? (item.placementSum / item.matches).toFixed(1) : '—';
          const winRate = item.matches > 0 ? `${Math.round((item.wins / item.matches) * 100)}%` : '0%';
          const kpm = item.matches > 0 ? (item.kills / item.matches).toFixed(2) : '0.00';
          return {
            'Revive Mechanism': item.revive,
            Team: item.teamName,
            Matches: item.matches,
            Wins: item.wins,
            'Win Rate': winRate,
            'Avg Place': avgPlace,
            'Total Kills': item.kills,
            'Kills / Match': kpm,
          };
        });

        rows.sort((a, b) => a['Revive Mechanism'].localeCompare(b['Revive Mechanism']) || b.Wins - a.Wins);
        const sliced = limit > 0 ? rows.slice(0, limit) : rows;

        return {
          rows: sliced,
          columns: [
            { header: 'Revive Mechanism', accessor: 'Revive Mechanism' },
            { header: 'Team', accessor: 'Team' },
            { header: 'Matches', accessor: 'Matches' },
            { header: 'Wins', accessor: 'Wins' },
            { header: 'Win Rate', accessor: 'Win Rate' },
            { header: 'Avg Place', accessor: 'Avg Place' },
            { header: 'Kills', accessor: 'Total Kills' },
            { header: 'KPM', accessor: 'Kills / Match' },
          ],
        };
      }

      // 13. Global Form Teams
      case 'global-form-teams': {
        const forms = activeTeamRegs.map(r => {
          const gf = computeTeamGlobalForm(r.teamId, allTournamentsData.tournaments, allTournamentsData.teamRes);
          return {
            teamId: r.teamId,
            teamName: r.teamName,
            clanName: r.clanName || '—',
            ...gf,
          };
        });
        forms.sort((a, b) => (b.decayedForm || 0) - (a.decayedForm || 0));
        const sliced = limit > 0 ? forms.slice(0, limit) : forms;
        const mapped = sliced.map((t, i) => ({
          Rank: i + 1,
          Team: t.teamName,
          Clan: t.clanName,
          'Global Form': t.decayedForm ?? '—',
          'Raw Form': t.rawForm ?? '—',
          Trend: t.trend,
          'Confidence %': t.confidence ? `${t.confidence}%` : '—',
          'Matches Analyzed': t.matchesUsed,
          'Days Inactive': t.daysInactive,
        }));
        return {
          rows: mapped,
          columns: [
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Team Name', accessor: 'Team' },
            { header: 'Clan', accessor: 'Clan' },
            { header: 'Global Form', accessor: 'Global Form' },
            { header: 'Raw Form', accessor: 'Raw Form' },
            { header: 'Trend', accessor: 'Trend' },
            { header: 'Confidence', accessor: 'Confidence %' },
            { header: 'Matches Analyzed', accessor: 'Matches Analyzed' },
            { header: 'Days Inactive', accessor: 'Days Inactive' },
          ],
        };
      }

      // 14. Global Form Players
      case 'global-form-players': {
        const forms = activePlayerRegs.map(r => {
          const gf = computePlayerGlobalForm(r.playerId, allTournamentsData.tournaments, allTournamentsData.playerRes);
          return {
            playerId: r.playerId,
            playerName: r.playerName || r.ign,
            ign: r.ign,
            teamName: r.teamName || '—',
            class: r.class || 'Class 1',
            ...gf,
          };
        });
        forms.sort((a, b) => (b.decayedForm || 0) - (a.decayedForm || 0));
        const sliced = limit > 0 ? forms.slice(0, limit) : forms;
        const mapped = sliced.map((p, i) => ({
          Rank: i + 1,
          'Pro Name': p.playerName,
          IGN: p.ign,
          Team: p.teamName,
          Class: p.class,
          'Global Form': p.decayedForm ?? '—',
          'Raw Form': p.rawForm ?? '—',
          Trend: p.trend,
          'Confidence %': p.confidence ? `${p.confidence}%` : '—',
          'Matches Analyzed': p.matchesUsed,
          'Days Inactive': p.daysInactive,
        }));
        return {
          rows: mapped,
          columns: [
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Pro Name', accessor: 'Pro Name' },
            { header: 'IGN', accessor: 'IGN' },
            { header: 'Team', accessor: 'Team' },
            { header: 'Class', accessor: 'Class' },
            { header: 'Global Form', accessor: 'Global Form' },
            { header: 'Raw Form', accessor: 'Raw Form' },
            { header: 'Trend', accessor: 'Trend' },
            { header: 'Confidence', accessor: 'Confidence %' },
            { header: 'Matches Analyzed', accessor: 'Matches Analyzed' },
          ],
        };
      }

      // 15. Full Player Roster
      case 'player-roster': {
        const mapped = activePlayerRegs.map(p => ({
          Slot: p.slot || '—',
          'Pro Name': p.professionalName || '—',
          IGN: p.ign || '—',
          Team: p.teamName || '—',
          Class: p.class || '—',
          Gender: p.gender || '—',
          Region: p.region || '—',
          Country: p.country || '—',
          Device: p.device || '—',
          Model: p.deviceModel || '—',
        }));

        return {
          rows: mapped,
          columns: [
            { header: 'Slot', accessor: 'Slot', width: 60 },
            { header: 'Pro Name', accessor: 'Pro Name' },
            { header: 'IGN', accessor: 'IGN' },
            { header: 'Team', accessor: 'Team' },
            { header: 'Class', accessor: 'Class' },
            { header: 'Region', accessor: 'Region' },
            { header: 'Country', accessor: 'Country' },
            { header: 'Device', accessor: 'Device' },
            { header: 'Model', accessor: 'Model' },
          ],
        };
      }

      // 16. Full Team Registry
      case 'team-registry': {
        const mapped = activeTeamRegs.map(t => ({
          Slot: t.slot || '—',
          'Team Name': t.teamName || '—',
          Clan: t.clanName || '—',
          Tier: t.tier || '—',
        }));

        return {
          rows: mapped,
          columns: [
            { header: 'Slot', accessor: 'Slot', width: 60 },
            { header: 'Team Name', accessor: 'Team Name' },
            { header: 'Clan', accessor: 'Clan' },
            { header: 'Tier', accessor: 'Tier' },
          ],
        };
      }

      default:
        return { rows: [], columns: [] };
    }
  };

  const { rows, columns } = getExtractData();

  const getFileName = (ext) => {
    const safeName = (tournament?.name || 'Tournament')
      .replace(/[/\\:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const presetLabel = activePresetObj?.name || activePreset;
    const daySuffix = selectedDay === 'all' ? '' : ` Day ${selectedDay}`;
    const mapSuffix = selectedMap === 'all' ? '' : ` - ${selectedMap}`;
    const groupSuffix = (isQualifier && selectedGroupId !== 'all' && selectedGroupObj)
      ? ` - ${selectedGroupObj.groupName}`
      : '';

    return `${safeName} - ${presetLabel}${groupSuffix}${daySuffix}${mapSuffix}.${ext}`;
  };

  // ─── Export Actions ──────────────────────────────────────────────────────────
  const handleCopyJSON = () => {
    try {
      navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
      toast.success('Copied JSON to clipboard!');
    } catch (e) {
      toast.error('Failed to copy JSON: ' + e.message);
    }
  };

  const handleDownloadCSV = () => {
    try {
      const csv = Papa.unparse(rows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', getFileName('csv'));
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('CSV downloaded successfully!');
    } catch (e) {
      toast.error('Failed to download CSV: ' + e.message);
    }
  };

  const handleDownloadExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Data Extract');
      XLSX.writeFile(wb, getFileName('xlsx'));
      toast.success('Excel workbook downloaded!');
    } catch (e) {
      toast.error('Failed to download Excel file: ' + e.message);
    }
  };

  if (loading) return <LoadingSpinner size="lg" text="Analyzing tournament data..." />;

  const ActiveIcon = activePresetObj?.categoryIcon || Table;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Page Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
        paddingBottom: 16,
        borderBottom: '1px solid var(--border-md)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 42,
            height: 42,
            borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(201,168,76,0.2) 0%, rgba(201,168,76,0.05) 100%)',
            border: '1px solid var(--border-gold)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--gold)',
          }}>
            <Table size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
              Data Extraction Hub
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '3px 0 0' }}>
              Select structured tournament reports, deep metrics, and analytics to preview, copy, or export.
            </p>
          </div>
        </div>

        {/* Global Export Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleCopyJSON}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}
            title="Copy current dataset formatted as JSON"
          >
            <Copy size={13} /> Copy JSON
          </button>
          <button
            onClick={handleDownloadCSV}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}
            title="Export and download as standard CSV"
          >
            <Download size={13} /> Export CSV
          </button>
          <button
            onClick={handleDownloadExcel}
            className="btn btn-primary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}
            title="Export as styled Excel spreadsheet (.xlsx)"
          >
            <FileSpreadsheet size={13} /> Export Excel (.xlsx)
          </button>
        </div>
      </div>

      {/* Main Grid: Neater Categorized Sidebar + Workspace */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>
        
        {/* ─── Categorized Sidebar ────────────────────────────────────────────── */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-md)',
          borderRadius: 12,
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          maxHeight: 'calc(100vh - 140px)',
          overflowY: 'auto',
          position: 'sticky',
          top: 20,
        }}>
          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search extraction reports..."
              style={{
                width: '100%',
                padding: '7px 30px 7px 32px',
                fontSize: '0.8rem',
                borderRadius: 8,
                background: 'var(--bg-app)',
                border: '1px solid var(--border-md)',
                color: 'var(--text-primary)',
                outline: 'none',
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Categories & Presets List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {filteredCategories.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 10px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                No reports matching &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              filteredCategories.map(category => {
                const CatIcon = category.icon;
                return (
                  <div key={category.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Category Header */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 6px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: category.color || 'var(--text-muted)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CatIcon size={13} />
                        <span>{category.name}</span>
                      </div>
                      <span style={{
                        fontSize: '0.65rem',
                        padding: '1px 6px',
                        borderRadius: 10,
                        background: 'rgba(255,255,255,0.06)',
                        color: 'var(--text-muted)',
                      }}>
                        {category.presets.length}
                      </span>
                    </div>

                    {/* Presets in Category */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {category.presets.map(preset => {
                        const isSelected = activePreset === preset.id;
                        return (
                          <button
                            key={preset.id}
                            onClick={() => {
                              setActivePreset(preset.id);
                              if (['player-roster', 'team-registry', 'daily-pts-matrix', 'group-standings'].includes(preset.id)) {
                                setLimit(0);
                              } else {
                                setLimit(10);
                              }
                            }}
                            style={{
                              textAlign: 'left',
                              padding: '9px 12px',
                              borderRadius: 8,
                              border: isSelected ? '1px solid var(--gold)' : '1px solid transparent',
                              background: isSelected
                                ? 'linear-gradient(90deg, rgba(201,168,76,0.15) 0%, rgba(201,168,76,0.03) 100%)'
                                : 'var(--bg-app)',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 3,
                              position: 'relative',
                              transition: 'all 0.15s ease',
                              borderLeft: isSelected ? '3px solid var(--gold)' : '3px solid transparent',
                            }}
                            onMouseEnter={e => {
                              if (!isSelected) e.currentTarget.style.background = 'var(--bg-alt-row)';
                            }}
                            onMouseLeave={e => {
                              if (!isSelected) e.currentTarget.style.background = 'var(--bg-app)';
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                              <span style={{
                                fontWeight: isSelected ? 700 : 600,
                                fontSize: '0.82rem',
                                color: isSelected ? 'var(--gold)' : 'var(--text-primary)',
                              }}>
                                {preset.name}
                              </span>
                              {preset.badge && (
                                <span style={{
                                  fontSize: '0.62rem',
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background: isSelected ? 'rgba(201,168,76,0.25)' : 'rgba(255,255,255,0.06)',
                                  color: isSelected ? 'var(--gold)' : 'var(--text-muted)',
                                  whiteSpace: 'nowrap',
                                }}>
                                  {preset.badge}
                                </span>
                              )}
                            </div>
                            <span style={{
                              fontSize: '0.72rem',
                              color: isSelected ? 'rgba(201,168,76,0.85)' : 'var(--text-muted)',
                              lineHeight: 1.3,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}>
                              {preset.desc}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ─── Active Report Workspace ────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          {/* Active Preset Summary & Filter Bar Card */}
          <div className="card" style={{ padding: 18, border: '1px solid var(--border-md)' }}>
            
            {/* Header info */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
              paddingBottom: 14,
              borderBottom: '1px solid var(--border-md)',
              marginBottom: 14,
              flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: 'rgba(201,168,76,0.12)',
                    color: 'var(--gold)',
                    border: '1px solid rgba(201,168,76,0.25)',
                  }}>
                    {activePresetObj.categoryName}
                  </span>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                    {activePresetObj.name}
                  </h3>
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                  {activePresetObj.desc}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-md)',
                  fontSize: '0.78rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>Dataset:</span>
                  <strong style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{rows.length} rows</strong>
                  <span style={{ color: 'var(--text-muted)' }}>·</span>
                  <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{columns.length} cols</strong>
                </div>
              </div>
            </div>

            {/* Filter controls row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              
              {/* Group filter for Qualifiers */}
              {isQualifier && groups.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Group:</span>
                  <select
                    value={selectedGroupId}
                    onChange={e => setSelectedGroupId(e.target.value)}
                    className="form-select"
                    style={{ fontSize: '0.78rem', padding: '4px 8px', minWidth: 130 }}
                  >
                    <option value="all">All Groups</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>{g.groupName}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Day Selector */}
              {['top-teams-avg', 'top-teams-pts', 'top-players-combined', 'top-players-set1', 'top-players-set2', 'player-damage-leaders', 'clan-rankings', 'team-analytics'].includes(activePreset) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Day:</span>
                  <select
                    value={selectedDay}
                    onChange={e => setSelectedDay(e.target.value)}
                    className="form-select"
                    style={{ fontSize: '0.78rem', padding: '4px 8px', minWidth: 100 }}
                  >
                    <option value="all">All Days (Overall)</option>
                    {Array.from({ length: activeTotalDays }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>Day {d}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Map Selector */}
              {['top-teams-avg', 'top-teams-pts', 'top-players-combined', 'top-players-set1', 'top-players-set2', 'player-damage-leaders', 'clan-rankings', 'team-analytics', 'daily-pts-matrix'].includes(activePreset) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Map:</span>
                  <select
                    value={selectedMap}
                    onChange={e => setSelectedMap(e.target.value)}
                    className="form-select"
                    style={{ fontSize: '0.78rem', padding: '4px 8px', minWidth: 120 }}
                  >
                    <option value="all">All Maps</option>
                    {AVAILABLE_MAPS.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Row Limit Selector */}
              {!['player-roster', 'team-registry', 'daily-pts-matrix', 'group-standings'].includes(activePreset) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Rows Limit:</span>
                  <select
                    value={limit}
                    onChange={e => setLimit(Number(e.target.value))}
                    className="form-select"
                    style={{ fontSize: '0.78rem', padding: '4px 8px', minWidth: 90 }}
                  >
                    <option value={5}>Top 5</option>
                    <option value={10}>Top 10</option>
                    <option value={20}>Top 20</option>
                    <option value={50}>Top 50</option>
                    <option value={0}>All Rows</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Live Preview Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--border-md)' }}>
            <div style={{
              padding: '12px 18px',
              borderBottom: '1px solid var(--border-md)',
              background: 'var(--bg-header)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 700 }}>
                <List size={15} style={{ color: 'var(--gold)' }} />
                <span>Live Data Preview</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                  ({rows.length} records ready for export)
                </span>
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Target: <code>{getFileName('xlsx')}</code>
              </span>
            </div>

            <div style={{ padding: 12 }}>
              <DataTable
                columns={columns}
                data={rows}
                searchable={true}
                searchPlaceholder="Search within preview records..."
                emptyMessage="No data records match this extraction filter setup."
                pageSize={15}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
