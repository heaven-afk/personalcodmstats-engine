'use client';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getPlayer } from '@/lib/firestore/registry';
import { getTournaments, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getPlayerMatchResults } from '@/lib/firestore/matchData';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import DataTable from '@/components/ui/DataTable';
import { ClassBadge } from '@/components/ui/Badge';
import { ChevronLeft, User, Trophy, Calendar, Cpu, Award, Star } from 'lucide-react';
import toast from 'react-hot-toast';

export default function PlayerProfilePage() {
  const { id } = useParams();
  const router = useRouter();

  const [player, setPlayer] = useState(null);
  const [history, setHistory] = useState([]);
  const [careerStats, setCareerStats] = useState({
    kills: 0,
    matches: 0,
    tournaments: 0,
    killsPerMatch: 0,
    avgDamage: 0,
    avgAccuracy: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPlayerProfile() {
      try {
        const p = await getPlayer(id);
        if (!p) {
          toast.error('Player not found');
          router.push('/players');
          return;
        }
        setPlayer(p);

        // Fetch tournament data
        const allTourneys = await getTournaments();

        const tRegsPromises = allTourneys.map(t => getPlayerRegistrations(t.id));
        const tResPromises = allTourneys.map(t => getPlayerMatchResults(t.id));

        const allRegs = await Promise.all(tRegsPromises);
        const allRes = await Promise.all(tResPromises);

        const participationHistory = [];
        let totalKills = 0;
        let totalMatches = 0;
        let totalDamage = 0;
        let totalAccSum = 0;
        let totalAccCount = 0;

        allTourneys.forEach((t, i) => {
          const regs = allRegs[i];
          const res = allRes[i];

          // Check if player registered
          const reg = regs.find(r => r.playerId === id);
          if (reg) {
            // Find matches
            const playerMatches = res.filter(r => r.playerId === id);
            const tKills = playerMatches.reduce((sum, m) => sum + (m.kills || 0), 0);
            const tMatches = playerMatches.length;
            const tDamage = playerMatches.reduce((sum, m) => sum + (m.damage || 0), 0);
            const validAcc = playerMatches.filter(m => m.accuracy != null && m.accuracy > 0);
            const tAccAvg = validAcc.length > 0 ? (validAcc.reduce((sum, m) => sum + m.accuracy, 0) / validAcc.length) : 0;

            totalKills += tKills;
            totalMatches += tMatches;
            totalDamage += tDamage;
            if (tAccAvg > 0) {
              totalAccSum += tAccAvg;
              totalAccCount++;
            }

            participationHistory.push({
              id: t.id,
              name: t.name,
              season: t.season,
              status: t.status,
              teamName: reg.teamName || '—',
              class: reg.class || 'Class 1',
              ign: reg.ign || p.ign,
              kills: tKills,
              matches: tMatches,
              killsPerMatch: tMatches > 0 ? Math.round((tKills / tMatches) * 100) / 100 : 0,
              avgDamage: tMatches > 0 ? Math.round(tDamage / tMatches) : 0,
              avgAccuracy: tAccAvg,
            });
          }
        });

        setHistory(participationHistory);
        setCareerStats({
          kills: totalKills,
          matches: totalMatches,
          tournaments: participationHistory.length,
          killsPerMatch: totalMatches > 0 ? Math.round((totalKills / totalMatches) * 100) / 100 : 0,
          avgDamage: totalMatches > 0 ? Math.round(totalDamage / totalMatches) : 0,
          avgAccuracy: totalAccCount > 0 ? Math.round((totalAccSum / totalAccCount) * 100) / 100 : 0,
        });

      } catch (err) {
        toast.error('Error loading profile: ' + err.message);
      } finally {
        setLoading(false);
      }
    }

    loadPlayerProfile();
  }, [id, router]);

  if (loading) return <LoadingSpinner size="lg" text="Loading player profile..." />;
  if (!player) return null;

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
    { header: 'IGN', accessor: 'ign' },
    { header: 'Team', accessor: 'teamName' },
    {
      header: 'Class',
      accessor: 'class',
      render: (row) => <ClassBadge playerClass={row.class} />,
    },
    { header: 'Kills', accessor: 'kills' },
    { header: 'Matches', accessor: 'matches' },
    { header: 'Kills/Match', accessor: 'killsPerMatch' },
    { header: 'Avg Damage', accessor: 'avgDamage' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-sm p-2" onClick={() => router.push('/players')}>
            <ChevronLeft size={16} />
          </button>
          <div>
            <h1 className="page-title">{player.professionalName}</h1>
            <p className="page-subtitle">IGN: {player.ign || '—'} · Region: {player.region || '—'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Identity & Career Totals */}
        <div className="space-y-6">
          {/* Identity Card */}
          <div className="card">
            <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <User size={18} className="text-gold" />
              Player Details
            </h2>
            <div className="space-y-3.5 text-sm">
              <div className="flex-between">
                <span className="text-text-muted">Pro Name</span>
                <span className="font-semibold text-text-primary">{player.professionalName}</span>
              </div>
              <div className="flex-between">
                <span className="text-text-muted">IGN</span>
                <span className="font-semibold text-text-primary">{player.ign || '—'}</span>
              </div>
              <div className="flex-between">
                <span className="text-text-muted">Gender</span>
                <span className="font-semibold text-text-primary">{player.gender || '—'}</span>
              </div>
              <div className="flex-between">
                <span className="text-text-muted">Region</span>
                <span className="font-semibold text-text-primary">{player.region || '—'}</span>
              </div>
              <div className="flex-between">
                <span className="text-text-muted">Country</span>
                <span className="font-semibold text-text-primary">{player.country || '—'}</span>
              </div>
              <div className="flex-between">
                <span className="text-text-muted">Device</span>
                <span className="font-semibold text-text-primary">{player.device || '—'}</span>
              </div>
              <div className="flex-between">
                <span className="text-text-muted">Model</span>
                <span className="font-semibold text-text-primary">{player.deviceModel || '—'}</span>
              </div>
            </div>
          </div>

          {/* Career Stats */}
          <div className="card">
            <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <Star size={18} className="text-gold fill-gold" />
              Career Summary
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Career Kills</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.kills}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Matches Played</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.matches}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Tournaments</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.tournaments}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Kills / Match</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.killsPerMatch}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Avg Damage</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.avgDamage}</div>
              </div>
              <div className="p-3 bg-bg-alt-row/40 rounded-lg border border-border">
                <div className="text-xs text-text-muted">Avg Accuracy</div>
                <div className="text-xl font-bold font-mono text-text-primary mt-1">{careerStats.avgAccuracy}%</div>
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
              emptyMessage="No tournament participation recorded for this player"
              pageSize={10}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
