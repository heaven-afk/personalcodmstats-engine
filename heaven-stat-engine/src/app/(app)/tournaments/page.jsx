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
  const [deleteChecked1, setDeleteChecked1] = useState(false);
  const [deleteChecked2, setDeleteChecked2] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const openDeleteModal = (id, name) => {
    setDeletingId(id);
    setDeletingName(name);
    setDeleteChecked1(false);
    setDeleteChecked2(false);
  };

  const closeDeleteModal = () => {
    setDeletingId(null);
    setDeleteChecked1(false);
    setDeleteChecked2(false);
  };

  const handleConfirmDelete = async () => {
    if (!deleteChecked1 || !deleteChecked2) return;
    setConfirming(true);
    try {
      await deleteTournament(deletingId);
      toast.success('Tournament deleted successfully');
      closeDeleteModal();
      // Re-fetch from source of truth to guarantee UI reflects actual stored data
      const updated = await getTournaments();
      setTournaments(updated);
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
                <img src={bannerSrc} alt="" style={{ width: 40, height: 24, borderRadius: 4, objectFit: 'cover', background: 'var(--bg-header)', border: '1px solid var(--border-md)' }} referrerPolicy="no-referrer" />
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
            onClick={() => openDeleteModal(t.id, t.name)}
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
        <Modal title="⚠ Delete Tournament" onClose={closeDeleteModal}>
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              You are about to permanently delete <strong className="text-text-primary">{deletingName}</strong>.
              All match results, configurations, registrations, bonuses, and stats will be gone forever.
            </p>

            {/* Checkboxes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px', background: 'rgba(239, 68, 68, 0.07)', borderRadius: 8, border: '1px solid rgba(239, 68, 68, 0.25)' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={deleteChecked1}
                  onChange={e => setDeleteChecked1(e.target.checked)}
                  style={{ marginTop: 2, accentColor: 'var(--danger)', width: 16, height: 16, flexShrink: 0 }}
                />
                <span>I understand that all match results, standings, and player stats for this tournament will be <strong>permanently deleted</strong>.</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={deleteChecked2}
                  onChange={e => setDeleteChecked2(e.target.checked)}
                  style={{ marginTop: 2, accentColor: 'var(--danger)', width: 16, height: 16, flexShrink: 0 }}
                />
                <span>I understand this action is <strong>irreversible</strong> and cannot be undone.</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button type="button" className="btn btn-secondary btn-sm" onClick={closeDeleteModal}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={!deleteChecked1 || !deleteChecked2 || confirming}
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
