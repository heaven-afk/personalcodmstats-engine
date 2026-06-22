'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createTournament } from '@/lib/firestore/tournaments';
import toast from 'react-hot-toast';
import { ChevronRight, ChevronLeft, Plus, Trash2, Check, Zap, AlignJustify, Layers, FileSpreadsheet } from 'lucide-react';
import ScoringConfigEditor, { DEFAULT_PLACEMENT_POINTS, SCORING_PRESETS } from '@/components/ui/ScoringConfigEditor';
import { getAllSheetsAsCSV } from '@/lib/importers/csvParser';
import {
  importTeamRegistrations,
  importPlayerRegistrations,
  importTeamMatchResults,
  importPlayerMatchResults
} from '@/lib/importers/importEngine';

// Scoring presets and defaults are now provided by ScoringConfigEditor

export default function CreateTournamentPage() {
  const router = useRouter();
  const fileRef = useRef(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Mode & Format
  const [createMode, setCreateMode] = useState('new'); // 'new' | 'import'
  const [format, setFormat] = useState('single'); // 'single' | 'multi'
  const [importFiles, setImportFiles] = useState([]); // [{ file, label }]
  const [showPaste, setShowPaste] = useState(false);

  // Multi-file helpers
  const addFiles = (fileList) => {
    const valid = Array.from(fileList).filter(f => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (valid.length === 0) { toast.error('Only .xlsx, .xls or .csv files are supported'); return; }
    setImportFiles(prev => [
      ...prev,
      ...valid.map(file => ({ file, label: guessLabel(file.name) })),
    ]);
  };
  const removeFile = (idx) => setImportFiles(prev => prev.filter((_, i) => i !== idx));
  const updateLabel = (idx, label) => setImportFiles(prev => prev.map((f, i) => i === idx ? { ...f, label } : f));

  function guessLabel(name) {
    const n = name.toLowerCase();
    if (n.includes('team')) return 'Teams';
    if (n.includes('player')) return 'Players';
    if (n.includes('match') || n.includes('result') || n.includes('entry')) return 'Match Results';
    if (n.includes('bonus') || n.includes('penalty')) return 'Bonus / Penalty';
    return 'Other';
  }

  // Step 1
  const [name, setName] = useState('');
  const [season, setSeason] = useState('');
  const [description, setDescription] = useState('');
  
  // Banner options
  const [bannerSource, setBannerSource] = useState('upload'); // 'upload' | 'url'
  const [bannerUrl, setBannerUrl] = useState('');
  const [banner, setBanner] = useState('');

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

  // Step 2 — structure
  const [totalDays, setTotalDays] = useState(6);
  const [lobbiesPerDay, setLobbiesPerDay] = useState(4);
  const [playerClasses, setPlayerClasses] = useState([
    { className: 'Class 1', activeDays: [1,2,3,4,5,6], badgeColor: '#C00000' },
    { className: 'Class 2', activeDays: [3,4,5], badgeColor: '#00B0F0' },
  ]);

  // Step 3 — scoring
  const [killPointValue, setKillPointValue] = useState(2);
  const [placementPoints, setPlacementPoints] = useState(DEFAULT_PLACEMENT_POINTS);
  const [bonusTypes, setBonusTypes] = useState([{ name: 'Wildcard Win' }, { name: 'Penalty' }]);

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

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Tournament name is required'); setStep(1); return; }
    setSaving(true);
    try {
      const t = await createTournament({
        name: name.trim(),
        season: season.trim(),
        description: description.trim(),
        banner: bannerSource === 'upload' ? banner : '',
        bannerUrl: bannerSource === 'url' ? bannerUrl.trim() : '',
        format,
        structure: { totalDays: Number(totalDays), lobbiesPerDay: Number(lobbiesPerDay), playerClasses },
        scoring: {
          killPointValue: Number(killPointValue),
          placementPoints: placementPoints.filter(pp => pp.position > 0),
          bonusTypes: bonusTypes.filter(bt => bt.name.trim()),
        },
      });

      // Bulk import any files uploaded during creation
      if (createMode === 'import' && importFiles.length > 0) {
        toast.loading('Processing uploaded spreadsheets...', { id: 'import-toast' });
        for (const item of importFiles) {
          try {
            const sheets = await getAllSheetsAsCSV(item.file);
            for (const [sheetName, csvText] of Object.entries(sheets)) {
              if (item.label === 'Teams') {
                await importTeamRegistrations(t.id, csvText);
              } else if (item.label === 'Players') {
                await importPlayerRegistrations(t.id, csvText);
              } else if (item.label === 'Match Results') {
                const headers = csvText.split('\n')[0].toLowerCase();
                if (headers.includes('player') || headers.includes('ign')) {
                  await importPlayerMatchResults(t.id, csvText);
                } else {
                  await importTeamMatchResults(t.id, csvText);
                }
              }
            }
          } catch (err) {
            console.error(`Failed to import file ${item.file.name}:`, err);
          }
        }
        toast.dismiss('import-toast');
      }

      toast.success('Tournament created!');
      router.push(`/tournaments/${t.id}`);
    } catch (e) {
      toast.error('Failed to create: ' + e.message);
      setSaving(false);
    }
  };

  const STEPS = ['Basic Info', 'Structure', 'Scoring'];

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Create Tournament</h1>
          <p className="page-subtitle">Set up a new event from scratch</p>
        </div>
      </div>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        {[{ id: 'new', label: '+ New Tournament', icon: Zap }, { id: 'import', label: '↑ Import from Excel / CSV', icon: FileSpreadsheet }].map(({ id, label }) => (
          <button key={id} onClick={() => setCreateMode(id)} style={{
            padding: '9px 18px', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
            border: `1px solid ${createMode === id ? 'var(--gold)' : 'var(--border-md)'}`,
            background: createMode === id ? 'rgba(201,168,76,0.12)' : 'var(--bg-alt-row)',
            color: createMode === id ? 'var(--gold)' : 'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      {/* Format selector (always visible) */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {[{ id: 'single', label: 'Single Tier', desc: 'All teams in one pool', Icon: AlignJustify }, { id: 'multi', label: 'Multiple Tier', desc: 'Separate Pro / Open tiers', Icon: Layers }].map(({ id, label, desc, Icon }) => (
          <div key={id} onClick={() => setFormat(id)} style={{
            flex: 1, padding: 16, borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
            border: `1px solid ${format === id ? 'var(--gold)' : 'var(--border-md)'}`,
            background: format === id ? 'rgba(201,168,76,0.08)' : 'var(--bg-alt-row)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Icon size={16} style={{ color: format === id ? 'var(--gold)' : 'var(--text-muted)' }} />
              <span style={{ fontWeight: 700, color: format === id ? 'var(--gold)' : 'var(--text-primary)' }}>{label}</span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{desc}</p>
          </div>
        ))}
      </div>

      {/* Import file picker — multi-file */}
      {createMode === 'import' && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 className="card-title">Upload Existing Files</h3>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{importFiles.length} file{importFiles.length !== 1 ? 's' : ''} selected</span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginBottom: 14 }}>
            Add as many files as you need — player stats and team stats can be in separate spreadsheets.
            Label each file so the system knows what it contains.
          </p>

          {/* File list */}
          {importFiles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {importFiles.map((entry, idx) => (
                <div key={idx} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '10px 14px',
                  background: 'var(--bg-alt-row)',
                  borderRadius: 8,
                  border: '1px solid var(--border-md)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <FileSpreadsheet size={18} style={{ color: 'var(--gold)', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.file.name}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {(entry.file.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <select
                    className="form-select"
                    value={entry.label}
                    onChange={e => updateLabel(idx, e.target.value)}
                    style={{ fontSize: '0.8rem', padding: '4px 8px', minWidth: 140 }}
                  >
                    <option>Teams</option>
                    <option>Players</option>
                    <option>Match Results</option>
                    <option>Bonus / Penalty</option>
                    <option>Other</option>
                  </select>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: '4px 6px', color: 'var(--danger)' }}
                    onClick={() => removeFile(idx)}
                    title="Remove file"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Drop zone */}
          <div
            style={{
              border: '2px dashed var(--border-md)',
              borderRadius: 10,
              padding: '20px 16px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--gold)'; }}
            onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border-md)'; }}
            onDrop={e => {
              e.preventDefault();
              e.currentTarget.style.borderColor = 'var(--border-md)';
              addFiles(e.dataTransfer.files);
            }}
          >
            <FileSpreadsheet size={28} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 4 }}>
              <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Click to add files</span> or drag &amp; drop
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Supports .xlsx, .xls, .csv — add multiple files</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
          />
        </div>
      )}

      {/* Step indicator */}
      <div className="wizard-steps" style={{ marginBottom: 32 }}>
        {STEPS.map((label, i) => {
          const s = i + 1;
          const done = step > s;
          const active = step === s;
          return (
            <div key={s} className="wizard-step">
              <div className={`wizard-step-circle ${done ? 'done' : active ? 'active' : ''}`}>
                {done ? <Check size={14} /> : s}
              </div>
              <span className={`wizard-step-label ${active ? 'active' : ''}`}>{label}</span>
              {i < STEPS.length - 1 && <div className={`wizard-step-line ${done ? 'done' : ''}`} />}
            </div>
          );
        })}
      </div>

      <div className="card">
        {/* ─── Step 1: Basic Info ────────────────────────────────── */}
        {step === 1 && (
          <div className="flex-col">
            <h2 className="card-title" style={{ marginBottom: 4 }}>Basic Information</h2>
            <div className="form-field">
              <label className="form-label">Tournament Name *</label>
              <input id="tournament-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. MGL Season 5 Finals" />
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
        )}

        {/* ─── Step 2: Structure ─────────────────────────────────── */}
        {step === 2 && (
          <div className="flex-col">
            <h2 className="card-title" style={{ marginBottom: 4 }}>Event Structure</h2>
            <div className="grid-2">
              <div className="form-field">
                <label className="form-label">Total Days</label>
                <input className="form-input" type="number" min={1} max={14} value={totalDays} onChange={e => setTotalDays(e.target.value)} />
              </div>
              <div className="form-field">
                <label className="form-label">Lobbies Per Day</label>
                <input className="form-input" type="number" min={1} max={10} value={lobbiesPerDay} onChange={e => setLobbiesPerDay(e.target.value)} />
              </div>
            </div>

            <div>
              <div className="flex-between" style={{ marginBottom: 12 }}>
                <label className="form-label">Player Classes</label>
                <button className="btn btn-secondary btn-sm" onClick={addClass}><Plus size={13} /> Add Class</button>
              </div>
              {playerClasses.map((cls, i) => (
                <div key={i} style={{ background: 'var(--bg-alt-row)', borderRadius: 8, padding: 14, marginBottom: 10 }}>
                  <div className="flex-between" style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', gap: 10, flex: 1 }}>
                      <input className="form-input" style={{ flex: 1 }} placeholder="Class name" value={cls.className} onChange={e => updateClass(i, 'className', e.target.value)} />
                      <input type="color" value={cls.badgeColor} onChange={e => updateClass(i, 'badgeColor', e.target.value)} style={{ width: 40, height: 40, border: 'none', background: 'none', cursor: 'pointer', borderRadius: 6 }} title="Badge color" />
                    </div>
                    {playerClasses.length > 1 && (
                      <button className="btn btn-ghost" onClick={() => removeClass(i)}><Trash2 size={14} /></button>
                    )}
                  </div>
                  <div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>Active Days:</p>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {Array.from({ length: Number(totalDays) }, (_, d) => d + 1).map(day => (
                        <button
                          key={day}
                          onClick={() => toggleDay(i, day)}
                          style={{
                            width: 32, height: 32, borderRadius: 6, fontWeight: 700, fontSize: '0.8rem',
                            border: `2px solid ${cls.activeDays.includes(day) ? cls.badgeColor : 'var(--border-md)'}`,
                            background: cls.activeDays.includes(day) ? cls.badgeColor + '33' : 'var(--bg-input)',
                            color: cls.activeDays.includes(day) ? cls.badgeColor : 'var(--text-muted)',
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
        )}

        {/* ─── Step 3: Scoring ───────────────────────────────────── */}
        {step === 3 && (
          <div className="flex-col">
            <ScoringConfigEditor
              killPointValue={killPointValue}
              setKillPointValue={setKillPointValue}
              placementPoints={placementPoints}
              setPlacementPoints={setPlacementPoints}
            />

            <div style={{ marginTop: 20 }}>
              <div className="flex-between" style={{ marginBottom: 10 }}>
                <label className="form-label">Bonus / Penalty Types</label>
                <button className="btn btn-secondary btn-sm" onClick={addBonus}><Plus size={13} /> Add Type</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
                {bonusTypes.map((bt, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input className="form-input" value={bt.name} onChange={(e) => updateBonus(i, e.target.value)} placeholder="e.g. Wildcard Win" />
                    <button className="btn btn-ghost" onClick={() => removeBonus(i)}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex-between" style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
          <button
            className="btn btn-secondary"
            onClick={() => step > 1 ? setStep(s => s - 1) : router.push('/tournaments')}
          >
            <ChevronLeft size={16} /> {step === 1 ? 'Cancel' : 'Back'}
          </button>

          {step < 3 ? (
            <button
              className="btn btn-primary"
              onClick={() => {
                if (step === 1 && !name.trim()) { toast.error('Name is required'); return; }
                setStep(s => s + 1);
              }}
            >
              Next <ChevronRight size={16} />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
              {saving ? 'Creating...' : <><Zap size={15} /> Create Tournament</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
