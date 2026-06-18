'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getPlayers } from '@/lib/firestore/registry';
import { getTournaments, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getPlayerMatchResults } from '@/lib/firestore/matchData';
import { ClassBadge, RankBadge } from '@/components/ui/Badge';
import DataTable from '@/components/ui/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { BarChart3, Search, Star, Trophy, Users, Shield } from 'lucide-react';
import toast from 'react-hot-toast';

export default function RankingsPage() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');

  useEffect(() => {
    async function loadRankingsData() {
      try {
        const [allPlayers, allTourneys] = await Promise.all([
          getPlayers(),
          getTournaments()
        ]);

        const regsPromises = allTourneys.map(t => getPlayerRegistrations(t.id));
        const resPromises = allTourneys.map(t => getPlayerMatchResults(t.id));

        const allRegs = await Promise.all(regsPromises);
        const allRes = await Promise.all(resPromises);

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
            totalKills: 0,
            totalMatches: 0,
            totalEvents: 0,
            totalDamage: 0,
            totalAccuracySum: 0,
            accuracyCount: 0,
          };
        });

        allTourneys.forEach((t, index) => {
          const tRegs = allRegs[index];
          const tRes = allRes[index];

          // Map registrations for player id
          const regMap = {};
          tRegs.forEach(r => {
            regMap[r.playerId] = r;
          });

          // Accumulate stats
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

          // Record tournament participation
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

        // Compute averages
        const computedLeaderboard = Object.values(playerStatsMap).map(p => {
          const avgDamage = p.totalMatches > 0 ? Math.round(p.totalDamage / p.totalMatches) : 0;
          const avgAccuracy = p.accuracyCount > 0 ? Math.round((p.totalAccuracySum / p.accuracyCount) * 100) / 100 : 0;
          const killsPerMatch = p.totalMatches > 0 ? Math.round((p.totalKills / p.totalMatches) * 100) / 100 : 0;
          const killsPerEvent = p.totalEvents > 0 ? Math.round((p.totalKills / p.totalEvents) * 100) / 100 : 0;

          return {
            ...p,
            avgDamage,
            avgAccuracy,
            killsPerMatch,
            killsPerEvent,
          };
        });

        // Sort by total kills descending as default
        computedLeaderboard.sort((a, b) => b.totalKills - a.totalKills);

        setLeaderboard(computedLeaderboard);
      } catch (err) {
        toast.error('Failed to load rankings: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    loadRankingsData();
  }, []);

  // Filter leaderboard
  const filteredRankings = leaderboard.filter(p => {
    const q = search.toLowerCase();
    const matchSearch =
      p.professionalName?.toLowerCase().includes(q) ||
      p.ign?.toLowerCase().includes(q) ||
      p.lastTeam?.toLowerCase().includes(q) ||
      p.clanName?.toLowerCase().includes(q);

    const matchRegion = regionFilter ? p.region === regionFilter : true;
    const matchClass = classFilter ? p.lastClass === classFilter : true;

    return matchSearch && matchRegion && matchClass;
  });

  const regions = Array.from(new Set(leaderboard.map(p => p.region).filter(Boolean)));
  const classes = Array.from(new Set(leaderboard.map(p => p.lastClass).filter(Boolean)));

  const columns = [
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
  ];

  if (loading) return <LoadingSpinner size="lg" text="Calculating global player rankings..." />;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Global Rankings</h1>
          <p className="page-subtitle">Cross-tournament player leaderboard compiled from all historical data</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="form-label">Search Players</label>
            <div className="search-input-wrap" style={{ marginTop: 4 }}>
              <Search size={16} className="search-icon" />
              <input
                type="text"
                className="form-input search-input"
                placeholder="Search name, IGN, team..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

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
        </div>
      </div>

      {/* Rankings Leaderboard */}
      <div className="card overflow-hidden">
        <DataTable
          columns={columns}
          data={filteredRankings}
          searchable={false}
          emptyMessage="No players found matching your criteria"
          pageSize={50}
        />
      </div>
    </div>
  );
}
