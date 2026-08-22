'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { getTournaments, deleteTournament } from '@/lib/firestore/tournaments';
import { formatEventDates } from '@/lib/utils/dateUtils';
import DataTable from '@/components/ui/DataTable';
import { StatusBadge, TierBadge } from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import { Plus, Trophy, Trash2, Calendar, LayoutGrid, List, Search, Medal, Eye, Edit3, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';

import useSWR from 'swr';

const STATUS_OPTIONS = ['all', 'setup', 'active', 'completed', 'archived'];

export default function TournamentsListPage() {
  const { user, isOwner, isOperator } = useAuth();
  const { data: tournaments = [], isLoading: loading, mutate } = useSWR('tournaments', getTournaments);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'table'

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState(null);
  const [deletingName, setDeletingName] = useState('');
  const [deleteChecked1, setDeleteChecked1] = useState(false);
  const [deleteChecked2, setDeleteChecked2] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const openDeleteModal = (id, name) => {
    if (!isOwner) return;
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
    if (!isOwner || !deleteChecked1 || !deleteChecked2) return;
    setConfirming(true);
    try {
      await deleteTournament(deletingId);
      toast.success('Tournament deleted successfully');
      closeDeleteModal();
      mutate(tournaments.filter(t => t.id !== deletingId), false);
      mutate();
    } catch (err) {
      toast.error('Failed to delete tournament: ' + err.message);
    } finally {
      setConfirming(false);
    }
  };

  const hasAccessToTourney = (t) => {
    if (isOwner) return true;
    const editors = t.editorUids || [];
    const userEmail = user?.email?.toLowerCase();
    return editors.some(e => e === user?.uid || (userEmail && e.toLowerCase() === userEmail));
  };

  const filtered = tournaments.filter(t => {
    if (!hasAccessToTourney(t)) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const nameMatch = t.name?.toLowerCase().includes(q);
    const seasonMatch = t.season?.toLowerCase().includes(q);
    const dateStr = formatEventDates(t.eventStartDate, t.eventEndDate)?.toLowerCase();
    const dateMatch = dateStr?.includes(q);
    return nameMatch || seasonMatch || dateMatch;
  });

  const columns = [
    {
      header: 'Name',
      accessor: 'name',
      render: (t) => {
        const bannerSrc = t.banner || t.bannerUrl;
        const dateRange = formatEventDates(t.eventStartDate, t.eventEndDate);
        const canEdit = hasAccessToTourney(t);
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
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{t.name}</span>
                  {isOperator && (
                    canEdit ? (
                      <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                        Editor
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(148, 163, 184, 0.15)', color: 'var(--text-muted)', border: '1px solid rgba(148, 163, 184, 0.3)' }}>
                        Read-Only
                      </span>
                    )
                  )}
                </div>
                {dateRange && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                    {dateRange}
                  </span>
                )}
              </div>
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
      header: 'Tier',
      accessor: 'rankedTier',
      render: (t) => t.isRanked ? <TierBadge tier={t.rankedTier} size="xs" /> : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>,
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
      render: (t) => {
        const canEdit = hasAccessToTourney(t);
        return (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Link href={`/tournaments/${t.id}`} className="btn btn-secondary btn-sm">
              {canEdit ? 'Open' : 'View (Read-Only)'}
            </Link>
            {isOwner && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--danger)', padding: '5px 8px' }}
                onClick={() => openDeleteModal(t.id, t.name)}
                title="Delete Tournament"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  if (loading) return <LoadingSpinner size="lg" text="Loading tournaments..." />;

  const visibleTourneysCount = tournaments.filter(hasAccessToTourney);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tournaments</h1>
          <p className="page-subtitle">
            {isOwner ? 'All events — setup, active, completed, archived' : 'Your assigned tournament projects'}
          </p>
        </div>
        {isOwner && (
          <Link href="/tournaments/new" className="btn btn-primary">
            <Plus size={16} />
            New Tournament
          </Link>
        )}
      </div>

      {/* Status filter tabs */}
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
                {visibleTourneysCount.filter(t => t.status === s).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Toolbar: Search + View Mode Switcher */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div className="search-input-wrap" style={{ flex: 1, minWidth: 240, maxWidth: 360 }}>
          <Search size={15} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search by name, season, or date..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-card)', padding: '3px', borderRadius: 8, border: '1px solid var(--border-md)' }}>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid size={15} /> Grid
          </button>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '6px 12px', fontSize: '0.8rem' }}
            onClick={() => setViewMode('table')}
          >
            <List size={15} /> List
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No tournaments found"
          text={statusFilter === 'all'
            ? (isOwner ? 'Create your first tournament to get started.' : 'You have not been assigned to any tournament projects yet.')
            : `No tournaments with status "${statusFilter}".`}
          action={statusFilter === 'all' && isOwner && (
            <Link href="/tournaments/new" className="btn btn-primary">
              <Plus size={16} /> New Tournament
            </Link>
          )}
        />
      ) : viewMode === 'grid' ? (
        /* Grid View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filtered.map(t => {
            const bannerSrc = t.banner || t.bannerUrl;
            const dateRange = formatEventDates(t.eventStartDate, t.eventEndDate);
            const canEdit = hasAccessToTourney(t);

            return (
              <div
                key={t.id}
                style={{
                  background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.75) 0%, rgba(15, 23, 42, 0.95) 100%)',
                  border: '1px solid var(--border-md)',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                  transition: 'all 0.2s ease',
                }}
              >
                {/* Banner or Header */}
                {bannerSrc ? (
                  <img src={bannerSrc} alt="" style={{ width: '100%', height: '120px', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                ) : (
                  <div style={{ height: '120px', background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--border)' }}>
                    <Trophy size={38} className="text-gold" style={{ opacity: 0.85 }} />
                  </div>
                )}

                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        {t.season || '—'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {isOperator && (
                          canEdit ? (
                            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                              Editor
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(148, 163, 184, 0.15)', color: 'var(--text-muted)', border: '1px solid rgba(148, 163, 184, 0.3)' }}>
                              Read-Only
                            </span>
                          )
                        )}
                        {t.isRanked && <TierBadge tier={t.rankedTier} size="xs" />}
                        <StatusBadge status={t.status} />
                      </div>
                    </div>

                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, lineHeight: 1.3 }}>
                      {t.name}
                    </h3>

                    {/* Prominent Event Date Range */}
                    {dateRange && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '0.8rem', color: 'var(--gold)', fontWeight: 600 }}>
                        <Calendar size={13} style={{ flexShrink: 0 }} />
                        <span>{dateRange}</span>
                      </div>
                    )}
                  </div>

                  {t.description && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineClamp: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {t.description}
                    </p>
                  )}

                  {/* Metadata Chips */}
                  <div style={{ display: 'flex', gap: '10px', background: 'rgba(15, 23, 42, 0.6)', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 'auto' }}>
                    <div>Days: <strong style={{ color: 'var(--text-primary)' }}>{t.structure?.totalDays ?? '—'}</strong></div>
                    <div>Lobbies: <strong style={{ color: 'var(--text-primary)' }}>{t.structure?.lobbiesPerDay ?? '—'}</strong></div>
                    <div>Type: <strong style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>{t.type || 'standard'}</strong></div>
                  </div>
                </div>

                {/* Card Actions */}
                <div style={{ padding: '12px 16px', background: 'rgba(15, 23, 42, 0.9)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Link href={`/tournaments/${t.id}`} className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center' }}>
                    {canEdit ? 'Open Hub' : 'View Hub (Read-Only)'}
                  </Link>
                  {isOwner && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--danger)', marginLeft: '8px', padding: '6px' }}
                      onClick={() => openDeleteModal(t.id, t.name)}
                      title="Delete Tournament"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <DataTable
          columns={columns}
          data={filtered}
          searchPlaceholder="Search by name or season..."
        />
      )}

      {/* Delete Confirmation Modal (Owner Only) */}
      {isOwner && deletingId && (
        <Modal title="⚠ Delete Tournament" onClose={closeDeleteModal}>
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              You are about to permanently delete <strong className="text-text-primary">{deletingName}</strong>.
              All match results, configurations, registrations, bonuses, and stats will be gone forever.
            </p>

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
