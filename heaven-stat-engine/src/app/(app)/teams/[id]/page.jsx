'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTeam, updateTeam } from '@/lib/firestore/registry';
import { getTournaments, getTeamRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getBonusPoints } from '@/lib/firestore/matchData';
import { computeTeamRanking } from '@/lib/engine/standings';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import DataTable from '@/components/ui/DataTable';
import { ChevronLeft, Trophy, Shield, Star, Link2, Image as ImageIcon } from 'lucide-react';
import toast from 'react-hot-toast';

export default function TeamProfilePage() {
  const { id } = useParams();
  const router = useRouter();

  const [team, setTeam] = useState(null);
  const [history, setHistory] = useState([]);
  const [careerStats, setCareerStats] = useState({
    wins: 0,
    matches: 0,
    tournaments: 0,
    placementPts: 0,
    killPts: 0,
    bonusPts: 0,
    totalPts: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTeamProfile() {
      try {
        const t = await getTeam(id);
        if (!t) {
          toast.error('Team not found');
          router.push('/teams');
          return;
        }
        setTeam(t);
        setLogoUrlInput(t.logoUrl || '');
        setBannerUrlInput(t.bannerUrl || '');

        const allTourneys = await getTournaments();

        const tRegsPromises = allTourneys.map(t => getTeamRegistrations(t.id));
        const tResPromises = allTourneys.map(t => getTeamMatchResults(t.id));
        const tBonusPromises = allTourneys.map(t => getBonusPoints(t.id));

        const allRegs = await Promise.all(tRegsPromises);
        const allRes = await Promise.all(tResPromises);
        const allBonuses = await Promise.all(tBonusPromises);

        const participationHistory = [];
        let totalWins = 0;
        let totalMatches = 0;
        let totalPlacePts = 0;
        let totalKillPts = 0;
        let totalBonusPts = 0;
        let totalPts = 0;

        allTourneys.forEach((tourney, i) => {
          const regs = allRegs[i];
          const res = allRes[i];
          const bonuses = allBonuses[i];

          // Check if team registered in this tournament
          const reg = regs.find(r => r.teamId === id);
          if (reg) {
            // Compute standings for this tournament to extract team's specific row
            const ranking = computeTeamRanking(res, bonuses, tourney.scoring || {});
            const teamRankRow = ranking.find(tr => tr.teamId === id);

            if (teamRankRow) {
              totalWins += teamRankRow.wins || 0;
              totalMatches += teamRankRow.matches || 0;
              totalPlacePts += teamRankRow.placementPts || 0;
              totalKillPts += teamRankRow.killPts || 0;
              totalBonusPts += teamRankRow.bonusPts || 0;
              totalPts += teamRankRow.totalPts || 0;

              participationHistory.push({
                id: tourney.id,
                name: tourney.name,
                season: tourney.season,
                status: tourney.status,
                rank: teamRankRow.rank || '—',
                wins: teamRankRow.wins || 0,
                matches: teamRankRow.matches || 0,
                placementPts: teamRankRow.placementPts || 0,
                killPts: teamRankRow.killPts || 0,
                bonusPts: teamRankRow.bonusPts || 0,
                totalPts: teamRankRow.totalPts || 0,
              });
            }
          }
        });

        setHistory(participationHistory);
        setCareerStats({
          wins: totalWins,
          matches: totalMatches,
          tournaments: participationHistory.length,
          placementPts: totalPlacePts,
          killPts: totalKillPts,
          bonusPts: totalBonusPts,
          totalPts: totalPts,
        });

      } catch (err) {
        toast.error('Error loading team profile: ' + err.message);
      } finally {
        setLoading(false);
      }
    }

    loadTeamProfile();
  }, [id, router]);

  const [logoUrlInput, setLogoUrlInput] = useState('');
  const [bannerUrlInput, setBannerUrlInput] = useState('');
  const [updatingImages, setUpdatingImages] = useState(false);

  const handleSaveImages = async () => {
    setUpdatingImages(true);
    try {
      const updates = {
        logoUrl: logoUrlInput.trim(),
        bannerUrl: bannerUrlInput.trim(),
        logo: '', // Clear old base64 logo so the logoUrl is prioritized globally
      };
      await updateTeam(id, updates);
      setTeam(prev => ({ 
        ...prev, 
        logoUrl: updates.logoUrl,
        bannerUrl: updates.bannerUrl,
        logo: ''
      }));
      toast.success('Team images updated successfully!');
    } catch (err) {
      toast.error('Failed to update team images: ' + err.message);
    } finally {
      setUpdatingImages(false);
    }
  };

  if (loading) return <LoadingSpinner size="lg" text="Loading team profile..." />;
  if (!team) return null;

  const historyColumns = [
    {
      header: 'Tournament',
      accessor: 'name',
      render: (row) => (
        <Link href={`/tournaments/${row.id}`} className="font-semibold text-text-primary hover:text-gold transition">
          {row.name}
        </Link>
      ),
    },
    { header: 'Season', accessor: 'season' },
    { header: 'Final Rank', accessor: 'rank', render: (row) => <span className="font-bold text-gold">#{row.rank}</span> },
    { header: 'Wins', accessor: 'wins' },
    { header: 'Matches', accessor: 'matches' },
    { header: 'Place Pts', accessor: 'placementPts' },
    { header: 'Kill Pts', accessor: 'killPts' },
    { header: 'Bonus Pts', accessor: 'bonusPts' },
    { header: 'Total Pts', accessor: 'totalPts', render: (row) => <span className="font-bold text-text-primary">{row.totalPts}</span> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-sm p-2" onClick={() => router.push('/teams')}>
            <ChevronLeft size={16} />
          </button>
          <div>
            <h1 className="page-title">{team.teamName}</h1>
            <p className="page-subtitle">Clan: {team.clanName || 'No Clan'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Identity & Career Summary */}
        <div className="space-y-6">
          {/* Identity Card */}
          <div className="card">
            <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <Shield size={18} className="text-gold" />
              Team Details
            </h2>
            <div className="space-y-3.5 text-sm">
              <div className="flex-between">
                <span className="text-text-muted">Team Name</span>
                <span className="font-semibold text-text-primary">{team.teamName}</span>
              </div>
              <div className="flex-between">
                <span className="text-text-muted">Clan Name</span>
                <span className="font-semibold text-text-primary">{team.clanName || '—'}</span>
              </div>
              <div className="flex-between">
                <span className="text-text-muted">Registered Date</span>
                <span className="font-semibold text-text-primary">
                  {team.createdAt ? (
                    typeof team.createdAt.toDate === 'function'
                      ? team.createdAt.toDate().toLocaleDateString()
                      : new Date(team.createdAt).toLocaleDateString()
                  ) : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Team Logo & Banner Card */}
          <div className="card">
            <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <ImageIcon size={18} className="text-gold" />
              Team Images
            </h2>

            {/* Logo */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Logo</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 10, flexShrink: 0,
                  background: 'var(--bg-header)', border: '2px solid var(--border-gold)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  {logoUrlInput || team.logo ? (
                    <img src={logoUrlInput || team.logo} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Shield size={28} style={{ color: 'var(--gold)' }} />
                  )}
                </div>
                <div style={{ flex: 1 }} className="form-field">
                  <label className="form-label text-[10px] mb-1">Logo Image URL</label>
                  <input
                    type="text"
                    className="form-input text-xs"
                    style={{ padding: '6px 10px', height: 'auto' }}
                    value={logoUrlInput}
                    onChange={(e) => setLogoUrlInput(e.target.value)}
                    placeholder="https://i.imgur.com/...png"
                  />
                </div>
              </div>
            </div>

            {/* Banner */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Banner</div>
              <div style={{
                width: '100%', height: 85, borderRadius: 8, overflow: 'hidden',
                background: 'var(--bg-header)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 10, position: 'relative',
              }}>
                {bannerUrlInput ? (
                  <img src={bannerUrlInput} alt="Banner" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No banner set</span>
                )}
              </div>
              <div className="form-field">
                <label className="form-label text-[10px] mb-1">Banner Image URL</label>
                <input
                  type="text"
                  className="form-input text-xs"
                  style={{ padding: '6px 10px', height: 'auto' }}
                  value={bannerUrlInput}
                  onChange={(e) => setBannerUrlInput(e.target.value)}
                  placeholder="https://i.imgur.com/...png"
                />
              </div>
            </div>

            {/* Guide Info Box */}
            <div style={{
              padding: '10px 12px',
              background: 'rgba(212, 175, 55, 0.05)',
              border: '1px dashed rgba(212, 175, 55, 0.25)',
              borderRadius: '6px',
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              marginBottom: 16,
              lineHeight: '1.4',
            }}>
              💡 <strong>Tip:</strong> Upload your logo and banner files to <a href="https://imgur.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)', textDecoration: 'underline' }}>imgur.com</a> or another host, and paste the <strong>Direct Link</strong> (must end in .png, .jpg, or .webp) here.
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={updatingImages || (logoUrlInput.trim() === (team.logoUrl || '') && bannerUrlInput.trim() === (team.bannerUrl || ''))}
              onClick={handleSaveImages}
            >
              {updatingImages ? 'Saving Images...' : 'Save Team Images'}
            </button>
          </div>

          {/* Career Stats */}
          <div className="card">
            <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <Star size={18} className="text-gold fill-gold" />
              Career Summary
            </h2>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Total Points</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.totalPts}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Lobby Wins</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.wins}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Matches</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.matches}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Tournaments</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.tournaments}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Place Pts</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.placementPts}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Kill Pts</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.killPts}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tournament Participation History */}
        <div className="lg:col-span-2">
          <div className="card h-full">
            <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <Trophy size={18} className="text-cyan" />
              Tournament History
            </h2>
            <DataTable
              columns={historyColumns}
              data={history}
              searchable={false}
              emptyMessage="No tournament participation recorded for this team"
              pageSize={10}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
