'use client';
import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { getTournaments, deleteTournament, updateTournament } from '@/lib/firestore/tournaments';
import { formatEventDates } from '@/lib/utils/dateUtils';
import DataTable from '@/components/ui/DataTable';
import { StatusBadge, TierBadge } from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import Modal from '@/components/ui/Modal';
import {
  Plus, Trophy, Trash2, Calendar, LayoutGrid, List, Search,
  Medal, Eye, Edit3, ShieldAlert, Building2, ChevronDown, ChevronRight,
  Folder, FolderOpen, X, Sparkles, ExternalLink
} from 'lucide-react';
import toast from 'react-hot-toast';
import useSWR from 'swr';

const STATUS_OPTIONS = ['all', 'setup', 'active', 'completed', 'archived'];

export default function TournamentsListPage() {
  const { user, isOwner, isOperator } = useAuth();
  const { data: tournaments = [], isLoading: loading, mutate } = useSWR('tournaments', getTournaments);
  const [statusFilter, setStatusFilter] = useState('all');
  const [orgFilter, setOrgFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('folders'); // 'folders' | 'grid' | 'table'

  // Expanded Mobile-Style Folder state: holds the organisation name currently open, or null
  const [openedFolderOrg, setOpenedFolderOrg] = useState(null);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [folderViewMode, setFolderViewMode] = useState('grid'); // 'grid' | 'table' inside opened folder

  // Quick edit organisation modal state (for easily tagging past/current events)
  const [editingOrgTournament, setEditingOrgTournament] = useState(null);
  const [orgInput, setOrgInput] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState(null);
  const [deletingName, setDeletingName] = useState('');
  const [deleteChecked1, setDeleteChecked1] = useState(false);
  const [deleteChecked2, setDeleteChecked2] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Close opened folder on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && openedFolderOrg) {
        setOpenedFolderOrg(null);
        setFolderSearchQuery('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openedFolderOrg]);

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

  const checkCanEdit = (t) => {
    if (isOwner) return true;
    const userEmail = user?.email?.toLowerCase();
    const isCreator = (t.createdBy && t.createdBy === user?.uid) ||
      (userEmail && t.creatorEmail && t.creatorEmail.toLowerCase() === userEmail);
    const editors = t.editorUids || [];
    const isAssigned = editors.some(e => e === user?.uid || (userEmail && e.toLowerCase() === userEmail));
    return Boolean(isCreator || isAssigned);
  };

  const openQuickOrgModal = (t) => {
    setEditingOrgTournament(t);
    setOrgInput(t.organisationName || t.organizationName || '');
  };

  const handleSaveQuickOrg = async () => {
    if (!editingOrgTournament) return;
    setSavingOrg(true);
    try {
      const trimmedOrg = orgInput.trim();
      await updateTournament(editingOrgTournament.id, {
        organisationName: trimmedOrg,
      });
      toast.success('Organisation updated!');
      mutate(
        tournaments.map(t => t.id === editingOrgTournament.id ? { ...t, organisationName: trimmedOrg } : t),
        false
      );
      mutate();
      setEditingOrgTournament(null);
    } catch (err) {
      toast.error('Failed to update organisation: ' + err.message);
    } finally {
      setSavingOrg(false);
    }
  };

  // List of all distinct organisations currently in tournaments
  const allExistingOrgs = useMemo(() => {
    return Array.from(new Set(
      tournaments
        .map(t => (t.organisationName || t.organizationName || '').trim())
        .filter(Boolean)
    )).sort();
  }, [tournaments]);

  // Filter tournaments by status, organisation, and search
  const filtered = useMemo(() => {
    return tournaments.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      const tOrg = (t.organisationName || t.organizationName || '').trim();
      if (orgFilter !== 'all') {
        if (orgFilter === '__unassigned__') {
          if (tOrg) return false;
        } else if (tOrg.toLowerCase() !== orgFilter.toLowerCase()) {
          return false;
        }
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const nameMatch = t.name?.toLowerCase().includes(q);
      const orgMatch = tOrg.toLowerCase().includes(q);
      const seasonMatch = t.season?.toLowerCase().includes(q);
      const dateStr = formatEventDates(t.eventStartDate, t.eventEndDate)?.toLowerCase();
      const dateMatch = dateStr?.includes(q);
      return nameMatch || orgMatch || seasonMatch || dateMatch;
    });
  }, [tournaments, statusFilter, orgFilter, searchQuery]);

  // Group tournaments by organisation
  const grouped = useMemo(() => {
    const map = {};
    filtered.forEach(t => {
      const org = (t.organisationName || t.organizationName || '').trim() || 'Independent / Unassigned';
      if (!map[org]) map[org] = [];
      map[org].push(t);
    });
    return map;
  }, [filtered]);

  const orgKeys = useMemo(() => {
    return Object.keys(grouped).sort((a, b) => {
      if (a === 'Independent / Unassigned') return 1;
      if (b === 'Independent / Unassigned') return -1;
      return a.localeCompare(b);
    });
  }, [grouped]);

  // Events belonging to the currently opened mobile-style folder
  const activeFolderTournaments = useMemo(() => {
    if (!openedFolderOrg) return [];
    const list = grouped[openedFolderOrg] || [];
    if (!folderSearchQuery.trim()) return list;
    const q = folderSearchQuery.toLowerCase().trim();
    return list.filter(t => {
      const nameMatch = t.name?.toLowerCase().includes(q);
      const seasonMatch = t.season?.toLowerCase().includes(q);
      const dateStr = formatEventDates(t.eventStartDate, t.eventEndDate)?.toLowerCase();
      return nameMatch || seasonMatch || dateStr?.includes(q);
    });
  }, [openedFolderOrg, grouped, folderSearchQuery]);

  const columns = [
    {
      header: 'Event Name',
      accessor: 'name',
      render: (t) => {
        const bannerSrc = t.banner || t.bannerUrl;
        const dateRange = formatEventDates(t.eventStartDate, t.eventEndDate);
        const canEdit = checkCanEdit(t);
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
    {
      header: 'Organisation',
      accessor: 'organisationName',
      render: (t) => {
        const org = (t.organisationName || t.organizationName || '').trim();
        const canEdit = checkCanEdit(t);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {org ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, color: 'var(--gold)', fontSize: '0.82rem' }}>
                <Building2 size={13} />
                {org}
              </span>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontStyle: 'italic' }}>Independent</span>
            )}
            {canEdit && (
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                style={{ padding: '2px 4px', color: 'var(--text-muted)' }}
                onClick={(e) => {
                  e.stopPropagation();
                  openQuickOrgModal(t);
                }}
                title="Edit Organisation"
              >
                <Edit3 size={11} />
              </button>
            )}
          </div>
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
        const canEdit = checkCanEdit(t);
        return (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Link href={`/tournaments/${t.id}`} className="btn btn-secondary btn-sm">
              {canEdit ? 'Open' : 'View (Read-Only)'}
            </Link>
            {canEdit && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--gold)', padding: '5px 8px' }}
                onClick={() => openQuickOrgModal(t)}
                title="Edit Organisation"
              >
                <Building2 size={14} />
              </button>
            )}
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

  // Helper to render an individual tournament grid card
  const renderCard = (t) => {
    const bannerSrc = t.banner || t.bannerUrl;
    const dateRange = formatEventDates(t.eventStartDate, t.eventEndDate);
    const canEdit = checkCanEdit(t);
    const org = (t.organisationName || t.organizationName || '').trim();

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
            {/* Top row with Organisation badge & Season */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span
                  onClick={() => canEdit && openQuickOrgModal(t)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 4,
                    background: org ? 'rgba(201,168,76,0.14)' : 'rgba(255,255,255,0.05)',
                    color: org ? 'var(--gold)' : 'var(--text-muted)',
                    border: `1px solid ${org ? 'rgba(201,168,76,0.3)' : 'var(--border-md)'}`,
                    cursor: canEdit ? 'pointer' : 'default',
                    transition: 'all 0.15s',
                  }}
                  title={canEdit ? 'Click to change organisation' : undefined}
                >
                  <Building2 size={11} />
                  {org || 'No Organisation'}
                  {canEdit && <Edit3 size={9} style={{ opacity: 0.7, marginLeft: 2 }} />}
                </span>

                {t.season && (
                  <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    {t.season}
                  </span>
                )}
              </div>

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
          {canEdit && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--gold)', marginLeft: '6px', padding: '6px' }}
              onClick={() => openQuickOrgModal(t)}
              title="Change Organisation"
            >
              <Building2 size={15} />
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--danger)', marginLeft: '6px', padding: '6px' }}
              onClick={() => openDeleteModal(t.id, t.name)}
              title="Delete Tournament"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
    );
  };

  // Helper to render Mobile-App Style Frosted Glass Folder Card
  const renderFolderCard = (orgName) => {
    const orgTourneys = grouped[orgName] || [];
    const isUnassigned = orgName === 'Independent / Unassigned';
    const previewItems = orgTourneys.slice(0, 4);
    const overflowCount = orgTourneys.length - 3;
    const hasActive = orgTourneys.some(t => t.status === 'active');

    return (
      <div
        key={orgName}
        onClick={() => {
          setOpenedFolderOrg(orgName);
          setFolderSearchQuery('');
        }}
        style={{
          position: 'relative',
          borderRadius: '26px',
          padding: '18px',
          background: 'linear-gradient(145deg, rgba(25, 36, 56, 0.55) 0%, rgba(13, 20, 36, 0.8) 100%)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: isUnassigned
            ? '1px solid rgba(255, 255, 255, 0.1)'
            : '1px solid rgba(201, 168, 76, 0.28)',
          boxShadow: '0 16px 36px -10px rgba(0, 0, 0, 0.5), inset 0 1px 1px 0 rgba(255, 255, 255, 0.18)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          userSelect: 'none',
          overflow: 'hidden',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-5px) scale(1.015)';
          e.currentTarget.style.boxShadow = '0 24px 48px -10px rgba(0, 0, 0, 0.65), 0 0 24px rgba(201, 168, 76, 0.2), inset 0 1px 2px rgba(255, 255, 255, 0.3)';
          e.currentTarget.style.borderColor = 'rgba(201, 168, 76, 0.5)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'none';
          e.currentTarget.style.boxShadow = '0 16px 36px -10px rgba(0, 0, 0, 0.5), inset 0 1px 1px 0 rgba(255, 255, 255, 0.18)';
          e.currentTarget.style.borderColor = isUnassigned ? 'rgba(255, 255, 255, 0.1)' : 'rgba(201, 168, 76, 0.28)';
        }}
      >
        {/* Subtle glossy sheen line across top */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: '10%',
          right: '10%',
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent)',
          pointerEvents: 'none',
        }} />

        {/* 2x2 Mini Preview Grid (Mobile App Folder Style) */}
        <div style={{
          width: '100%',
          aspectRatio: '1',
          background: 'rgba(10, 15, 29, 0.65)',
          backdropFilter: 'blur(10px)',
          borderRadius: '18px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '10px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: '8px',
          overflow: 'hidden',
          boxShadow: 'inset 0 2px 8px rgba(0, 0, 0, 0.4)',
        }}>
          {Array.from({ length: 4 }).map((_, slotIdx) => {
            const item = previewItems[slotIdx];
            const isOverflowCell = slotIdx === 3 && orgTourneys.length > 4;

            if (!item) {
              // Empty placeholder slot inside folder
              return (
                <div
                  key={slotIdx}
                  style={{
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px dashed rgba(255, 255, 255, 0.06)',
                  }}
                />
              );
            }

            const bannerSrc = item.banner || item.bannerUrl;

            return (
              <div
                key={item.id || slotIdx}
                style={{
                  position: 'relative',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {bannerSrc ? (
                  <img
                    src={bannerSrc}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <Trophy size={16} className="text-gold" style={{ opacity: 0.75 }} />
                )}

                {/* +N badge for 4th cell if more items exist */}
                {isOverflowCell && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(10, 15, 29, 0.75)',
                    backdropFilter: 'blur(6px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    color: 'var(--gold)',
                    letterSpacing: '0.04em',
                    textShadow: '0 2px 4px rgba(0,0,0,0.6)',
                  }}>
                    +{overflowCount}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Folder Meta Information */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <h3 style={{
              fontSize: '1.05rem',
              fontWeight: 800,
              color: isUnassigned ? 'var(--text-secondary)' : 'var(--text-primary)',
              margin: 0,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {orgName}
            </h3>

            {hasActive && (
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 8px #22c55e',
                  flexShrink: 0,
                }}
                title="Active events inside"
              />
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: '0.72rem',
              fontWeight: 700,
              color: isUnassigned ? 'var(--text-muted)' : 'var(--gold)',
              background: isUnassigned ? 'rgba(255,255,255,0.05)' : 'rgba(201,168,76,0.12)',
              border: `1px solid ${isUnassigned ? 'var(--border-md)' : 'rgba(201,168,76,0.25)'}`,
              padding: '2px 8px',
              borderRadius: 99,
            }}>
              <Folder size={11} />
              {orgTourneys.length} {orgTourneys.length === 1 ? 'Event' : 'Events'}
            </span>

            <span style={{
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              fontWeight: 600,
            }}>
              <span>Open</span>
              <ChevronRight size={13} />
            </span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <LoadingSpinner size="lg" text="Loading tournaments..." />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tournaments & Events</h1>
          <p className="page-subtitle">Browse competitions grouped in modern organisation folders</p>
        </div>
        <Link href="/tournaments/new" className="btn btn-primary">
          <Plus size={16} />
          New Tournament
        </Link>
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
                {tournaments.filter(t => t.status === s).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Toolbar: Search + Org Filter + Mode Switcher */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 260, flexWrap: 'wrap' }}>
          <div className="search-input-wrap" style={{ flex: 1, minWidth: 220, maxWidth: 360 }}>
            <Search size={15} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Search by event name, organisation, season..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Organisation Filter Dropdown */}
          {allExistingOrgs.length > 0 && (
            <select
              className="form-select"
              value={orgFilter}
              onChange={e => setOrgFilter(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '6px 12px', minWidth: 160, maxWidth: 220, height: 38 }}
            >
              <option value="all">All Organisations ({allExistingOrgs.length})</option>
              {allExistingOrgs.map(org => (
                <option key={org} value={org}>{org}</option>
              ))}
              <option value="__unassigned__">Independent / Unassigned</option>
            </select>
          )}
        </div>

        {/* View Switcher: Folders | Flat Grid | Table */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-card)', padding: '3px', borderRadius: 10, border: '1px solid var(--border-md)' }}>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'folders' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setViewMode('folders')}
            title="App-style folder grouping"
          >
            <Folder size={14} /> Folders
          </button>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setViewMode('grid')}
            title="Flat grid view"
          >
            <LayoutGrid size={14} /> Flat Grid
          </button>
          <button
            type="button"
            className={`btn btn-sm ${viewMode === 'table' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ padding: '6px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => setViewMode('table')}
            title="Table list view"
          >
            <List size={14} /> Table
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No tournaments found"
          text={statusFilter === 'all' && orgFilter === 'all' && !searchQuery
            ? 'Create your first tournament to get started.'
            : `No tournaments matching current filters.`}
          action={statusFilter === 'all' && (
            <Link href="/tournaments/new" className="btn btn-primary">
              <Plus size={16} /> New Tournament
            </Link>
          )}
        />
      ) : viewMode === 'folders' ? (
        /* ── Modern Mobile App Folder Grid ─────────────────────────────── */
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
            gap: '24px',
          }}>
            {orgKeys.map(orgName => renderFolderCard(orgName))}
          </div>

          <div style={{ textAlign: 'center', marginTop: 36, color: 'var(--text-muted)', fontSize: '0.78rem' }}>
            Click on any folder card above to open and explore its tournaments in full detail.
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        /* ── Flat Grid View ───────────────────────────────────────────── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filtered.map(t => renderCard(t))}
        </div>
      ) : (
        /* ── Table View ───────────────────────────────────────────────── */
        <DataTable
          columns={columns}
          data={filtered}
          searchPlaceholder="Search by event name or season..."
        />
      )}

      {/* ── EXPANDED MOBILE-STYLE FOLDER MODAL / SHEET ──────────────────── */}
      {openedFolderOrg && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'rgba(5, 10, 20, 0.75)',
            backdropFilter: 'blur(24px) saturate(190%)',
            WebkitBackdropFilter: 'blur(24px) saturate(190%)',
            animation: 'fadeIn 0.2s ease-out',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpenedFolderOrg(null);
              setFolderSearchQuery('');
            }
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '1180px',
              maxHeight: '88vh',
              background: 'linear-gradient(155deg, rgba(26, 38, 57, 0.88) 0%, rgba(13, 20, 36, 0.96) 100%)',
              backdropFilter: 'blur(36px)',
              WebkitBackdropFilter: 'blur(36px)',
              border: '1px solid rgba(201, 168, 76, 0.35)',
              borderRadius: '28px',
              boxShadow: '0 30px 80px -15px rgba(0, 0, 0, 0.85), inset 0 1px 2px rgba(255, 255, 255, 0.25), 0 0 40px rgba(201, 168, 76, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Top Glossy Bar */}
            <div style={{
              height: '3px',
              background: 'linear-gradient(90deg, transparent, #b8860b, #C9A84C, #d4a017, transparent)',
              width: '100%',
            }} />

            {/* Folder Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 16,
              background: 'rgba(15, 23, 42, 0.4)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, rgba(201,168,76,0.3) 0%, rgba(201,168,76,0.08) 100%)',
                  border: '1px solid rgba(201,168,76,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 14px rgba(201,168,76,0.2)',
                  flexShrink: 0,
                }}>
                  <FolderOpen size={22} style={{ color: 'var(--gold)' }} />
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
                      {openedFolderOrg}
                    </h2>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '3px 9px',
                      borderRadius: 99,
                      background: 'rgba(201,168,76,0.14)',
                      border: '1px solid rgba(201,168,76,0.35)',
                      color: 'var(--gold)',
                    }}>
                      {(grouped[openedFolderOrg] || []).length} Events
                    </span>
                  </div>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '3px 0 0' }}>
                    Showing all tournaments and events organized by {openedFolderOrg}
                  </p>
                </div>
              </div>

              {/* Controls inside folder: search, view toggle, and close */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div className="search-input-wrap" style={{ minWidth: 200, maxWidth: 280 }}>
                  <Search size={14} className="search-icon" />
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Search in this folder..."
                    value={folderSearchQuery}
                    onChange={e => setFolderSearchQuery(e.target.value)}
                    style={{ height: 34, fontSize: '0.8rem' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'rgba(15, 23, 42, 0.6)', padding: '2px', borderRadius: 8, border: '1px solid var(--border-md)' }}>
                  <button
                    type="button"
                    className={`btn btn-xs ${folderViewMode === 'grid' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ padding: '5px 9px' }}
                    onClick={() => setFolderViewMode('grid')}
                  >
                    <LayoutGrid size={13} />
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs ${folderViewMode === 'table' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ padding: '5px 9px' }}
                    onClick={() => setFolderViewMode('table')}
                  >
                    <List size={13} />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setOpenedFolderOrg(null);
                    setFolderSearchQuery('');
                  }}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: 'rgba(255, 255, 255, 0.08)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                    e.currentTarget.style.borderColor = 'var(--danger)';
                    e.currentTarget.style.color = '#ef4444';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                  title="Close Folder (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Folder Body */}
            <div style={{
              padding: '24px',
              overflowY: 'auto',
              flex: 1,
            }}>
              {activeFolderTournaments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                  No tournaments match &quot;{folderSearchQuery}&quot; in this folder.
                </div>
              ) : folderViewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {activeFolderTournaments.map(t => renderCard(t))}
                </div>
              ) : (
                <DataTable
                  columns={columns}
                  data={activeFolderTournaments}
                  searchPlaceholder="Filter folder events..."
                />
              )}
            </div>

            {/* Folder Footer */}
            <div style={{
              padding: '12px 24px',
              background: 'rgba(10, 15, 29, 0.7)',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.78rem',
              color: 'var(--text-muted)',
            }}>
              <span>
                Tip: Click <strong>&quot;Open Hub&quot;</strong> on any tournament card to manage matches, entries, and standings.
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => {
                  setOpenedFolderOrg(null);
                  setFolderSearchQuery('');
                }}
              >
                Close Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Assign Organisation Modal ─────────────────────────────── */}
      {editingOrgTournament && (
        <Modal
          title="Assign Organisation"
          onClose={() => setEditingOrgTournament(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Update the host organisation for <strong className="text-text-primary">{editingOrgTournament.name}</strong>. This organizes previous events under the same banner on your dashboard.
            </p>

            <div className="form-field">
              <label className="form-label">Organisation Name</label>
              <input
                className="form-input"
                value={orgInput}
                onChange={e => setOrgInput(e.target.value)}
                placeholder="e.g. Heaven Esports, ESL Gaming, Activision"
                list="quick-modal-orgs"
                autoFocus
              />
              {allExistingOrgs.length > 0 && (
                <datalist id="quick-modal-orgs">
                  {allExistingOrgs.map((org, i) => (
                    <option key={i} value={org} />
                  ))}
                </datalist>
              )}
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Enter an existing organisation or type a new one. Leave blank to mark as Independent.
              </span>
            </div>

            {/* Quick select buttons */}
            {allExistingOrgs.length > 0 && (
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Quick select from existing organisations:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {allExistingOrgs.map((org, i) => (
                    <button
                      key={i}
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => setOrgInput(org)}
                      style={{
                        fontSize: '0.72rem',
                        borderColor: orgInput.toLowerCase() === org.toLowerCase() ? 'var(--gold)' : undefined,
                        color: orgInput.toLowerCase() === org.toLowerCase() ? 'var(--gold)' : undefined,
                      }}
                    >
                      <Building2 size={11} /> {org}
                    </button>
                  ))}
                  {orgInput && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => setOrgInput('')}
                      style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setEditingOrgTournament(null)}
                disabled={savingOrg}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={savingOrg}
                onClick={handleSaveQuickOrg}
              >
                {savingOrg ? 'Saving...' : 'Save Organisation'}
              </button>
            </div>
          </div>
        </Modal>
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
