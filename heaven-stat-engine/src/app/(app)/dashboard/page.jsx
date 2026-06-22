'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTournaments } from '@/lib/firestore/tournaments';
import { getPlayers } from '@/lib/firestore/registry';
import { getTeams } from '@/lib/firestore/registry';
import { StatusBadge } from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Trophy, Users, Shield, Zap, ExternalLink, Play, ClipboardList, BarChart2, Star } from 'lucide-react';
import toast from 'react-hot-toast';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    totalTournaments: 0,
    activeTournaments: 0,
    totalPlayers: 0,
    totalTeams: 0,
  });
  const [activeTourneys, setActiveTourneys] = useState([]);
  const [recentTourneys, setRecentTourneys] = useState([]);
  const [topPlayers, setTopPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [tourneys, players, teams] = await Promise.all([
          getTournaments(),
          getPlayers(),
          getTeams()
        ]);

        const active = tourneys.filter(t => t.status === 'active');
        const setup = tourneys.filter(t => t.status === 'setup');
        const completed = tourneys.filter(t => t.status === 'completed' || t.status === 'archived');

        // Calculate stats
        setStats({
          totalTournaments: tourneys.length,
          activeTournaments: active.length,
          totalPlayers: players.length,
          totalTeams: teams.length,
        });

        setActiveTourneys([...active, ...setup]);
        setRecentTourneys(completed.slice(0, 5));

        // Let's compute mini player leaderboard. Since players list contains career stats if they exist, or we can sum kills from their data.
        // Wait, for this dashboard we'll sort players by a career kills field (or calculate if stored, or just mock/simulate based on players registry data)
        // Let's see: standard player object has careerKills, careerMatches, or we can sort them by a calculated value.
        // For now, if players have tournamentIds or other fields, let's sort by careerKills if present, or simulate.
        const sortedPlayers = [...players]
          .sort((a, b) => (b.careerKills || 0) - (a.careerKills || 0))
          .slice(0, 5);
        setTopPlayers(sortedPlayers);

      } catch (err) {
        console.error('Error loading dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  if (loading) return <LoadingSpinner size="lg" text="Loading dashboard data..." />;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Overview of your tournament stats and database</p>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="card-grid">
        <div className="stat-card">
          <div className="stat-card-icon gold">
            <Trophy size={20} />
          </div>
          <div>
            <div className="stat-card-value">{stats.totalTournaments}</div>
            <div className="stat-card-label">Total Tournaments</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon cyan">
            <Play size={20} />
          </div>
          <div>
            <div className="stat-card-value">{stats.activeTournaments}</div>
            <div className="stat-card-label">Active Tournaments</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon red">
            <Users size={20} />
          </div>
          <div>
            <div className="stat-card-value">{stats.totalPlayers}</div>
            <div className="stat-card-label">Total Players</div>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon blue">
            <Shield size={20} />
          </div>
          <div>
            <div className="stat-card-value">{stats.totalTeams}</div>
            <div className="stat-card-label">Total Teams</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active & Setup Tournaments */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card">
            <div className="flex-between mb-4">
              <h2 className="card-title flex items-center gap-2">
                <Zap size={18} className="text-gold" />
                Active & Setup Tournaments
              </h2>
              <Link href="/tournaments/new" className="btn btn-sm btn-primary">
                New Tournament
              </Link>
            </div>

            {activeTourneys.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border rounded-lg">
                No active or setup tournaments. Start by creating one!
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {activeTourneys.map((tourney) => {
                  const bannerSrc = tourney.banner || tourney.bannerUrl;
                  return (
                    <div key={tourney.id} className="tourney-square-card">
                      {/* Banner area */}
                      {bannerSrc ? (
                        <img src={bannerSrc} alt="" className="tourney-card-banner" />
                      ) : (
                        <div className="tourney-card-banner" style={{
                          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          overflow: 'hidden'
                        }}>
                          <div style={{ position: 'absolute', inset: 0, opacity: 0.05, backgroundImage: 'radial-gradient(var(--gold) 1px, transparent 0)', backgroundSize: '12px 12px' }}></div>
                          <Trophy size={32} className="text-gold" style={{ opacity: 0.7 }} />
                        </div>
                      )}

                      <div className="tourney-card-content">
                        <div style={{ width: '100%' }}>
                          <div className="flex-between mb-2">
                            <span className="text-xs text-text-muted font-semibold tracking-wider uppercase">Season {tourney.season || '—'}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <StatusBadge status={tourney.status} />
                            </div>
                          </div>
                          <h3 className="text-md font-semibold text-text-primary line-clamp-1">{tourney.name}</h3>
                          <p className="text-xs text-text-secondary mt-1 line-clamp-2" style={{ minHeight: '32px' }}>
                            {tourney.description || 'No description provided.'}
                          </p>
                        </div>

                        <div style={{ width: '100%', marginTop: '12px' }}>
                          <div className="grid grid-cols-3 gap-1 pt-2 border-t border-border text-center text-xs">
                            <Link href={`/tournaments/${tourney.id}/team-entry`} className="p-2 hover:bg-gold/10 hover:text-gold rounded flex flex-col items-center gap-1 transition text-text-secondary">
                              <ClipboardList size={14} />
                              <span>Team Entry</span>
                            </Link>
                            <Link href={`/tournaments/${tourney.id}/player-entry`} className="p-2 hover:bg-cyan/10 hover:text-cyan rounded flex flex-col items-center gap-1 transition text-text-secondary">
                              <Zap size={14} />
                              <span>Player Entry</span>
                            </Link>
                            <Link href={`/tournaments/${tourney.id}/standings`} className="p-2 hover:bg-green-500/10 hover:text-green-400 rounded flex flex-col items-center gap-1 transition text-text-secondary">
                              <BarChart2 size={14} />
                              <span>Standings</span>
                            </Link>
                          </div>

                          <Link href={`/tournaments/${tourney.id}`} className="btn btn-sm btn-secondary w-full text-center flex items-center justify-center gap-1.5 mt-3">
                            Go to Hub <ExternalLink size={12} />
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Completed Tournaments */}
          <div className="card">
            <h2 className="card-title mb-4 flex items-center gap-2">
              <Trophy size={18} className="text-cyan" />
              Recent Completed Tournaments
            </h2>

            {recentTourneys.length === 0 ? (
              <div className="text-center py-6 text-text-muted text-sm">
                No completed tournaments yet.
              </div>
            ) : (
              <div className="space-y-3">
                {recentTourneys.map((tourney) => (
                  <div key={tourney.id} className="flex-between p-3.5 bg-bg-alt-row/40 hover:bg-bg-alt-row/70 rounded-lg border border-border transition">
                    <div>
                      <h4 className="font-semibold text-sm text-text-primary">{tourney.name}</h4>
                      <p className="text-xs text-text-muted mt-0.5">Season {tourney.season} · Completed {tourney.completedAt ? (
                        typeof tourney.completedAt.toDate === 'function'
                          ? tourney.completedAt.toDate().toLocaleDateString()
                          : new Date(tourney.completedAt).toLocaleDateString()
                      ) : 'recently'}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={tourney.status} />
                      <Link href={`/tournaments/${tourney.id}`} className="text-text-muted hover:text-gold p-1 transition">
                        <ExternalLink size={16} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Mini Leaderboard */}
        <div>
          <div className="card h-full">
            <h2 className="card-title mb-4 flex items-center gap-2">
              <Star size={18} className="text-gold fill-gold" />
              Career Kill Leaderboard
            </h2>
            <p className="text-xs text-text-muted mb-4">Top players ranked by career kills across all tournaments.</p>

            {topPlayers.length === 0 ? (
              <div className="text-center py-12 text-text-muted text-sm">
                No player statistics available.
              </div>
            ) : (
              <div className="space-y-4">
                {topPlayers.map((player, index) => (
                  <div key={player.id} className="flex items-center justify-between p-3 bg-bg-alt-row/30 hover:bg-bg-alt-row/60 rounded-lg border border-border/50 transition">
                    <div className="flex items-center gap-3">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        index === 0 ? 'bg-gold text-black' : index === 1 ? 'bg-zinc-400 text-black' : index === 2 ? 'bg-amber-700 text-white' : 'bg-bg-header text-text-muted'
                      }`}>
                        {index + 1}
                      </div>
                      <div>
                        <Link href={`/players/${player.id}`} className="font-semibold text-sm hover:text-gold transition">
                          {player.professionalName}
                        </Link>
                        <div className="text-xs text-text-muted">IGN: {player.ign}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold text-text-primary">{player.careerKills || 0}</div>
                      <div className="text-[10px] text-text-muted uppercase tracking-wider">Kills</div>
                    </div>
                  </div>
                ))}
                
                <Link href="/rankings" className="btn btn-secondary w-full text-center mt-4 flex items-center justify-center gap-1.5 text-xs py-2">
                  View Full Rankings <ExternalLink size={12} />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
