'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { getTournaments, deleteTournament } from '@/lib/firestore/tournaments';
import { formatEventDates } from '@/lib/utils/dateUtils';
import DataTable from '@/components/ui/DataTable';
import { StatusBadge, TierBadge } from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import {
  FolderGit2, Plus, Trophy, Calendar, LayoutGrid, List, Search,
  ArrowRight, ClipboardList, Zap, BarChart2, Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';
import useSWR from 'swr';

const STATUS_OPTIONS = ['all', 'setup', 'active', 'completed', 'archived'];

export default function MyProjectsPage() {
  const { user, isOwner } = useAuth();
  const { data: tournaments = [], isLoading: loading, mutate } = useSWR('tournaments', getTournaments);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'table'

  // Delete modal state (if owner/creator)
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
      mutate(tournaments.filter(t => t.id !== deletingId), false);
      mutate();
    } catch (err) {
      toast.error('Failed to delete tournament: ' + err.message);
    } finally {
      setConfirming(false);
    }
  };

  // Strictly filter tournaments belonging to the user:
  // Must be creator OR assigned in editorUids (NO isOwner bypass)
  const userEmail = user?.email?.toLowerCase();
  const userUid = user?.uid;

  const isUserProject = (t) => {
    if (!userUid && !userEmail) return false;
    const isCreator = (t.createdBy && t.createdBy === userUid) ||
      (userEmail && t.creatorEmail && t.creatorEmail.toLowerCase() === userEmail);
    const editors = t.editorUids || [];
    const isAssigned = editors.some(e => e === userUid || (userEmail && e.toLowerCase() === userEmail));
    return Boolean(isCreator || isAssigned);
  };

  const getUserRoleInProject = (t) => {
    const isCreator = (t.createdBy && t.createdBy === userUid) ||
      (userEmail && t.creatorEmail && t.creatorEmail.toLowerCase() === userEmail);
    if (isCreator) return { label: 'Creator', color: 'var(--gold)', bg: 'rgba(201, 168, 76, 0.15)', border: 'rgba(201, 168, 76, 0.3)' };
    return { label: 'Assigned Editor', color: '#38BDF8', bg: 'rgba(14, 165, 233, 0.15)', border: 'rgba(14, 165, 233, 0.3)' };
  };

  const myProjects = tournaments.filter(isUserProject);

  const filteredProjects = myProjects.filter(t => {
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
        const roleInfo = getUserRoleInProject(t);
        return (
          <Link href={`/tournaments/${t.id}`} className="text-gold" style={{ fontWeight: 600 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {bannerSrc ? (
                <img src={bannerSrc} alt="" style={{ width: 44, height: 28, borderRadius: 6, objectFit: 'cover', background: 'var(--bg-header)', border: '1px solid var(--border-md)' }} referrerPolicy="no-referrer" />
              ) : (
                <div style={{ width: 44, height: 28, borderRadius: 6, background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border-md)' }}>
                  <Trophy size={13} className="text-gold" style={{ opacity: 0.8 }} />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{t.name}</span>
                  <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 4, background: roleInfo.bg, color: roleInfo.color, border: `1px solid ${roleInfo.border}`, fontWeight: 700 }}>
                    {roleInfo.label}
                  </span>
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
      header: 'Actions',
      key: 'actions',
      render: (t) => (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Link href={`/tournaments/${t.id}`} className="btn btn-secondary btn-sm">
            Manage Hub
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
      ),
    },
  ];

  if (loading) return <LoadingSpinner size="lg" text="Loading your projects..." />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 className="page-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FolderGit2 className="text-gold" size={26} />
              My Projects
            </h1>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 800,
              color: 'var(--gold)',
              background: 'rgba(201, 168, 76, 0.15)',
              padding: '3px 10px',
              borderRadius: 6,
              border: '1px solid rgba(201, 168, 76, 0.3)',
            }}>
              {myProjects.length} Project{myProjects.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="page-subtitle" style={{ margin: 0 }}>
            Tournaments you created or have assigned editor permissions to manage
          </p>
        </div>

        <Link href="/tournaments/new" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Plus size={16} />
          New Tournament
        </Link>
      </div>

      {/* Status Filter Tabs */}
      <div className="tab-bar">
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
                {myProjects.filter(t => t.status === s).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Toolbar: Search + View Mode Switcher */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div className="search-input-wrap" style={{ flex: 1, minWidth: 240, maxWidth: 360 }}>
          <Search size={15} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search your projects by name or season..."
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

      {/* Content Rendering */}
      {filteredProjects.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title={myProjects.length === 0 ? "No personal projects yet" : "No matching projects found"}
          text={myProjects.length === 0
            ? "You haven't created any tournament projects or been assigned editor permissions yet. Create a tournament to get started!"
            : `No projects match the current search and "${statusFilter}" filter.`}
          action={
            <Link href="/tournaments/new" className="btn btn-primary">
              <Plus size={16} /> Create Tournament
            </Link>
          }
        />
      ) : viewMode === 'grid' ? (
        /* Grid View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredProjects.map(tourney => {
            const bannerSrc = tourney.banner || tourney.bannerUrl;
            const dateRange = formatEventDates(tourney.eventStartDate, tourney.eventEndDate);
            const roleInfo = getUserRoleInProject(tourney);

            return (
              <div
                key={tourney.id}
                style={{
                  background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.98) 100%)',
                  border: '1px solid rgba(201, 168, 76, 0.25)',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
                  transition: 'all 0.25s ease',
                }}
                className="hover:border-gold/60"
              >
                {/* Banner Area */}
                {bannerSrc ? (
                  <div style={{ position: 'relative', height: '120px' }}>
                    <img src={bannerSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                    <div style={{ position: 'absolute', top: 10, right: 10 }}>
                      <StatusBadge status={tourney.status} />
                    </div>
                  </div>
                ) : (
                  <div style={{
                    height: '120px',
                    background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.15) 0%, rgba(15, 23, 42, 0.95) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                  }}>
                    <Trophy size={38} className="text-gold" style={{ opacity: 0.85, filter: 'drop-shadow(0 4px 12px rgba(201, 168, 76, 0.4))' }} />
                    <div style={{ position: 'absolute', top: 10, right: 10 }}>
                      <StatusBadge status={tourney.status} />
                    </div>
                  </div>
                )}

                {/* Content Area */}
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Season {tourney.season || '—'}
                      </span>
                      <span style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        padding: '2px 7px',
                        borderRadius: 4,
                        background: roleInfo.bg,
                        color: roleInfo.color,
                        border: `1px solid ${roleInfo.border}`,
                      }}>
                        {roleInfo.label}
                      </span>
                    </div>

                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#FFFFFF', margin: 0, lineHeight: 1.3 }}>
                      {tourney.name}
                    </h3>

                    {dateRange && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '0.78rem', color: 'var(--gold)', fontWeight: 600 }}>
                        <Calendar size={13} style={{ flexShrink: 0 }} />
                        <span>{dateRange}</span>
                      </div>
                    )}
                  </div>

                  {tourney.description && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineClamp: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {tourney.description}
                    </p>
                  )}

                  {/* Quick entry links grid */}
                  <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-border/60 text-center text-xs" style={{ marginTop: 'auto' }}>
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
                </div>

                {/* Footer action */}
                <div style={{ padding: '12px 16px', background: 'rgba(15, 23, 42, 0.95)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <Link href={`/tournaments/${tourney.id}`} className="btn btn-primary btn-sm" style={{ flex: 1, justifyContent: 'center', fontSize: '0.78rem' }}>
                    Manage Hub <ArrowRight size={13} />
                  </Link>
                  {isOwner && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--danger)', padding: '6px' }}
                      onClick={() => openDeleteModal(tourney.id, tourney.name)}
                      title="Delete Tournament"
                    >
                      <Trash2 size={14} />
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
          data={filteredProjects}
          searchPlaceholder="Search your projects..."
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
