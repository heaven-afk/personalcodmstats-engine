'use client';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTournament } from '../layout';
import { updateTournament, deleteTournament } from '@/lib/firestore/tournaments';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/Modal';
import { Plus, Trash2, Check, Zap, ChevronLeft } from 'lucide-react';

const DEFAULT_PLACEMENT = [
  { position: 1, points: 25 }, { position: 2, points: 20 },
  { position: 3, points: 15 }, { position: 4, points: 10 },
  { position: 5, points: 5 },
];

const PRESETS = {
  top5: {
    label: "Top 5 (Standard)",
    placementPoints: [
      { position: 1, points: 25 }, { position: 2, points: 20 },
      { position: 3, points: 15 }, { position: 4, points: 10 },
      { position: 5, points: 5 }
    ],
    killPointValue: 2
  },
  standard25: {
    label: "Placements 1-25 (Standard)",
    placementPoints: [
      { position: 1, points: 25 }, { position: 2, points: 20 },
      { position: 3, points: 15 }, { position: 4, points: 10 },
      { position: 5, points: 5 },
      ...Array.from({ length: 20 }, (_, i) => ({ position: i + 6, points: 0 }))
    ],
    killPointValue: 2
  },
  apex20: {
    label: "Apex Legends (Official)",
    placementPoints: [
      { position: 1, points: 12 }, { position: 2, points: 9 },
      { position: 3, points: 7 }, { position: 4, points: 5 },
      { position: 5, points: 4 }, { position: 6, points: 3 },
      { position: 7, points: 3 }, { position: 8, points: 2 },
      { position: 9, points: 2 }, { position: 10, points: 2 },
      { position: 11, points: 1 }, { position: 12, points: 1 },
      { position: 13, points: 1 }, { position: 14, points: 1 },
      { position: 15, points: 1 }, { position: 16, points: 0 },
      { position: 17, points: 0 }, { position: 18, points: 0 },
      { position: 19, points: 0 }, { position: 20, points: 0 }
    ],
    killPointValue: 1
  },
  pubg16: {
    label: "PUBG Esports (Official)",
    placementPoints: [
      { position: 1, points: 10 }, { position: 2, points: 6 },
      { position: 3, points: 5 }, { position: 4, points: 4 },
      { position: 5, points: 3 }, { position: 6, points: 2 },
      { position: 7, points: 1 }, { position: 8, points: 1 },
      ...Array.from({ length: 8 }, (_, i) => ({ position: i + 9, points: 0 }))
    ],
    killPointValue: 1
  }
};

export default function EditTournamentConfigPage() {
  const router = useRouter();
  const { id } = useParams();
  const { tournament, refresh, setTournament } = useTournament();

  if (!tournament) return null;

  return (
    <TournamentConfigForm
      key={tournament.id}
      tournament={tournament}
      refresh={refresh}
      setTournament={setTournament}
      id={id}
      router={router}
    />
  );
}

