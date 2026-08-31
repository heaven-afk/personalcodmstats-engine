'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getPlayers, getTeams } from '@/lib/firestore/registry';
import { getTournaments, getPlayerRegistrations, getTeamRegistrations } from '@/lib/firestore/tournaments';
import { getPlayerMatchResults, getTeamMatchResults } from '@/lib/firestore/matchData';
import { ClassBadge, RankBadge, StatusBadge, TierBadge } from '@/components/ui/Badge';
import DataTable from '@/components/ui/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import MetricTooltip from '@/components/ui/MetricTooltip';
import { BarChart3, Search, Star, Trophy, Users, Shield, TrendingUp, TrendingDown, Minus, Sparkles, Flame, AlertCircle, Download, Copy, Info, HelpCircle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Papa from 'papaparse';
import { GLOBAL_FORM_CATEGORIES, computeTeamGlobalForm, computePlayerGlobalForm, globalFormLabel } from '@/lib/engine/globalForm';

export default function RankingsPage() {
  const searchParams = useSearchParams();
  const tabParam = searchParams ? searchParams.get('tab') : null;

  const [activeTab, setActiveTab] = useState('career'); // 'career' | 'teamForm' | 'playerForm'

  const [rawData, setRawData] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal state for Global Form (i) calculation & sample walkthrough
  const [showInfoModal, setShowInfoModal] = useState(false);

  // Selection states for export
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);

  // Filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all'); // 'all' | 'Tier 1' | 'Tier 2' | 'Tier 3' | 'unranked'
  const [regionFilter, setRegionFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');

  useEffect(() => {
    if (tabParam === 'teamForm' || tabParam === 'team') {
      setActiveTab('teamForm');
    } else if (tabParam === 'playerForm' || tabParam === 'player') {
      setActiveTab('playerForm');
    } else if (tabParam === 'career') {
      setActiveTab('career');
    }
  }, [tabParam]);

  useEffect(() => {
    async function loadRankingsData() {
      try {
        const [allPlayers, allTeams, allTourneys] = await Promise.all([
          getPlayers(),
          getTeams(),
          getTournaments()
        ]);

        const playerRegsPromises = allTourneys.map(t => getPlayerRegistrations(t.id));
        const playerResPromises  = allTourneys.map(t => getPlayerMatchResults(t.id));
        const teamResPromises    = allTourneys.map(t => getTeamMatchResults(t.id));

        const allPlayerRegs = await Promise.all(playerRegsPromises);
        const allPlayerRes  = await Promise.all(playerResPromises);
        const allTeamRes    = await Promise.all(teamResPromises);

        const playerMatchResultsByTournament = {};
        const teamMatchResultsByTournament   = {};

        allTourneys.forEach((t, index) => {
          playerMatchResultsByTournament[t.id] = allPlayerRes[index] || [];
          teamMatchResultsByTournament[t.id]   = allTeamRes[index] || [];
        });

        // 1. Career Player Leaderboard
        const playerStatsMap = {};
        allPlayers.forEach(p => {
          playerStatsMap[p.id] = {
            id: p.id,
            professionalName: p.professionalName,
            ign: p.ign,
            region: p.region || '—',
            country: p.country || '—',
            device: p.device || '—',
            lastClass: 'Class 1',
            lastTeam: '—',
            clanName: '—',
            rankedTier: p.rankedTier || null,
            rankedEventsCount: p.rankedEventsCount || 0,
            totalKills: 0,
            totalMatches: 0,
            totalEvents: 0,
            totalDamage: 0,
            totalAccuracySum: 0,
            accuracyCount: 0,
          };
        });

        allTourneys.forEach((t, index) => {
          const tRegs = allPlayerRegs[index];
          const tRes  = allPlayerRes[index];

          tRes.forEach(res => {
            const pid = res.playerId;
            if (playerStatsMap[pid]) {
              playerStatsMap[pid].totalKills += res.kills || 0;
              playerStatsMap[pid].totalMatches += 1;
              playerStatsMap[pid].totalDamage += res.damage || 0;
              if (res.accuracy != null && res.accuracy > 0) {
                playerStatsMap[pid].totalAccuracySum += res.accuracy;
                playerStatsMap[pid].accuracyCount++;
              }
            }
          });

          tRegs.forEach(r => {
            const pid = r.playerId;
            if (playerStatsMap[pid]) {
              playerStatsMap[pid].totalEvents += 1;
              if (r.class) playerStatsMap[pid].lastClass = r.class;
              if (r.teamName) playerStatsMap[pid].lastTeam = r.teamName;
              if (r.clanName) playerStatsMap[pid].clanName = r.clanName;
            }
          });
        });

        const computedLeaderboard = Object.values(playerStatsMap).map(p => {
          const avgDamage     = p.totalMatches > 0 ? Math.round(p.totalDamage / p.totalMatches) : 0;
          const avgAccuracy   = p.accuracyCount > 0 ? Math.round((p.totalAccuracySum / p.accuracyCount) * 100) / 100 : 0;
          const killsPerMatch = p.totalMatches > 0 ? Math.round((p.totalKills / p.totalMatches) * 100) / 100 : 0;
          const killsPerEvent = p.totalEvents > 0 ? Math.round((p.totalKills / p.totalEvents) * 100) / 100 : 0;

          return { ...p, avgDamage, avgAccuracy, killsPerMatch, killsPerEvent };
        });

        computedLeaderboard.sort((a, b) => b.totalKills - a.totalKills);
        setLeaderboard(computedLeaderboard);

        setRawData({
          allPlayers,
          allTeams,
          allTourneys,
          teamMatchResultsByTournament,
          playerMatchResultsByTournament,
          playerStatsMap,
        });

      } catch (err) {
        toast.error('Failed to load rankings: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    loadRankingsData();
  }, []);

  // Compute team global form for the selected category
  const teamFormList = useMemo(() => {
    if (!rawData) return [];
    const { allTeams, allTourneys, teamMatchResultsByTournament } = rawData;

    const rawTeamForm = allTeams.map(t => {
      const gf = computeTeamGlobalForm(t.id, allTourneys, teamMatchResultsByTournament, categoryFilter);
      return {
        ...t,
        globalForm: gf,
      };
    });

    const rankedTeamForms = rawTeamForm.filter(t => t.globalForm.confidence !== 'unranked');
    const fieldAvgTeamForm = rankedTeamForms.length > 0
      ? rankedTeamForms.reduce((sum, t) => sum + (t.globalForm.decayedForm || 0), 0) / rankedTeamForms.length
      : 0;

    const processedTeamForm = rawTeamForm.map(t => {
      const label = globalFormLabel(t.globalForm.decayedForm, t.globalForm.trend, t.globalForm.confidence, fieldAvgTeamForm);
      return { ...t, formLabel: label };
    });

    processedTeamForm.sort((a, b) => {
      if (a.globalForm.confidence === 'unranked' && b.globalForm.confidence !== 'unranked') return 1;
      if (a.globalForm.confidence !== 'unranked' && b.globalForm.confidence === 'unranked') return -1;
      return (b.globalForm.decayedForm || 0) - (a.globalForm.decayedForm || 0);
    });

    return processedTeamForm;
  }, [rawData, categoryFilter]);

  // Compute player global form for the selected category
  const playerFormList = useMemo(() => {
    if (!rawData) return [];
    const { allPlayers, allTourneys, playerMatchResultsByTournament, playerStatsMap } = rawData;

    const rawPlayerForm = allPlayers.map(p => {
      const gf = computePlayerGlobalForm(p.id, allTourneys, playerMatchResultsByTournament, categoryFilter);
      const meta = playerStatsMap[p.id] || {};
      return {
        ...p,
        lastTeam: meta.lastTeam || '—',
        lastClass: meta.lastClass || 'Class 1',
        globalForm: gf,
      };
    });

    const rankedPlayerForms = rawPlayerForm.filter(p => p.globalForm.confidence !== 'unranked');
    const fieldAvgPlayerForm = rankedPlayerForms.length > 0
      ? rankedPlayerForms.reduce((sum, p) => sum + (p.globalForm.decayedForm || 0), 0) / rankedPlayerForms.length
      : 0;

    const processedPlayerForm = rawPlayerForm.map(p => {
      const label = globalFormLabel(p.globalForm.decayedForm, p.globalForm.trend, p.globalForm.confidence, fieldAvgPlayerForm);
      return { ...p, formLabel: label };
    });

    processedPlayerForm.sort((a, b) => {
      if (a.globalForm.confidence === 'unranked' && b.globalForm.confidence !== 'unranked') return 1;
      if (a.globalForm.confidence !== 'unranked' && b.globalForm.confidence === 'unranked') return -1;
      return (b.globalForm.decayedForm || 0) - (a.globalForm.decayedForm || 0);
    });

    return processedPlayerForm;
  }, [rawData, categoryFilter]);

  // Filter career leaderboard
  const filteredRankings = useMemo(() => {
    return leaderboard.filter(p => {
      const q = search.toLowerCase();
      const matchSearch =
        p.professionalName?.toLowerCase().includes(q) ||
        p.ign?.toLowerCase().includes(q) ||
        p.lastTeam?.toLowerCase().includes(q) ||
        p.clanName?.toLowerCase().includes(q);

      const matchRegion = regionFilter ? p.region === regionFilter : true;
      const matchClass  = classFilter ? p.lastClass === classFilter : true;

      return matchSearch && matchRegion && matchClass;
    });
  }, [leaderboard, search, regionFilter, classFilter]);

  // Filter team form list
  const filteredTeamForm = useMemo(() => {
    return teamFormList.filter(t => {
      const q = search.toLowerCase();
      return t.teamName?.toLowerCase().includes(q) || t.clanName?.toLowerCase().includes(q);
    });
  }, [teamFormList, search]);

  // Filter player form list
  const filteredPlayerForm = useMemo(() => {
    return playerFormList.filter(p => {
      const q = search.toLowerCase();
      const matchSearch =
        p.professionalName?.toLowerCase().includes(q) ||
        p.ign?.toLowerCase().includes(q) ||
        p.lastTeam?.toLowerCase().includes(q);

      const matchRegion = regionFilter ? p.region === regionFilter : true;
      const matchClass  = classFilter ? p.lastClass === classFilter : true;

      return matchSearch && matchRegion && matchClass;
    });
  }, [playerFormList, search, regionFilter, classFilter]);

  const regions = Array.from(new Set(leaderboard.map(p => p.region).filter(Boolean)));
  const classes = Array.from(new Set(leaderboard.map(p => p.lastClass).filter(Boolean)));

  // Team Form Export Handlers
  const handleExportTeamFormCSV = () => {
    const targets = selectedTeamIds.length > 0
      ? filteredTeamForm.filter(t => selectedTeamIds.includes(t.id))
      : filteredTeamForm;

    if (targets.length === 0) {
      toast.error('No team form records available to export.');
      return;
    }

    const catLabel = categoryFilter === 'all' ? 'All' : categoryFilter;
    const rows = targets.map((t, idx) => ({
      Rank: t.globalForm.confidence === 'unranked' ? 'Unranked' : idx + 1,
      'Team Name': t.teamName,
      Clan: t.clanName || '—',
      'Dominant Tier': t.rankedTier || 'Unranked',
      Category: catLabel,
      'Global Form Score': t.globalForm.decayedForm ?? '—',
      'Raw Form Score': t.globalForm.rawForm ?? '—',
      'Status Label': t.formLabel,
      Trend: t.globalForm.trend,
      Confidence: t.globalForm.confidence,
      'Matches Used': `${t.globalForm.matchesUsed}/8`,
      'Days Inactive': t.globalForm.daysInactive ?? '—',
      'Last Match Date': t.globalForm.lastMatchDate ? new Date(t.globalForm.lastMatchDate).toLocaleDateString() : '—',
    }));

    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const catSlug = categoryFilter.toLowerCase().replace(/\s+/g, '_');
    a.download = `global_team_form_${catSlug}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${targets.length} team form (${catLabel}) records to CSV`);
  };

  const handleCopyTeamFormSummary = () => {
    const targets = selectedTeamIds.length > 0
      ? filteredTeamForm.filter(t => selectedTeamIds.includes(t.id))
      : filteredTeamForm;

    if (targets.length === 0) {
      toast.error('No team form records available');
      return;
    }

    const catLabel = categoryFilter === 'all' ? 'All Categories' : categoryFilter;
    const lines = targets.map((t, idx) =>
      `#${t.globalForm.confidence === 'unranked' ? '—' : idx + 1} ${t.teamName} | [${catLabel}] Form: ${t.globalForm.decayedForm ?? '—'} (${t.formLabel}) | Trend: ${t.globalForm.trend} | Matches: ${t.globalForm.matchesUsed}/8`
    );
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success(`Copied ${targets.length} team form summaries (${catLabel}) to clipboard`);
  };

  // Player Form Export Handlers
  const handleExportPlayerFormCSV = () => {
    const targets = selectedPlayerIds.length > 0
      ? filteredPlayerForm.filter(p => selectedPlayerIds.includes(p.id))
      : filteredPlayerForm;

    if (targets.length === 0) {
      toast.error('No player form records available to export.');
      return;
    }

    const catLabel = categoryFilter === 'all' ? 'All' : categoryFilter;
    const rows = targets.map((p, idx) => ({
      Rank: p.globalForm.confidence === 'unranked' ? 'Unranked' : idx + 1,
      'Pro Name': p.professionalName,
      IGN: p.ign,
      Team: p.lastTeam,
      'Dominant Tier': p.rankedTier || 'Unranked',
      Class: p.lastClass,
      Category: catLabel,
      'Global Form Score (Kills/Match)': p.globalForm.decayedForm ?? '—',
      'Raw Form Score': p.globalForm.rawForm ?? '—',
      'Status Label': p.formLabel,
      Trend: p.globalForm.trend,
      Confidence: p.globalForm.confidence,
      'Matches Used': `${p.globalForm.matchesUsed}/8`,
      'Days Inactive': p.globalForm.daysInactive ?? '—',
    }));

    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const catSlug = categoryFilter.toLowerCase().replace(/\s+/g, '_');
    a.download = `global_player_form_${catSlug}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${targets.length} player form (${catLabel}) records to CSV`);
  };

  const handleCopyPlayerFormSummary = () => {
    const targets = selectedPlayerIds.length > 0
      ? filteredPlayerForm.filter(p => selectedPlayerIds.includes(p.id))
      : filteredPlayerForm;

    if (targets.length === 0) {
      toast.error('No player form records available');
      return;
    }

    const catLabel = categoryFilter === 'all' ? 'All Categories' : categoryFilter;
    const lines = targets.map((p, idx) =>
      `#${p.globalForm.confidence === 'unranked' ? '—' : idx + 1} ${p.professionalName} (${p.ign}) | [${catLabel}] Form: ${p.globalForm.decayedForm ?? '—'} (${p.formLabel}) | Trend: ${p.globalForm.trend} | Matches: ${p.globalForm.matchesUsed}/8`
    );
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success(`Copied ${targets.length} player form summaries (${catLabel}) to clipboard`);
  };

  const careerColumns = [
    {
      header: 'Rank',
      key: 'rank',
      width: 65,
      render: (row, i) => <RankBadge rank={i + 1} />,
    },
    {
      header: 'Player',
      accessor: 'professionalName',
      render: (row) => (
        <div>
          <Link href={`/players/${row.id}`} className="font-semibold text-text-primary hover:text-gold transition">
            {row.professionalName}
          </Link>
          <div className="text-[10px] text-text-muted">IGN: {row.ign}</div>
        </div>
      ),
    },
    { header: 'Team', accessor: 'lastTeam' },
    { header: 'Clan', accessor: 'clanName' },
    {
      header: 'Class',
      accessor: 'lastClass',
      render: (row) => <ClassBadge playerClass={row.lastClass} />,
    },
    { header: 'Kills', accessor: 'totalKills' },
    { header: 'Matches', accessor: 'totalMatches' },
    { header: 'Kills/Match', accessor: 'killsPerMatch' },
    { header: 'Avg Damage', accessor: 'avgDamage' },
    { header: 'Avg Accuracy', accessor: 'avgAccuracy', render: (row) => <span>{row.avgAccuracy}%</span> },
    {
      header: 'Ranked Tier',
      accessor: 'rankedTier',
      render: (row) => row.rankedTier
        ? <TierBadge tier={row.rankedTier} size="xs" />
        : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>,
    },
    {
      header: 'Ranked Events',
      accessor: 'rankedEventsCount',
      render: (row) => <span style={{ fontWeight: 700, color: row.rankedEventsCount > 0 ? 'var(--gold)' : 'var(--text-muted)' }}>{row.rankedEventsCount || 0}</span>,
    },
  ];

  const renderTrendIcon = (trend) => {
    switch (trend) {
      case 'up':   return <span title="Rising Form" style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 2, fontWeight: 700 }}><TrendingUp size={15} /> Up</span>;
      case 'down': return <span title="Declining Form" style={{ color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: 2, fontWeight: 700 }}><TrendingDown size={15} /> Down</span>;
      case 'flat': return <span title="Steady Form" style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 2 }}><Minus size={15} /> Flat</span>;
      default:     return <span title="New Entry" style={{ color: 'var(--cyan)', display: 'inline-flex', alignItems: 'center', gap: 2 }}><Sparkles size={14} /> New</span>;
    }
  };

  const teamFormColumns = [
    {
      header: () => (
        <input
          type="checkbox"
          checked={filteredTeamForm.length > 0 && selectedTeamIds.length === filteredTeamForm.length}
          onChange={e => {
            if (e.target.checked) setSelectedTeamIds(filteredTeamForm.map(t => t.id));
            else setSelectedTeamIds([]);
          }}
          style={{ accentColor: 'var(--gold)', cursor: 'pointer', width: 15, height: 15 }}
          title="Select / Deselect All Teams"
        />
      ),
      key: 'select',
      width: 40,
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedTeamIds.includes(row.id)}
          onChange={e => {
            if (e.target.checked) setSelectedTeamIds(prev => [...prev, row.id]);
            else setSelectedTeamIds(prev => prev.filter(id => id !== row.id));
          }}
          style={{ accentColor: 'var(--gold)', cursor: 'pointer', width: 15, height: 15 }}
        />
      ),
    },
    {
      header: 'Rank',
      key: 'rank',
      width: 65,
      render: (row, i) => row.globalForm.confidence === 'unranked' ? '—' : <RankBadge rank={i + 1} />,
    },
    {
      header: 'Team',
      accessor: 'teamName',
      render: (row) => (
        <div>
          <Link href={`/teams/${row.id}`} className="font-semibold text-text-primary hover:text-gold transition">
            {row.teamName}
          </Link>
          <div className="text-[10px] text-text-muted">{row.clanName ? `Clan: ${row.clanName}` : ''}</div>
        </div>
      ),
    },
    {
      header: 'Dominant Tier',
      accessor: 'rankedTier',
      render: (row) => row.rankedTier
        ? <TierBadge tier={row.rankedTier} size="xs" />
        : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>,
    },
    {
      header: categoryFilter === 'all' ? 'Global Form (All)' : `Global Form (${categoryFilter})`,
      accessor: 'decayedForm',
      render: (row) => row.globalForm.decayedForm != null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>
            {row.globalForm.decayedForm}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            (raw: {row.globalForm.rawForm})
          </span>
        </div>
      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      header: 'Status Label',
      accessor: 'formLabel',
      render: (row) => (
        <MetricTooltip metricKey={row.formLabel.toLowerCase()}>
          <span className="badge" style={{
            background: row.formLabel === 'Red Hot' ? 'rgba(239, 68, 68, 0.2)' : row.formLabel === 'In Form' ? 'rgba(34, 197, 94, 0.2)' : row.formLabel === 'Cold' ? 'rgba(14, 165, 233, 0.2)' : 'var(--bg-alt-row)',
            color: row.formLabel === 'Red Hot' ? 'var(--danger)' : row.formLabel === 'In Form' ? 'var(--success)' : row.formLabel === 'Cold' ? 'var(--cyan)' : 'var(--text-secondary)',
            border: '1px solid currentColor',
          }}>
            {row.formLabel}
          </span>
        </MetricTooltip>
      ),
    },
    {
      header: 'Trend',
      accessor: 'trend',
      render: (row) => renderTrendIcon(row.globalForm.trend),
    },
    {
      header: 'Confidence',
      accessor: 'confidence',
      render: (row) => (
        <span className="badge" style={{ textTransform: 'capitalize', fontSize: '0.7rem' }}>
          {row.globalForm.confidence}
        </span>
      ),
    },
    {
      header: 'Matches Used',
      accessor: 'matchesUsed',
      render: (row) => <span>{row.globalForm.matchesUsed} / 8</span>,
    },
    {
      header: 'Last Match',
      accessor: 'daysInactive',
      render: (row) => row.globalForm.lastMatchDate ? (
        <span style={{ fontSize: '0.78rem', color: row.globalForm.daysInactive > 7 ? 'var(--warning)' : 'var(--text-secondary)' }}>
          {row.globalForm.daysInactive === 0 ? 'Today' : `${row.globalForm.daysInactive}d ago`}
        </span>
      ) : '—',
    },
  ];

  const playerFormColumns = [
    {
      header: () => (
        <input
          type="checkbox"
          checked={filteredPlayerForm.length > 0 && selectedPlayerIds.length === filteredPlayerForm.length}
          onChange={e => {
            if (e.target.checked) setSelectedPlayerIds(filteredPlayerForm.map(p => p.id));
            else setSelectedPlayerIds([]);
          }}
          style={{ accentColor: 'var(--gold)', cursor: 'pointer', width: 15, height: 15 }}
          title="Select / Deselect All Players"
        />
      ),
      key: 'select',
      width: 40,
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedPlayerIds.includes(row.id)}
          onChange={e => {
            if (e.target.checked) setSelectedPlayerIds(prev => [...prev, row.id]);
            else setSelectedPlayerIds(prev => prev.filter(id => id !== row.id));
          }}
          style={{ accentColor: 'var(--gold)', cursor: 'pointer', width: 15, height: 15 }}
        />
      ),
    },
    {
      header: 'Rank',
      key: 'rank',
      width: 65,
      render: (row, i) => row.globalForm.confidence === 'unranked' ? '—' : <RankBadge rank={i + 1} />,
    },
    {
      header: 'Player',
      accessor: 'professionalName',
      render: (row) => (
        <div>
          <Link href={`/players/${row.id}`} className="font-semibold text-text-primary hover:text-gold transition">
            {row.professionalName}
          </Link>
          <div className="text-[10px] text-text-muted">IGN: {row.ign}</div>
        </div>
      ),
    },
    { header: 'Team', accessor: 'lastTeam' },
    {
      header: 'Dominant Tier',
      accessor: 'rankedTier',
      render: (row) => row.rankedTier
        ? <TierBadge tier={row.rankedTier} size="xs" />
        : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>,
    },
    {
      header: 'Class',
      accessor: 'lastClass',
      render: (row) => <ClassBadge playerClass={row.lastClass} />,
    },
    {
      header: categoryFilter === 'all' ? 'Global Form (All)' : `Global Form (${categoryFilter})`,
      accessor: 'decayedForm',
      render: (row) => row.globalForm.decayedForm != null ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>
            {row.globalForm.decayedForm}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            (raw: {row.globalForm.rawForm})
          </span>
        </div>
      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      header: 'Status Label',
      accessor: 'formLabel',
      render: (row) => (
        <MetricTooltip metricKey={row.formLabel.toLowerCase()}>
          <span className="badge" style={{
            background: row.formLabel === 'Red Hot' ? 'rgba(239, 68, 68, 0.2)' : row.formLabel === 'In Form' ? 'rgba(34, 197, 94, 0.2)' : row.formLabel === 'Cold' ? 'rgba(14, 165, 233, 0.2)' : 'var(--bg-alt-row)',
            color: row.formLabel === 'Red Hot' ? 'var(--danger)' : row.formLabel === 'In Form' ? 'var(--success)' : row.formLabel === 'Cold' ? 'var(--cyan)' : 'var(--text-secondary)',
            border: '1px solid currentColor',
          }}>
            {row.formLabel}
          </span>
        </MetricTooltip>
      ),
    },
    {
      header: 'Trend',
      accessor: 'trend',
      render: (row) => renderTrendIcon(row.globalForm.trend),
    },
    {
      header: 'Confidence',
      accessor: 'confidence',
      render: (row) => (
        <span className="badge" style={{ textTransform: 'capitalize', fontSize: '0.7rem' }}>
          {row.globalForm.confidence}
        </span>
      ),
    },
    {
      header: 'Matches Used',
      accessor: 'matchesUsed',
      render: (row) => <span>{row.globalForm.matchesUsed} / 8</span>,
    },
    {
      header: 'Last Match',
      accessor: 'daysInactive',
      render: (row) => row.globalForm.lastMatchDate ? (
        <span style={{ fontSize: '0.78rem', color: row.globalForm.daysInactive > 7 ? 'var(--warning)' : 'var(--text-secondary)' }}>
          {row.globalForm.daysInactive === 0 ? 'Today' : `${row.globalForm.daysInactive}d ago`}
        </span>
      ) : '—',
    },
  ];

  if (loading) return <LoadingSpinner size="lg" text="Calculating global leaderboards & rolling form..." />;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Global Rankings & Rolling Form</h1>
          <p className="page-subtitle">Cross-tournament career standings and always-current 8-match rolling momentum</p>
        </div>
      </div>

      {/* Main Tab bar */}
      <div className="tab-bar">
        <button
          className={`tab ${activeTab === 'career' ? 'active' : ''}`}
          onClick={() => setActiveTab('career')}
        >
          <Trophy size={15} style={{ display: 'inline', marginRight: 6 }} />
          Career Rankings (Players)
        </button>
        <button
          className={`tab ${activeTab === 'teamForm' ? 'active' : ''}`}
          onClick={() => setActiveTab('teamForm')}
        >
          <Shield size={15} style={{ display: 'inline', marginRight: 6 }} />
          Global Team Form
        </button>
        <button
          className={`tab ${activeTab === 'playerForm' ? 'active' : ''}`}
          onClick={() => setActiveTab('playerForm')}
        >
          <Flame size={15} style={{ display: 'inline', marginRight: 6 }} />
          Global Player Form
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className={activeTab === 'career' ? 'md:col-span-2' : 'md:col-span-1'}>
            <label className="form-label">Search</label>
            <div className="search-input-wrap" style={{ marginTop: 4 }}>
              <Search size={16} className="search-icon" />
              <input
                type="text"
                className="form-input search-input"
                placeholder={activeTab === 'teamForm' ? "Search team or clan..." : "Search name, IGN, team..."}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {activeTab !== 'career' && (
            <div>
              <label className="form-label">Form Category / Tier</label>
              <select
                className="form-input font-medium"
                style={{ marginTop: 4, borderColor: categoryFilter !== 'all' ? 'var(--gold)' : undefined }}
                value={categoryFilter}
                onChange={e => {
                  setCategoryFilter(e.target.value);
                  setSelectedTeamIds([]);
                  setSelectedPlayerIds([]);
                }}
              >
                <option value="all">All Tournaments (Combined)</option>
                <option value="Tier 1">Tier 1 Tournaments Only</option>
                <option value="Tier 2">Tier 2 Tournaments Only</option>
                <option value="Tier 3">Tier 3 Tournaments Only</option>
                <option value="unranked">Unranked Tournaments Only</option>
              </select>
            </div>
          )}

          {activeTab !== 'teamForm' && (
            <>
              <div>
                <label className="form-label">Filter Region</label>
                <select
                  className="form-input"
                  style={{ marginTop: 4 }}
                  value={regionFilter}
                  onChange={e => setRegionFilter(e.target.value)}
                >
                  <option value="">All Regions</option>
                  {regions.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="form-label">Filter Class</label>
                <select
                  className="form-input"
                  style={{ marginTop: 4 }}
                  value={classFilter}
                  onChange={e => setClassFilter(e.target.value)}
                >
                  <option value="">All Classes</option>
                  {classes.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tab 1: Career Player Rankings */}
      {activeTab === 'career' && (
        <div className="card overflow-hidden">
          <DataTable
            columns={careerColumns}
            data={filteredRankings}
            searchable={false}
            emptyMessage="No players found matching your criteria"
            pageSize={50}
          />
        </div>
      )}

      {/* Tab 2: Team Global Form */}
      {activeTab === 'teamForm' && (
        <div className="space-y-4">
          <div className="card" style={{ background: 'rgba(201, 168, 76, 0.06)', border: '1px solid var(--border-gold)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem' }}>
                <MetricTooltip metricKey="global_form">
                  <span style={{ fontWeight: 700, color: 'var(--gold)' }}>
                    Global Form {categoryFilter !== 'all' ? `(${categoryFilter})` : ''}
                  </span>
                </MetricTooltip>
                <button
                  type="button"
                  onClick={() => setShowInfoModal(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: 'rgba(201, 168, 76, 0.25)',
                    color: 'var(--gold)',
                    border: '1px solid var(--border-gold)',
                    fontWeight: 900,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  className="hover:scale-110"
                  title="Click for explicit calculation formula & sample data walkthrough"
                >
                  i
                </button>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Rolling momentum calculated from each team's <strong>last 8 matches</strong> {categoryFilter === 'all' ? 'across all tournaments.' : `in ${categoryFilter} tournaments only.`}
                </span>
              </div>

              {/* Selection & Export Action Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {selectedTeamIds.length > 0 ? `${selectedTeamIds.length} team(s) selected` : `All ${filteredTeamForm.length} team(s)`}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (selectedTeamIds.length === filteredTeamForm.length) setSelectedTeamIds([]);
                    else setSelectedTeamIds(filteredTeamForm.map(t => t.id));
                  }}
                  style={{ fontSize: '0.75rem' }}
                >
                  {selectedTeamIds.length === filteredTeamForm.length ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleExportTeamFormCSV}
                  style={{ fontSize: '0.75rem' }}
                >
                  <Download size={13} /> Export CSV
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleCopyTeamFormSummary}
                  style={{ fontSize: '0.75rem' }}
                >
                  <Copy size={13} /> Copy Summary
                </button>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <DataTable
              columns={teamFormColumns}
              data={filteredTeamForm}
              searchable={false}
              emptyMessage={`No team records found for category "${categoryFilter === 'all' ? 'All' : categoryFilter}"`}
              pageSize={50}
            />
          </div>

          {filteredTeamForm.some(t => t.globalForm.hasUndatedTournaments) && (
            <p style={{ fontSize: '0.75rem', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={13} /> Note: Some teams have history originating from tournaments without explicit start dates. Sorting uses creation timestamps as fallback.
            </p>
          )}
        </div>
      )}

      {/* Tab 3: Player Global Form */}
      {activeTab === 'playerForm' && (
        <div className="space-y-4">
          <div className="card" style={{ background: 'rgba(201, 168, 76, 0.06)', border: '1px solid var(--border-gold)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.85rem' }}>
                <MetricTooltip metricKey="global_form">
                  <span style={{ fontWeight: 700, color: 'var(--gold)' }}>
                    Global Form {categoryFilter !== 'all' ? `(${categoryFilter})` : ''}
                  </span>
                </MetricTooltip>
                <button
                  type="button"
                  onClick={() => setShowInfoModal(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: 'rgba(201, 168, 76, 0.25)',
                    color: 'var(--gold)',
                    border: '1px solid var(--border-gold)',
                    fontWeight: 900,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  className="hover:scale-110"
                  title="Click for explicit calculation formula & sample data walkthrough"
                >
                  i
                </button>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Rolling fragging momentum calculated from each player's <strong>last 8 matches (kills/match)</strong> {categoryFilter === 'all' ? 'across all tournaments.' : `in ${categoryFilter} tournaments only.`}
                </span>
              </div>

              {/* Selection & Export Action Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {selectedPlayerIds.length > 0 ? `${selectedPlayerIds.length} player(s) selected` : `All ${filteredPlayerForm.length} player(s)`}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (selectedPlayerIds.length === filteredPlayerForm.length) setSelectedPlayerIds([]);
                    else setSelectedPlayerIds(filteredPlayerForm.map(p => p.id));
                  }}
                  style={{ fontSize: '0.75rem' }}
                >
                  {selectedPlayerIds.length === filteredPlayerForm.length ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleExportPlayerFormCSV}
                  style={{ fontSize: '0.75rem' }}
                >
                  <Download size={13} /> Export CSV
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleCopyPlayerFormSummary}
                  style={{ fontSize: '0.75rem' }}
                >
                  <Copy size={13} /> Copy Summary
                </button>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <DataTable
              columns={playerFormColumns}
              data={filteredPlayerForm}
              searchable={false}
              emptyMessage={`No player records found for category "${categoryFilter === 'all' ? 'All' : categoryFilter}"`}
              pageSize={50}
            />
          </div>

          {filteredPlayerForm.some(p => p.globalForm.hasUndatedTournaments) && (
            <p style={{ fontSize: '0.75rem', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={13} /> Note: Some players have history originating from tournaments without explicit start dates. Sorting uses creation timestamps as fallback.
            </p>
          )}
        </div>
      )}

      {/* Explicit Calculation & Sample Data Walkthrough Modal */}
      {showInfoModal && (
        <div className="modal-backdrop" onClick={() => setShowInfoModal(false)}>
          <div
            className="modal-box modal-lg"
            onClick={e => e.stopPropagation()}
            style={{
              background: '#0F172A',
              border: '1px solid var(--border-gold)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
            }}
          >
            <div className="modal-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'rgba(201,168,76,0.15)',
                  border: '1px solid var(--border-gold)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--gold)',
                  fontWeight: 900,
                }}>
                  i
                </div>
                <div>
                  <h3 className="modal-title" style={{ fontSize: '1.15rem', color: '#FFFFFF', margin: 0 }}>
                    Global Form Calculation & Worked Sample Walkthrough
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Cross-tournament rolling momentum engine specification
                  </div>
                </div>
              </div>
              <button type="button" className="modal-close" onClick={() => setShowInfoModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 24, fontSize: '0.86rem', color: 'var(--text-primary)' }}>
              {/* Section 1: Core Principles */}
              <div style={{ background: 'rgba(30, 41, 59, 0.6)', padding: 18, borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
                <h4 style={{ fontSize: '0.95rem', color: 'var(--gold)', fontWeight: 800, marginTop: 0, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sparkles size={16} /> 1. Core Mechanics & Formulas
                </h4>
                <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, color: '#CBD5E1' }}>
                  <li><strong>Chronological Ordering</strong>: Matches across tournaments are sorted by event start date (`eventStartDate` or fallback creation timestamp).</li>
                  <li><strong>8-Match Rolling Window</strong>: Evaluates up to the most recent 8 matches (N ≤ 8). Linear weights [1, 2, 3, 4, 5, 6, 7, 8] are assigned (Match 8 = newest).</li>
                  <li><strong>Raw Form Score Formula</strong>:
                    <div style={{ fontFamily: 'var(--font-mono)', background: 'rgba(15, 23, 42, 0.8)', padding: '8px 12px', borderRadius: 6, marginTop: 4, color: 'var(--gold)', fontSize: '0.82rem' }}>
                      Raw Form = Σ (Match Value × Weight) ÷ Σ Weights
                    </div>
                  </li>
                  <li><strong>Inactivity Decay</strong>: 7-day grace period after the last played match. Beyond 7 days, a <strong>4% daily penalty</strong> reduces the Raw Form.
                    <div style={{ fontFamily: 'var(--font-mono)', background: 'rgba(15, 23, 42, 0.8)', padding: '8px 12px', borderRadius: 6, marginTop: 4, color: '#38BDF8', fontSize: '0.82rem' }}>
                      Decayed Form = Raw Form × max(0, 1 - 0.04 × (Days Inactive - 7))
                    </div>
                  </li>
                  <li><strong>Confidence Ratings</strong>: <code>Full</code> (≥8 matches), <code>Provisional</code> (3–7 matches), <code>Unranked</code> (&lt;3 matches).</li>
                </ul>
              </div>

              {/* Section 2: Category / Tier Scoping */}
              <div style={{ background: 'rgba(30, 41, 59, 0.6)', padding: 18, borderRadius: 12, border: '1px solid rgba(255,255,255,0.06)' }}>
                <h4 style={{ fontSize: '0.95rem', color: 'var(--gold)', fontWeight: 800, marginTop: 0, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={16} /> 2. Category & Tier Scoping
                </h4>
                <p style={{ margin: '0 0 8px', color: '#CBD5E1' }}>
                  Global Form can be evaluated across all tournaments or isolated to specific competitive categories:
                </p>
                <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6, color: '#CBD5E1' }}>
                  <li><strong>All Tournaments</strong>: Combines all matches across ranked and unranked tournaments for an overall momentum rating.</li>
                  <li><strong>Tier 1 / Tier 2 / Tier 3</strong>: Evaluates rolling form using only matches from tournaments with that specific ranked tier label.</li>
                  <li><strong>Unranked</strong>: Evaluates rolling form considering only scrims and unranked events.</li>
                </ul>
              </div>

              {/* Section 3: Sample Data Table */}
              <div>
                <h4 style={{ fontSize: '0.95rem', color: 'var(--gold)', fontWeight: 800, marginTop: 0, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BarChart3 size={16} /> 3. Worked Example with Sample Match Data
                </h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                  Here is a step-by-step example for a team with 8 matches played across 3 tournaments:
                </p>

                <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-header)', color: 'var(--text-secondary)' }}>
                        <th style={{ padding: '10px 12px' }}>Match #</th>
                        <th style={{ padding: '10px 12px' }}>Event / Lobby</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center' }}>Points (PPM)</th>
                        <th style={{ padding: '10px 12px', textAlign: 'center' }}>Recency Weight</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right' }}>Weighted Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>1 (Oldest)</td>
                        <td style={{ padding: '8px 12px', color: '#94A3B8' }}>Season 1 - Day 1 Lobby 1</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>10</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>× 1</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>10</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>2</td>
                        <td style={{ padding: '8px 12px', color: '#94A3B8' }}>Season 1 - Day 1 Lobby 2</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>12</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>× 2</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>24</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>3</td>
                        <td style={{ padding: '8px 12px', color: '#94A3B8' }}>Season 1 - Day 2 Lobby 1</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>8</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>× 3</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>24</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>4</td>
                        <td style={{ padding: '8px 12px', color: '#94A3B8' }}>Season 2 - Day 1 Lobby 1</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>15</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>× 4</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>60</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>5</td>
                        <td style={{ padding: '8px 12px', color: '#94A3B8' }}>Season 2 - Day 1 Lobby 2</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>18</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>× 5</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>90</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>6</td>
                        <td style={{ padding: '8px 12px', color: '#94A3B8' }}>Season 3 - Day 1 Lobby 1</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>14</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>× 6</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>84</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700 }}>7</td>
                        <td style={{ padding: '8px 12px', color: '#94A3B8' }}>Season 3 - Day 2 Lobby 1</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>22</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>× 7</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>154</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--gold)', fontWeight: 800 }}>
                        <td style={{ padding: '8px 12px' }}>8 (Latest)</td>
                        <td style={{ padding: '8px 12px' }}>Season 3 - Day 2 Lobby 2</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>25</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>× 8</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>200</td>
                      </tr>
                      <tr style={{ background: 'rgba(201,168,76,0.12)', fontWeight: 900 }}>
                        <td colSpan={3} style={{ padding: '10px 12px', color: '#FFFFFF' }}>Total Sums</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--gold)' }}>36</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>646</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 4: Calculation Walkthrough */}
              <div style={{ background: 'rgba(15, 23, 42, 0.8)', padding: 18, borderRadius: 12, border: '1px solid rgba(201,168,76,0.2)' }}>
                <h4 style={{ fontSize: '0.92rem', color: '#FFFFFF', fontWeight: 800, marginTop: 0, marginBottom: 10 }}>
                  4. Calculation Step-by-Step Output:
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>1. Raw Form</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--gold)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      17.94
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: 2 }}>646 ÷ 36 = 17.94</div>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>2. Days Inactive Penalty</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#38BDF8', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      -12% <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>(0.88×)</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: 2 }}>10 days inactive (3d past 7d grace)</div>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>3. Decayed Global Form</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--gold)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      15.79
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: 2 }}>17.94 × 0.88 = 15.79</div>
                  </div>

                  <div style={{ background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>4. Status & Trend</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--danger)', marginTop: 2 }}>
                      🔥 Red Hot <span style={{ fontSize: '0.8rem', color: 'var(--success)' }}>(↑ Up)</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: 2 }}>Confidence: Full (8/8)</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ padding: '14px 20px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowInfoModal(false)}>
                Close Walkthrough
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
