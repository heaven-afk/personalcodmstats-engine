'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTournament } from '../layout';
import {
  getPlayerMatchResultsByDayLobby, savePlayerMatchResult, updatePlayerMatchResult,
} from '@/lib/firestore/matchData';
import { getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getPlayers } from '@/lib/firestore/registry';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { ClassBadge } from '@/components/ui/Badge';
import toast from 'react-hot-toast';
import { Save, Upload, X, Check, FileSpreadsheet, ClipboardPaste, ChevronRight, Camera, AlertCircle, AlertTriangle, Trash2 } from 'lucide-react';
import { getAllSheetsAsCSV } from '@/lib/importers/csvParser';
import { extractTextFromImage, parsePlayerOCRResult } from '@/lib/importers/ocrParser';

// ─── Player Paste Parser ──────────────────────────────────────────────────────
function parsePlayerEntryPaste(text, playerRegs) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return { results: [], errors: [] };

  const delimiter = lines[0].includes('\t') ? '\t' : (lines[0].includes(',') ? ',' : (lines[0].includes(';') ? ';' : ' '));
  const grid = lines.map(line => line.split(delimiter).map(c => c.trim()));

  const firstRow = grid[0];
  const hasHeader = firstRow.some(cell => {
    const c = cell.toLowerCase();
    return c.includes('player') || c.includes('ign') || c.includes('kill') || c.includes('dmg') || c.includes('damage') || c.includes('acc') || c.includes('accuracy') || c.includes('name');
  });

  let dataRows = grid;
  let headers = null;

  if (hasHeader) {
    headers = firstRow;
    dataRows = grid.slice(1);
  }

  const results = [];
  const errors = [];

  // Identify column mapping
  let nameCol = 0;
  let killsCol = 1;
  let dmgCol = 2;
  let accCol = 3;

  if (headers) {
    headers.forEach((h, idx) => {
      const lower = h.toLowerCase();
      if (lower.includes('player') || lower.includes('ign') || lower.includes('name') || lower.includes('username')) {
        nameCol = idx;
      } else if (lower.includes('kill') || lower.includes('k')) {
        killsCol = idx;
      } else if (lower.includes('dmg') || lower.includes('damage') || lower.includes('dealt')) {
        dmgCol = idx;
      } else if (lower.includes('acc') || lower.includes('accuracy') || lower.includes('pct') || lower.includes('percent')) {
        accCol = idx;
      }
    });
  } else {
    const firstCols = dataRows[0] || [];
    if (firstCols.length === 2) {
      nameCol = 0;
      killsCol = 1;
      dmgCol = -1;
      accCol = -1;
    } else if (firstCols.length === 3) {
      nameCol = 0;
      killsCol = 1;
      dmgCol = 2;
      accCol = -1;
    }
  }

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const cols = dataRows[rowIndex];
    if (cols.length === 0 || !cols[nameCol]) continue;

    const nameInput = cols[nameCol];
    const reg = playerRegs.find(p => 
      p.ign?.toLowerCase().replace(/\s+/g, '') === nameInput.toLowerCase().replace(/\s+/g, '') ||
      p.professionalName?.toLowerCase().replace(/\s+/g, '') === nameInput.toLowerCase().replace(/\s+/g, '')
    );

    if (!reg) {
      errors.push(`Row ${rowIndex + (hasHeader ? 2 : 1)}: Player "${nameInput}" is not registered.`);
      continue;
    }

    const kills = killsCol !== -1 && killsCol < cols.length ? parseInt(cols[killsCol]) || 0 : 0;
    const damage = dmgCol !== -1 && dmgCol < cols.length ? parseFloat(cols[dmgCol]) || 0 : 0;
    const accuracy = accCol !== -1 && accCol < cols.length ? parseFloat(cols[accCol]) || 0 : 0;

    results.push({
      playerId: reg.playerId,
      playerName: reg.professionalName || reg.ign || reg.playerId,
      ign: reg.ign,
      teamName: reg.teamName || '',
      kills,
      damage,
      accuracy
    });
  }

  return { results, errors };
}

