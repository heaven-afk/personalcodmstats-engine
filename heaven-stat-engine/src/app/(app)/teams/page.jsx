'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTeams } from '@/lib/firestore/registry';
import { getTournaments, getTeamRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getBonusPoints } from '@/lib/firestore/matchData';
import { computeTeamRanking } from '@/lib/engine/standings';
import DataTable from '@/components/ui/DataTable';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Shield, Search, ExternalLink, Trophy, BarChart2, Combine } from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import { mergeTeams } from '@/lib/firestore/merge';
import { scanForDuplicates } from '@/lib/utils/similarity';
import { cleanImageUrl } from '@/lib/utils/image';

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [clanFilter, setClanFilter] = useState('');

  // Merge states
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');

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

        const ranking = computeTeamRanking(tRes, tBonuses, t.scoring || {});

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
      setReloading(false);
    }
  }

  useEffect(() => {
    loadTeamsData();
  }, []);

  // Scan for duplicate pairs Reactively
  const duplicatePairs = scanForDuplicates(teams, 0.75);

  const handleOpenMergeWith = (t1, t2) => {
    if ((t1.tournamentsCount || 0) >= (t2.tournamentsCount || 0)) {
      setMergeSource(t2.id);
      setMergeTarget(t1.id);
    } else {
      setMergeSource(t1.id);
      setMergeTarget(t2.id);
    }
    setMergeModalOpen(true);
  };

  const sourceTeamObj = teams.find(t => t.id === mergeSource);
  const targetTeamObj = teams.find(t => t.id === mergeTarget);

  const handleExecuteMerge = async () => {
    if (!mergeSource || !mergeTarget) {
      toast.error('Select both source and target teams');
      return;
    }
    if (mergeSource === mergeTarget) {
      toast.error('Cannot merge a team into itself');
      return;
    }
    if (!confirm(`Are you sure you want to merge "${sourceTeamObj?.teamName}" into "${targetTeamObj?.teamName}"?\nThis will update all match history, registrations, and players, and permanently delete "${sourceTeamObj?.teamName}".`)) {
      return;
    }

    setReloading(true);
    try {
      await mergeTeams(mergeSource, mergeTarget);
      toast.success('Teams merged successfully!');
      setMergeModalOpen(false);
      setMergeSource('');
      setMergeTarget('');
      await loadTeamsData();
    } catch (err) {
      toast.error('Merge failed: ' + err.message);
      setReloading(false);
    }
  };

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
        const logoSrc = cleanImageUrl(row.logo || row.logoUrl);
        return (
          <Link href={`/teams/${row.id}`} className="font-semibold text-text-primary hover:text-gold transition">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {logoSrc ? (
                <img src={logoSrc} alt="" className="team-logo-thumbnail" width={20} height={20} referrerPolicy="no-referrer" />
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
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Teams</h1>
          <p className="page-subtitle">Unified registry of all teams across all tournaments</p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={() => setMergeModalOpen(true)}
        >
          <Combine size={14} /> Merge Teams
        </button>
      </div>

      {/* Potential Duplicates Scanner Alert */}
      {duplicatePairs.length > 0 && (
        <div className="card" style={{ border: '1px solid var(--border-gold)', background: 'rgba(201,168,76,0.02)', padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Combine size={18} style={{ color: 'var(--gold)' }} />
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              Potential Duplicate Teams Detected
            </h3>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            The following teams in the registry have very similar names and might be spelling errors or duplicates.
            Use the Merge tool to consolidate them:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {duplicatePairs.map((pair, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-alt-row)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.85rem' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{pair.team1.teamName}</span>
                  <span style={{ color: 'var(--text-muted)' }}>and</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{pair.team2.teamName}</span>
                  <span className="badge badge-secondary" style={{ fontSize: '0.7rem' }}>
                    Match: {Math.round(pair.similarity * 100)}%
                  </span>
                </div>
                <button
                  className="btn btn-secondary btn-xs"
                  onClick={() => handleOpenMergeWith(pair.team1, pair.team2)}
                >
                  Merge Teams
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Merge Teams Modal */}
      {mergeModalOpen && (
        <Modal title="Merge Duplicate Teams" onClose={() => setMergeModalOpen(false)} size="md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Consolidate duplicate team records. All tournament registrations, player registrations,
              match results, and bonus points from the <strong>Source Team</strong> will be merged into the <strong>Canonical Team</strong>.
              The Source Team will then be permanently deleted.
            </p>

            <div className="form-field">
              <label className="form-label">Source Team (Duplicate to delete)</label>
              <select
                className="form-input"
                style={{ marginTop: 4 }}
                value={mergeSource}
                onChange={e => setMergeSource(e.target.value)}
              >
                <option value="">-- Select Source Team --</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.teamName} {t.clanName ? `(Clan: ${t.clanName})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">Canonical Team (To keep and consolidate under)</label>
              <select
                className="form-input"
                style={{ marginTop: 4 }}
                value={mergeTarget}
                onChange={e => setMergeTarget(e.target.value)}
              >
                <option value="">-- Select Canonical Team --</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id} disabled={t.id === mergeSource}>
                    {t.teamName} {t.clanName ? `(Clan: ${t.clanName})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {sourceTeamObj && targetTeamObj && (
              <div style={{ padding: 14, background: 'rgba(201,168,76,0.03)', border: '1px solid var(--border-gold)', borderRadius: 8 }}>
                <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--gold)', marginBottom: 8 }}>
                  Merge Comparison & Preview
                </div>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div style={{ borderRight: '1px solid var(--border)', paddingRight: 8 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                      ❌ Source (will be deleted):
                    </div>
                    <div>Name: <strong>{sourceTeamObj.teamName}</strong></div>
                    <div>Clan: {sourceTeamObj.clanName || '—'}</div>
                    <div>Tournaments: {sourceTeamObj.tournamentsCount || 0}</div>
                    <div>Total Pts: {sourceTeamObj.careerTotalPts || 0}</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                      ✓ Target (will be kept):
                    </div>
                    <div>Name: <strong>{targetTeamObj.teamName}</strong></div>
                    <div>Clan: {targetTeamObj.clanName || sourceTeamObj.clanName || '—'}</div>
                    <div>Tournaments: {targetTeamObj.tournamentsCount || 0}</div>
                    <div>Total Pts: {targetTeamObj.careerTotalPts || 0}</div>
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  ℹ️ <strong>Resulting team:</strong> "{targetTeamObj.teamName}" will gain all data from "{sourceTeamObj.teamName}" and will represent {Array.from(new Set([...(sourceTeamObj.tournamentIds || []), ...(targetTeamObj.tournamentIds || [])])).length} total tournaments.
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setMergeModalOpen(false)}
                disabled={reloading}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleExecuteMerge}
                disabled={reloading || !mergeSource || !mergeTarget || mergeSource === mergeTarget}
              >
                {reloading ? 'Merging...' : 'Confirm & Merge Teams'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
