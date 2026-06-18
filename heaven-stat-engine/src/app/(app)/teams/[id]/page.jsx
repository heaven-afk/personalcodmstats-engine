'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getTeam, updateTeam } from '@/lib/firestore/registry';
import { getTournaments, getTeamRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getBonusPoints } from '@/lib/firestore/matchData';
import { computeTeamRanking } from '@/lib/engine/standings';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import DataTable from '@/components/ui/DataTable';
import { ChevronLeft, Trophy, Shield, Calendar, Star, TrendingUp } from 'lucide-react';
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
        setLogoBase64(t.logo || '');
        setLogoSourceType(t.logo ? 'upload' : t.logoUrl ? 'url' : 'upload');

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

  const [logoSourceType, setLogoSourceType] = useState('upload'); // 'upload' | 'url'
  const [logoUrlInput, setLogoUrlInput] = useState('');
  const [logoBase64, setLogoBase64] = useState('');
  const [updatingLogo, setUpdatingLogo] = useState(false);

  const handleLogoFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoBase64(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveLogo = async () => {
    setUpdatingLogo(true);
    try {
      const updates = {
        logo: logoSourceType === 'upload' ? logoBase64 : '',
        logoUrl: logoSourceType === 'url' ? logoUrlInput.trim() : ''
      };
      await updateTeam(id, updates);
      setTeam(prev => ({ ...prev, ...updates }));
      toast.success('Team logo updated successfully!');
    } catch (err) {
      toast.error('Failed to update team logo: ' + err.message);
    } finally {
      setUpdatingLogo(false);
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

          {/* Team Logo Card */}
          <div className="card">
            <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <Shield size={18} className="text-gold" />
              Team Logo
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: 80,
                height: 80,
                borderRadius: 10,
                background: 'var(--bg-header)',
                border: '2px solid var(--border-gold)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0
              }}>
                {team.logo || team.logoUrl ? (
                  <img src={team.logo || team.logoUrl} alt="Team Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Shield size={36} className="text-gold" />
                )}
              </div>
              
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                  <button 
                    type="button" 
                    className={`btn btn-sm ${logoSourceType === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setLogoSourceType('upload')}
                  >
                    Upload File
                  </button>
                  <button 
                    type="button" 
                    className={`btn btn-sm ${logoSourceType === 'url' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setLogoSourceType('url')}
                  >
                    Logo URL
                  </button>
                </div>

                {logoSourceType === 'upload' ? (
                  <div className="form-field">
                    <label className="form-label text-[10px]">Select Image File</label>
                    <input 
                      key="logo-file-input"
                      type="file" 
                      accept="image/*" 
                      className="form-input" 
                      onChange={handleLogoFileChange}
                    />
                  </div>
                ) : (
                  <div className="form-field">
                    <label className="form-label text-[10px]">Enter Image URL</label>
                    <input 
                      key="logo-url-input"
                      type="text" 
                      className="form-input" 
                      value={logoUrlInput || ''}
                      onChange={(e) => setLogoUrlInput(e.target.value)}
                      placeholder="https://example.com/logo.png"
                    />
                  </div>
                )}

                <button 
                  type="button" 
                  className="btn btn-primary btn-primary-full text-xs py-2"
                  disabled={updatingLogo}
                  onClick={handleSaveLogo}
                >
                  {updatingLogo ? 'Updating...' : 'Save Team Logo'}
                </button>
              </div>
            </div>
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
