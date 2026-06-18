'use client';
import { useTournament } from './layout';
import { StatusBadge } from '@/components/ui/Badge';
import { Calendar, Trophy, Crosshair, Users, Award, BarChart3 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { setTournamentStatus } from '@/lib/firestore/tournaments';
import toast from 'react-hot-toast';
import { useState } from 'react';

const STATUS_FLOW = ['setup', 'active', 'completed', 'archived'];

export default function TournamentOverviewPage() {
  const { tournament, refresh } = useTournament();
  const router = useRouter();
  const [advancing, setAdvancing] = useState(false);

  const { structure = {}, scoring = {} } = tournament;
  const currentIdx = STATUS_FLOW.indexOf(tournament.status);

  const handleAdvance = async () => {
    const next = STATUS_FLOW[currentIdx + 1];
    if (!next) return;
    if (!confirm(`Advance tournament to "${next}"?${next === 'active' ? '\nThis will lock structure and scoring config.' : ''}`)) return;
    setAdvancing(true);
    try {
      await setTournamentStatus(tournament.id, next);
      await refresh();
      toast.success(`Status → ${next}`);
    } catch (e) { toast.error(e.message); }
    finally { setAdvancing(false); }
  };

  return (
    <div>
      {/* Quick stats */}
      <div className="card-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-card-icon gold"><Calendar size={20} /></div>
          <div><div className="stat-card-value">{structure.totalDays || 0}</div><div className="stat-card-label">Total Days</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon cyan"><Trophy size={20} /></div>
          <div><div className="stat-card-value">{structure.lobbiesPerDay || 0}</div><div className="stat-card-label">Lobbies / Day</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon red"><Crosshair size={20} /></div>
          <div><div className="stat-card-value">{scoring.killPointValue || 0}</div><div className="stat-card-label">Points / Kill</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon blue"><Award size={20} /></div>
          <div><div className="stat-card-value">{scoring.placementPoints?.length || 0}</div><div className="stat-card-label">Placement Tiers</div></div>
        </div>
      </div>

      {/* Status stepper */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="flex-between" style={{ marginBottom: 16 }}>
          <h3 className="card-title">Tournament Status</h3>
          <StatusBadge status={tournament.status} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 20, flexWrap: 'wrap', rowGap: 8 }}>
          {STATUS_FLOW.map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 99,
                background: i < currentIdx ? 'rgba(201,168,76,0.15)' : i === currentIdx ? 'rgba(201,168,76,0.25)' : 'var(--bg-alt-row)',
                border: `1px solid ${i <= currentIdx ? 'rgba(201,168,76,0.4)' : 'var(--border)'}`,
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.7rem', fontWeight: 700,
                  background: i <= currentIdx ? 'var(--gold)' : 'var(--bg-header)',
                  color: i <= currentIdx ? '#000' : 'var(--text-muted)',
                }}>
                  {i + 1}
                </div>
                <span style={{ fontSize: '0.8rem', fontWeight: i === currentIdx ? 700 : 400, color: i === currentIdx ? 'var(--gold)' : i < currentIdx ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </span>
              </div>
              {i < STATUS_FLOW.length - 1 && <div style={{ width: 24, height: 2, background: i < currentIdx ? 'var(--gold)' : 'var(--border)' }} />}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          {currentIdx < STATUS_FLOW.length - 1 && (
            <button className="btn btn-primary" onClick={handleAdvance} disabled={advancing}>
              {advancing ? 'Advancing...' : `Advance to ${STATUS_FLOW[currentIdx + 1]}`}
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => router.push(`/tournaments/${tournament.id}/config`)}>
            {tournament.status === 'setup' ? 'Edit Configuration' : 'View Configuration'}
          </button>
        </div>
      </div>

      <div className="card-grid">
        {/* Placement Points */}
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 14 }}>Placement Points</h3>
          {scoring.placementPoints?.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 6 }}>
              {scoring.placementPoints.map((pp) => (
                <div key={pp.position} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--bg-alt-row)', borderRadius: 6, fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>#{pp.position}</span>
                  <span style={{ fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{pp.points}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No placement points configured</p>}
        </div>

        {/* Player Classes */}
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 14 }}>Player Classes</h3>
          {structure.playerClasses?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {structure.playerClasses.map((cls, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-alt-row)', borderRadius: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: cls.badgeColor || '#C9A84C', display: 'inline-block' }} />
                    <span style={{ fontWeight: 600 }}>{cls.className}</span>
                  </span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Days: {cls.activeDays?.join(', ') || 'All'}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No classes defined</p>}
        </div>

        {/* Bonus Types */}
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 14 }}>Bonus / Penalty Types</h3>
          {scoring.bonusTypes?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {scoring.bonusTypes.map((bt, i) => (
                <div key={i} style={{ padding: '9px 14px', background: 'var(--bg-alt-row)', borderRadius: 8, fontWeight: 500, fontSize: '0.875rem' }}>{bt.name}</div>
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No bonus types defined</p>}
        </div>
      </div>
    </div>
  );
}
