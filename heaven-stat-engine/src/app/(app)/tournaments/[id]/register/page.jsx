'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTournament } from '../layout';
import {
  getTeamRegistrations, addTeamRegistration, updateTeamRegistration, deleteTeamRegistration,
  getPlayerRegistrations, addPlayerRegistration, updatePlayerRegistration, deletePlayerRegistration,
} from '@/lib/firestore/tournaments';
import { findTeamByName, createTeam, getTeams, findPlayerByName, createPlayer, getPlayers } from '@/lib/firestore/registry';
import { deriveRegion, deriveDevice, REGIONS, DEVICE_TYPES } from '@/lib/regionDeviceLogic';
import Modal from '@/components/ui/Modal';
import { getSimilarTeams } from '@/lib/utils/similarity';
import {
  getAllSheetsAsCSV,
  parsePlayerRegistrationCSV,
  parseTeamRegistrationCSV,
} from '@/lib/importers/csvParser';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import { Plus, Trash2, Upload, Users, Shield, Search, Check, FileSpreadsheet, X, ChevronRight, ClipboardPaste } from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Sheet Picker Modal ───────────────────────────────────────────────────────
function SheetPickerModal({ sheets, onSelect, onClose }) {
  return (
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
              Multiple Sheets Detected
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 18 }}>
          Select which sheet to import data from:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sheets.map((name) => (
            <button
              key={name}
              onClick={() => onSelect(name)}
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
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Inline Editable Cell Component ──────────────────────────────────────────
function EditableCell({ value, onSave, type = 'text', width = '100%', selectOptions = null }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  useEffect(() => { setLocal(value); }, [value]);

  const handleBlur = () => {
    setEditing(false);
    if (local !== value) {
      onSave(local);
    }
  };

  if (editing) {
    if (selectOptions) {
      return (
        <td>
          <select
            className="editable-input text-xs"
            style={{ width, padding: '2px 4px', height: 'auto', minHeight: 24 }}
            value={local}
            autoFocus
            onChange={e => setLocal(e.target.value)}
            onBlur={handleBlur}
          >
            {selectOptions.map(opt => (
              <option key={opt} value={opt}>{opt || '—'}</option>
            ))}
          </select>
        </td>
      );
    }
    return (
      <td>
        <input
          className="editable-input text-xs"
          style={{ width, padding: '2px 4px', height: 'auto' }}
          type={type}
          value={local}
          autoFocus
          onChange={e => setLocal(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={e => {
            if (e.key === 'Enter') handleBlur();
            if (e.key === 'Escape') { setEditing(false); setLocal(value); }
          }}
        />
      </td>
    );
  }

  return (
    <td>
      <div
        className="editable-cell-display"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onFocus={() => setEditing(true)}
        style={{ minHeight: 'auto', padding: '2px 6px', fontSize: '0.85rem' }}
      >
        {local !== '' && local !== null && local !== undefined ? <span>{local}</span> : <span className="cell-empty">—</span>}
      </div>
    </td>
  );
}

// ─── Text Copy-Paste Parsers ─────────────────────────────────────────────────
function parsePastedTeams(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const teams = [];
  lines.forEach((line, i) => {
    if (line.includes('\t')) {
      const parts = line.split('\t').map(p => p.trim());
      if (parts.length >= 2 && !isNaN(parts[0])) {
        teams.push({ slot: parseInt(parts[0]), teamName: parts[1], clanName: parts[2] || '', tier: parts[3] || '' });
      } else {
        teams.push({ slot: i + 1, teamName: parts[0], clanName: parts[1] || '', tier: parts[2] || '' });
      }
    } else if (line.includes(',')) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length >= 2 && !isNaN(parts[0])) {
        teams.push({ slot: parseInt(parts[0]), teamName: parts[1], clanName: parts[2] || '', tier: parts[3] || '' });
      } else {
        teams.push({ slot: i + 1, teamName: parts[0], clanName: parts[1] || '', tier: parts[2] || '' });
      }
    } else {
      teams.push({ slot: i + 1, teamName: line, clanName: '', tier: '' });
    }
  });
  return teams;
}

function parsePastedPlayers(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const players = [];
  lines.forEach((line, i) => {
    if (line.includes('\t')) {
      const parts = line.split('\t').map(p => p.trim());
      players.push({
        slot: parseInt(parts[0]) || (i + 1),
        professionalName: parts[1] || '',
        ign: parts[2] || '',
        teamName: parts[3] || '',
        class: parts[4] || 'Registered',
        gender: parts[5] || '',
        region: parts[6] || '',
        country: parts[7] || '',
        device: parts[8] || '',
        deviceModel: parts[9] || ''
      });
    } else if (line.includes(',')) {
      const parts = line.split(',').map(p => p.trim());
      players.push({
        slot: parseInt(parts[0]) || (i + 1),
        professionalName: parts[1] || '',
        ign: parts[2] || '',
        teamName: parts[3] || '',
        class: parts[4] || 'Registered',
        gender: parts[5] || '',
        region: parts[6] || '',
        country: parts[7] || '',
        device: parts[8] || '',
        deviceModel: parts[9] || ''
      });
    } else {
      players.push({
        slot: i + 1,
        professionalName: line,
        ign: line,
        teamName: '',
        class: 'Registered',
        gender: '',
        region: '',
        country: '',
        device: '',
        deviceModel: ''
      });
    }
  });
  return players;
}

export default function RegisterPage() {
  const { id } = useParams();
  const { tournament } = useTournament();
  const [tab, setTab] = useState('teams');
  const [teamRegs, setTeamRegs] = useState([]);
  const [playerRegs, setPlayerRegs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [globalTeams, setGlobalTeams] = useState([]);
  const [globalPlayers, setGlobalPlayers] = useState([]);

  const classes = tournament?.structure?.playerClasses || [];

  const refresh = useCallback(async () => {
    const [tr, pr, gt, gp] = await Promise.all([
      getTeamRegistrations(id),
      getPlayerRegistrations(id),
      getTeams(),
      getPlayers(),
    ]);
    setTeamRegs(tr);
    setPlayerRegs(pr);
    setGlobalTeams(gt);
    setGlobalPlayers(gp);
  }, [id]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  if (loading) return <LoadingSpinner size="lg" text="Loading registrations..." />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Registration</h1>
          <p className="page-subtitle">Register teams and players for this tournament</p>
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab ${tab === 'teams' ? 'active' : ''}`} onClick={() => setTab('teams')}>
          <Shield size={14} style={{ marginRight: 6 }} /> Teams ({teamRegs.length})
        </button>
        <button className={`tab ${tab === 'players' ? 'active' : ''}`} onClick={() => setTab('players')}>
          <Users size={14} style={{ marginRight: 6 }} /> Players ({playerRegs.length})
        </button>
      </div>

      {tab === 'teams' && (
        <TeamRegistrationPanel
          tournamentId={id}
          registrations={teamRegs}
          globalTeams={globalTeams}
          onRefresh={refresh}
        />
      )}
      {tab === 'players' && (
        <PlayerRegistrationPanel
          tournamentId={id}
          registrations={playerRegs}
          teamRegistrations={teamRegs}
          globalPlayers={globalPlayers}
          globalTeams={globalTeams}
          classes={classes}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

// ─── useSheetUpload hook ──────────────────────────────────────────────────────
function useSheetUpload(onImport) {
  const fileRef = useRef(null);
  const [sheetModal, setSheetModal] = useState(null); // { sheets: [...], allSheets: {...} }
  const [importing, setImporting] = useState(false);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validExt = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!validExt) { toast.error('Only .xlsx, .xls, or .csv files are supported'); return; }

    setImporting(true);
    try {
      const allSheets = await getAllSheetsAsCSV(file);
      const names = Object.keys(allSheets);

      if (names.length === 1) {
        // Single sheet — import directly
        await onImport(allSheets[names[0]], names[0]);
      } else {
        // Multiple sheets — show picker
        setSheetModal({ sheets: names, allSheets });
      }
    } catch (err) {
      toast.error('Failed to read file: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleSheetSelect = async (sheetName) => {
    if (!sheetModal) return;
    const csv = sheetModal.allSheets[sheetName];
    setSheetModal(null);
    setImporting(true);
    try {
      await onImport(csv, sheetName);
    } catch (err) {
      toast.error('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  const trigger = () => fileRef.current?.click();

  const modal = sheetModal ? (
    <SheetPickerModal
      sheets={sheetModal.sheets}
      onSelect={handleSheetSelect}
      onClose={() => setSheetModal(null)}
    />
  ) : null;

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept=".xlsx,.xls,.csv"
      style={{ display: 'none' }}
      onChange={handleFileChange}
    />
  );

  return { trigger, modal, input, importing };
}

// ─── Team Registration Panel ─────────────────────────────────────────────────
function TeamRegistrationPanel({ tournamentId, registrations, globalTeams, onRefresh }) {
  const [addingRow, setAddingRow] = useState(false);
  const [newTeam, setNewTeam] = useState({ slot: '', teamName: '', clanName: '', tier: '' });
  const [teamSearch, setTeamSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Paste Data states
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);

  // Import Preview states
  const [importQueue, setImportQueue] = useState([]);
  const [showImportPreview, setShowImportPreview] = useState(false);

  const exactMatch = teamSearch.length > 1
    ? globalTeams.find(t => t.teamName.toLowerCase() === teamSearch.toLowerCase())
    : null;

  const similarTeams = teamSearch.length > 1
    ? getSimilarTeams(teamSearch, globalTeams, 0.75).filter(t => t.id !== exactMatch?.id)
    : [];

  const prepareImport = (parsedRows) => {
    const queue = parsedRows.map((row, index) => {
      const name = row.teamName.trim();
      const clan = row.clanName?.trim() || '';
      const slot = Number(row.slot) || (registrations.length + index + 1);
      const tier = row.tier || '';

      const exact = globalTeams.find(t => t.teamName.toLowerCase() === name.toLowerCase());
      if (exact) {
        return {
          id: `imp_${Date.now()}_${index}`,
          slot,
          teamName: exact.teamName,
          clanName: exact.clanName || clan,
          tier,
          teamId: exact.id,
          isLinked: true,
          originalName: name,
          conflict: null
        };
      }

      const similar = getSimilarTeams(name, globalTeams, 0.75);
      return {
        id: `imp_${Date.now()}_${index}`,
        slot,
        teamName: name,
        clanName: clan,
        tier,
        teamId: '',
        isLinked: false,
        originalName: name,
        conflict: similar.length > 0 ? similar[0] : null
      };
    });

    const hasConflicts = queue.some(item => item.conflict !== null);
    if (hasConflicts) {
      setImportQueue(queue);
      setShowImportPreview(true);
    } else {
      executeRegistration(queue);
    }
  };

  const executeRegistration = async (queue) => {
    setSaving(true);
    let added = 0;
    try {
      for (const item of queue) {
        let team;
        if (item.isLinked && item.teamId) {
          team = { id: item.teamId, teamName: item.teamName, clanName: item.clanName };
        } else {
          team = await createTeam({ teamName: item.teamName.trim(), clanName: item.clanName.trim() });
        }

        await addTeamRegistration(tournamentId, {
          teamId: team.id,
          teamName: team.teamName,
          clanName: team.clanName,
          slot: item.slot,
          tier: item.tier,
        });
        added++;
      }
      toast.success(`Registered ${added} teams successfully`);
      setShowImportPreview(false);
      setImportQueue([]);
      await onRefresh();
    } catch (e) {
      toast.error('Failed to register teams: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!newTeam.teamName.trim()) { toast.error('Team name required'); return; }
    
    const name = newTeam.teamName.trim();
    const clan = newTeam.clanName.trim();
    const slot = Number(newTeam.slot) || registrations.length + 1;
    const tier = newTeam.tier;

    const exact = globalTeams.find(t => t.teamName.toLowerCase() === name.toLowerCase());
    if (exact) {
      setSaving(true);
      try {
        await addTeamRegistration(tournamentId, {
          teamId: exact.id,
          teamName: exact.teamName,
          clanName: exact.clanName || clan,
          slot,
          tier,
        });
        toast.success(`${exact.teamName} linked and registered`);
        setNewTeam({ slot: '', teamName: '', clanName: '', tier: '' });
        setAddingRow(false);
        setTeamSearch('');
        await onRefresh();
      } catch (e) {
        toast.error(e.message);
      } finally {
        setSaving(false);
      }
      return;
    }

    const similar = getSimilarTeams(name, globalTeams, 0.75);
    if (similar.length > 0) {
      const manualItem = {
        id: `imp_manual_${Date.now()}`,
        slot,
        teamName: name,
        clanName: clan,
        tier,
        teamId: '',
        isLinked: false,
        originalName: name,
        conflict: similar[0]
      };
      setImportQueue([manualItem]);
      setShowImportPreview(true);
      setNewTeam({ slot: '', teamName: '', clanName: '', tier: '' });
      setAddingRow(false);
      setTeamSearch('');
      return;
    }

    setSaving(true);
    try {
      const team = await createTeam({ teamName: name, clanName: clan });
      await addTeamRegistration(tournamentId, {
        teamId: team.id,
        teamName: team.teamName,
        clanName: team.clanName,
        slot,
        tier,
      });
      toast.success(`${team.teamName} registered`);
      setNewTeam({ slot: '', teamName: '', clanName: '', tier: '' });
      setAddingRow(false);
      setTeamSearch('');
      await onRefresh();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const handleUpdateTeam = async (regId, fields) => {
    try {
      await updateTeamRegistration(tournamentId, regId, fields);
      await onRefresh();
    } catch (e) {
      toast.error('Failed to update team: ' + e.message);
    }
  };

  const handleDelete = async (regId, teamName) => {
    if (!confirm(`Remove ${teamName} from this tournament?`)) return;
    await deleteTeamRegistration(tournamentId, regId);
    toast.success('Removed');
    await onRefresh();
  };

  const handlePasteImport = async () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    try {
      const parsed = parsePastedTeams(pasteText);
      if (parsed.length === 0) {
        toast.error('No teams parsed. Please check the copy format.');
        return;
      }
      prepareImport(parsed);
      setPasteText('');
      setShowPaste(false);
    } catch (err) {
      toast.error('Import failed: ' + err.message);
    } finally {
      setParsing(false);
    }
  };

  const handleClearAll = async () => {
    if (!confirm(`Are you sure you want to remove all ${registrations.length} teams from this tournament? This will not delete teams globally, but will remove their registrations.`)) return;
    setSaving(true);
    try {
      for (const reg of registrations) {
        await deleteTeamRegistration(tournamentId, reg.id);
      }
      toast.success('All team registrations cleared');
      await onRefresh();
    } catch (e) {
      toast.error('Failed to clear registrations: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Upload logic ──────────────────────────────────────────────────────────
  const handleTeamImport = async (csvText, sheetLabel) => {
    const { rows, errors } = parseTeamRegistrationCSV(csvText);
    if (errors?.length) console.warn('CSV parse warnings:', errors);

    const validRows = rows.filter(r => r.teamName?.trim());
    if (validRows.length === 0) {
      toast.error(`No valid team rows found in "${sheetLabel}". Check column headers (teamName / team).`);
      return;
    }

    prepareImport(validRows);
  };

  const { trigger, modal, input, importing } = useSheetUpload(handleTeamImport);

  const teamCols = [
    { w: 60, label: 'SLOT' },
    { w: 200, label: 'TEAM NAME' },
    { w: 160, label: 'CLAN' },
    { w: 120, label: 'TIER' },
    { w: 60, label: '' },
  ];

  return (
    <div className="data-table-container">
      {modal}
      {input}
      <div className="data-table-toolbar">
        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Teams</span>
        <span className="data-table-count">{registrations.length} registered</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {registrations.length > 0 && (
            <button
              className="btn btn-danger btn-sm"
              onClick={handleClearAll}
              disabled={saving}
              title="Remove all registered teams from this tournament"
            >
              <Trash2 size={13} /> Clear All
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowPaste(v => !v)}
            title="Copy and paste a list of team names directly"
          >
            <ClipboardPaste size={13} /> Paste Data
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={trigger}
            disabled={importing}
            title="Upload CSV or Excel file (supports multiple sheets)"
          >
            <Upload size={13} /> {importing ? 'Importing…' : 'Upload CSV / Excel'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setAddingRow(true)}>
            <Plus size={13} /> Add Team
          </button>
        </div>
      </div>

      {/* Paste Area panel */}
      {showPaste && (
        <div className="card" style={{ margin: '12px 16px', border: '1px solid var(--border-gold)', background: 'rgba(201,168,76,0.02)' }}>
          <div className="flex-between" style={{ marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--gold)' }}>Paste Teams List (Plain text, TSV, or CSV)</span>
            <button onClick={() => setShowPaste(false)} style={{ color: 'var(--text-muted)' }}><X size={15} /></button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            Paste tab-separated columns copied from Excel (Slot, Team Name, Clan, Tier) or list of names (one per line).
          </p>
          <textarea
            className="form-textarea"
            rows={5}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder={`Example:\nTeam Liquid\nFnatic\n\nOr:\n1\tTeam Liquid\tLiquid Clan\tT1\n2\tFnatic\tFNC\tT2`}
            style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={handlePasteImport} disabled={!pasteText.trim() || parsing}>
              {parsing ? 'Importing...' : 'Register Teams'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowPaste(false); setPasteText(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Upload hint */}
      <div style={{
        padding: '8px 16px', fontSize: '0.75rem', color: 'var(--text-muted)',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-alt-row)',
      }}>
        📋 <strong>Expected columns:</strong> <code>teamName</code>, <code>clanName</code>, <code>tier</code>, <code>slot</code> — Click cells below to edit.
      </div>

      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {teamCols.map(c => <th key={c.label} style={{ width: c.w }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {registrations.length === 0 && !addingRow && (
              <tr><td colSpan={5} className="empty-row">No teams registered yet — add manually, upload, or paste a list</td></tr>
            )}
            {registrations.map((reg, i) => (
              <tr key={reg.id}>
                <EditableCell
                  value={reg.slot}
                  type="number"
                  width="60px"
                  onSave={val => handleUpdateTeam(reg.id, { slot: Number(val) || i + 1 })}
                />
                <EditableCell
                  value={reg.teamName}
                  width="200px"
                  onSave={val => handleUpdateTeam(reg.id, { teamName: val })}
                />
                <EditableCell
                  value={reg.clanName}
                  width="160px"
                  onSave={val => handleUpdateTeam(reg.id, { clanName: val })}
                />
                <EditableCell
                  value={reg.tier}
                  width="120px"
                  onSave={val => handleUpdateTeam(reg.id, { tier: val })}
                />
                <td>
                  <button className="btn btn-ghost" style={{ padding: '4px 6px' }} onClick={() => handleDelete(reg.id, reg.teamName)}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {addingRow && (
              <tr style={{ background: 'rgba(201,168,76,0.06)' }}>
                <td><input className="editable-input" style={{ width: 50 }} placeholder="#" value={newTeam.slot} onChange={e => setNewTeam(p => ({ ...p, slot: e.target.value }))} /></td>
                <td>
                  <input
                    className="editable-input"
                    style={{ width: 180 }}
                    placeholder="Team name..."
                    value={newTeam.teamName}
                    onChange={e => {
                      setNewTeam(p => ({ ...p, teamName: e.target.value }));
                      setTeamSearch(e.target.value);
                    }}
                  />
                  {exactMatch && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--cyan)', marginTop: 3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                      onClick={() => { setNewTeam(p => ({ ...p, teamName: exactMatch.teamName, clanName: exactMatch.clanName })); setTeamSearch(''); }}>
                      <Check size={10} /> Link existing: {exactMatch.teamName}
                    </div>
                  )}
                  {!exactMatch && similarTeams.length > 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--gold)', marginTop: 4, padding: '4px 6px', background: 'rgba(201,168,76,0.05)', borderRadius: 6, border: '1px dashed rgba(201,168,76,0.15)' }}>
                      <span style={{ fontWeight: 600, display: 'block', marginBottom: 2 }}>⚠️ Similar team exists:</span>
                      {similarTeams.slice(0, 2).map(t => (
                        <div key={t.id} style={{ cursor: 'pointer', textDecoration: 'underline', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}
                          onClick={() => { setNewTeam(p => ({ ...p, teamName: t.teamName, clanName: t.clanName })); setTeamSearch(''); }}>
                          Link: {t.teamName}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td><input className="editable-input" style={{ width: 140 }} placeholder="Clan name..." value={newTeam.clanName} onChange={e => setNewTeam(p => ({ ...p, clanName: e.target.value }))} /></td>
                <td><input className="editable-input" style={{ width: 100 }} placeholder="T1/T2..." value={newTeam.tier} onChange={e => setNewTeam(p => ({ ...p, tier: e.target.value }))} /></td>
                <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>
                    {saving ? '...' : <Check size={13} />}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setAddingRow(false)}>✕</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {showImportPreview && (
        <Modal title="Sync & Register Preview" onClose={() => setShowImportPreview(false)} size="lg">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              We found existing teams in the registry with names very similar to the ones you're trying to add.
              Review them below and choose whether to link them or register them as new:
            </p>
            <div style={{ maxHeight: '50vh', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Slot</th>
                    <th>Entered Name</th>
                    <th>Clan / Tier</th>
                    <th>Similarity Match Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {importQueue.map((item, idx) => (
                    <tr key={item.id} style={{ background: item.conflict ? 'rgba(201,168,76,0.02)' : 'transparent' }}>
                      <td>{item.slot}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.originalName}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {item.clanName ? `Clan: ${item.clanName}` : ''} {item.tier ? `[${item.tier}]` : ''}
                        </span>
                      </td>
                      <td>
                        {item.conflict ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span>⚠️ Similar: <strong>{item.conflict.teamName}</strong> {item.conflict.clanName ? `(Clan: ${item.conflict.clanName})` : ''}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                type="button"
                                className={`btn btn-xs ${item.isLinked ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => {
                                  const newQueue = [...importQueue];
                                  newQueue[idx] = {
                                    ...item,
                                    isLinked: true,
                                    teamId: item.conflict.id,
                                    teamName: item.conflict.teamName,
                                    clanName: item.conflict.clanName || item.clanName
                                  };
                                  setImportQueue(newQueue);
                                }}
                              >
                                Link to Existing
                              </button>
                              <button
                                type="button"
                                className={`btn btn-xs ${!item.isLinked ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => {
                                  const newQueue = [...importQueue];
                                  newQueue[idx] = {
                                    ...item,
                                    isLinked: false,
                                    teamId: '',
                                    teamName: item.originalName,
                                    clanName: item.clanName
                                  };
                                  setImportQueue(newQueue);
                                }}
                              >
                                Register as New
                              </button>
                            </div>
                          </div>
                        ) : item.isLinked ? (
                          <span style={{ fontSize: '0.75rem', color: 'var(--cyan)' }}>✓ Auto-linked to exact match</span>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Will register as new team</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowImportPreview(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => executeRegistration(importQueue)} disabled={saving}>
                {saving ? 'Registering...' : `Confirm & Register ${importQueue.length} Teams`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Player Registration Panel ───────────────────────────────────────────────
function PlayerRegistrationPanel({ tournamentId, registrations, teamRegistrations, globalPlayers, globalTeams, classes, onRefresh }) {
  const [addingRow, setAddingRow] = useState(false);
  const [newPlayer, setNewPlayer] = useState({ slot: '', professionalName: '', ign: '', teamName: '', category: 'Registered', gender: '', region: '', country: '', device: '', deviceModel: '' });
  const [saving, setSaving] = useState(false);
  const [nameSearch, setNameSearch] = useState('');

  // Paste Data states
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);

  const matchedPlayer = nameSearch.length > 1
    ? globalPlayers.find(p => p.professionalName?.toLowerCase().includes(nameSearch.toLowerCase()) || p.ign?.toLowerCase().includes(nameSearch.toLowerCase()))
    : null;

  const teamReg = teamRegistrations.find(t => t.teamName?.toLowerCase() === newPlayer.teamName?.toLowerCase());

  const handleAdd = async () => {
    if (!newPlayer.professionalName.trim() && !newPlayer.ign.trim()) { toast.error('Name or IGN required'); return; }
    setSaving(true);
    try {
      const player = await createPlayer({
        professionalName: newPlayer.professionalName.trim(),
        ign: newPlayer.ign.trim(),
        gender: newPlayer.gender,
        region: newPlayer.region || deriveRegion(newPlayer.country),
        country: newPlayer.country,
        device: newPlayer.device || deriveDevice(newPlayer.deviceModel),
        deviceModel: newPlayer.deviceModel,
        category: newPlayer.category,
      });
      await addPlayerRegistration(tournamentId, {
        playerId: player.id,
        slot: Number(newPlayer.slot) || registrations.length + 1,
        class: newPlayer.category,
        teamId: teamReg?.teamId || '',
        teamName: newPlayer.teamName,
        ign: player.ign,
        professionalName: player.professionalName,
      });
      toast.success(`${player.professionalName || player.ign} registered`);
      setNewPlayer(p => ({ ...p, slot: '', professionalName: '', ign: '' }));
      setAddingRow(false);
      await onRefresh();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const handleUpdatePlayer = async (regId, fields) => {
    try {
      await updatePlayerRegistration(tournamentId, regId, fields);
      await onRefresh();
    } catch (e) {
      toast.error('Failed to update player: ' + e.message);
    }
  };

  const handleDelete = async (regId, name) => {
    if (!confirm(`Remove ${name}?`)) return;
    await deletePlayerRegistration(tournamentId, regId);
    toast.success('Removed');
    await onRefresh();
  };

  const handlePasteImport = async () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    try {
      const parsed = parsePastedPlayers(pasteText);
      if (parsed.length === 0) {
        toast.error('No players parsed. Please check the copy format.');
        return;
      }
      let added = 0;
      for (const row of parsed) {
        const matchedTeam = teamRegistrations.find(
          t => t.teamName?.toLowerCase() === row.teamName?.toLowerCase()
        );
        const player = await createPlayer({
          professionalName: row.professionalName,
          ign: row.ign,
          gender: row.gender,
          region: row.region || deriveRegion(row.country || ''),
          country: row.country,
          device: row.device || deriveDevice(row.deviceModel || ''),
          deviceModel: row.deviceModel,
          category: row.class || 'Registered',
        });
        await addPlayerRegistration(tournamentId, {
          playerId: player.id,
          slot: row.slot || (registrations.length + added + 1),
          class: row.class || 'Registered',
          teamId: matchedTeam?.teamId || '',
          teamName: row.teamName || '',
          ign: player.ign,
          professionalName: player.professionalName,
        });
        added++;
      }
      toast.success(`Registered ${added} players from paste`);
      setPasteText('');
      setShowPaste(false);
      await onRefresh();
    } catch (err) {
      toast.error('Import failed: ' + err.message);
    } finally {
      setParsing(false);
    }
  };

  const handleClearAll = async () => {
    if (!confirm(`Are you sure you want to remove all ${registrations.length} players from this tournament?`)) return;
    setSaving(true);
    try {
      for (const reg of registrations) {
        await deletePlayerRegistration(tournamentId, reg.id);
      }
      toast.success('All player registrations cleared');
      await onRefresh();
    } catch (e) {
      toast.error('Failed to clear registrations: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Upload logic ──────────────────────────────────────────────────────────
  const handlePlayerImport = async (csvText, sheetLabel) => {
    const { rows, errors } = parsePlayerRegistrationCSV(csvText);
    if (errors?.length) console.warn('CSV parse warnings:', errors);

    const validRows = rows.filter(r => r.professionalName?.trim() || r.ign?.trim());
    if (validRows.length === 0) {
      toast.error(`No valid player rows found in "${sheetLabel}". Check column headers (professionalName / ign).`);
      return;
    }

    let added = 0, skipped = 0;
    for (const row of validRows) {
      try {
        const matchedTeam = teamRegistrations.find(
          t => t.teamName?.toLowerCase() === row.teamName?.toLowerCase()
        );
        const player = await createPlayer({
          professionalName: row.professionalName || '',
          ign: row.ign || '',
          gender: row.gender || '',
          region: row.region || deriveRegion(row.country || ''),
          country: row.country || '',
          device: row.device || deriveDevice(row.deviceModel || ''),
          deviceModel: row.deviceModel || '',
          category: row.class || 'Registered',
        });
        await addPlayerRegistration(tournamentId, {
          playerId: player.id,
          slot: row.slot || (registrations.length + added + 1),
          class: row.class || 'Registered',
          teamId: matchedTeam?.teamId || '',
          teamName: row.teamName || '',
          ign: player.ign,
          professionalName: player.professionalName,
        });
        added++;
      } catch {
        skipped++;
      }
    }
    toast.success(`Imported ${added} player${added !== 1 ? 's' : ''} from "${sheetLabel}"${skipped ? ` (${skipped} skipped)` : ''}`);
    await onRefresh();
  };

  const { trigger, modal, input, importing } = useSheetUpload(handlePlayerImport);

  // Sort registrations by team name then slot
  const sortedRegistrations = [...registrations].sort((a, b) => {
    const tc = (a.teamName || '').localeCompare(b.teamName || '');
    if (tc !== 0) return tc;
    return (a.slot || 0) - (b.slot || 0);
  });

  const FIELDS = ['PRO NAME', 'IGN', 'TEAM', 'CATEGORY', 'GENDER', 'REGION', 'COUNTRY', 'DEVICE', 'MODEL', ''];

  return (
    <div className="data-table-container">
      {modal}
      {input}
      <div className="data-table-toolbar">
        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Players</span>
        <span className="data-table-count">{registrations.length} registered</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {registrations.length > 0 && (
            <button
              className="btn btn-danger btn-sm"
              onClick={handleClearAll}
              disabled={saving}
              title="Remove all registered players from this tournament"
            >
              <Trash2 size={13} /> Clear All
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowPaste(v => !v)}
            title="Copy and paste a list of player names/details directly"
          >
            <ClipboardPaste size={13} /> Paste Data
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={trigger}
            disabled={importing}
            title="Upload CSV or Excel file (supports multiple sheets)"
          >
            <Upload size={13} /> {importing ? 'Importing…' : 'Upload CSV / Excel'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setAddingRow(true)}>
            <Plus size={13} /> Add Player
          </button>
        </div>
      </div>

      {/* Paste Area panel */}
      {showPaste && (
        <div className="card" style={{ margin: '12px 16px', border: '1px solid var(--border-gold)', background: 'rgba(201,168,76,0.02)' }}>
          <div className="flex-between" style={{ marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--gold)' }}>Paste Players List (Plain text, TSV, or CSV)</span>
            <button onClick={() => setShowPaste(false)} style={{ color: 'var(--text-muted)' }}><X size={15} /></button>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            Paste tab-separated columns copied from Excel (Slot, Pro Name, IGN, Team, Category, Gender, Region, Country, Device, Model) or list of names (one per line).
          </p>
          <textarea
            className="form-textarea"
            rows={5}
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder={`Example:\nPlayer One\nPlayer Two\n\nOr:\n1\tPlayer One\tP1_IGN\tTeam Liquid\tRegistered\tMale\tNA\tUSA\tMobile\tiPhone`}
            style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={handlePasteImport} disabled={!pasteText.trim() || parsing}>
              {parsing ? 'Importing...' : 'Register Players'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowPaste(false); setPasteText(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Upload hint */}
      <div style={{
        padding: '8px 16px', fontSize: '0.75rem', color: 'var(--text-muted)',
        borderBottom: '1px solid var(--border)', background: 'var(--bg-alt-row)',
      }}>
        📋 <strong>Expected columns:</strong> <code>professionalName</code>, <code>ign</code>, <code>teamName</code>, <code>class</code>, <code>gender</code>, <code>region</code>, <code>country</code>, <code>device</code>, <code>deviceModel</code> — Click cells below to edit.
      </div>

      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {FIELDS.map(f => <th key={f}>{f}</th>)}
            </tr>
          </thead>
          <tbody>
            {registrations.length === 0 && !addingRow && (
              <tr><td colSpan={FIELDS.length} className="empty-row">No players registered yet — add manually, upload, or paste a list</td></tr>
            )}
            {sortedRegistrations.map((reg, i) => {
              return (
                <tr key={reg.id}>
                  <EditableCell
                    value={reg.professionalName}
                    width="110px"
                    onSave={val => handleUpdatePlayer(reg.id, { professionalName: val })}
                  />
                  <EditableCell
                    value={reg.ign}
                    width="100px"
                    onSave={val => handleUpdatePlayer(reg.id, { ign: val })}
                  />
                  <EditableCell
                    value={reg.teamName}
                    width="120px"
                    selectOptions={['', ...teamRegistrations.map(t => t.teamName)]}
                    onSave={val => handleUpdatePlayer(reg.id, { teamName: val, teamId: teamRegistrations.find(t => t.teamName === val)?.teamId || '' })}
                  />
                  <EditableCell
                    value={reg.class || 'Registered'}
                    width="110px"
                    selectOptions={['Registered', 'Transferred In']}
                    onSave={val => handleUpdatePlayer(reg.id, { class: val })}
                  />
                  <EditableCell
                    value={reg.gender}
                    width="60px"
                    onSave={val => handleUpdatePlayer(reg.id, { gender: val })}
                  />
                  <EditableCell
                    value={reg.region}
                    width="80px"
                    onSave={val => handleUpdatePlayer(reg.id, { region: val })}
                  />
                  <EditableCell
                    value={reg.country}
                    width="80px"
                    onSave={val => handleUpdatePlayer(reg.id, { country: val })}
                  />
                  <EditableCell
                    value={reg.device}
                    width="80px"
                    onSave={val => handleUpdatePlayer(reg.id, { device: val })}
                  />
                  <EditableCell
                    value={reg.deviceModel}
                    width="80px"
                    onSave={val => handleUpdatePlayer(reg.id, { deviceModel: val })}
                  />
                  <td>
                    <button className="btn btn-ghost" style={{ padding: '4px 6px' }} onClick={() => handleDelete(reg.id, reg.professionalName || reg.ign)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {addingRow && (
              <tr style={{ background: 'rgba(201,168,76,0.06)' }}>
                <td>
                  <input className="editable-input" style={{ width: 130 }} placeholder="Pro name..." value={newPlayer.professionalName}
                    onChange={e => { setNewPlayer(p => ({ ...p, professionalName: e.target.value })); setNameSearch(e.target.value); }} />
                  {matchedPlayer && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--cyan)', cursor: 'pointer', marginTop: 2 }}
                      onClick={() => setNewPlayer(p => ({ ...p, professionalName: matchedPlayer.professionalName, ign: matchedPlayer.ign, gender: matchedPlayer.gender || '', region: matchedPlayer.region || '', country: matchedPlayer.country || '', device: matchedPlayer.device || '', deviceModel: matchedPlayer.deviceModel || '' }))}>
                      <Check size={9} /> Link: {matchedPlayer.professionalName}
                    </div>
                  )}
                </td>
                <td><input className="editable-input" style={{ width: 110 }} placeholder="IGN..." value={newPlayer.ign} onChange={e => setNewPlayer(p => ({ ...p, ign: e.target.value }))} /></td>
                <td>
                  <select className="editable-input" style={{ width: 120 }} value={newPlayer.teamName} onChange={e => setNewPlayer(p => ({ ...p, teamName: e.target.value }))}>
                    <option value="">— Team —</option>
                    {teamRegistrations.map(t => <option key={t.id} value={t.teamName}>{t.teamName}</option>)}
                  </select>
                </td>
                <td>
                  <select className="editable-input" style={{ width: 110 }} value={newPlayer.category} onChange={e => setNewPlayer(p => ({ ...p, category: e.target.value }))}>
                    <option value="Registered">Registered</option>
                    <option value="Transferred In">Transferred In</option>
                  </select>
                </td>
                <td><input className="editable-input" style={{ width: 70 }} placeholder="Gender" value={newPlayer.gender} onChange={e => setNewPlayer(p => ({ ...p, gender: e.target.value }))} /></td>
                <td>
                  <input
                    className="editable-input"
                    style={{ width: 80 }}
                    placeholder="Region"
                    value={newPlayer.region}
                    onChange={e => setNewPlayer(p => ({ ...p, region: e.target.value }))}
                    onBlur={e => { if (!e.target.value && newPlayer.country) setNewPlayer(p => ({ ...p, region: deriveRegion(p.country) })); }}
                  />
                </td>
                <td>
                  <input
                    className="editable-input"
                    style={{ width: 80 }}
                    placeholder="Country"
                    value={newPlayer.country}
                    onChange={e => {
                      const country = e.target.value;
                      setNewPlayer(p => ({ ...p, country, region: p.region || deriveRegion(country) }));
                    }}
                  />
                </td>
                <td>
                  <input
                    className="editable-input"
                    style={{ width: 80 }}
                    placeholder="Device"
                    value={newPlayer.device}
                    onChange={e => setNewPlayer(p => ({ ...p, device: e.target.value }))}
                  />
                </td>
                <td>
                  <input
                    className="editable-input"
                    style={{ width: 90 }}
                    placeholder="Model"
                    value={newPlayer.deviceModel}
                    onChange={e => {
                      const model = e.target.value;
                      setNewPlayer(p => ({ ...p, deviceModel: model, device: p.device || deriveDevice(model) }));
                    }}
                  />
                </td>
                <td style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>{saving ? '...' : <Check size={13} />}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setAddingRow(false)}>✕</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
