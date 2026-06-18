'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getTournaments, deleteTournament } from '@/lib/firestore/tournaments';
import DataTable from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import { Plus, Trophy, Filter, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = ['all', 'setup', 'active', 'completed', 'archived'];

export default function TournamentsListPage() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState(null);
  const [deletingName, setDeletingName] = useState('');
  const [typedConfirmName, setTypedConfirmName] = useState('');
  const [confirming, setConfirming] = useState(false);

  const handleConfirmDelete = async () => {
    if (typedConfirmName !== deletingName) {
      toast.error('Tournament name does not match');
      return;
    }
    setConfirming(true);
    try {
      await deleteTournament(deletingId);
      setTournaments(prev => prev.filter(t => t.id !== deletingId));
      toast.success('Tournament deleted successfully');
      setDeletingId(null);
      setTypedConfirmName('');
    } catch (err) {
      toast.error('Failed to delete tournament: ' + err.message);
    } finally {
      setConfirming(false);
    }
  };

  useEffect(() => {
    getTournaments()
      .then(setTournaments)
      .finally(() => setLoading(false));
  }, []);

  const filtered = statusFilter === 'all'
    ? tournaments
    : tournaments.filter(t => t.status === statusFilter);

  const columns = [
    {
      header: 'Name',
      accessor: 'name',
      render: (t) => {
        const bannerSrc = t.banner || t.bannerUrl;
        return (
          <Link href={`/tournaments/${t.id}`} className="text-gold" style={{ fontWeight: 600 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {bannerSrc ? (
                <img src={bannerSrc} alt="" style={{ width: 40, height: 24, borderRadius: 4, objectFit: 'cover', background: 'var(--bg-header)', border: '1px solid var(--border-md)' }} />
              ) : (
                <div style={{ width: 40, height: 24, borderRadius: 4, background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-md)' }}>
                  <Trophy size={11} className="text-gold" style={{ opacity: 0.8 }} />
                </div>
              )}
              <span>{t.name}</span>
            </div>
          </Link>
        );
      },
    },
    { header: 'Season', accessor: 'season' },
    {
      header: 'Status',
      accessor: 'status',
      render: (t) => <StatusBadge status={t.status} />,
    },
    {
      header: 'Days',
      accessor: 'totalDays',
      render: (t) => t.structure?.totalDays ?? '—',
    },
    {
      header: 'Lobbies/Day',
      render: (t) => t.structure?.lobbiesPerDay ?? '—',
    },
    {
      header: 'Created',
      accessor: 'createdAt',
      render: (t) => t.createdAt?.seconds
        ? new Date(t.createdAt.seconds * 1000).toLocaleDateString()
        : '—',
    },
    {
      header: 'Actions',
      key: 'actions',
      render: (t) => (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Link href={`/tournaments/${t.id}`} className="btn btn-secondary btn-sm">
            Open
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--danger)', padding: '5px 8px' }}
            onClick={() => {
              setDeletingId(t.id);
              setDeletingName(t.name);
            }}
            title="Delete Tournament"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  if (loading) return <LoadingSpinner size="lg" text="Loading tournaments..." />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tournaments</h1>
          <p className="page-subtitle">All events — setup, active, completed, archived</p>
        </div>
        <Link href="/tournaments/new" className="btn btn-primary">
          <Plus size={16} />
          New Tournament
        </Link>
      </div>

      {/* Status filter */}
      <div className="tab-bar" style={{ marginBottom: 20 }}>
        {STATUS_OPTIONS.map(s => (
          <button
            key={s}
            className={`tab ${statusFilter === s ? 'active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {s !== 'all' && (
              <span style={{
                marginLeft: 6,
                fontSize: '0.7rem',
                background: 'var(--bg-alt-row)',
                borderRadius: 99,
                padding: '1px 6px',
                color: 'var(--text-muted)',
              }}>
                {tournaments.filter(t => t.status === s).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No tournaments found"
          text={statusFilter === 'all'
            ? 'Create your first tournament to get started.'
            : `No tournaments with status "${statusFilter}".`}
          action={statusFilter === 'all' && (
            <Link href="/tournaments/new" className="btn btn-primary">
              <Plus size={16} /> New Tournament
            </Link>
          )}
        />
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          searchPlaceholder="Search by name or season..."
        />
      )}
      {/* Delete Confirmation Modal */}
      {deletingId && (
        <Modal title="Delete Tournament" onClose={() => { setDeletingId(null); setTypedConfirmName(''); }}>
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Are you sure you want to delete this tournament? All match results, configurations, and player registrations associated with this tournament will be permanently deleted.
            </p>
            <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.08)', borderRadius: 8, border: '1px solid rgba(239, 68, 68, 0.2)' }}>
              <p className="text-xs text-danger font-semibold">WARNING: This action is irreversible!</p>
            </div>
            <div className="form-field mt-3">
              <label className="form-label text-[10px]">
                Type <strong className="text-text-primary">{deletingName}</strong> to confirm:
              </label>
              <input
                type="text"
                className="form-input mt-1"
                placeholder="Type tournament name here..."
                value={typedConfirmName}
                onChange={e => setTypedConfirmName(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border mt-4">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => { setDeletingId(null); setTypedConfirmName(''); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={typedConfirmName !== deletingName || confirming}
                onClick={handleConfirmDelete}
              >
                {confirming ? 'Deleting...' : 'Permanently Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
