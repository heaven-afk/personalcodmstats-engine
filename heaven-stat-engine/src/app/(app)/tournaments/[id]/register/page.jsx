'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTournament } from '../layout';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTeamRegistrations, addTeamRegistration, updateTeamRegistration, deleteTeamRegistration,
  getPlayerRegistrations, addPlayerRegistration, updatePlayerRegistration, deletePlayerRegistration,
  clearAllTeamRegistrations, clearAllPlayerRegistrations,
} from '@/lib/firestore/tournaments';
import { getGroups } from '@/lib/firestore/groups';
import { findTeamByName, createTeam, getTeams, findPlayerByName, createPlayer, getPlayers, updatePlayer, deletePlayer, deleteTeam } from '@/lib/firestore/registry';
import { deriveRegion, deriveDevice, REGIONS, DEVICE_TYPES } from '@/lib/regionDeviceLogic';
import Modal from '@/components/ui/Modal';
import { getSimilarTeams, getSimilarPlayers, findExactPlayerMatch, getAllPlayerIGNs, cleanTeamName } from '@/lib/utils/similarity';
import {
  getAllSheetsAsCSV,
  parsePlayerRegistrationCSV,
  parseTeamRegistrationCSV,
} from '@/lib/importers/csvParser';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import EmptyState from '@/components/ui/EmptyState';
import { Plus, Trash2, Upload, Users, Shield, Search, Check, FileSpreadsheet, X, ChevronRight, ClipboardPaste, Lock } from 'lucide-react';
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
                padding: '10px 14px', borderRadius: 8,
                background: 'var(--bg-alt-row)', border: '1px solid var(--border-md)',
                color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.875rem',
                fontWeight: 600, transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--gold)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-md)'; }}
            >
              <span>{name}</span>
              <ChevronRight size={14} style={{ color: 'var(--gold)' }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Inline Editable Cell Component ──────────────────────────────────────────
function EditableCell({ value, onSave, type = 'text', width = '100%', selectOptions = null, readOnly = false }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  useEffect(() => { setLocal(value); }, [value]);

  const handleBlur = () => {
    setEditing(false);
    if (local !== value) {
      onSave(local);
    }
  };

  if (readOnly) {
    return (
      <td style={{ width }}>
        <span className="editable-cell-value" style={{ cursor: 'default' }}>
          {value || <span className="placeholder-dash">—</span>}
        </span>
      </td>
    );
  }

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
  if (lines.length === 0) return [];

  // Determine delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : (firstLine.includes(',') ? ',' : null);

  if (!delimiter) {
    // If no delimiter, treat each line as a player name
    return lines.map((line, i) => ({
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
    }));
  }

  // Parse all lines
  const parsedRows = lines.map(line => line.split(delimiter).map(p => p.trim()));

  // Check if the first row is a header row
  const firstRow = parsedRows[0];
  const isHeader = firstRow.some(cell => {
    const c = cell.toLowerCase();
    return c.includes('name') || c.includes('ign') || c.includes('team') || c.includes('gender') || c.includes('device') || c.includes('country') || c.includes('region') || c === '#';
  });

  let headers = [];
  let dataRows = parsedRows;

  if (isHeader) {
    headers = firstRow.map(h => h.toLowerCase());
    dataRows = parsedRows.slice(1);
  }

  // Map columns based on headers
  const getIndex = (keys) => {
    return headers.findIndex(h => keys.some(key => h.includes(key)));
  };

  // Find column indices
  let slotIdx = getIndex(['#', 'slot', 'no', 'index']);
  let nameIdx = getIndex(['professionalname', 'proname', 'playername', 'fullname', 'pro name']);
  if (nameIdx === -1) {
    nameIdx = headers.findIndex(h => h === 'name' || h.includes('player name'));
  }
  let ignIdx = getIndex(['ign', 'ingame', 'in-game']);
  let teamIdx = getIndex(['teamname', 'team', 'clan']);
  let clanIdx = getIndex(['clanname', 'clan', 'originalorg', 'org']);
  let classIdx = getIndex(['class', 'category', 'tier', 'group']);
  let genderIdx = getIndex(['gender', 'sex']);
  let regionIdx = getIndex(['region', 'zone']);
  let countryIdx = getIndex(['country', 'nation']);
  let deviceIdx = getIndex(['device', 'platform']);
  let modelIdx = getIndex(['devicemodel', 'model', 'phone']);

  const useFallback = headers.length === 0;

  return dataRows.map((row, i) => {
    if (useFallback) {
      // Check if first cell is a number (slot)
      const hasSlot = !isNaN(row[0]) && row[0] !== '';
      if (hasSlot) {
        return {
          slot: parseInt(row[0]) || (i + 1),
          professionalName: row[1] || '',
          ign: row[2] || '',
          teamName: row[3] || '',
          class: row[4] || 'Registered',
          gender: row[5] || '',
          region: row[6] || '',
          country: row[7] || '',
          device: row[8] || '',
          deviceModel: row[9] || ''
        };
      } else {
        // Fallback for 8-column layout from screenshot
        if (row.length >= 7) {
          let dev = row[6] || '';
          let model = '';
          if (dev && !['iphone', 'ipad', 'tablet', 'phone'].includes(dev.toLowerCase())) {
            model = dev;
            dev = '';
          }
          return {
            slot: i + 1,
            professionalName: row[0] || '',
            ign: row[1] || '',
            teamName: row[2] || '',
            class: 'Registered',
            gender: row[7] || '',
            region: row[5] || '',
            country: row[4] || '',
            device: dev,
            deviceModel: model
          };
        }
        // General fallback
        return {
          slot: i + 1,
          professionalName: row[0] || '',
          ign: row[1] || '',
          teamName: row[2] || '',
          class: 'Registered',
          gender: row[3] || '',
          region: row[4] || '',
          country: row[5] || '',
          device: row[6] || '',
          deviceModel: row[7] || ''
        };
      }
    }

    // Header-based mapping
    let dev = deviceIdx !== -1 ? row[deviceIdx] || '' : '';
    let model = modelIdx !== -1 ? row[modelIdx] || '' : '';
    if (dev && !model) {
      if (!['iphone', 'ipad', 'tablet', 'phone'].includes(dev.toLowerCase())) {
        model = dev;
        dev = '';
      }
    }

    return {
      slot: slotIdx !== -1 ? (parseInt(row[slotIdx]) || (i + 1)) : (i + 1),
      professionalName: nameIdx !== -1 ? row[nameIdx] || '' : '',
      ign: ignIdx !== -1 ? row[ignIdx] || '' : '',
      teamName: teamIdx !== -1 ? row[teamIdx] || '' : '',
      class: classIdx !== -1 ? row[classIdx] || 'Registered' : 'Registered',
      gender: genderIdx !== -1 ? row[genderIdx] || '' : '',
      region: regionIdx !== -1 ? row[regionIdx] || '' : '',
      country: countryIdx !== -1 ? row[countryIdx] || '' : '',
      device: dev,
      deviceModel: model
    };
  });
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

  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');

  const [importProgress, setImportProgress] = useState(null);

  const refresh = useCallback(async () => {
    const [tr, pr, gt, gp, gList] = await Promise.all([
      getTeamRegistrations(id),
      getPlayerRegistrations(id),
      getTeams(),
      getPlayers(),
      getGroups(id),
    ]);
    setTeamRegs(tr);
    setPlayerRegs(pr);
    setGlobalTeams(gt);
    setGlobalPlayers(gp);
    setGroups(gList);
    if (gList.length > 0 && (!selectedGroupId || !gList.some(g => g.id === selectedGroupId))) {
      setSelectedGroupId(gList[0].id);
    }
  }, [id, selectedGroupId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  if (loading) return <LoadingSpinner size="lg" text="Loading registrations..." />;

  const { user, isOwner, isOperator } = useAuth();
  const userEmail = user?.email?.toLowerCase();
  const isCreator = (tournament?.createdBy && tournament.createdBy === user?.uid) ||
    (userEmail && tournament?.creatorEmail && tournament.creatorEmail.toLowerCase() === userEmail);
  const isAssigned = (tournament?.editorUids || []).some(
    e => e === user?.uid || (userEmail && e.toLowerCase() === userEmail)
  );
  const canEdit = Boolean(isOwner || isCreator || isAssigned);

  const hasGroups = groups.length > 0;
  const displayedTeamRegs = selectedGroupId
    ? teamRegs.filter(r => r.groupId === selectedGroupId)
    : teamRegs;

  const displayedPlayerRegs = selectedGroupId
    ? playerRegs.filter(r => r.groupId === selectedGroupId)
    : playerRegs;

  const activeGroup = groups.find(g => g.id === selectedGroupId);
  const classes = (activeGroup?.structure?.playerClasses || []) || (tournament?.structure?.playerClasses || []);

  return (
    <div>
      {/* Read-Only Notice for Operators without edit access */}
      {isOperator && !canEdit && (
        <div style={{
          padding: '14px 18px',
          borderRadius: 10,
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: '#93c5fd'
        }}>
          <Lock size={18} style={{ color: '#60a5fa', flexShrink: 0 }} />
          <div>
            <strong style={{ color: '#fff' }}>Read-Only View:</strong> You have view-only access to this tournament's registrations.
          </div>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Registration</h1>
          <p className="page-subtitle">Register teams and players for this tournament</p>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="card" style={{ marginBottom: 20, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--gold)' }}>Select Group:</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {groups.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedGroupId(g.id)}
                  className={`btn btn-sm ${selectedGroupId === g.id ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontWeight: selectedGroupId === g.id ? 700 : 500 }}
                >
                  {g.groupName}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="tab-bar">
        <button className={`tab ${tab === 'teams' ? 'active' : ''}`} onClick={() => setTab('teams')}>
          <Shield size={14} style={{ marginRight: 6 }} /> Teams ({displayedTeamRegs.length})
        </button>
        <button className={`tab ${tab === 'players' ? 'active' : ''}`} onClick={() => setTab('players')}>
          <Users size={14} style={{ marginRight: 6 }} /> Players ({displayedPlayerRegs.length})
        </button>
      </div>

      {tab === 'teams' && (
        <TeamRegistrationPanel
          tournamentId={id}
          registrations={displayedTeamRegs}
          globalTeams={globalTeams}
          onRefresh={refresh}
          setImportProgress={setImportProgress}
          selectedGroupId={selectedGroupId || null}
          canEdit={canEdit}
          isOwner={isOwner}
        />
      )}
      {tab === 'players' && (
        <PlayerRegistrationPanel
          tournamentId={id}
          registrations={displayedPlayerRegs}
          teamRegistrations={displayedTeamRegs}
          globalPlayers={globalPlayers}
          globalTeams={globalTeams}
          classes={classes}
          onRefresh={refresh}
          setImportProgress={setImportProgress}
          selectedGroupId={selectedGroupId || null}
          canEdit={canEdit}
          isOwner={isOwner}
        />
      )}

      {importProgress !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="card text-center" style={{ padding: 24, width: 300, background: 'var(--bg-card)', border: '1px solid var(--border-md)' }}>
            <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>Importing data... {importProgress}%</div>
            <div style={{ height: 6, background: 'var(--bg-alt-row)', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ width: `${importProgress}%`, height: '100%', background: 'var(--gold)', transition: 'width 0.1s ease' }} />
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Please do not close this page.</div>
          </div>
        </div>
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
function TeamRegistrationPanel({ tournamentId, registrations, globalTeams, onRefresh, setImportProgress, selectedGroupId, canEdit = true, isOwner = false }) {
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
    if (!canEdit) {
      toast.error('You do not have permission to register teams for this tournament.');
      return;
    }
    setSaving(true);
    let added = 0;
    const total = queue.length;
    if (setImportProgress) setImportProgress(0);
    try {
      for (let i = 0; i < total; i++) {
        const item = queue[i];
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
          ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
        });
        added++;
        if (setImportProgress) setImportProgress(Math.round(((i + 1) / total) * 100));
      }
      toast.success(`Registered ${added} teams successfully`);
      setShowImportPreview(false);
      setImportQueue([]);
      await onRefresh();
    } catch (e) {
      toast.error('Failed to register teams: ' + e.message);
    } finally {
      setSaving(false);
      if (setImportProgress) setImportProgress(null);
    }
  };

  const handleAdd = async () => {
    if (!canEdit) {
      toast.error('You do not have permission to register teams for this tournament.');
      return;
    }
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
          ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
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
        ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
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
    if (!canEdit) {
      toast.error('You do not have permission to modify team details.');
      return;
    }
    try {
      await updateTeamRegistration(tournamentId, regId, fields);
      await onRefresh();
    } catch (e) {
      toast.error('Failed to update team: ' + e.message);
    }
  };

  const handleDelete = async (regId, teamName) => {
    if (!canEdit) { toast.error('You do not have permission to delete registrations'); return; }
    if (!isOwner) { toast.error('Only the owner can delete registrations'); return; }
    const currentReg = registrations.find(r => r.id === regId);
    if (!confirm(`Remove ${teamName} from this tournament?`)) return;
    
    setSaving(true);
    try {
      await deleteTeamRegistration(tournamentId, regId);
      if (currentReg?.teamId) {
        const deleteGlobal = confirm(`Would you also like to delete "${teamName}" from the Global Teams Registry?`);
        if (deleteGlobal) {
          await deleteTeam(currentReg.teamId);
        }
      }
      toast.success('Removed');
      await onRefresh();
    } catch (e) {
      toast.error('Failed to remove team: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePasteImport = async () => {
    if (!canEdit) {
      toast.error('You do not have permission to register teams for this tournament.');
      return;
    }
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
    if (!isOwner) { toast.error('Only the owner can clear all registrations'); return; }
    if (!confirm(`Are you sure you want to remove all ${registrations.length} teams from this tournament?`)) return;
    const deleteGlobal = confirm("Would you also like to delete these teams from the Global Teams Registry overall?");
    
    setSaving(true);
    try {
      await clearAllTeamRegistrations(tournamentId, registrations.map(r => r.id));
      if (deleteGlobal) {
        const deletePromises = registrations
          .map(r => r.teamId)
          .filter(Boolean)
          .map(tid => deleteTeam(tid));
        await Promise.all(deletePromises);
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
          {isOwner && registrations.length > 0 && (
            <button
              className="btn btn-danger btn-sm"
              onClick={handleClearAll}
              disabled={saving}
              title="Remove all registered teams from this tournament"
            >
              <Trash2 size={13} /> Clear All
            </button>
          )}
          {canEdit && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Paste Area panel */}
      {canEdit && showPaste && (
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
        📋 <strong>Expected columns:</strong> <code>teamName</code>, <code>clanName</code>, <code>tier</code>, <code>slot</code> {canEdit ? '— Click cells below to edit.' : ''}
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
                  readOnly={!canEdit}
                  onSave={val => handleUpdateTeam(reg.id, { slot: Number(val) || i + 1 })}
                />
                <EditableCell
                  value={reg.teamName}
                  width="200px"
                  readOnly={!canEdit}
                  onSave={val => handleUpdateTeam(reg.id, { teamName: val })}
                />
                <EditableCell
                  value={reg.clanName}
                  width="160px"
                  readOnly={!canEdit}
                  onSave={val => handleUpdateTeam(reg.id, { clanName: val })}
                />
                <EditableCell
                  value={reg.tier}
                  width="120px"
                  readOnly={!canEdit}
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
function PlayerRegistrationPanel({ tournamentId, registrations, teamRegistrations, globalPlayers, globalTeams, classes, onRefresh, setImportProgress, selectedGroupId, canEdit = true, isOwner = false }) {
  const [addingRow, setAddingRow] = useState(false);
  const [newPlayer, setNewPlayer] = useState({ slot: '', professionalName: '', ign: '', teamName: '', category: 'Registered', gender: '', region: '', country: '', device: '', deviceModel: '' });
  const [saving, setSaving] = useState(false);
  const [nameSearch, setNameSearch] = useState('');

  // Paste Data states
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);

  // Import Preview states
  const [importQueue, setImportQueue] = useState([]);
  const [showImportPreview, setShowImportPreview] = useState(false);

  const prepareImport = (parsedRows) => {
    const HIGH_CONFIDENCE = 0.88; // auto-link silently
    const PROPOSE_THRESHOLD = 0.70; // show to user to confirm

    const queue = parsedRows.map((row, index) => {
      const proName = row.professionalName?.trim() || '';
      const ign = row.ign?.trim() || '';
      const teamName = row.teamName?.trim() || '';
      const slot = Number(row.slot) || (registrations.length + index + 1);
      const gender = row.gender?.trim() || '';
      const country = row.country?.trim() || '';
      const region = row.region?.trim() || deriveRegion(country);
      const deviceModel = row.deviceModel?.trim() || '';
      const device = row.device?.trim() || deriveDevice(deviceModel);
      const category = row.class || 'Registered';

      const proNameLower = proName.toLowerCase();
      const ignLower = ign.toLowerCase();
      const teamLower = teamName.toLowerCase();

      // ── Duplicate-in-this-tournament check ──────────────────────────────────
      // Check against all known IGNs for already-registered players in this tournament
      const isDuplicate = registrations.some(r => {
        const rProName = (r.professionalName || '').trim().toLowerCase();
        const rTeam = (r.teamName || '').trim().toLowerCase();
        if (proNameLower && rProName === proNameLower && rTeam === teamLower) return true;
        // Also check against all IGNs of the existing registration's global player
        if (ignLower && rTeam === teamLower) {
          const regPlayer = globalPlayers.find(p => p.id === r.playerId);
          if (regPlayer && getAllPlayerIGNs(regPlayer).includes(ignLower)) return true;
        }
        return false;
      });

      // ── Team fuzzy match ─────────────────────────────────────────────────────
      let similarTeam = null;
      if (teamName && !teamRegistrations.some(t => t.teamName?.trim().toLowerCase() === teamLower)) {
        const similarRegs = getSimilarTeams(teamName, teamRegistrations, 0.75);
        if (similarRegs.length > 0) similarTeam = similarRegs[0];
      }
      const resolvedTeamName = similarTeam ? similarTeam.teamName : teamName;

      // ── Tier 1: Exact match (pro name or any known IGN) ─────────────────────
      const exact = findExactPlayerMatch(proName, ign, globalPlayers);
      if (exact) {
        return {
          id: `imp_pl_${Date.now()}_${index}`,
          slot,
          professionalName: exact.professionalName,   // keep existing pro name
          ign,                                         // carry the imported IGN (history will accumulate)
          teamName: resolvedTeamName,
          category,
          gender: exact.gender || gender,
          region: exact.region || region,
          country: exact.country || country,
          device: device || exact.currentDevice || exact.device,
          deviceModel: deviceModel || exact.currentDeviceModel || exact.deviceModel,
          playerId: exact.id,
          isLinked: true,
          linkTier: 'exact',
          originalName: proName || ign,
          conflict: null,
          similarTeam: similarTeam ? null : null,
          isDuplicate,
        };
      }

      // ── Tiers 2 & 3: Fuzzy match across pro name + all known IGNs ───────────
      const similarResults = getSimilarPlayers(proName, ign, globalPlayers, PROPOSE_THRESHOLD);
      const best = similarResults[0] || null;

      if (best && best.similarity >= HIGH_CONFIDENCE) {
        // Tier 2: High-confidence — auto-link without user action
        return {
          id: `imp_pl_${Date.now()}_${index}`,
          slot,
          professionalName: best.player.professionalName,
          ign,
          teamName: resolvedTeamName,
          category,
          gender: best.player.gender || gender,
          region: best.player.region || region,
          country: best.player.country || country,
          device: device || best.player.currentDevice || best.player.device,
          deviceModel: deviceModel || best.player.currentDeviceModel || best.player.deviceModel,
          playerId: best.player.id,
          isLinked: true,
          linkTier: 'high',
          linkSimilarity: Math.round(best.similarity * 100),
          matchedOn: best.matchedOn,
          originalName: proName || ign,
          conflict: null,
          similarTeam,
          isDuplicate,
        };
      }

      // Tier 3: Proposed link (user must confirm)
      return {
        id: `imp_pl_${Date.now()}_${index}`,
        slot,
        professionalName: proName,
        ign,
        teamName: resolvedTeamName,
        category,
        gender,
        region,
        country,
        device,
        deviceModel,
        playerId: '',
        isLinked: false,
        linkTier: 'none',
        originalName: proName || ign,
        conflict: best,   // { player, similarity, matchedOn } — shown to user
        similarTeam,
        isDuplicate,
      };
    });

    setImportQueue(queue);
    setShowImportPreview(true);
  };

  const executeRegistration = async (queue) => {
    if (!canEdit) {
      toast.error('You do not have permission to register players for this tournament.');
      return;
    }
    setSaving(true);
    let added = 0;
    let skipped = 0;
    const total = queue.length;
    if (setImportProgress) setImportProgress(0);
    try {
      for (let i = 0; i < total; i++) {
        const item = queue[i];
        if (item.isDuplicate) {
          skipped++;
          if (setImportProgress) setImportProgress(Math.round(((i + 1) / total) * 100));
          continue;
        }

        // ── Use createPlayer() for BOTH linked and new players.
        // For linked players, createPlayer finds the existing record by ID
        // and runs the correct history-accumulation logic (IGN/device history,
        // immutable professionalName, fill-in-only demographics).
        // For new players, createPlayer creates a fresh profile.
        let player;
        if (item.isLinked && item.playerId) {
          // Pass the imported IGN/device so history accumulates correctly
          player = await createPlayer({
            professionalName: item.professionalName,  // ignored by createPlayer (immutable)
            ign: item.ign,
            gender: item.gender,
            region: item.region,
            country: item.country,
            device: item.device,
            deviceModel: item.deviceModel,
            category: item.category,
          });
          // Ensure we use the correct existing player ID
          player = { ...player, id: item.playerId };
        } else {
          player = await createPlayer({
            professionalName: item.professionalName,
            ign: item.ign,
            gender: item.gender,
            region: item.region,
            country: item.country,
            device: item.device,
            deviceModel: item.deviceModel,
            category: item.category,
          });
        }

        let matchedTeam = teamRegistrations.find(
          t => t.teamName?.trim().toLowerCase() === (item.teamName || '').trim().toLowerCase()
        );
        if (!matchedTeam && item.teamName?.trim()) {
          const similar = getSimilarTeams(item.teamName, teamRegistrations, 0.75);
          if (similar.length > 0) {
            matchedTeam = similar[0];
          }
        }

        await addPlayerRegistration(tournamentId, {
          playerId: player.id,
          slot: item.slot,
          class: item.category,
          teamId: matchedTeam?.teamId || '',
          teamName: matchedTeam?.teamName || item.teamName || '',
          // Registration snapshot: use the imported IGN (current for this tournament)
          ign: item.ign || player.currentIGN || player.ign || '',
          professionalName: player.professionalName,
          gender: player.gender || item.gender || '',
          region: player.region || item.region || '',
          country: player.country || item.country || '',
          // Use current device from player profile (just updated by createPlayer)
          device: player.currentDevice || item.device || player.device || '',
          deviceModel: player.currentDeviceModel || item.deviceModel || player.deviceModel || '',
          ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
        });

        added++;
        if (setImportProgress) setImportProgress(Math.round(((i + 1) / total) * 100));
      }
      toast.success(`Registered ${added} players successfully${skipped ? ` (skipped ${skipped} duplicates)` : ''}`);
      setShowImportPreview(false);
      setImportQueue([]);
      await onRefresh();
    } catch (e) {
      toast.error('Failed to register players: ' + e.message);
    } finally {
      setSaving(false);
      if (setImportProgress) setImportProgress(null);
    }
  };

  const matchedPlayer = nameSearch.length > 1
    ? globalPlayers.find(p => p.professionalName?.toLowerCase().includes(nameSearch.toLowerCase()) || p.ign?.toLowerCase().includes(nameSearch.toLowerCase()))
    : null;

  const teamReg = teamRegistrations.find(t => t.teamName?.toLowerCase() === newPlayer.teamName?.toLowerCase());

  const handleAdd = async () => {
    if (!canEdit) {
      toast.error('You do not have permission to register players for this tournament.');
      return;
    }
    if (!newPlayer.professionalName.trim() && !newPlayer.ign.trim()) { toast.error('Name or IGN required'); return; }
    setSaving(true);
    try {
      const proName = newPlayer.professionalName.trim();
      const teamName = newPlayer.teamName || '';
      if (proName) {
        const hasDuplicate = registrations.some(r => 
          r.teamName?.toLowerCase() === teamName.toLowerCase() &&
          r.professionalName?.trim().toLowerCase() === proName.toLowerCase()
        );
        if (hasDuplicate) {
          toast.error(`Player with Professional Name "${proName}" is already registered in team "${teamName || 'Unassigned'}".`);
          setSaving(false);
          return;
        }
      }

      const player = await createPlayer({
        professionalName: proName,
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
        gender: player.gender || '',
        region: player.region || '',
        country: player.country || '',
        device: player.device || '',
        deviceModel: player.deviceModel || '',
        ...(selectedGroupId ? { groupId: selectedGroupId } : {}),
      });
      toast.success(`${player.professionalName || player.ign} registered`);
      setNewPlayer(p => ({ ...p, slot: '', professionalName: '', ign: '' }));
      setAddingRow(false);
      await onRefresh();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const handleUpdatePlayer = async (regId, fields) => {
    if (!canEdit) {
      toast.error('You do not have permission to modify player details.');
      return;
    }
    const currentReg = registrations.find(r => r.id === regId);
    if (!currentReg) return;

    const targetProName = (fields.professionalName !== undefined ? fields.professionalName : currentReg.professionalName || '').trim();
    const targetTeamName = fields.teamName !== undefined ? fields.teamName : currentReg.teamName || '';
    try {
      await updatePlayerRegistration(tournamentId, regId, fields);
      await onRefresh();
    } catch (e) {
      toast.error('Failed to update player: ' + e.message);
    }
  };

  const handleDelete = async (regId, name) => {
    if (!canEdit) { toast.error('You do not have permission to delete registrations'); return; }
    if (!isOwner) { toast.error('Only the owner can delete registrations'); return; }
    const currentReg = registrations.find(r => r.id === regId);
    if (!confirm(`Remove ${name} from this tournament?`)) return;
    
    setSaving(true);
    try {
      await deletePlayerRegistration(tournamentId, regId);
      toast.success('Removed');
      await onRefresh();
    } catch (e) {
      toast.error('Failed to remove player: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClearAll = async () => {
    if (!isOwner) { toast.error('Only the owner can clear all registrations'); return; }
    if (!confirm(`Are you sure you want to remove all ${registrations.length} players from this tournament?`)) return;
    const deleteGlobal = confirm("Would you also like to delete these players' profiles from the Global Player Registry overall? (Warning: This will delete their career profile and statistics!)");
    
    setSaving(true);
    try {
      await clearAllPlayerRegistrations(tournamentId);
      if (deleteGlobal) {
        const deletePromises = registrations
          .filter(r => r.playerId)
          .map(r => r.playerId)
          .filter((v, i, a) => a.indexOf(v) === i)
          .map(pid => deletePlayer(pid));
        await Promise.all(deletePromises);
      }
      toast.success('All player registrations cleared');
      await onRefresh();
    } catch (e) {
      toast.error('Failed to clear players: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="data-table-container">
      {modal}
      {input}
      <div className="data-table-toolbar">
        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Players</span>
        <span className="data-table-count">{registrations.length} registered</span>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {isOwner && registrations.length > 0 && (
            <button
              className="btn btn-danger btn-sm"
              onClick={handleClearAll}
              disabled={saving}
              title="Remove all registered players from this tournament"
            >
              <Trash2 size={13} /> Clear All
            </button>
          )}
          {canEdit && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Paste Area panel */}
      {canEdit && showPaste && (
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
        📋 <strong>Expected columns:</strong> <code>professionalName</code>, <code>ign</code>, <code>teamName</code>, <code>class</code>, <code>gender</code>, <code>region</code>, <code>country</code>, <code>device</code>, <code>deviceModel</code> {canEdit ? '— Click cells below to edit.' : ''}
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
                    readOnly={!canEdit}
                    onSave={val => handleUpdatePlayer(reg.id, { professionalName: val })}
                  />
                  <EditableCell
                    value={reg.ign}
                    width="100px"
                    readOnly={!canEdit}
                    onSave={val => handleUpdatePlayer(reg.id, { ign: val })}
                  />
                  <EditableCell
                    value={reg.teamName}
                    width="120px"
                    readOnly={!canEdit}
                    selectOptions={['', ...teamRegistrations.map(t => t.teamName)]}
                    onSave={val => handleUpdatePlayer(reg.id, { teamName: val, teamId: teamRegistrations.find(t => t.teamName === val)?.teamId || '' })}
                  />
                  <EditableCell
                    value={reg.class || 'Registered'}
                    width="110px"
                    readOnly={!canEdit}
                    selectOptions={['Registered', 'Transferred In']}
                    onSave={val => handleUpdatePlayer(reg.id, { class: val })}
                  />
                  <EditableCell
                    value={reg.gender}
                    width="60px"
                    readOnly={!canEdit}
                    onSave={val => handleUpdatePlayer(reg.id, { gender: val })}
                  />
                  <EditableCell
                    value={reg.region}
                    width="80px"
                    readOnly={!canEdit}
                    onSave={val => handleUpdatePlayer(reg.id, { region: val })}
                  />
                  <EditableCell
                    value={reg.country}
                    width="80px"
                    readOnly={!canEdit}
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
      {showImportPreview && (
        <Modal title="Sync & Register Players Preview" onClose={() => setShowImportPreview(false)} size="xl">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Review the players parsed from your import. Teams with similar names are checked automatically. You can link players to existing registry profiles or register them as new.
            </p>
            <div style={{ maxHeight: '65vh', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>Slot</th>
                    <th>Entered Player</th>
                    <th>Team</th>
                    <th>Details</th>
                    <th>Similarity Match Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {importQueue.map((item, idx) => (
                    <tr key={item.id} style={{ 
                      background: item.isDuplicate 
                        ? 'rgba(239, 68, 68, 0.05)' 
                        : item.conflict || item.similarTeam
                        ? 'rgba(201,168,76,0.03)' 
                        : 'transparent',
                      opacity: item.isDuplicate ? 0.7 : 1
                    }}>
                      <td>{item.slot}</td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {item.professionalName || '—'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          IGN: {item.ign || '—'}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.teamName || 'Unassigned'}</div>
                        {item.teamName && (
                          teamRegistrations.some(t => t.teamName?.trim().toLowerCase() === item.teamName.trim().toLowerCase()) ? (
                            <div style={{ fontSize: '0.68rem', color: 'var(--green)', marginTop: 2 }}>
                              ✓ Team Registered
                            </div>
                          ) : item.similarTeam ? (
                            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div style={{ fontSize: '0.68rem', color: 'var(--gold)' }}>
                                💡 Similar team: <strong>{item.similarTeam.teamName}</strong>
                              </div>
                              <button
                                type="button"
                                className="btn btn-xs btn-secondary"
                                style={{ fontSize: '0.65rem', padding: '2px 6px', width: 'fit-content' }}
                                onClick={() => {
                                  const newQueue = [...importQueue];
                                  newQueue[idx] = {
                                    ...item,
                                    teamName: item.similarTeam.teamName,
                                    similarTeam: null
                                  };
                                  setImportQueue(newQueue);
                                }}
                              >
                                Use "{item.similarTeam.teamName}"
                              </button>
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
                              ⚠️ Team not registered
                            </div>
                          )
                        )}
                      </td>
                      <td>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {item.gender ? `Gender: ${item.gender} | ` : ''}
                          {item.country ? `Country: ${item.country} | ` : ''}
                          {item.deviceModel || item.device ? `Device: ${item.deviceModel || item.device}` : ''}
                        </div>
                      </td>
                      <td>
                        {item.isDuplicate ? (
                          <span style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 600 }}>
                            ⚠️ Already Registered (Will be skipped)
                          </span>

                        ) : item.conflict ? (
                          /* ── Tier 3: Proposed link (user must confirm) ── */
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <span>
                                💡 Possible match: <strong>{item.conflict.player.professionalName}</strong>
                                {' '}
                                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', opacity: 0.8 }}>
                                  ({Math.round(item.conflict.similarity * 100)}% via {item.conflict.matchedOn === 'ign' ? 'IGN' : 'name'})
                                </span>
                              </span>
                            </div>
                            {item.conflict.player.currentIGN || item.conflict.player.ign ? (
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                Known IGN: {item.conflict.player.currentIGN || item.conflict.player.ign}
                              </div>
                            ) : null}
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                type="button"
                                className={`btn btn-xs ${item.isLinked ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => {
                                  const newQueue = [...importQueue];
                                  newQueue[idx] = {
                                    ...item,
                                    isLinked: true,
                                    linkTier: 'proposed',
                                    playerId: item.conflict.player.id,
                                    // Keep existing professional name (immutable)
                                    professionalName: item.conflict.player.professionalName,
                                    // Carry the imported IGN for history accumulation
                                    ign: item.ign,
                                    gender: item.conflict.player.gender || item.gender,
                                    region: item.conflict.player.region || item.region,
                                    country: item.conflict.player.country || item.country,
                                    device: item.device || item.conflict.player.currentDevice || item.conflict.player.device,
                                    deviceModel: item.deviceModel || item.conflict.player.currentDeviceModel || item.conflict.player.deviceModel,
                                  };
                                  setImportQueue(newQueue);
                                }}
                              >
                                ✓ Link to "{item.conflict.player.professionalName}"
                              </button>
                              <button
                                type="button"
                                className={`btn btn-xs ${!item.isLinked ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => {
                                  const newQueue = [...importQueue];
                                  newQueue[idx] = {
                                    ...item,
                                    isLinked: false,
                                    linkTier: 'none',
                                    playerId: '',
                                  };
                                  setImportQueue(newQueue);
                                }}
                              >
                                Register as New
                              </button>
                            </div>
                          </div>

                        ) : item.isLinked && item.linkTier === 'high' ? (
                          /* ── Tier 2: High-confidence auto-link ── */
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
                              ✓ Auto-linked ({item.linkSimilarity}% via {item.matchedOn === 'ign' ? 'IGN' : 'name'})
                            </span>
                            <button
                              type="button"
                              className="btn btn-xs btn-secondary"
                              style={{ fontSize: '0.65rem', padding: '2px 6px', width: 'fit-content' }}
                              onClick={() => {
                                const newQueue = [...importQueue];
                                newQueue[idx] = { ...item, isLinked: false, linkTier: 'none', playerId: '' };
                                setImportQueue(newQueue);
                              }}
                            >
                              Undo — Register as New
                            </button>
                          </div>

                        ) : item.isLinked ? (
                          /* ── Tier 1: Exact match ── */
                          <span style={{ fontSize: '0.75rem', color: 'var(--cyan)', fontWeight: 600 }}>✓ Linked — exact match</span>

                        ) : (
                          /* ── Tier 4: New player ── */
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Will register as new player</span>
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
                {saving ? 'Registering...' : `Confirm & Register ${importQueue.filter(x => !x.isDuplicate).length} Players`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
