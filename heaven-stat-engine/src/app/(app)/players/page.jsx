'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getPlayers, deletePlayer, updatePlayer } from '@/lib/firestore/registry';
import { getTournaments, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getPlayerMatchResults } from '@/lib/firestore/matchData';
import DataTable from '@/components/ui/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { ClassBadge } from '@/components/ui/Badge';
import { Users, Search, ExternalLink, Award, Cpu, Globe, Trash2 } from 'lucide-react';
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

  const handleDeletePlayer = async (id, name) => {
    if (!confirm(`Are you sure you want to delete player "${name}" globally?\n\nThis will permanently delete their profile and stats across ALL tournaments.`)) return;
    try {
      await deletePlayer(id);
      toast.success(`Player "${name}" deleted from registry`);
      setPlayers(prev => prev.filter(p => p.id !== id));
    } catch (e) {
      toast.error('Failed to delete player: ' + e.message);
    }
  };

  const [syncing, setSyncing] = useState(false);

  const handlePurgeAndSync = async () => {
    if (!confirm("Are you sure you want to drop all players from the global registry who are not registered in the MGL Mixed Event, and update the registered players' details to the global registry?")) return;
    setSyncing(true);
    try {
      // 1. Fetch all tournaments to find the Mixed Event
      const allTourneys = await getTournaments();
      const mixedTourney = allTourneys.find(t => 
        t.name?.toLowerCase().includes('mixed') || 
        t.name?.toLowerCase().includes('mgl')
      );
      
      if (!mixedTourney) {
        toast.error("MGL Mixed Event tournament not found in database.");
        setSyncing(false);
        return;
      }
      
      // 2. Fetch all registrations for this tournament
      const registrations = await getPlayerRegistrations(mixedTourney.id);
      const registeredPlayerIds = new Set(
        registrations.map(r => r.playerId).filter(Boolean)
      );
      
      // 3. Drop players not registered in Mixed Event
      let deletedCount = 0;
      for (const player of players) {
        if (!registeredPlayerIds.has(player.id)) {
          await deletePlayer(player.id);
          deletedCount++;
        }
      }
      
      // 4. Update or create global player profiles for registered players
      let updatedCount = 0;
      for (const reg of registrations) {
        if (!reg.playerId) continue;
        
        const fields = {
          professionalName: reg.professionalName || '',
          ign: reg.ign || '',
          gender: reg.gender || '',
          region: reg.region || '',
          country: reg.country || '',
          device: reg.device || '',
          deviceModel: reg.deviceModel || '',
          professionalNameLower: (reg.professionalName || '').toLowerCase().trim(),
          ignLower: (reg.ign || '').toLowerCase().trim(),
        };
        
        await updatePlayer(reg.playerId, fields);
        updatedCount++;
      }
      
      toast.success(`Success! Kept & synced ${updatedCount} players. Purged ${deletedCount} unrelated players.`);
      window.location.reload();
    } catch (e) {
      toast.error("Sync failed: " + e.message);
    } finally {
      setSyncing(false);
    }
  };

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href={`/players/${row.id}`} className="text-text-muted hover:text-gold transition" title="View Profile">
            <ExternalLink size={16} />
          </Link>
          <button
            onClick={() => handleDeletePlayer(row.id, row.professionalName || row.ign)}
            className="text-text-muted hover:text-red-500 transition-colors"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            title="Delete player globally"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner size="lg" text="Loading player database..." />;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Players</h1>
          <p className="page-subtitle">Unified registry of all players across all tournaments</p>
        </div>
        <div>
          <button
            onClick={handlePurgeAndSync}
            disabled={syncing}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {syncing ? 'Syncing...' : 'Sync MGL Mixed Event & Purge Others'}
          </button>
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
