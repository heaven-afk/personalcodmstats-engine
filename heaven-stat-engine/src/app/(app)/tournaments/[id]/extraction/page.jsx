'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTournament } from '../layout';
import { getTournaments, getTeamRegistrations, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getPlayerMatchResults, getBonusPoints } from '@/lib/firestore/matchData';
import { getGroups } from '@/lib/firestore/groups';
import { computeTeamRanking, computeClanRanking, computeDailyStandings } from '@/lib/engine/standings';
import { computePlayerStats } from '@/lib/engine/playerStats';
import { computeTeamAnalytics } from '@/lib/engine/analytics';
import { computeTeamGlobalForm, computePlayerGlobalForm } from '@/lib/engine/globalForm';
import DataTable from '@/components/ui/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import Papa from 'papaparse';
import { Download, Copy, Table, List } from 'lucide-react';
import { AVAILABLE_MAPS } from '@/lib/constants/maps';
import { getActiveMapConfig, filterResultsByMap } from '@/lib/utils/mapConfig';

const PRESETS = [
  { id: 'top-players-set1', name: 'Top Players (Class 1)', desc: 'Players in Class 1 sorted by total kills.' },
  { id: 'top-players-set2', name: 'Top Players (Class 2)', desc: 'Players in Class 2 sorted by total kills.' },
  { id: 'top-teams-pts',    name: 'Top Teams by Points',    desc: 'Team season standings ranked by total points + tiebreakers.' },
  { id: 'clan-rankings',    name: 'Clan Rankings',         desc: 'Clan standings based on active team member point aggregates.' },
  { id: 'global-form-teams', name: 'Global Form (Teams)',   desc: 'Cross-tournament rolling form, recency-decayed scores, confidence, and trend for teams.' },
  { id: 'global-form-players', name: 'Global Form (Players)', desc: 'Cross-tournament rolling form, recency-decayed scores, confidence, and trend for players.' },
  { id: 'player-roster',    name: 'Full Player Roster',     desc: 'List of all registered players and their setup details.' },
  { id: 'team-registry',    name: 'Full Team Registry',     desc: 'List of all registered teams and their setup details.' },
  { id: 'team-analytics',   name: 'Full Team Analytics',    desc: 'Enriched analytics including PPM, KPM, consistency, rating and playstyle labels.' },
  { id: 'daily-pts-matrix', name: 'Daily Points Matrix',    desc: 'Day-by-day breakdown of points for all teams.' },
];

