'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getPlayers } from '@/lib/firestore/registry';
import { getTournaments, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getPlayerMatchResults } from '@/lib/firestore/matchData';
import DataTable from '@/components/ui/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { ClassBadge } from '@/components/ui/Badge';
import { Users, Search, ExternalLink, Award, Cpu, Globe } from 'lucide-react';
import toast from 'react-hot-toast';

export default function PlayersPage() {
  const [players, setPlayers] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');

  useEffect(() => {
    async function loadPlayersData() {
      try {
        const [allPlayers, allTourneys] = await Promise.all([
          getPlayers(),
          getTournaments(),
        ]);
        setTournaments(allTourneys);

        // Fetch match data for all tournaments to aggregate career stats dynamically
        const resultsPromises = allTourneys.map(t => getPlayerMatchResults(t.id));
        const regsPromises = allTourneys.map(t => getPlayerRegistrations(t.id));
        
        const allResults = await Promise.all(resultsPromises);
        const allRegs = await Promise.all(regsPromises);

        // Aggregate stats
        const playerStatsMap = {};
        allPlayers.forEach(p => {
          playerStatsMap[p.id] = {
            ...p,
            careerKills: 0,
            careerMatches: 0,
            tournamentsCount: 0,
            lastClass: 'Class 1',
          };
        });

        allTourneys.forEach((t, index) => {
          const tResults = allResults[index];
          const tRegs = allRegs[index];

          // Map registrations for this tournament
          const regMap = {};
          tRegs.forEach(r => {
            regMap[r.playerId] = r;
          });

          // Accumulate kills & matches
          tResults.forEach(res => {
            const pid = res.playerId;
            if (playerStatsMap[pid]) {
              playerStatsMap[pid].careerKills += res.kills || 0;
              playerStatsMap[pid].careerMatches += 1;
            }
          });

          // Increment tournament count
          tRegs.forEach(r => {
            const pid = r.playerId;
            if (playerStatsMap[pid]) {
              playerStatsMap[pid].tournamentsCount += 1;
              if (r.class) {
                playerStatsMap[pid].lastClass = r.class;
              }
            }
          });
        });

        setPlayers(Object.values(playerStatsMap));
      } catch (err) {
        toast.error('Failed to load players: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    loadPlayersData();
  }, []);

  // Filter players
  const filteredPlayers = players.filter(p => {
    const q = search.toLowerCase();
    const matchSearch = 
      p.professionalName?.toLowerCase().includes(q) ||
      p.ign?.toLowerCase().includes(q) ||
      p.device?.toLowerCase().includes(q) ||
      p.deviceModel?.toLowerCase().includes(q);
      
    const matchRegion = regionFilter ? p.region === regionFilter : true;
    const matchClass = classFilter ? p.lastClass === classFilter : true;

    return matchSearch && matchRegion && matchClass;
  });

  const regions = Array.from(new Set(players.map(p => p.region).filter(Boolean)));
  const classes = Array.from(new Set(players.map(p => p.lastClass).filter(Boolean)));

  const columns = [
    {
      header: 'Professional Name',
      accessor: 'professionalName',
      render: (row) => (
        <Link href={`/players/${row.id}`} className="font-semibold text-text-primary hover:text-gold transition">
          {row.professionalName || '—'}
        </Link>
      ),
    },
    { header: 'IGN', accessor: 'ign' },
    {
      header: 'Class',
      accessor: 'lastClass',
      render: (row) => <ClassBadge playerClass={row.lastClass} />,
    },
    { header: 'Region', accessor: 'region' },
    { header: 'Country', accessor: 'country' },
    { header: 'Device', accessor: 'device' },
    { header: 'Tournaments', accessor: 'tournamentsCount' },
    { header: 'Career Kills', accessor: 'careerKills' },
    { header: 'Matches', accessor: 'careerMatches' },
    {
      header: 'Actions',
      key: 'actions',
      render: (row) => (
        <Link href={`/players/${row.id}`} className="text-text-muted hover:text-gold transition">
          <ExternalLink size={16} />
        </Link>
      ),
    },
  ];

  if (loading) return <LoadingSpinner size="lg" text="Loading player database..." />;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Players</h1>
          <p className="page-subtitle">Unified registry of all players across all tournaments</p>
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
                placeholder="Search name, IGN, device..."
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

      {/* Players Table */}
      <div className="card overflow-hidden">
        <DataTable
          columns={columns}
          data={filteredPlayers}
          searchable={false}
          emptyMessage="No players found matching your criteria"
          pageSize={20}
        />
      </div>
    </div>
  );
}
