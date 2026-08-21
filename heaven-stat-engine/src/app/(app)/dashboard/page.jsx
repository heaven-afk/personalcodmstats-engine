'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTournaments } from '@/lib/firestore/tournaments';
import { getPlayers, getTeams } from '@/lib/firestore/registry';
import { getTeamMatchResults } from '@/lib/firestore/matchData';
import { useAuth } from '@/contexts/AuthContext';
import { StatusBadge } from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Trophy, Users, Shield, Zap, ExternalLink, Play, ClipboardList, BarChart2, Star, Sparkles, ArrowRight, Flame, FolderGit2 } from 'lucide-react';
import { formatEventDates } from '@/lib/utils/dateUtils';
import { computeTeamGlobalForm, globalFormLabel } from '@/lib/engine/globalForm';

export default function DashboardPage() {
  const { user, isOwner } = useAuth();
  const [stats, setStats] = useState({
    totalTournaments: 0,
    activeTournaments: 0,
    totalPlayers: 0,
    totalTeams: 0,
  });
  const [allTournaments, setAllTournaments] = useState([]);
  const [activeTourneys, setActiveTourneys] = useState([]);
  const [recentTourneys, setRecentTourneys] = useState([]);
  const [topPlayers, setTopPlayers] = useState([]);
  const [topTeamForms, setTopTeamForms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [tourneys, players, teams] = await Promise.all([
          getTournaments(),
          getPlayers(),
          getTeams()
        ]);

        const teamResPromises = tourneys.map(t => getTeamMatchResults(t.id));
        const allTeamRes = await Promise.all(teamResPromises);
        const teamMatchResultsByTournament = {};
        tourneys.forEach((t, i) => {
          teamMatchResultsByTournament[t.id] = allTeamRes[i] || [];
        });

        const active = tourneys.filter(t => t.status === 'active');
        const setup = tourneys.filter(t => t.status === 'setup');
        const completed = tourneys.filter(t => t.status === 'completed' || t.status === 'archived');

        setStats({
          totalTournaments: tourneys.length,
          activeTournaments: active.length,
          totalPlayers: players.length,
          totalTeams: teams.length,
        });

        setAllTournaments(tourneys);
        setActiveTourneys([...active, ...setup]);
        setRecentTourneys(completed.slice(0, 5));

        const sortedPlayers = [...players]
          .sort((a, b) => (b.careerKills || 0) - (a.careerKills || 0))
          .slice(0, 5);
        setTopPlayers(sortedPlayers);

        // Global Team Form Top 5
        const teamForms = teams.map(t => {
          const gf = computeTeamGlobalForm(t.id, tourneys, teamMatchResultsByTournament);
          return { ...t, globalForm: gf };
        });

        const rankedForms = teamForms.filter(t => t.globalForm.confidence !== 'unranked');
        const fieldAvgForm = rankedForms.length > 0
          ? rankedForms.reduce((sum, t) => sum + (t.globalForm.decayedForm || 0), 0) / rankedForms.length
          : 0;

        const processedForms = teamForms.map(t => ({
          ...t,
          formLabel: globalFormLabel(t.globalForm.decayedForm, t.globalForm.trend, t.globalForm.confidence, fieldAvgForm),
        }));

        processedForms.sort((a, b) => {
          if (a.globalForm.confidence === 'unranked' && b.globalForm.confidence !== 'unranked') return 1;
          if (a.globalForm.confidence !== 'unranked' && b.globalForm.confidence === 'unranked') return -1;
          return (b.globalForm.decayedForm || 0) - (a.globalForm.decayedForm || 0);
        });

        setTopTeamForms(processedForms.slice(0, 5));

      } catch (err) {
        console.error('Error loading dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  if (loading) return <LoadingSpinner size="lg" text="Loading dashboard hub..." />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Liquid Hero Header */}
      <div style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '20px',
        padding: '28px 32px',
        background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, rgba(15, 23, 42, 0.95) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(251, 191, 36, 0.25)',
        boxShadow: '0 12px 40px -10px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '20px',
      }}>
        {/* Ambient Light Orbs */}
        <div style={{
          position: 'absolute',
          top: '-40px',
          left: '-40px',
          width: '180px',
          height: '180px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(201, 168, 76, 0.25) 0%, rgba(201, 168, 76, 0) 70%)',
          pointerEvents: 'none',
          filter: 'blur(24px)',
        }} />
        <div style={{
          position: 'absolute',
          bottom: '-40px',
          right: '10%',
          width: '180px',
          height: '180px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(14, 165, 233, 0.2) 0%, rgba(14, 165, 233, 0) 70%)',
          pointerEvents: 'none',
          filter: 'blur(24px)',
        }} />

        <div style={{ zIndex: 1 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: '20px', background: 'rgba(201, 168, 76, 0.15)', border: '1px solid rgba(201, 168, 76, 0.3)', fontSize: '0.72rem', fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            <Sparkles size={12} /> Live Tournament Engine
          </div>
          <h1 className="page-title" style={{ fontSize: '1.8rem', fontWeight: 900, color: '#FFFFFF', letterSpacing: '-0.02em', margin: 0 }}>
            Esports Command Dashboard
          </h1>
          <p className="page-subtitle" style={{ fontSize: '0.88rem', color: '#94A3B8', marginTop: 4, margin: 0 }}>
            Real-time standings, player stats analytics, and tournament administration hub
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, zIndex: 1 }}>
          <Link href="/tournaments/new" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', fontSize: '0.85rem', borderRadius: '10px', boxShadow: '0 4px 16px rgba(201, 168, 76, 0.3)' }}>
            <Zap size={16} /> New Tournament
          </Link>
        </div>
      </div>

      {/* Infused Liquid Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Stat 1 */}
        <div style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '16px',
          padding: '20px',
          background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.12) 0%, rgba(15, 23, 42, 0.85) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(201, 168, 76, 0.3)',
          boxShadow: 'inset 0 0 20px rgba(201, 168, 76, 0.08), 0 8px 24px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.3) 0%, rgba(201, 168, 76, 0.1) 100%)',
            border: '1px solid rgba(201, 168, 76, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(201, 168, 76, 0.25)',
            flexShrink: 0,
          }}>
            <Trophy size={22} style={{ color: '#FBBF24' }} />
          </div>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#FFFFFF', fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>
              {stats.totalTournaments}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
              Total Tournaments
            </div>
          </div>
        </div>

        {/* Stat 2 */}
        <div style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '16px',
          padding: '20px',
          background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.12) 0%, rgba(15, 23, 42, 0.85) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          boxShadow: 'inset 0 0 20px rgba(14, 165, 233, 0.08), 0 8px 24px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.3) 0%, rgba(14, 165, 233, 0.1) 100%)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(14, 165, 233, 0.25)',
            flexShrink: 0,
          }}>
            <Play size={22} style={{ color: '#38BDF8' }} />
          </div>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#FFFFFF', fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>
              {stats.activeTournaments}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
              Active Events
            </div>
          </div>
        </div>

        {/* Stat 3 */}
        <div style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '16px',
          padding: '20px',
          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(15, 23, 42, 0.85) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(248, 113, 113, 0.3)',
          boxShadow: 'inset 0 0 20px rgba(239, 68, 68, 0.08), 0 8px 24px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.3) 0%, rgba(239, 68, 68, 0.1) 100%)',
            border: '1px solid rgba(248, 113, 113, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(239, 68, 68, 0.25)',
            flexShrink: 0,
          }}>
            <Users size={22} style={{ color: '#F87171' }} />
          </div>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#FFFFFF', fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>
              {stats.totalPlayers}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
              Total Players
            </div>
          </div>
        </div>

        {/* Stat 4 */}
        <div style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '16px',
          padding: '20px',
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(15, 23, 42, 0.85) 100%)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(52, 211, 153, 0.3)',
          boxShadow: 'inset 0 0 20px rgba(16, 185, 129, 0.08), 0 8px 24px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.3) 0%, rgba(16, 185, 129, 0.1) 100%)',
            border: '1px solid rgba(52, 211, 153, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.25)',
            flexShrink: 0,
          }}>
            <Shield size={22} style={{ color: '#34D399' }} />
          </div>
          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 900, color: '#FFFFFF', fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>
              {stats.totalTeams}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
              Total Teams
            </div>
          </div>
        </div>
      </div>

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left Column: Tournaments */}
        <div className="lg:col-span-2" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {/* My Projects Section (Tournaments where user is an assigned editor) */}
          {user?.uid && (
            <div className="card" style={{
              background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.08) 0%, rgba(15, 23, 42, 0.95) 100%)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(201, 168, 76, 0.3)',
              borderRadius: '16px',
              padding: '24px',
            }}>
              <div className="flex-between mb-4">
                <div>
                  <h2 className="card-title flex items-center gap-2" style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--gold)', margin: 0 }}>
                    <FolderGit2 size={20} />
                    My Projects
                  </h2>
                  <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: '4px 0 0' }}>
                    Tournaments you created or have editor collaboration access to.
                  </p>
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gold)', background: 'rgba(201,168,76,0.15)', padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(201,168,76,0.3)' }}>
                  {allTournaments.filter(t => t.editorUids && t.editorUids.includes(user?.uid)).length} Project{allTournaments.filter(t => t.editorUids && t.editorUids.includes(user?.uid)).length !== 1 ? 's' : ''}
                </span>
              </div>

              {allTournaments.filter(t => t.editorUids && t.editorUids.includes(user?.uid)).length === 0 ? (
                <div className="text-center py-6 text-text-muted text-sm border border-dashed border-border/60 rounded-xl" style={{ background: 'rgba(15, 23, 42, 0.4)' }}>
                  You haven't been added to any tournament projects yet. Create a tournament or ask an administrator for invite access.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {allTournaments
                    .filter(t => t.editorUids && t.editorUids.includes(user?.uid))
                    .map((tourney) => {
                      const dateRange = formatEventDates(tourney.eventStartDate, tourney.eventEndDate);
                      return (
                        <div key={tourney.id} style={{
                          background: 'rgba(15, 23, 42, 0.85)',
                          border: '1px solid rgba(201, 168, 76, 0.25)',
                          borderRadius: '12px',
                          padding: '16px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '12px',
                        }}>
                          <div>
                            <div className="flex-between mb-2">
                              <span style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                                Season {tourney.season || '—'}
                              </span>
                              <StatusBadge status={tourney.status} />
                            </div>
                            <h3 style={{ fontSize: '0.98rem', fontWeight: 800, color: '#FFFFFF', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {tourney.name}
                            </h3>
                            {dateRange && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--gold)', fontWeight: 600, marginTop: 3 }}>
                                {dateRange}
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                            <Link
                              href={`/tournaments/${tourney.id}`}
                              className="btn btn-sm btn-primary"
                              style={{ flex: 1, fontSize: '0.75rem', padding: '6px 10px', justifyContent: 'center' }}
                            >
                              Manage Hub <ArrowRight size={12} />
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          <div className="card" style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.75) 0%, rgba(15, 23, 42, 0.95) 100%)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            padding: '24px',
          }}>
            <div className="flex-between mb-5">
              <h2 className="card-title flex items-center gap-2" style={{ fontSize: '1.1rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                <Zap size={20} className="text-gold" />
                Active & Setup Tournaments
              </h2>
              <Link href="/tournaments/new" className="btn btn-sm btn-primary" style={{ fontSize: '0.78rem', borderRadius: '8px' }}>
                + New Tournament
              </Link>
            </div>

            {activeTourneys.length === 0 ? (
              <div className="text-center py-10 text-text-muted text-sm border border-dashed border-border/60 rounded-xl" style={{ background: 'rgba(15, 23, 42, 0.4)' }}>
                No active or setup tournaments currently. Click above to create one!
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {activeTourneys.map((tourney) => {
                  const bannerSrc = tourney.banner || tourney.bannerUrl;
                  const dateRange = formatEventDates(tourney.eventStartDate, tourney.eventEndDate);
                  return (
                    <div key={tourney.id} className="tourney-square-card" style={{
                      background: 'rgba(15, 23, 42, 0.85)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '14px',
                      overflow: 'hidden',
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                      transition: 'all 0.25s ease',
                    }}>
                      {/* Banner area */}
                      {bannerSrc ? (
                        <img src={bannerSrc} alt="" className="tourney-card-banner" style={{ height: '110px', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                      ) : (
                        <div className="tourney-card-banner" style={{
                          height: '110px',
                          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        }}>
                          <div style={{ position: 'absolute', inset: 0, opacity: 0.08, backgroundImage: 'radial-gradient(var(--gold) 1px, transparent 0)', backgroundSize: '12px 12px' }}></div>
                          <Trophy size={36} className="text-gold" style={{ opacity: 0.85, filter: 'drop-shadow(0 4px 12px rgba(201, 168, 76, 0.4))' }} />
                        </div>
                      )}

                      <div className="tourney-card-content" style={{ padding: '16px' }}>
                        <div style={{ width: '100%' }}>
                          <div className="flex-between mb-2">
                            <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                              Season {tourney.season || '—'}
                            </span>
                            <StatusBadge status={tourney.status} />
                          </div>
                          <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#FFFFFF', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {tourney.name}
                          </h3>
                          {dateRange && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--gold)', fontWeight: 600, marginTop: 2 }}>
                              {dateRange}
                            </div>
                          )}
                          <p style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: 4, lineClamp: 2, minHeight: '34px' }}>
                            {tourney.description || 'No description provided.'}
                          </p>
                        </div>

                        <div style={{ width: '100%', marginTop: '14px' }}>
                          <div className="grid grid-cols-3 gap-1.5 pt-3 border-t border-border/60 text-center text-xs">
                            <Link href={`/tournaments/${tourney.id}/team-entry`} className="p-2 hover:bg-gold/15 hover:text-gold rounded-lg flex flex-col items-center gap-1 transition text-text-secondary">
                              <ClipboardList size={14} />
                              <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>Team Entry</span>
                            </Link>
                            <Link href={`/tournaments/${tourney.id}/player-entry`} className="p-2 hover:bg-cyan/15 hover:text-cyan rounded-lg flex flex-col items-center gap-1 transition text-text-secondary">
                              <Zap size={14} />
                              <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>Player Entry</span>
                            </Link>
                            <Link href={`/tournaments/${tourney.id}/standings`} className="p-2 hover:bg-green-500/15 hover:text-green-400 rounded-lg flex flex-col items-center gap-1 transition text-text-secondary">
                              <BarChart2 size={14} />
                              <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>Standings</span>
                            </Link>
                          </div>

                          <Link href={`/tournaments/${tourney.id}`} className="btn btn-sm btn-secondary w-full text-center flex items-center justify-center gap-1.5 mt-3" style={{ borderRadius: '8px', fontSize: '0.78rem' }}>
                            Go to Hub <ArrowRight size={13} />
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
          <div className="card" style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.75) 0%, rgba(15, 23, 42, 0.95) 100%)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            padding: '24px',
          }}>
            <h2 className="card-title mb-4 flex items-center gap-2" style={{ fontSize: '1.1rem', fontWeight: 800, color: '#FFFFFF' }}>
              <Trophy size={20} className="text-cyan" />
              Recent Completed Tournaments
            </h2>

            {recentTourneys.length === 0 ? (
              <div className="text-center py-6 text-text-muted text-sm">
                No completed tournaments recorded yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {recentTourneys.map((tourney) => (
                  <div key={tourney.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    background: 'rgba(26, 35, 50, 0.4)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    transition: 'all 0.2s ease',
                    gap: '16px',
                  }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h4 style={{ fontSize: '0.92rem', fontWeight: 700, color: '#FFFFFF', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                        {tourney.name}
                      </h4>
                      <p style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: 3, margin: 0 }}>
                        Season {tourney.season || '—'} · Completed {tourney.completedAt ? (
                          typeof tourney.completedAt.toDate === 'function'
                            ? tourney.completedAt.toDate().toLocaleDateString()
                            : new Date(tourney.completedAt).toLocaleDateString()
                        ) : 'recently'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                      <StatusBadge status={tourney.status} />
                      <Link href={`/tournaments/${tourney.id}`} style={{ color: '#94A3B8', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Open Hub">
                        <ExternalLink size={16} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Global Team Form & Career Leaderboard */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {/* Global Team Form Widget */}
          <div className="card" style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.75) 0%, rgba(15, 23, 42, 0.95) 100%)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(201, 168, 76, 0.3)',
            borderRadius: '16px',
            padding: '24px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <h2 className="card-title flex items-center gap-2" style={{ fontSize: '1.1rem', fontWeight: 800, color: '#FFFFFF', margin: 0 }}>
                <Flame size={20} className="text-gold fill-gold" />
                Global Team Form
              </h2>
              <span style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--gold)', background: 'rgba(201,168,76,0.15)', padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase' }}>
                8-Match Rolling
              </span>
            </div>
            <p className="text-xs text-text-muted mb-4">Top teams ranked by cross-tournament rolling momentum.</p>

            {topTeamForms.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border/50 rounded-xl">
                No team form statistics available.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {topTeamForms.map((t, index) => (
                  <Link href="/rankings?tab=teamForm" key={t.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    background: 'rgba(26, 35, 50, 0.35)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    gap: '12px',
                    transition: 'all 0.2s ease',
                  }} className="hover:border-gold/50">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 900, color: index === 0 ? 'var(--gold)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        #{index + 1}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {t.teamName}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#94A3B8', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: t.formLabel === 'Red Hot' ? 'var(--danger)' : t.formLabel === 'In Form' ? 'var(--success)' : 'var(--gold)', fontWeight: 600 }}>{t.formLabel}</span>
                          <span>•</span>
                          <span>{t.globalForm.matchesUsed}/8 matches</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.95rem', fontWeight: 900, color: 'var(--gold)' }}>
                        {t.globalForm.decayedForm ?? '—'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: t.globalForm.trend === 'up' ? 'var(--success)' : t.globalForm.trend === 'down' ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 700 }}>
                        {t.globalForm.trend === 'up' ? '↑ Rising' : t.globalForm.trend === 'down' ? '↓ Falling' : '→ Steady'}
                      </div>
                    </div>
                  </Link>
                ))}

                <Link href="/rankings?tab=teamForm" className="btn btn-secondary w-full text-center mt-2 flex items-center justify-center gap-2 text-xs py-2.5 rounded-xl border border-border/80 hover:border-gold/50 transition">
                  View All Team Forms <ArrowRight size={13} />
                </Link>
              </div>
            )}
          </div>

          {/* Career Kill Leaderboard Card */}
          <div className="card" style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.75) 0%, rgba(15, 23, 42, 0.95) 100%)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            padding: '24px',
          }}>
            <h2 className="card-title mb-2 flex items-center gap-2" style={{ fontSize: '1.1rem', fontWeight: 800, color: '#FFFFFF' }}>
              <Star size={20} className="text-gold fill-gold" />
              Career Kill Leaderboard
            </h2>
            <p className="text-xs text-text-muted mb-5">Top players ranked by total kills across all tournaments.</p>

            {topPlayers.length === 0 ? (
              <div className="text-center py-12 text-text-muted text-sm border border-dashed border-border/50 rounded-xl">
                No player statistics available.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {topPlayers.map((player, index) => {
                  const rankStyles = [
                    { bg: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)', text: '#000000', label: '1st' },
                    { bg: 'linear-gradient(135deg, #94A3B8 0%, #64748B 100%)', text: '#000000', label: '2nd' },
                    { bg: 'linear-gradient(135deg, #B45309 0%, #78350F 100%)', text: '#FFFFFF', label: '3rd' },
                  ];
                  const currentStyle = rankStyles[index] || { bg: 'rgba(255, 255, 255, 0.1)', text: '#94A3B8', label: `${index + 1}` };

                  return (
                    <div key={player.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 16px',
                      background: 'rgba(26, 35, 50, 0.3)',
                      borderRadius: '12px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      gap: '12px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                        <div style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: currentStyle.bg,
                          color: currentStyle.text,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.8rem',
                          fontWeight: 900,
                          boxShadow: index < 3 ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
                          flexShrink: 0,
                        }}>
                          {index + 1}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <Link href={`/players/${player.id}`} style={{ fontSize: '0.88rem', fontWeight: 700, color: '#FFFFFF', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                            {player.professionalName || player.ign}
                          </Link>
                          <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: 2 }}>
                            IGN: <span style={{ fontFamily: 'var(--font-mono)', color: '#CBD5E1' }}>{player.ign || '—'}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.92rem', fontWeight: 900, color: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                          <Flame size={12} style={{ color: 'var(--gold)' }} />
                          {player.careerKills || 0}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>Kills</div>
                      </div>
                    </div>
                  );
                })}

                <Link href="/rankings?tab=career" className="btn btn-secondary w-full text-center mt-5 flex items-center justify-center gap-2 text-xs py-2.5 rounded-xl border border-border/80 hover:border-gold/50 transition">
                  View Full Career Rankings <ExternalLink size={13} />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