export default function ExtractionPage() {
  const { id: tournamentId } = useParams();
  const { tournament } = useTournament();
  const { structure = {}, scoring = {} } = tournament || {};
  const isQualifier = tournament?.type === 'qualifier';

  const [activePreset, setActivePreset] = useState('top-players-set1');
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

  if (loading) return <LoadingSpinner size="lg" text="Analyzing tournament data..." />;

  const selectedGroupObj = isQualifier && selectedGroupId !== 'all' ? groups.find(g => g.id === selectedGroupId) : null;
  const activeStructure = selectedGroupObj?.structure || structure;
  const activeTotalDays = activeStructure.totalDays || 6;

  // ─── Data Extract Selectors ──────────────────────────────────────────────────
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

    const activeMapConfig = getActiveMapConfig(tournament, selectedGroupObj);
    if (selectedMap !== 'all' && activeMapConfig) {
      activeTeamResults = filterResultsByMap(activeTeamResults, activeMapConfig, selectedMap);
      activePlayerResults = filterResultsByMap(activePlayerResults, activeMapConfig, selectedMap);
      activeBonusPoints = filterResultsByMap(activeBonusPoints, activeMapConfig, selectedMap);
    }

    switch (activePreset) {
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
          'Kills/Match': p.killsPerMatch,
          'Kills/Event': p.killsPerEvent,
          'Avg Damage': p.avgDamage,
          'Avg Accuracy %': p.avgAccuracy ? Math.round(p.avgAccuracy * 100) : 0,
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
            { header: 'Kills/Match', accessor: 'Kills/Match' },
            { header: 'Kills/Event', accessor: 'Kills/Event' },
            { header: 'Avg Damage', accessor: 'Avg Damage' },
          ],
        };
      }

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
          'Kills/Match': p.killsPerMatch,
          'Kills/Event': p.killsPerEvent,
          'Avg Damage': p.avgDamage,
          'Avg Accuracy %': p.avgAccuracy ? Math.round(p.avgAccuracy * 100) : 0,
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
            { header: 'Kills/Match', accessor: 'Kills/Match' },
            { header: 'Kills/Event', accessor: 'Kills/Event' },
            { header: 'Avg Damage', accessor: 'Avg Damage' },
          ],
        };
      }

      case 'top-teams-pts': {
        const ranking = selectedDay === 'all'
          ? computeTeamRanking(activeTeamResults, activeBonusPoints, scoring)
          : computeDailyStandings(activeTeamResults, activeBonusPoints, scoring, Number(selectedDay));
        const sliced = limit > 0 ? ranking.slice(0, limit) : ranking;
        const mapped = sliced.map((t, i) => ({
          Rank: t.rank || i + 1,
          Team: t.teamName,
          Clan: t.clanName || '—',
          Wins: t.wins,
          Matches: t.matches,
          'Place Pts': t.placementPts,
          Kills: t.kills,
          'Kill Pts': t.killPts,
          'Bonus Pts': t.bonusPts,
          'Total Pts': t.totalPts,
        }));

        return {
          rows: mapped,
          columns: [
            { header: 'Rank', accessor: 'Rank', width: 60 },
            { header: 'Team Name', accessor: 'Team' },
            { header: 'Clan', accessor: 'Clan' },
            { header: 'Wins', accessor: 'Wins' },
            { header: 'Matches', accessor: 'Matches' },
            { header: 'Place Pts', accessor: 'Place Pts' },
            { header: 'Kills', accessor: 'Kills' },
            { header: 'Kill Pts', accessor: 'Kill Pts' },
            { header: 'Bonus Pts', accessor: 'Bonus Pts' },
            { header: 'Total Pts', accessor: 'Total Pts' },
          ],
        };
      }

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
          'Best Rank': c.bestRank === Infinity ? '—' : c.bestRank,
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
            { header: 'Best Member Rank', accessor: 'Best Rank' },
          ],
        };
      }

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
          Confidence: t.confidence,
          'Matches Used': t.matchesUsed,
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
            { header: 'Confidence', accessor: 'Confidence' },
            { header: 'Matches Used', accessor: 'Matches Used' },
            { header: 'Days Inactive', accessor: 'Days Inactive' },
          ],
        };
      }

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
          Confidence: p.confidence,
          'Matches Used': p.matchesUsed,
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
            { header: 'Confidence', accessor: 'Confidence' },
            { header: 'Matches Used', accessor: 'Matches Used' },
            { header: 'Days Inactive', accessor: 'Days Inactive' },
          ],
        };
      }

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
            { header: 'Device', accessor: 'Device' },
          ],
        };
      }

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
          Wins: t.wins,
          Matches: t.matches,
          Kills: t.kills,
          'Total Pts': t.totalPts,
          'Team Rating': t.scores?.FINAL_RATING || 0,
          PPM: t.analytics?.PPM || 0,
          KPM: t.analytics?.KPM || 0,
          'Kill %': t.analytics?.killPct || 0,
          'Avg Place': t.analytics?.avgPlace || 0,
          'Top 3 Rate %': t.analytics?.top3Rate || 0,
          'Win Rate %': t.analytics?.winRate || 0,
          'Momentum Index': t.analytics?.forwardMI || 0,
          Consistency: t.analytics?.stdDevCS || 0,
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
            { header: 'Rating', accessor: 'Team Rating' },
            { header: 'PPM', accessor: 'PPM' },
            { header: 'KPM', accessor: 'KPM' },
            { header: 'Avg Place', accessor: 'Avg Place' },
            { header: 'Playstyle', accessor: 'Playstyle' },
            { header: 'Power Tier', accessor: 'Power Tier' },
          ],
        };
      }

      case 'daily-pts-matrix': {
        const collation = computeTeamRanking(activeTeamResults, activeBonusPoints, scoring);
        const days = Array.from({ length: activeTotalDays }, (_, i) => i + 1);
        const mapped = collation.map(t => {
          const row = {
            Team: t.teamName,
            Clan: t.clanName || '—',
          };
          days.forEach(d => {
            row[`Day ${d}`] = t.perDay[d]?.totalPts ?? 0;
          });
          row['Total Pts'] = t.totalPts;
          return row;
        });

        const columns = [
          { header: 'Team Name', accessor: 'Team' },
          { header: 'Clan', accessor: 'Clan' },
          ...days.map(d => ({ header: `Day ${d}`, accessor: `Day ${d}` })),
          { header: 'Total Pts', accessor: 'Total Pts' },
        ];

        return { rows: mapped, columns };
      }

      default:
        return { rows: [], columns: [] };
    }
  };

  const { rows, columns } = getExtractData();

  const getFileName = (ext) => {
    // Sanitise tournament name for use as a filename
    const safeName = (tournament?.name || 'Tournament')
      .replace(/[/\\:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Human-readable preset label
    const preset = PRESETS.find(p => p.id === activePreset);
    const presetLabel = preset ? preset.name : activePreset;

    // Day / Group suffix
    const daySuffix = selectedDay === 'all' ? '' : ` Day ${selectedDay}`;
    const groupSuffix = (isQualifier && selectedGroupId !== 'all' && selectedGroupObj)
      ? ` - ${selectedGroupObj.groupName}`
      : '';

    return `${safeName} - ${presetLabel}${groupSuffix}${daySuffix}.${ext}`;
  };

  // ─── Downloader Actions ──────────────────────────────────────────────────────
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
      toast.success('CSV downloaded!');
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
      toast.success('Excel file downloaded!');
    } catch (e) {
      toast.error('Failed to download Excel file: ' + e.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Configuration Header */}
      <div className="flex-between flex-wrap gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-text-primary">
            <Table size={20} className="text-gold" />
            Data Extraction Hub
          </h2>
          <p className="text-xs text-text-muted mt-1">Select structured reports to copy or download as Excel / CSV files.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Presets List */}
        <div className="lg:col-span-1 space-y-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => {
                setActivePreset(preset.id);
                if (['player-roster', 'team-registry', 'daily-pts-matrix'].includes(preset.id)) {
                  setLimit(0);
                } else {
                  setLimit(10);
                }
              }}
              className={`w-full text-left p-3 rounded-lg border text-sm transition flex flex-col space-y-1 ${
                activePreset === preset.id
                  ? 'border-gold bg-gold/10 text-gold font-semibold'
                  : 'border-border bg-bg-card hover:bg-bg-alt-row text-text-secondary'
              }`}
            >
              <span>{preset.name}</span>
              <span className={`text-[10px] line-clamp-1 ${activePreset === preset.id ? 'text-gold/80' : 'text-text-muted'}`}>
                {preset.desc}
              </span>
            </button>
          ))}
        </div>

        {/* Workspace panel */}
        <div className="lg:col-span-3 space-y-4">
          <div className="card">
            <div className="flex-between flex-wrap gap-4 pb-4 border-b border-border mb-4">
              {/* Configuration panel */}
              <div className="flex items-center gap-4 flex-wrap">
                {isQualifier && groups.length > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-muted font-medium">Group:</span>
                    <select
                      value={selectedGroupId}
                      onChange={(e) => setSelectedGroupId(e.target.value)}
                      className="form-input py-1 px-2 text-xs"
                      style={{ width: 140 }}
                    >
                      <option value="all">All Groups</option>
                      {groups.map(g => (
                        <option key={g.id} value={g.id}>{g.groupName}</option>
                      ))}
                    </select>
                  </div>
                )}
                {!['player-roster', 'team-registry', 'daily-pts-matrix'].includes(activePreset) && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-muted">Limit rows:</span>
                    <select
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                      className="form-input py-1 px-2 text-xs"
                      style={{ width: 80 }}
                    >
                      <option value={5}>Top 5</option>
                      <option value={10}>Top 10</option>
                      <option value={20}>Top 20</option>
                      <option value={50}>Top 50</option>
                      <option value={0}>All Rows</option>
                    </select>
                  </div>
                )}
                {['top-players-set1', 'top-players-set2', 'top-teams-pts', 'clan-rankings', 'team-analytics'].includes(activePreset) && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-muted">Day:</span>
                    <select
                      value={selectedDay}
                      onChange={(e) => setSelectedDay(e.target.value)}
                      className="form-input py-1 px-2 text-xs"
                      style={{ width: 100 }}
                    >
                      <option value="all">All Days</option>
                      {Array.from({ length: activeTotalDays }, (_, i) => i + 1).map(d => (
                        <option key={d} value={d}>Day {d}</option>
                      ))}
                    </select>
                  </div>
                )}
                {['top-players-set1', 'top-players-set2', 'top-teams-pts', 'clan-rankings', 'team-analytics', 'daily-pts-matrix'].includes(activePreset) && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-muted font-medium">Map:</span>
                    <select
                      value={selectedMap}
                      onChange={(e) => setSelectedMap(e.target.value)}
                      className="form-input py-1 px-2 text-xs"
                      style={{ width: 130 }}
                    >
                      <option value="all">All Maps</option>
                      {AVAILABLE_MAPS.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Actions panel */}
              <div className="flex items-center gap-2">
                <button onClick={handleCopyJSON} className="btn btn-secondary btn-sm flex items-center gap-1.5 py-1.5 text-xs">
                  <Copy size={13} /> Copy JSON
                </button>
                <button onClick={handleDownloadCSV} className="btn btn-secondary btn-sm flex items-center gap-1.5 py-1.5 text-xs">
                  <Download size={13} /> Download CSV
                </button>
                <button onClick={handleDownloadExcel} className="btn btn-primary btn-sm flex items-center gap-1.5 py-1.5 text-xs">
                  <Download size={13} /> Download Excel
                </button>
              </div>
            </div>

            {/* Preview Area */}
            <div>
              <div className="flex items-center gap-2 text-text-muted text-xs font-semibold uppercase tracking-wider mb-2">
                <List size={13} className="text-gold" />
                Live Preview ({rows.length} rows)
              </div>
              <div className="border border-border/80 rounded-lg bg-bg-app/30 overflow-hidden">
                <DataTable
                  columns={columns}
                  data={rows}
                  searchable={true}
                  searchPlaceholder="Filter columns..."
                  emptyMessage="No rows match this extract setup"
                  pageSize={15}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