export default function PlayerEntryPage() {
  const { tournament } = useTournament();
  const [day, setDay] = useState(1);
  const [lobby, setLobby] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [playerRegs, setPlayerRegs] = useState([]);
  const [players, setPlayers] = useState([]);
  const [section, setSection] = useState('kills'); // 'kills' | 'damage' | 'rosterUpdate'

  // Paste / File Upload States
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [pasteErrors, setPasteErrors] = useState([]);
  const [parsedPreview, setParsedPreview] = useState([]);

  const fileRef = useRef(null);
  const [sheetModal, setSheetModal] = useState(null);
  const [importingFile, setImportingFile] = useState(false);

  // OCR States
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrResults, setOcrResults] = useState([]);
  const [isOcrMode, setIsOcrMode] = useState(false);
  const ocrFileRef = useRef(null);

  // Live preview parse effect
  useEffect(() => {
    if (!pasteText.trim()) {
      setParsedPreview([]);
      setPasteErrors([]);
      return;
    }
    const { results, errors } = parsePlayerEntryPaste(pasteText, playerRegs);
    setParsedPreview(results);
    setPasteErrors(errors);
  }, [pasteText, playerRegs]);

  const { structure = {}, scoring = {} } = tournament;
  const totalDays = structure.totalDays || 6;
  const lobbiesPerDay = structure.lobbiesPerDay || 4;
  const playerClasses = structure.playerClasses || [];
  const maxLobbies = lobbiesPerDay; // L1, L2, L3...

  // formData: playerId → { kills: {L1,L2,L3,...}, damage: {L1,L2,...}, accuracy: {L1,L2,...}, existingId }
  const [formData, setFormData] = useState({});

  // Roster update form (Class 2 on Days 3–5) — separate from regular
  // RU data structure: playerId → { ruDay1: {L1,L2,...}, ruDay2: {...}, ruDay3: {...} }
  const [ruData, setRuData] = useState({});

  const getRUDays = useCallback(() => {
    const cls2 = playerClasses.find((c) => c.className?.includes('2') || c.badgeColor === '#00B0F0');
    if (!cls2) return [];
    // Map active days starting at Day 3 (RU days are 3,4,5 by default)
    return cls2.activeDays.filter((d) => d >= 3).sort();
  }, [playerClasses]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [regs, allPlayers, results] = await Promise.all([
        getPlayerRegistrations(tournament.id),
        getPlayers(),
        getPlayerMatchResultsByDayLobby(tournament.id, day, lobby),
      ]);
      setPlayerRegs(regs);
      setPlayers(allPlayers);

      const fd = {};
      for (const reg of regs) {
        const globalPlayer = allPlayers.find((p) => p.id === reg.playerId);
        const existing = results.find((r) => r.playerId === reg.playerId);
        fd[reg.playerId] = {
          playerId: reg.playerId,
          slot: reg.slot,
          playerName: globalPlayer?.professionalName || reg.ign || reg.playerId,
          ign: reg.ign || globalPlayer?.ign || '',
          teamName: reg.teamName || '',
          class: reg.class || '',
          kills: existing?.kills ?? '',
          damage: existing?.damage ?? '',
          accuracy: existing?.accuracy ?? '',
          existingId: existing?.id || null,
        };
      }
      setFormData(fd);
    } catch (err) { toast.error('Load failed'); console.error(err); }
    finally { setLoading(false); }
  }, [tournament.id, day, lobby]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleChange = (playerId, field, val) => {
    setFormData((prev) => ({ ...prev, [playerId]: { ...prev[playerId], [field]: val } }));
  };

  const saveRow = async (playerId) => {
    const row = formData[playerId];
    if (!row) return;
    const payload = {
      playerId: row.playerId, playerName: row.playerName, teamName: row.teamName,
      day, lobby,
      kills: parseInt(row.kills) || 0,
      damage: parseFloat(row.damage) || 0,
      accuracy: parseFloat(row.accuracy) || 0,
    };
    try {
      if (row.existingId) {
        await updatePlayerMatchResult(tournament.id, row.existingId, payload);
      } else {
        const saved = await savePlayerMatchResult(tournament.id, payload);
        setFormData((prev) => ({ ...prev, [playerId]: { ...prev[playerId], existingId: saved.id } }));
      }
    } catch (err) { console.error('Auto-save error', err); }
  };

  const handleBulkSave = async () => {
    setSaving(true);
    try {
      for (const pid of Object.keys(formData)) await saveRow(pid);
      toast.success(`Day ${day} · Lobby ${lobby} player data saved`);
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handlePasteImport = async () => {
    if (parsedPreview.length === 0) {
      toast.error('No valid player entry results parsed.');
      return;
    }
    setParsing(true);
    try {
      let updatedCount = 0;
      let addedCount = 0;

      for (const item of parsedPreview) {
        const existing = formData[item.playerId]?.existingId;
        const payload = {
          playerId: item.playerId,
          playerName: item.playerName,
          teamName: item.teamName,
          day,
          lobby,
          kills: item.kills,
          damage: item.damage,
          accuracy: item.accuracy
        };

        if (existing) {
          await updatePlayerMatchResult(tournament.id, existing, payload);
          updatedCount++;
        } else {
          await savePlayerMatchResult(tournament.id, payload);
          addedCount++;
        }
      }

      toast.success(`Successfully saved player stats! Added ${addedCount}, updated ${updatedCount} records.`);
      setPasteText('');
      setShowPaste(false);
      await loadData();
    } catch (err) {
      toast.error('Failed to save imported results: ' + err.message);
    } finally {
      setParsing(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validExt = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!validExt) { toast.error('Only .xlsx, .xls, or .csv files are supported'); return; }

    setImportingFile(true);
    try {
      const allSheets = await getAllSheetsAsCSV(file);
      const names = Object.keys(allSheets);

      if (names.length === 1) {
        setPasteText(allSheets[names[0]]);
        setIsOcrMode(false);
        setOcrResults([]);
        toast.success(`Loaded "${names[0]}" sheet from spreadsheet`);
      } else {
        setSheetModal({ sheets: names, allSheets });
      }
    } catch (err) {
      toast.error('Failed to read file: ' + err.message);
    } finally {
      setImportingFile(false);
    }
  };

  const handleSheetSelect = (sheetName) => {
    if (!sheetModal) return;
    setPasteText(sheetModal.allSheets[sheetName]);
    setIsOcrMode(false);
    setOcrResults([]);
    toast.success(`Loaded "${sheetName}" sheet from spreadsheet`);
    setSheetModal(null);
  };

  const handleOcrFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setOcrProcessing(true);
    setOcrProgress(0);
    setOcrResults([]);
    setIsOcrMode(true);
    setPasteText(''); // Clear paste input

    try {
      const text = await extractTextFromImage(file, (p) => setOcrProgress(p));
      const { results } = parsePlayerOCRResult(text, playerRegs);
      setOcrResults(results);
      toast.success('Image scanned successfully!');
    } catch (err) {
      toast.error('Failed to extract text: ' + err.message);
      setIsOcrMode(false);
    } finally {
      setOcrProcessing(false);
    }
  };

  const handleOcrClear = () => {
    setOcrResults([]);
    setIsOcrMode(false);
    setOcrProgress(0);
    setOcrProcessing(false);
  };

  const handleOcrNameChange = (idx, newName) => {
    const normalized = newName.toLowerCase().replace(/\s+/g, '');
    let player = playerRegs.find(p => p.ign?.toLowerCase().replace(/\s+/g, '') === normalized);
    let matchType = 'ign';

    if (!player) {
      player = playerRegs.find(p => p.professionalName?.toLowerCase().replace(/\s+/g, '') === normalized);
      matchType = 'proName';
    }

    setOcrResults(prev => prev.map((row, i) => {
      if (i !== idx) return row;
      return {
        ...row,
        originalParsedName: newName,
        playerId: player?.playerId || null,
        playerName: player?.professionalName || player?.ign || newName,
        teamName: player?.teamName || '',
        matchType: player ? matchType : null,
      };
    }));
  };

  const handleOcrKillsChange = (idx, val) => {
    const numericKills = parseInt(val) || 0;
    setOcrResults(prev => prev.map((row, i) => {
      if (i !== idx) return row;
      return {
        ...row,
        kills: val === '' ? '' : numericKills,
      };
    }));
  };

  const handleOcrRemoveRow = (idx) => {
    setOcrResults(prev => prev.filter((_, i) => i !== idx));
  };

  const handleOcrSave = async () => {
    const validResults = ocrResults.filter(r => r.playerId !== null);
    if (validResults.length === 0) {
      toast.error('No valid matches with registered players to save.');
      return;
    }
    setParsing(true);
    try {
      let updatedCount = 0;
      let addedCount = 0;

      for (const row of validResults) {
        const existing = formData[row.playerId]?.existingId;
        const payload = {
          playerId: row.playerId,
          playerName: row.playerName,
          teamName: row.teamName || '',
          day,
          lobby,
          kills: row.kills,
          damage: existing ? formData[row.playerId]?.damage || 0 : 0,
          accuracy: existing ? formData[row.playerId]?.accuracy || 0 : 0,
        };

        if (existing) {
          await updatePlayerMatchResult(tournament.id, existing, payload);
          updatedCount++;
        } else {
          await savePlayerMatchResult(tournament.id, payload);
          addedCount++;
        }
      }

      toast.success(`Successfully saved OCR player results! Added ${addedCount}, updated ${updatedCount} records.`);
      handleOcrClear();
      setShowPaste(false);
      await loadData();
    } catch (err) {
      toast.error('Failed to save OCR results: ' + err.message);
    } finally {
      setParsing(false);
    }
  };

  const ocrErrors = useMemo(() => {
    const errs = [];
    ocrResults.forEach((row, idx) => {
      if (!row.playerId) {
        errs.push(`Row ${idx + 1}: "${row.originalParsedName}" did not match any registered IGN or Professional Name.`);
      }
    });
    return errs;
  }, [ocrResults]);

  // Check if Roster Update section should be shown
  const ruDays = getRUDays();
  const showRU = ruDays.includes(day);

  // Helpers
  const getClass2Players = () => Object.values(formData).filter((p) => p.class?.includes('2')).sort((a, b) => a.slot - b.slot);
  const getAllPlayers = () => Object.values(formData).sort((a, b) => a.slot - b.slot);
  const isClass2ActiveToday = (p) => {
    const cls = playerClasses.find((c) => c.className === p.class);
    return cls ? cls.activeDays.includes(day) : true;
  };

  if (loading) return <LoadingSpinner size="lg" />;

  const rows = getAllPlayers();

  return (
    <div>
      {sheetModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-md)',
            borderRadius: 14, padding: '28px 28px 24px', minWidth: 360, maxWidth: 480,
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileSpreadsheet size={20} style={{ color: 'var(--gold)' }} />
                <h3 style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                  Select Excel Sheet
                </h3>
              </div>
              <button
                onClick={() => setSheetModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 18 }}>
              Select which sheet contains the player match results:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sheetModal.sheets.map((name) => (
                <button
                  key={name}
                  onClick={() => handleSheetSelect(name)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderRadius: 9,
                    background: 'var(--bg-alt-row)', border: '1px solid var(--border-md)',
                    cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 600,
                    fontSize: '0.875rem', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = 'var(--gold)';
                    e.currentTarget.style.background = 'rgba(201,168,76,0.08)';
                    e.currentTarget.style.color = 'var(--gold)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--border-md)';
                    e.currentTarget.style.background = 'var(--bg-alt-row)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FileSpreadsheet size={15} style={{ color: 'var(--gold)', flexShrink: 0 }} />
                    {name}
                  </span>
                  <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                </button>
              ))}
            </div>
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 16, width: '100%' }}
              onClick={() => setSheetModal(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, marginBottom: 24, flexWrap: 'wrap' }}>
        <div className="form-field">
          <label className="form-label">Day</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => (
              <button key={d} className={`btn btn-sm ${d === day ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDay(d)}>Day {d}</button>
            ))}
          </div>
        </div>
        <div className="form-field">
          <label className="form-label">Lobby</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {Array.from({ length: lobbiesPerDay }, (_, i) => i + 1).map((l) => (
              <button key={l} className={`btn btn-sm ${l === lobby ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setLobby(l)}>L{l}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button className={`btn btn-sm ${section === 'kills' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSection('kills')}>Section A · Kills</button>
          <button className={`btn btn-sm ${section === 'damage' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSection('damage')}>Section B · Damage/Acc</button>
          {showRU && <button className={`btn btn-sm ${section === 'rosterUpdate' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSection('rosterUpdate')}>Roster Update</button>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() => setShowPaste(v => !v)}
            title="Paste player stats from spreadsheet"
          >
            <ClipboardPaste size={14} style={{ marginRight: 6 }} /> Paste or Upload Stats
          </button>
          <button className="btn btn-primary" onClick={handleBulkSave} disabled={saving}>
            <Save size={14} /> {saving ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>

      {/* Paste Data Panel */}
      {showPaste && (
        <div className="card" style={{ marginBottom: 24, border: '1px solid var(--border-gold)', background: 'rgba(201,168,76,0.02)' }}>
          <div className="flex-between" style={{ marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--gold)' }}>
              Paste or Upload Player Stats (Day {day} · Lobby {lobby})
            </span>
            <button onClick={() => { setShowPaste(false); setPasteText(''); handleOcrClear(); }} style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
              <X size={15} />
            </button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            Paste columns copied from Excel (Player Name or IGN, Kills, Damage, Accuracy) or upload a CSV or Excel file or scan an image.
          </p>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10, alignItems: 'stretch' }}>
            <div style={{ flex: 1 }}>
              <textarea
                className="form-textarea"
                rows={5}
                value={pasteText}
                onChange={e => {
                  setPasteText(e.target.value);
                  setIsOcrMode(false);
                  setOcrResults([]);
                }}
                placeholder={`Example:\nPlayerOne\t5\t1200\t45\nPlayerTwo\t2\t850\t35`}
                style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', width: '100%', minHeight: 120 }}
              />
            </div>
            <div style={{
              width: 200,
              border: '2px dashed var(--border-md)',
              borderRadius: 'var(--r-md)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              background: 'var(--bg-card)',
              textAlign: 'center',
              padding: 8
            }}
            onClick={() => fileRef.current?.click()}
            >
              <Upload size={24} style={{ color: 'var(--text-muted)', marginBottom: 6 }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--gold)', fontWeight: 600 }}>{importingFile ? 'Reading...' : 'Upload CSV or Excel'}</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>Or drag file here</span>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>

            {/* Scan Image (OCR) box */}
            <div style={{
              width: 200,
              border: '2px dashed var(--border-md)',
              borderRadius: 'var(--r-md)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              background: 'var(--bg-card)',
              textAlign: 'center',
              padding: 8,
              position: 'relative'
            }}
            onClick={() => {
              if (!ocrProcessing) ocrFileRef.current?.click();
            }}
            >
              {ocrProcessing ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <LoadingSpinner size="sm" />
                  <span style={{ fontSize: '0.75rem', color: 'var(--gold)', fontWeight: 600, marginTop: 8 }}>
                    Scanning ({ocrProgress}%)
                  </span>
                </div>
              ) : (
                <>
                  <Camera size={24} style={{ color: 'var(--text-muted)', marginBottom: 6 }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--gold)', fontWeight: 600 }}>Scan Image (OCR)</span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>Camera capture or upload</span>
                </>
              )}
              <input
                ref={ocrFileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleOcrFileChange}
              />
            </div>
          </div>

          {/* Live Parser Preview */}
          {!isOcrMode && parsedPreview.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                Previewing Parsed Stats ({parsedPreview.length} players mapped):
              </div>
              <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-md)', borderRadius: 'var(--r-sm)' }}>
                <table className="data-table" style={{ fontSize: '0.75rem', width: '100%' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-header)' }}>
                      <th>Player</th>
                      <th>Team</th>
                      <th>Kills</th>
                      <th>Damage</th>
                      <th>Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedPreview.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600 }}>{item.playerName} ({item.ign})</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{item.teamName}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{item.kills}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{item.damage}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{item.accuracy}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* OCR Review Table */}
          {isOcrMode && ocrResults.length > 0 && (
            <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                Review OCR Scanned Players (Day {day} · Lobby {lobby}):
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border-md)', borderRadius: 'var(--r-sm)' }}>
                <table className="data-table" style={{ fontSize: '0.75rem', width: '100%' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-header)' }}>
                      <th>Parsed Name / IGN</th>
                      <th>Matched Player Name</th>
                      <th>Team</th>
                      <th style={{ width: 80 }}>Kills</th>
                      <th>Raw OCR Line</th>
                      <th style={{ width: 50 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ocrResults.map((item, idx) => {
                      const isUnmatched = !item.playerId;
                      const isFallback = item.matchType === 'proName';
                      
                      let rowBg = undefined;
                      let statusBadge = null;

                      if (isUnmatched) {
                        rowBg = 'rgba(239, 68, 68, 0.08)';
                        statusBadge = (
                          <span style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: 'white',
                            background: 'var(--danger)',
                            padding: '2px 6px',
                            borderRadius: 4,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}>
                            <AlertCircle size={10} /> Unmatched
                          </span>
                        );
                      } else if (isFallback) {
                        rowBg = 'rgba(245, 158, 11, 0.08)';
                        statusBadge = (
                          <span style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: 'white',
                            background: 'var(--warning)',
                            padding: '2px 6px',
                            borderRadius: 4,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }} title="Matched via Professional Name instead of IGN (Confidence Low)">
                            <AlertTriangle size={10} /> Low Confidence
                          </span>
                        );
                      }

                      return (
                        <tr key={idx} style={{ background: rowBg }}>
                          <td>
                            <input
                              type="text"
                              className="editable-input"
                              style={{
                                width: '100%',
                                fontSize: '0.75rem',
                                padding: '2px 4px',
                                borderColor: isUnmatched ? 'var(--danger)' : isFallback ? 'var(--warning)' : undefined
                              }}
                              value={item.originalParsedName}
                              onChange={e => handleOcrNameChange(idx, e.target.value)}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 600 }}>{item.playerName}</span>
                              {statusBadge}
                            </div>
                          </td>
                          <td style={{ color: 'var(--text-secondary)' }}>{item.teamName || '—'}</td>
                          <td>
                            <input
                              type="number"
                              className="editable-input"
                              style={{ width: 60, fontSize: '0.75rem', padding: '2px 4px' }}
                              value={item.kills}
                              onChange={e => handleOcrKillsChange(idx, e.target.value)}
                            />
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '0.7rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.sourceLine}>
                            {item.sourceLine}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              onClick={() => handleOcrRemoveRow(idx)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                              onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                              title="Remove this row"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Parsing errors/warnings */}
          {!isOcrMode && pasteErrors.length > 0 && (
            <div style={{ marginTop: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--r-sm)', padding: 10 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--danger)', marginBottom: 4 }}>
                Warnings / Skipped Rows:
              </div>
              <ul style={{ listStyleType: 'disc', paddingLeft: 16, fontSize: '0.72rem', color: 'var(--text-secondary)' }} className="space-y-1">
                {pasteErrors.slice(0, 10).map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
                {pasteErrors.length > 10 && (
                  <li style={{ fontStyle: 'italic', listStyleType: 'none', paddingLeft: 0 }}>...and {pasteErrors.length - 10} more warnings</li>
                )}
              </ul>
            </div>
          )}

          {/* OCR errors/warnings */}
          {isOcrMode && ocrErrors.length > 0 && (
            <div style={{ marginTop: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--r-sm)', padding: 10 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--danger)', marginBottom: 4 }}>
                Warnings / Skipped Rows:
              </div>
              <ul style={{ listStyleType: 'disc', paddingLeft: 16, fontSize: '0.72rem', color: 'var(--text-secondary)' }} className="space-y-1">
                {ocrErrors.slice(0, 10).map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
                {ocrErrors.length > 10 && (
                  <li style={{ fontStyle: 'italic', listStyleType: 'none', paddingLeft: 0 }}>...and {ocrErrors.length - 10} more warnings</li>
                )}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {isOcrMode ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleOcrSave}
                disabled={ocrResults.length === 0 || ocrProcessing || parsing}
              >
                {parsing ? 'Saving results...' : `Save OCR results to Lobby ${lobby}`}
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                onClick={handlePasteImport}
                disabled={parsedPreview.length === 0 || parsing}
              >
                {parsing ? 'Saving stats...' : `Save stats to Lobby ${lobby}`}
              </button>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { setShowPaste(false); setPasteText(''); handleOcrClear(); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── SECTION A: Kills ─────────────────────────────── */}
      {section === 'kills' && (
        <div className="data-table-container">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="col-slot" style={{ width: 50 }}>SLOT</th>
                  <th>PLAYER NAME</th>
                  <th>TEAM</th>
                  <th>CLASS</th>
                  <th style={{ background: 'var(--bg-header)' }}>L{lobby} KILLS</th>
                  <th className="col-kills">KILLS (Lobby Total)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const active = isClass2ActiveToday(row);
                  const kills = parseInt(row.kills) || 0;
                  return (
                    <tr key={row.playerId} style={{ opacity: active ? 1 : 0.45 }}>
                      <td className="col-slot" style={{ textAlign: 'center', fontWeight: 700 }}>{row.slot}</td>
                      <td style={{ fontWeight: 600 }}>{row.playerName}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{row.teamName}</td>
                      <td><ClassBadge playerClass={row.class} /></td>
                      <td>
                        {active ? (
                          <input type="number" min={0} className="editable-input" style={{ width: 70 }}
                            value={row.kills} placeholder="—"
                            onChange={(e) => handleChange(row.playerId, 'kills', e.target.value)}
                            onBlur={() => saveRow(row.playerId)}
                          />
                        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="col-kills">{kills > 0 ? kills : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── SECTION B: Damage & Accuracy ────────────────── */}
      {section === 'damage' && (
        <div className="data-table-container">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>PLAYER NAME</th>
                  <th>L{lobby} DMG</th>
                  <th>L{lobby} ACC%</th>
                  <th>TOTAL DMG (auto)</th>
                  <th>TOTAL ACC (auto)</th>
                  <th className="col-avg-red">AVG DMG</th>
                  <th className="col-avg-red">AVG ACC%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const active = isClass2ActiveToday(row);
                  const dmg = parseFloat(row.damage) || 0;
                  const acc = parseFloat(row.accuracy) || 0;
                  return (
                    <tr key={row.playerId} style={{ opacity: active ? 1 : 0.45 }}>
                      <td style={{ fontWeight: 600 }}>{row.playerName}</td>
                      <td>
                        {active ? (
                          <input type="number" min={0} className="editable-input" style={{ width: 80 }}
                            value={row.damage} placeholder="—"
                            onChange={(e) => handleChange(row.playerId, 'damage', e.target.value)}
                            onBlur={() => saveRow(row.playerId)}
                          />
                        ) : '—'}
                      </td>
                      <td>
                        {active ? (
                          <input type="number" min={0} max={100} step={0.1} className="editable-input" style={{ width: 70 }}
                            value={row.accuracy} placeholder="—"
                            onChange={(e) => handleChange(row.playerId, 'accuracy', e.target.value)}
                            onBlur={() => saveRow(row.playerId)}
                          />
                        ) : '—'}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{dmg > 0 ? dmg : '—'}</td>
                      <td style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{acc > 0 ? `${acc}%` : '—'}</td>
                      <td className="col-avg-red">{dmg > 0 ? Math.round(dmg) : '—'}</td>
                      <td className="col-avg-red">{acc > 0 ? `${acc.toFixed(1)}%` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ROSTER UPDATE (Class 2, Days 3-5) ───────────── */}
      {section === 'rosterUpdate' && showRU && (
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 16, color: 'var(--cyan)' }}>
            ROSTER UPDATE — Day {day} (Class 2 Players)
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Kills and damage/accuracy for Class 2 players on their active days (Days {ruDays.join(', ')}).
          </p>
          <div className="data-table-container">
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>PRO NAME</th>
                    <th>TEAM</th>
                    <th style={{ color: 'var(--cyan)' }}>L{lobby} KILLS</th>
                    <th style={{ color: 'var(--cyan)' }}>L{lobby} DMG</th>
                    <th style={{ color: 'var(--cyan)' }}>L{lobby} ACC%</th>
                    <th className="col-cyan">KILLS (auto)</th>
                    <th className="col-cyan">EVENTS (auto)</th>
                  </tr>
                </thead>
                <tbody>
                  {getClass2Players().map((row) => {
                    const kills = parseInt(row.kills) || 0;
                    return (
                      <tr key={row.playerId}>
                        <td style={{ fontWeight: 600 }}>{row.playerName}<br /><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{row.ign}</span></td>
                        <td style={{ color: 'var(--text-secondary)' }}>{row.teamName}</td>
                        <td>
                          <input type="number" min={0} className="editable-input" style={{ width: 70 }}
                            value={row.kills} placeholder="—"
                            onChange={(e) => handleChange(row.playerId, 'kills', e.target.value)}
                            onBlur={() => saveRow(row.playerId)}
                          />
                        </td>
                        <td>
                          <input type="number" min={0} className="editable-input" style={{ width: 80 }}
                            value={row.damage} placeholder="—"
                            onChange={(e) => handleChange(row.playerId, 'damage', e.target.value)}
                            onBlur={() => saveRow(row.playerId)}
                          />
                        </td>
                        <td>
                          <input type="number" min={0} max={100} step={0.1} className="editable-input" style={{ width: 70 }}
                            value={row.accuracy} placeholder="—"
                            onChange={(e) => handleChange(row.playerId, 'accuracy', e.target.value)}
                            onBlur={() => saveRow(row.playerId)}
                          />
                        </td>
                        <td className="col-cyan">{kills > 0 ? kills : '—'}</td>
                        <td className="col-cyan">{kills > 0 ? 1 : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
