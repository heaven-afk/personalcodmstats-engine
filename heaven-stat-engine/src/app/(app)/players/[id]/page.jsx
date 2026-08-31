'use client';
import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePlayer } from './layout';
import { updatePlayer } from '@/lib/firestore/registry';
import { getTournament, getAllRegistrationsForPlayer } from '@/lib/firestore/tournaments';
import { getAllMatchResultsForPlayer } from '@/lib/firestore/matchData';
import { getGroups } from '@/lib/firestore/groups';
import { AVAILABLE_MAPS } from '@/lib/constants/maps';
import { getActiveMapConfig, getMapForMatch } from '@/lib/utils/mapConfig';
import { useAuth } from '@/contexts/AuthContext';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import DataTable from '@/components/ui/DataTable';
import { ClassBadge, TierBadge } from '@/components/ui/Badge';
import MetricTooltip from '@/components/ui/MetricTooltip';
import { ChevronLeft, User, Trophy, Calendar, Cpu, Award, Star, Flame, Camera, Upload, X, Trash2, Image as ImageIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import toast from 'react-hot-toast';
import { computePlayerGlobalForm, computePlayerCategoryForms, GLOBAL_FORM_CATEGORIES } from '@/lib/engine/globalForm';

function HistoryList({ label, items, renderItem }) {
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;
  return (
    <div style={{ marginTop: 4, paddingLeft: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '0.7rem', color: 'var(--text-muted)', padding: '2px 0',
          display: 'flex', alignItems: 'center', gap: 4
        }}
      >
        <span style={{ transition: 'transform 0.15s', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
        {label} ({items.length})
      </button>
      {open && (
        <div style={{
          marginTop: 4, padding: '8px 10px',
          background: 'var(--bg-alt-row)', borderRadius: 6,
          border: '1px solid var(--border-md)', display: 'flex', flexDirection: 'column', gap: 4
        }}>
          {items.map((item, i) => renderItem(item, i))}
        </div>
      )}
    </div>
  );
}

export default function PlayerProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const { isOwner } = useAuth();
  const { player, setPlayer } = usePlayer();

  const [history, setHistory] = useState([]);
  const [careerStats, setCareerStats] = useState({
    kills: 0,
    matches: 0,
    tournaments: 0,
    killsPerMatch: 0,
    avgDamage: 0,
    avgAccuracy: 0,
  });
  const [mapCounts, setMapCounts] = useState({ Isolated: 0, Blackout: 0, 'Rebirth Island': 0 });
  const [globalForm, setGlobalForm] = useState(null);
  const [categoryForms, setCategoryForms] = useState({});
  const [selectedFormCategory, setSelectedFormCategory] = useState('all');
  const [loading, setLoading] = useState(true);

  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoInputUrl, setPhotoInputUrl] = useState(player?.photoUrl || '');
  const [savingPhoto, setSavingPhoto] = useState(false);

  useEffect(() => {
    async function loadPlayerProfile() {
      try {
        // 1. Single collection-group queries for this player's matches and registrations
        const [playerMatches, playerRegs] = await Promise.all([
          getAllMatchResultsForPlayer(id),
          getAllRegistrationsForPlayer(id),
        ]);

        // 2. Identify only the specific tournaments this player actually participated in
        const tourneyIdSet = new Set();
        playerMatches.forEach(m => { if (m.tournamentId) tourneyIdSet.add(m.tournamentId); });
        playerRegs.forEach(r => { if (r.tournamentId) tourneyIdSet.add(r.tournamentId); });
        const tourneyIds = Array.from(tourneyIdSet);

        // 3. Fetch only those specific tournaments (bounded by player history, not platform size)
        const tournamentsList = (await Promise.all(tourneyIds.map(tId => getTournament(tId)))).filter(Boolean);

        // 4. Fetch qualifier groups only for relevant tournaments that are qualifiers
        const groupsResults = await Promise.all(
          tournamentsList.map(t => t.type === 'qualifier' ? getGroups(t.id) : Promise.resolve([]))
        );

        const playerMatchResultsByTournament = {};
        tournamentsList.forEach(t => {
          playerMatchResultsByTournament[t.id] = playerMatches.filter(m => m.tournamentId === t.id);
        });

        const catForms = computePlayerCategoryForms(id, tournamentsList, playerMatchResultsByTournament);
        setCategoryForms(catForms);
        setGlobalForm(catForms.all || computePlayerGlobalForm(id, tournamentsList, playerMatchResultsByTournament));

        const participationHistory = [];
        let totalKills = 0;
        let totalMatches = 0;
        let totalDamage = 0;
        let totalAccSum = 0;
        let totalAccCount = 0;

        const counts = { Isolated: 0, Blackout: 0, 'Rebirth Island': 0 };

        tournamentsList.forEach((t, i) => {
          const tMatches = playerMatches.filter(m => m.tournamentId === t.id);
          const tReg = playerRegs.find(r => r.tournamentId === t.id);
          const gList = groupsResults[i] || [];
          const gMap = Object.fromEntries(gList.map(g => [g.id, g]));

          // Per-map count for player
          tMatches.forEach(m => {
            const group = m.groupId ? gMap[m.groupId] : null;
            const mapConfig = getActiveMapConfig(t, group);
            const mapName = getMapForMatch(mapConfig, m.day, m.lobby);
            if (mapName && counts[mapName] !== undefined) {
              counts[mapName]++;
            }
          });

          // Check if player registered or played
          if (tReg || tMatches.length > 0) {
            const tKills = tMatches.reduce((sum, m) => sum + (m.kills || 0), 0);
            const tMatchCount = tMatches.length;
            const tDamage = tMatches.reduce((sum, m) => sum + (m.damage || 0), 0);
            const validAcc = tMatches.filter(m => m.accuracy != null && m.accuracy > 0);
            const tAccAvg = validAcc.length > 0 ? (validAcc.reduce((sum, m) => sum + m.accuracy, 0) / validAcc.length) : 0;

            totalKills += tKills;
            totalMatches += tMatchCount;
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
              isRanked: t.isRanked || false,
              rankedTier: t.rankedTier || null,
              teamName: tReg?.teamName || tMatches[0]?.teamName || '—',
              class: tReg?.class || 'Class 1',
              ign: tReg?.ign || player?.currentIGN || player?.ign || '—',
              kills: tKills,
              matches: tMatchCount,
              killsPerMatch: tMatchCount > 0 ? Math.round((tKills / tMatchCount) * 100) / 100 : 0,
              avgDamage: tMatchCount > 0 ? Math.round(tDamage / tMatchCount) : 0,
              avgAccuracy: tAccAvg,
            });
          }
        });

        setMapCounts(counts);
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
  }, [id, router, player]);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size exceeds 5MB limit');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setPhotoInputUrl(dataUrl);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleSavePhoto = async () => {
    if (!isOwner) {
      toast.error('Only the owner can edit player photos');
      return;
    }
    setSavingPhoto(true);
    try {
      const finalUrl = photoInputUrl.trim();
      await updatePlayer(id, { photoUrl: finalUrl });
      setPlayer(prev => ({ ...prev, photoUrl: finalUrl }));
      toast.success('Player photo updated!');
      setPhotoModalOpen(false);
    } catch (err) {
      toast.error('Failed to update photo: ' + err.message);
    } finally {
      setSavingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!isOwner) {
      toast.error('Only the owner can remove player photos');
      return;
    }
    setSavingPhoto(true);
    try {
      await updatePlayer(id, { photoUrl: '' });
      setPlayer(prev => ({ ...prev, photoUrl: '' }));
      setPhotoInputUrl('');
      toast.success('Player photo removed');
      setPhotoModalOpen(false);
    } catch (err) {
      toast.error('Failed to remove photo: ' + err.message);
    } finally {
      setSavingPhoto(false);
    }
  };

  if (loading) return <LoadingSpinner size="lg" text="Loading player profile..." />;
  if (!player) return null;

  const initial = (player.professionalName || player.ign || '?')[0].toUpperCase();

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
    {
      header: 'Ranked Tier',
      accessor: 'rankedTier',
      render: (row) => row.isRanked
        ? <TierBadge tier={row.rankedTier} size="xs" />
        : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="btn btn-secondary btn-sm p-2" onClick={() => router.push('/players')}>
            <ChevronLeft size={16} />
          </button>

          {/* Player Avatar Header Frame */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {player.photoUrl ? (
              <img
                src={player.photoUrl}
                alt={player.professionalName}
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '2px solid var(--border-gold)',
                  boxShadow: '0 0 16px rgba(201, 168, 76, 0.25)',
                }}
              />
            ) : (
              <div style={{
                width: 58,
                height: 58,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(201,168,76,0.25), rgba(59,130,246,0.2))',
                border: '2px solid var(--border-gold)',
                boxShadow: '0 0 16px rgba(201, 168, 76, 0.15)',
                color: 'var(--gold)',
                fontWeight: 800,
                fontSize: '1.4rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {initial}
              </div>
            )}
            {isOwner && (
              <button
                onClick={() => {
                  setPhotoInputUrl(player.photoUrl || '');
                  setPhotoModalOpen(true);
                }}
                title="Edit Player Photo"
                style={{
                  position: 'absolute',
                  bottom: -2,
                  right: -2,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: 'var(--gold)',
                  color: '#000',
                  border: '2px solid var(--bg-card)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                  transition: 'transform 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              >
                <Camera size={11} />
              </button>
            )}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 className="page-title">{player.professionalName}</h1>
              {player.rankedTier && <TierBadge tier={player.rankedTier} />}
              {globalForm && globalForm.confidence !== 'unranked' && (
                <MetricTooltip metricKey="global_form">
                  <span className="badge" style={{
                    background: 'rgba(201, 168, 76, 0.15)',
                    color: 'var(--gold)',
                    border: '1px solid var(--border-gold)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: '0.75rem',
                  }}>
                    <Flame size={12} /> Global Form: {globalForm.decayedForm} ({globalForm.trend === 'up' ? '↑' : globalForm.trend === 'down' ? '↓' : '→'})
                  </span>
                </MetricTooltip>
              )}
            </div>
            <p className="page-subtitle">IGN: {player.currentIGN || player.ign || '—'} · Region: {player.region || '—'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Identity & Career Totals */}
        <div className="space-y-6">
          {/* Identity Card */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
              <h2 className="card-title flex items-center gap-2" style={{ margin: 0 }}>
                <User size={18} className="text-gold" />
                Player Details
              </h2>
              {isOwner && (
                <button
                  onClick={() => {
                    setPhotoInputUrl(player.photoUrl || '');
                    setPhotoModalOpen(true);
                  }}
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.72rem', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Camera size={12} /> Edit Photo
                </button>
              )}
            </div>

            {/* Avatar Spotlight Banner */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px 12px',
              marginBottom: 16,
              background: 'var(--bg-alt-row)',
              border: '1px solid var(--border-md)',
              borderRadius: 10
            }}>
              {player.photoUrl ? (
                <img
                  src={player.photoUrl}
                  alt={player.professionalName}
                  style={{
                    width: 90,
                    height: 90,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '3px solid var(--border-gold)',
                    boxShadow: '0 0 20px rgba(201, 168, 76, 0.3)',
                    marginBottom: 10
                  }}
                />
              ) : (
                <div style={{
                  width: 90,
                  height: 90,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, rgba(201,168,76,0.25), rgba(59,130,246,0.2))',
                  border: '3px solid var(--border-gold)',
                  boxShadow: '0 0 20px rgba(201, 168, 76, 0.2)',
                  color: 'var(--gold)',
                  fontWeight: 800,
                  fontSize: '2.2rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 10
                }}>
                  {initial}
                </div>
              )}
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {player.professionalName}
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {(player.currentIGN || player.ign) ? `IGN: ${player.currentIGN || player.ign}` : 'No IGN Registered'}
              </span>
            </div>

            <div className="space-y-3.5 text-sm">
              {/* Pro Name — immutable */}
              <div className="flex-between">
                <span className="text-text-muted">Pro Name</span>
                <span className="font-semibold text-text-primary">{player.professionalName}</span>
              </div>

              {/* IGN — current + history */}
              <div>
                <div className="flex-between">
                  <span className="text-text-muted">IGN</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="font-semibold text-text-primary">
                      {player.currentIGN || player.ign || '—'}
                    </span>
                    {(player.currentIGN || player.ign) && (
                      <span style={{
                        fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px',
                        borderRadius: 4, background: 'rgba(201,168,76,0.15)',
                        color: 'var(--gold)', border: '1px solid var(--border-gold)',
                        letterSpacing: '0.04em', textTransform: 'uppercase'
                      }}>Current</span>
                    )}
                  </div>
                </div>
                {(player.ignHistory?.length > 1) && (
                  <HistoryList
                    label="IGN History"
                    items={[...player.ignHistory].reverse()}
                    renderItem={(ign, i) => (
                      <span key={i} style={{
                        fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                        color: i === 0 ? 'var(--gold)' : 'var(--text-secondary)'
                      }}>
                        {i === 0 && '▸ '}{ign}
                        {i === 0 && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>(current)</span>}
                      </span>
                    )}
                  />
                )}
              </div>

              {/* Gender */}
              <div className="flex-between">
                <span className="text-text-muted">Gender</span>
                <span className="font-semibold text-text-primary">{player.gender || '—'}</span>
              </div>

              {/* Region */}
              <div className="flex-between">
                <span className="text-text-muted">Region</span>
                <span className="font-semibold text-text-primary">{player.region || '—'}</span>
              </div>

              {/* Country */}
              <div className="flex-between">
                <span className="text-text-muted">Country</span>
                <span className="font-semibold text-text-primary">{player.country || '—'}</span>
              </div>

              {/* Device — current + history */}
              <div>
                <div className="flex-between">
                  <span className="text-text-muted">Device</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="font-semibold text-text-primary">
                      {player.currentDevice || player.device || '—'}
                      {(player.currentDeviceModel || player.deviceModel) && (
                        <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                          {player.currentDeviceModel || player.deviceModel}
                        </span>
                      )}
                    </span>
                    {(player.currentDevice || player.device) && (
                      <span style={{
                        fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px',
                        borderRadius: 4, background: 'rgba(201,168,76,0.15)',
                        color: 'var(--gold)', border: '1px solid var(--border-gold)',
                        letterSpacing: '0.04em', textTransform: 'uppercase'
                      }}>Current</span>
                    )}
                  </div>
                </div>
                {(player.deviceHistory?.length > 1) && (
                  <HistoryList
                    label="Device History"
                    items={[...player.deviceHistory].reverse()}
                    renderItem={(d, i) => (
                      <span key={i} style={{
                        fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                        color: i === 0 ? 'var(--gold)' : 'var(--text-secondary)'
                      }}>
                        {i === 0 && '▸ '}{d.device} {d.deviceModel}
                        {i === 0 && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>(current)</span>}
                      </span>
                    )}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Global Form by Category Card */}
          <div className="card" style={{ border: '1px solid var(--border-gold)', background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <h2 className="card-title flex items-center gap-2" style={{ margin: 0, fontSize: '0.95rem' }}>
                <Flame size={16} className="text-gold fill-gold" />
                Fragging Momentum (Form)
              </h2>
              <MetricTooltip metricKey="global_form">
                <span style={{ fontSize: '0.68rem', color: 'var(--gold)', cursor: 'help' }}>8-Match Rolling</span>
              </MetricTooltip>
            </div>

            {/* Category Selector Tabs */}
            <div style={{ display: 'flex', gap: 4, padding: 3, background: 'rgba(0,0,0,0.3)', borderRadius: 8, marginBottom: 14, overflowX: 'auto' }}>
              {[
                { id: 'all', label: 'All' },
                { id: 'Tier 1', label: 'Tier 1' },
                { id: 'Tier 2', label: 'Tier 2' },
                { id: 'Tier 3', label: 'Tier 3' },
                { id: 'unranked', label: 'Unranked' },
              ].map(cat => {
                const active = selectedFormCategory === cat.id;
                const formForCat = categoryForms[cat.id];
                const hasMatches = formForCat && formForCat.matchesUsed > 0;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedFormCategory(cat.id)}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      borderRadius: 6,
                      fontSize: '0.72rem',
                      fontWeight: active ? 800 : 500,
                      background: active ? 'var(--gold)' : 'transparent',
                      color: active ? '#000' : hasMatches ? 'var(--text-primary)' : 'var(--text-muted)',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap',
                      textAlign: 'center',
                    }}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>

            {/* Active Category Display */}
            {(() => {
              const curForm = categoryForms[selectedFormCategory] || { confidence: 'unranked', matchesUsed: 0 };
              const isUnranked = curForm.confidence === 'unranked' || curForm.decayedForm == null;
              return (
                <div className="space-y-3">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {selectedFormCategory === 'all' ? 'Overall Fragging Form' : `${selectedFormCategory} Fragging Form`}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                        <span style={{ fontSize: '1.6rem', fontWeight: 900, color: isUnranked ? 'var(--text-muted)' : 'var(--gold)', fontFamily: 'var(--font-mono)' }}>
                          {curForm.decayedForm != null ? `${curForm.decayedForm} KPM` : '—'}
                        </span>
                        {!isUnranked && curForm.rawForm && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            raw: {curForm.rawForm}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: curForm.trend === 'up' ? 'var(--success)' : curForm.trend === 'down' ? 'var(--danger)' : 'var(--text-muted)',
                      }}>
                        {curForm.trend === 'up' ? <TrendingUp size={14} /> : curForm.trend === 'down' ? <TrendingDown size={14} /> : <Minus size={14} />}
                        {curForm.trend === 'up' ? 'Rising' : curForm.trend === 'down' ? 'Falling' : curForm.trend === 'flat' ? 'Steady' : 'New'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'capitalize', marginTop: 2 }}>
                        {curForm.confidence} ({curForm.matchesUsed}/8 matches)
                      </div>
                    </div>
                  </div>

                  {/* Category Form Comparison Mini-Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.7rem' }}>
                    {[
                      { key: 'all', label: 'All' },
                      { key: 'Tier 1', label: 'T1' },
                      { key: 'Tier 2', label: 'T2' },
                      { key: 'unranked', label: 'Unrk' },
                    ].map(item => {
                      const f = categoryForms[item.key];
                      const score = f?.decayedForm != null ? `${f.decayedForm}` : '—';
                      return (
                        <div
                          key={item.key}
                          onClick={() => setSelectedFormCategory(item.key)}
                          style={{
                            textAlign: 'center',
                            padding: '4px 2px',
                            background: selectedFormCategory === item.key ? 'rgba(201, 168, 76, 0.15)' : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${selectedFormCategory === item.key ? 'var(--gold)' : 'rgba(255,255,255,0.05)'}`,
                            borderRadius: 6,
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{item.label}</div>
                          <div style={{ fontWeight: 800, color: score !== '—' ? 'var(--gold)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {score}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
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

            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Matches Played by Map
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {AVAILABLE_MAPS.map(m => (
                  <div key={m} style={{ padding: '6px 10px', background: 'var(--bg-alt-row)', border: '1px solid var(--border-md)', borderRadius: 6, fontSize: '0.78rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{m}:</span>{' '}
                    <strong style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{mapCounts[m] || 0}</strong>
                  </div>
                ))}
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

      {/* Edit Photo / Avatar Modal */}
      {isOwner && photoModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-md)',
            borderRadius: 14, padding: '24px', width: '100%', maxWidth: 440,
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Camera size={20} style={{ color: 'var(--gold)' }} />
                <h3 style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                  Edit Player Photo / Avatar
                </h3>
              </div>
              <button
                onClick={() => setPhotoModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Avatar Preview */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
              {photoInputUrl ? (
                <img
                  src={photoInputUrl}
                  alt="Preview"
                  style={{
                    width: 100,
                    height: 100,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    border: '3px solid var(--border-gold)',
                    boxShadow: '0 0 20px rgba(201,168,76,0.35)',
                    marginBottom: 8
                  }}
                />
              ) : (
                <div style={{
                  width: 100,
                  height: 100,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, rgba(201,168,76,0.25), rgba(59,130,246,0.2))',
                  border: '3px solid var(--border-gold)',
                  boxShadow: '0 0 20px rgba(201, 168, 76, 0.2)',
                  color: 'var(--gold)',
                  fontSize: '2.5rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 8
                }}>
                  {initial}
                </div>
              )}
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {photoInputUrl ? 'Photo Preview' : 'Default Initials Placeholder'}
              </span>
            </div>

            {/* Upload File button */}
            <div style={{ marginBottom: 16 }}>
              <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Upload Image File</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
                id="avatar-file-upload-modal"
              />
              <label
                htmlFor="avatar-file-upload-modal"
                className="btn btn-secondary btn-sm"
                style={{ width: '100%', cursor: 'pointer', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px' }}
              >
                <Upload size={14} /> Choose Image File...
              </label>
            </div>

            {/* Image URL input */}
            <div style={{ marginBottom: 20 }}>
              <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Or Paste Image URL</label>
              <input
                type="text"
                className="form-input"
                placeholder="https://example.com/avatar.jpg"
                value={photoInputUrl}
                onChange={e => setPhotoInputUrl(e.target.value)}
              />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              {player.photoUrl ? (
                <button
                  onClick={handleRemovePhoto}
                  className="btn btn-danger btn-sm"
                  disabled={savingPhoto}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Trash2 size={13} /> Remove
                </button>
              ) : <div />}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setPhotoModalOpen(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePhoto}
                  className="btn btn-primary btn-sm"
                  disabled={savingPhoto}
                >
                  {savingPhoto ? 'Saving...' : 'Save Photo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