function TournamentConfigForm({ tournament, refresh, setTournament, id, router }) {
  const [saving, setSaving] = useState(false);

  // States mirroring create wizard, initialized from tournament directly
  const [name, setName] = useState(tournament.name || '');
  const [season, setSeason] = useState(tournament.season || '');
  const [description, setDescription] = useState(tournament.description || '');
  const [totalDays, setTotalDays] = useState(tournament.structure?.totalDays || 6);
  const [lobbiesPerDay, setLobbiesPerDay] = useState(tournament.structure?.lobbiesPerDay || 4);
  const [playerClasses, setPlayerClasses] = useState(tournament.structure?.playerClasses || []);
  const [killPointValue, setKillPointValue] = useState(tournament.scoring?.killPointValue || 2);
  const [placementPoints, setPlacementPoints] = useState(tournament.scoring?.placementPoints || DEFAULT_PLACEMENT);
  const [bonusTypes, setBonusTypes] = useState(tournament.scoring?.bonusTypes || []);

  // Banner options
  const [bannerSource, setBannerSource] = useState(tournament.banner ? 'upload' : tournament.bannerUrl ? 'url' : 'upload'); // 'upload' | 'url'
  const [bannerUrl, setBannerUrl] = useState(tournament.bannerUrl || '');
  const [banner, setBanner] = useState(tournament.banner || '');

  const handleBannerChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setBanner(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Delete states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteChecked1, setDeleteChecked1] = useState(false);
  const [deleteChecked2, setDeleteChecked2] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const openDeleteModal = () => {
    setDeleteChecked1(false);
    setDeleteChecked2(false);
    setShowDeleteModal(true);
  };

  const closeDeleteModal = () => {
    setShowDeleteModal(false);
    setDeleteChecked1(false);
    setDeleteChecked2(false);
  };

  const handleDeleteTournament = async () => {
    if (!deleteChecked1 || !deleteChecked2) return;
    setConfirming(true);
    try {
      await deleteTournament(id);
      // Nullify the context so the layout stops re-rendering this tournament
      setTournament(null);
      toast.success('Tournament deleted successfully');
      router.push('/tournaments');
    } catch (err) {
      toast.error('Failed to delete tournament: ' + err.message);
      setConfirming(false);
    }
  };

  const isLocked = tournament.status !== 'setup';

  // Player class helpers
  const addClass = () => setPlayerClasses(p => [...p, { className: '', activeDays: [], badgeColor: '#C9A84C' }]);
  const removeClass = (i) => setPlayerClasses(p => p.filter((_, j) => j !== i));
  const updateClass = (i, field, val) => setPlayerClasses(p => p.map((c, j) => j === i ? { ...c, [field]: val } : c));
  const toggleDay = (i, day) => {
    setPlayerClasses(p => p.map((c, j) => {
      if (j !== i) return c;
      const days = c.activeDays.includes(day) ? c.activeDays.filter(d => d !== day) : [...c.activeDays, day].sort((a,b)=>a-b);
      return { ...c, activeDays: days };
    }));
  };

  // Placement table helpers
  const addPlacement = () => {
    const next = (placementPoints[placementPoints.length - 1]?.position || 0) + 1;
    setPlacementPoints(p => [...p, { position: next, points: 0 }]);
  };
  const removePlacement = (i) => setPlacementPoints(p => p.filter((_, j) => j !== i));
  const updatePlacement = (i, field, val) => setPlacementPoints(p => p.map((pp, j) => j === i ? { ...pp, [field]: Number(val) } : pp));

  // Bonus type helpers
  const addBonus = () => setBonusTypes(b => [...b, { name: '' }]);
  const removeBonus = (i) => setBonusTypes(b => b.filter((_, j) => j !== i));
  const updateBonus = (i, val) => setBonusTypes(b => b.map((bt, j) => j === i ? { name: val } : bt));

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Tournament name is required');
      return;
    }
    setSaving(true);
    try {
      const updates = {
        name: name.trim(),
        season: season.trim(),
        description: description.trim(),
        banner: bannerSource === 'upload' ? banner : '',
        bannerUrl: bannerSource === 'url' ? bannerUrl.trim() : '',
      };

      if (!isLocked) {
        updates.structure = {
          totalDays: Number(totalDays),
          lobbiesPerDay: Number(lobbiesPerDay),
          playerClasses
        };
        updates.scoring = {
          killPointValue: Number(killPointValue),
          placementPoints: placementPoints.filter(pp => pp.position > 0),
          bonusTypes: bonusTypes.filter(bt => bt.name.trim()),
        };
      }

      await updateTournament(id, updates);
      await refresh();
      toast.success('Configuration updated!');
      router.push(`/tournaments/${id}`);
    } catch (e) {
      toast.error('Failed to save config: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-sm p-2" onClick={() => router.push(`/tournaments/${id}`)}>
            <ChevronLeft size={16} />
          </button>
          <div>
            <h1 className="page-title">Edit Configuration</h1>
            <p className="page-subtitle">Configure parameters for {tournament.name}</p>
          </div>
        </div>
      </div>

      {isLocked && (
        <div className="card" style={{ borderLeft: '4px solid var(--red)', background: 'rgba(192, 0, 0, 0.08)', marginBottom: 20 }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            <strong>Locked:</strong> Since this tournament is in the <strong>{tournament.status}</strong> phase, you can view the configuration but edits cannot be saved.
          </p>
        </div>
      )}

      <div className="card space-y-6">
        {/* Basic Info */}
        <div className="flex-col">
          <h2 className="card-title" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 16 }}>Basic Information</h2>
          <div className="form-field">
            <label className="form-label">Tournament Name *</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. MGL Season 5 Finals" />
          </div>
          <div className="form-field">
            <label className="form-label">Season</label>
            <input className="form-input" value={season} onChange={e => setSeason(e.target.value)} placeholder="e.g. 2026 Season 1" />
          </div>
          <div className="form-field">
            <label className="form-label">Description</label>
            <textarea className="form-textarea" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional event description..." />
          </div>

          {/* Banner options */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
            <label className="form-label" style={{ marginBottom: 8, display: 'block' }}>Tournament Banner Image</label>
            
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <button
                type="button"
                className={`btn btn-sm ${bannerSource === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setBannerSource('upload')}
              >
                Upload File
              </button>
              <button
                type="button"
                className={`btn btn-sm ${bannerSource === 'url' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setBannerSource('url')}
              >
                Image URL
              </button>
            </div>

            {bannerSource === 'upload' ? (
              <div className="form-field">
                <label className="form-label text-[10px]">Select Banner File</label>
                <input
                  key="banner-file-input"
                  type="file"
                  accept="image/*"
                  className="form-input"
                  onChange={handleBannerChange}
                />
                {banner && (
                  <img src={banner} alt="Preview" className="banner-preview-lg" />
                )}
              </div>
            ) : (
              <div className="form-field">
                <label className="form-label text-[10px]">Banner Image URL</label>
                <input
                  key="banner-url-input"
                  type="text"
                  className="form-input"
                  value={bannerUrl || ''}
                  onChange={e => setBannerUrl(e.target.value)}
                  placeholder="https://example.com/banner.jpg"
                />
                {bannerUrl && (
                  <img src={bannerUrl} alt="Preview" className="banner-preview-lg" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Structure */}
        <div className="flex-col">
          <h2 className="card-title" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 16 }}>Event Structure</h2>
          <div className="grid-2">
            <div className="form-field">
              <label className="form-label">Total Days</label>
              <input className="form-input" type="number" min={1} max={14} value={totalDays} onChange={e => setTotalDays(e.target.value)} disabled={isLocked} />
            </div>
            <div className="form-field">
              <label className="form-label">Lobbies Per Day</label>
              <input className="form-input" type="number" min={1} max={10} value={lobbiesPerDay} onChange={e => setLobbiesPerDay(e.target.value)} disabled={isLocked} />
            </div>
          </div>

          <div>
            <div className="flex-between" style={{ marginBottom: 12 }}>
              <label className="form-label">Player Classes</label>
              {!isLocked && (
                <button className="btn btn-secondary btn-sm" onClick={addClass}><Plus size={13} /> Add Class</button>
              )}
            </div>
            {playerClasses.map((cls, i) => (
              <div key={i} style={{ background: 'var(--bg-alt-row)', borderRadius: 8, padding: 14, marginBottom: 10 }}>
                <div className="flex-between" style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', gap: 10, flex: 1 }}>
                    <input className="form-input" style={{ flex: 1 }} placeholder="Class name" value={cls.className} onChange={e => updateClass(i, 'className', e.target.value)} disabled={isLocked} />
                    <input type="color" value={cls.badgeColor} onChange={e => updateClass(i, 'badgeColor', e.target.value)} disabled={isLocked} style={{ width: 40, height: 40, border: 'none', background: 'none', cursor: isLocked ? 'default' : 'pointer', borderRadius: 6 }} title="Badge color" />
                  </div>
                  {!isLocked && playerClasses.length > 1 && (
                    <button className="btn btn-ghost" onClick={() => removeClass(i)}><Trash2 size={14} /></button>
                  )}
                </div>
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>Active Days:</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {Array.from({ length: Number(totalDays) }, (_, d) => d + 1).map(day => (
                      <button
                        key={day}
                        onClick={() => !isLocked && toggleDay(i, day)}
                        disabled={isLocked}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 6,
                          fontWeight: 700,
                          fontSize: '0.8rem',
                          border: '2px solid ' + (cls.activeDays.includes(day) ? cls.badgeColor : 'var(--border-md)'),
                          background: cls.activeDays.includes(day) ? cls.badgeColor + '33' : 'var(--bg-input)',
                          color: cls.activeDays.includes(day) ? cls.badgeColor : 'var(--text-muted)',
                          cursor: isLocked ? 'default' : 'pointer'
                        }}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scoring */}
        <div className="flex-col">
          <h2 className="card-title" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 16 }}>Scoring & Rules</h2>

          <div className="form-field">
            <label className="form-label">Kill Point Value</label>
            <input className="form-input" type="number" min={0} step={0.5} value={killPointValue} onChange={e => setKillPointValue(e.target.value)} disabled={isLocked} style={{ maxWidth: 160 }} />
          </div>

          <div>
            <div className="flex-between" style={{ marginBottom: 10 }}>
              <label className="form-label">Placement Points Table</label>
              {!isLocked && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    className="form-select text-xs py-1 px-2"
                    style={{ width: 180, height: 30 }}
                    defaultValue=""
                    onChange={e => {
                      const val = e.target.value;
                      if (val && PRESETS[val]) {
                        setPlacementPoints(PRESETS[val].placementPoints);
                        setKillPointValue(PRESETS[val].killPointValue);
                        toast.success(`Loaded preset: ${PRESETS[val].label}`);
                      }
                      e.target.value = "";
                    }}
                  >
                    <option value="" disabled>-- Load Preset --</option>
                    <option value="top5">Top 5 Standard</option>
                    <option value="standard25">Standard Placements 1-25</option>
                    <option value="apex20">Apex Legends Official</option>
                    <option value="pubg16">PUBG Esports Official</option>
                  </select>
                  <button className="btn btn-secondary btn-sm" onClick={addPlacement}><Plus size={13} /> Add Row</button>
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '6px 10px', alignItems: 'center', maxWidth: 360 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>POSITION</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>POINTS</div>
              <div />
              {placementPoints.map((pp, i) => (
                <div key={i} style={{ display: 'contents' }}>
                  <input type="number" className="form-input" value={pp.position} onChange={e => updatePlacement(i, 'position', e.target.value)} disabled={isLocked} />
                  <input type="number" className="form-input" value={pp.points} onChange={e => updatePlacement(i, 'points', e.target.value)} disabled={isLocked} />
                  {!isLocked && (
                    <button className="btn btn-ghost" onClick={() => removePlacement(i)}><Trash2 size={13} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex-between" style={{ marginBottom: 10 }}>
              <label className="form-label">Bonus / Penalty Types</label>
              {!isLocked && (
                <button className="btn btn-secondary btn-sm" onClick={addBonus}><Plus size={13} /> Add Type</button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
              {bonusTypes.map((bt, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input className="form-input" value={bt.name} onChange={e => updateBonus(i, e.target.value)} disabled={isLocked} placeholder="e.g. Wildcard Win" />
                  {!isLocked && (
                    <button className="btn btn-ghost" onClick={() => removeBonus(i)}><Trash2 size={13} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex-between" style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-secondary" onClick={() => router.push(`/tournaments/${id}`)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : (
              <span className="flex items-center gap-1">
                <Zap size={15} /> Save Changes
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="card" style={{ border: '1px solid var(--danger)', background: 'rgba(239, 68, 68, 0.04)', marginTop: 24 }}>
        <h2 className="card-title text-danger mb-2 flex items-center gap-2">
          <Trash2 size={18} /> Danger Zone
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          Once you delete a tournament, all of its match results, registrations, bonuses, and stats are permanently lost. This action cannot be undone.
        </p>
        <button
          type="button"
          className="btn btn-danger"
          onClick={openDeleteModal}
        >
          Delete Tournament
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <Modal title="⚠ Delete Tournament" onClose={closeDeleteModal}>
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              You are about to permanently delete <strong className="text-text-primary">{tournament.name}</strong>.
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
                onClick={handleDeleteTournament}
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
