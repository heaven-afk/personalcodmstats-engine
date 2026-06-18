'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTeams } from '@/lib/firestore/registry';
import { getTournaments, getTeamRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getBonusPoints } from '@/lib/firestore/matchData';
import { computeTeamRanking } from '@/lib/engine/standings';
import DataTable from '@/components/ui/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Shield, Search, ExternalLink, Trophy, BarChart2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [clanFilter, setClanFilter] = useState('');

  useEffect(() => {
    async function loadTeamsData() {
      try {
        const [allTeams, allTourneys] = await Promise.all([
          getTeams(),
          getTournaments()
        ]);

        const regsPromises = allTourneys.map(t => getTeamRegistrations(t.id));
        const resPromises = allTourneys.map(t => getTeamMatchResults(t.id));
        const bonusPromises = allTourneys.map(t => getBonusPoints(t.id));

        const allRegs = await Promise.all(regsPromises);
        const allRes = await Promise.all(resPromises);
        const allBonuses = await Promise.all(bonusPromises);

        const teamStatsMap = {};
        allTeams.forEach(t => {
          teamStatsMap[t.id] = {
            ...t,
            careerWins: 0,
            careerTotalPts: 0,
            tournamentsCount: 0,
          };
        });

        allTourneys.forEach((t, index) => {
          const tRegs = allRegs[index];
          const tRes = allRes[index];
          const tBonuses = allBonuses[index];

          // Compute standings for this tournament to get official points and wins
          const ranking = computeTeamRanking(tRes, tBonuses, t.scoring || {});

          // Map rankings
          ranking.forEach(tr => {
            const teamReg = tRegs.find(r => r.teamId === tr.teamId);
            if (teamReg) {
              const tid = teamReg.teamId;
              if (teamStatsMap[tid]) {
                teamStatsMap[tid].careerWins += tr.wins || 0;
                teamStatsMap[tid].careerTotalPts += tr.totalPts || 0;
                teamStatsMap[tid].tournamentsCount += 1;
              }
            }
          });
        });

        setTeams(Object.values(teamStatsMap));
      } catch (err) {
        toast.error('Failed to load teams: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    loadTeamsData();
  }, []);

  const filteredTeams = teams.filter(t => {
    const q = search.toLowerCase();
    const matchSearch =
      t.teamName?.toLowerCase().includes(q) ||
      t.clanName?.toLowerCase().includes(q);

    const matchClan = clanFilter ? t.clanName === clanFilter : true;

    return matchSearch && matchClan;
  });

  const clans = Array.from(new Set(teams.map(t => t.clanName).filter(Boolean)));

  const columns = [
    {
      header: 'Team Name',
      accessor: 'teamName',
      render: (row) => {
        const logoSrc = row.logo || row.logoUrl;
        return (
          <Link href={`/teams/${row.id}`} className="font-semibold text-text-primary hover:text-gold transition">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {logoSrc ? (
                <img src={logoSrc} alt="" className="team-logo-thumbnail" width={20} height={20} />
              ) : (
                <Shield size={16} className="text-gold flex-shrink-0" />
              )}
              <span>{row.teamName}</span>
            </div>
          </Link>
        );
      },
    },
    { header: 'Clan', accessor: 'clanName' },
    { header: 'Tournaments Played', accessor: 'tournamentsCount' },
    { header: 'Career Wins', accessor: 'careerWins' },
    { header: 'Career Points', accessor: 'careerTotalPts' },
    {
      header: 'Actions',
      key: 'actions',
      render: (row) => (
        <Link href={`/teams/${row.id}`} className="text-text-muted hover:text-gold transition">
          <ExternalLink size={16} />
        </Link>
      ),
    },
  ];

  if (loading) return <LoadingSpinner size="lg" text="Loading teams registry..." />;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Teams</h1>
          <p className="page-subtitle">Unified registry of all teams across all tournaments</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="form-label">Search Teams</label>
            <div className="search-input-wrap" style={{ marginTop: 4 }}>
              <Search size={16} className="search-icon" />
              <input
                type="text"
                className="form-input search-input"
                placeholder="Search team name or clan..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="form-label">Filter Clan</label>
            <select
              className="form-input"
              style={{ marginTop: 4 }}
              value={clanFilter}
              onChange={e => setClanFilter(e.target.value)}
            >
              <option value="">All Clans</option>
              {clans.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Teams Table */}
      <div className="card overflow-hidden">
        <DataTable
          columns={columns}
          data={filteredTeams}
          searchable={false}
          emptyMessage="No teams found matching your criteria"
          pageSize={20}
        />
      </div>
    </div>
  );
}
