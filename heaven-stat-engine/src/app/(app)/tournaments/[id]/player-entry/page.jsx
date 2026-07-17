'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTournament } from '../layout';
import {
  getPlayerMatchResultsByDayLobby, savePlayerMatchResult, updatePlayerMatchResult, deletePlayerMatchResult,
} from '@/lib/firestore/matchData';
import { getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getPlayers } from '@/lib/firestore/registry';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { ClassBadge } from '@/components/ui/Badge';
import toast from 'react-hot-toast';
import { Save, Upload, X, Check, FileSpreadsheet, ClipboardPaste, ChevronRight, Camera, AlertCircle, AlertTriangle, Trash2 } from 'lucide-react';
import { getAllSheetsAsCSV, readExcelAsGrid, parseCSVToGrid, getSheetNames } from '@/lib/importers/csvParser';
import { uploadAndParseImage } from '@/lib/importers/ocrClient';

// ─── Smart Spreadsheet Parser ────────────────────────────────────────────────
function parseSmartSpreadsheet(grid) {
  let headerRowIndex = -1;
  let subheaderRowIndex = -1;

  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const row = grid[r] || [];
    const hasHeaderCell = row.some(cell => {
      const clean = String(cell || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        clean === 'playername' || 
        clean === 'player' || 
        clean === 'teamname' || 
        clean === 'slot' ||
        clean.startsWith('lobby') || 
        clean.startsWith('game') ||
        (clean.startsWith('l') && /^\d+$/.test(clean.substring(1)))
      );
    });
    if (hasHeaderCell) {
      headerRowIndex = r;
      break;
    }
  }

  if (headerRowIndex === -1) {
    headerRowIndex = 0;
  }

  const nextRow = grid[headerRowIndex + 1] || [];
  const hasSubheaders = nextRow.some(cell => {
    const cleanSub = String(cell || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      cleanSub.includes('damage') || 
      cleanSub.includes('dmg') || 
      cleanSub.includes('ccurc') || 
      cleanSub.includes('acc') || 
      cleanSub.includes('accuracy') || 
      cleanSub.includes('kills') ||
      cleanSub.includes('kill')
    );
  });
  if (hasSubheaders) {
    subheaderRowIndex = headerRowIndex + 1;
  }

  const headerRow = grid[headerRowIndex] || [];
  const subheaderRow = subheaderRowIndex !== -1 ? grid[subheaderRowIndex] : [];

  let playerCol = -1;
  let teamCol = -1;
  let slotCol = -1;
  const lobbies = {};

  for (let c = 0; c < headerRow.length; c++) {
    const cellVal = String(headerRow[c] || '').trim();
    const cleanVal = cellVal.toLowerCase().replace(/[^a-z0-9]/g, '');
    const subCellVal = subheaderRowIndex !== -1 ? String(subheaderRow[c] || '').trim() : '';
    const cleanSubVal = subCellVal.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (cleanVal === 'playername' || cleanVal === 'player' || (cleanVal === 'name' && playerCol === -1)) {
      if (playerCol === -1) {
        playerCol = c;
      }
    } else if (cleanVal === 'teamname' || cleanVal === 'team' || cleanVal === 'clan') {
      if (teamCol === -1) {
        teamCol = c;
      }
    } else if (cleanVal === 'slot' || cleanVal === 'id' || cleanVal === 'no' || cleanVal === 'index' || cellVal === '#') {
      if (slotCol === -1) {
        slotCol = c;
      }
    }

    const matchVal = (val) => {
      const match = val.match(/lobby\s*(\d+)/i) || 
                    val.match(/game\s*(\d+)/i) || 
                    val.match(/match\s*(\d+)/i) || 
                    val.match(/^l\s*(\d+)$/i);
      return match ? parseInt(match[1]) : null;
    };

    let lobbyNum = matchVal(cellVal);
    if (lobbyNum === null && subheaderRowIndex !== -1) {
      lobbyNum = matchVal(subCellVal);
    }

    if (lobbyNum !== null) {
      if (!lobbies[lobbyNum]) {
        lobbies[lobbyNum] = { killsCol: -1, damageCol: -1, accuracyCol: -1 };
      }

      const checkVal = subheaderRowIndex !== -1 ? cleanSubVal : cleanVal;

      if (checkVal.includes('damage') || checkVal.includes('dmg')) {
        lobbies[lobbyNum].damageCol = c;
      } else if (
        checkVal.includes('ccurc') || 
        checkVal.includes('acc') || 
        checkVal.includes('accuracy') || 
        checkVal.includes('pct') || 
        checkVal.includes('percent')
      ) {
        lobbies[lobbyNum].accuracyCol = c;
      } else {
        lobbies[lobbyNum].killsCol = c;
      }
    }
  }

  if (playerCol === -1) playerCol = 0;

  const parsedRows = [];
  const startRowIndex = Math.max(headerRowIndex, subheaderRowIndex) + 1;

  for (let r = startRowIndex; r < grid.length; r++) {
    const rowData = grid[r];
    if (!rowData || rowData.length === 0) continue;

    const playerName = String(rowData[playerCol] || '').trim();
    if (!playerName || playerName === '0' || playerName.toLowerCase() === 'player name' || playerName.toLowerCase() === 'player') continue;

    const teamName = teamCol !== -1 ? String(rowData[teamCol] || '').trim() : '';
    const slot = slotCol !== -1 ? String(rowData[slotCol] || '').trim() : '';

    const stats = {};
    Object.entries(lobbies).forEach(([lobbyNum, cols]) => {
      const killsVal = cols.killsCol !== -1 ? rowData[cols.killsCol] : '';
      const damageVal = cols.damageCol !== -1 ? rowData[cols.damageCol] : '';
      const accuracyVal = cols.accuracyCol !== -1 ? rowData[cols.accuracyCol] : '';

      const kills = killsVal !== '' && !isNaN(killsVal) ? parseInt(killsVal) : null;
      const damage = damageVal !== '' && !isNaN(damageVal) ? parseFloat(damageVal) : null;
      const accuracy = accuracyVal !== '' && !isNaN(accuracyVal) ? parseFloat(accuracyVal) : null;

      stats[lobbyNum] = { kills, damage, accuracy };
    });

    parsedRows.push({
      parsedName: playerName,
      parsedTeam: teamName,
      parsedSlot: slot,
      stats,
    });
  }

  return {
    lobbies: Object.keys(lobbies).map(Number).sort((a, b) => a - b),
    rows: parsedRows
  };
}

// ─── Smart Matcher Utility ──────────────────────────────────────────────────
function findBestMatch(parsedName, parsedTeam, regs, allPlayers) {
  if (!parsedName) return null;
  
  const cleanStr = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pNameClean = cleanStr(parsedName);
  const pTeamClean = cleanStr(parsedTeam);

  let bestReg = null;
  let maxScore = -1;

  for (const reg of regs) {
    const globalPlayer = allPlayers.find(p => p.id === reg.playerId);
    const ign = cleanStr(reg.ign || globalPlayer?.ign || '');
    const profName = cleanStr(reg.professionalName || globalPlayer?.professionalName || '');
    const regTeam = cleanStr(reg.teamName || '');

    let score = 0;
    if (ign === pNameClean) {
      score = 100;
    } else if (profName === pNameClean) {
      score = 90;
    } else if (pNameClean.length >= 3 && (pNameClean.includes(ign) || ign.includes(pNameClean))) {
      score = 50;
    } else if (pNameClean.length >= 3 && (pNameClean.includes(profName) || profName.includes(pNameClean))) {
      score = 40;
    }

    if (score > 0) {
      if (pTeamClean && regTeam === pTeamClean) {
        score += 50;
      } else if (pTeamClean && (regTeam.includes(pTeamClean) || pTeamClean.includes(regTeam))) {
        score += 20;
      }
      
      if (score > maxScore) {
        maxScore = score;
        bestReg = reg;
      }
    }
  }

  if (bestReg) {
    const globalPlayer = allPlayers.find(p => p.id === bestReg.playerId);
    let confidence = 'low';
    if (maxScore >= 140) confidence = 'high';
    else if (maxScore >= 80) confidence = 'medium';

    return {
      playerId: bestReg.playerId,
      playerName: globalPlayer?.professionalName || bestReg.professionalName || bestReg.ign || bestReg.playerId,
      confidence
    };
  }

  return null;
}

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

  // Smart Spreadsheet Import States
  const [smartImportRows, setSmartImportRows] = useState([]);
  const [smartImportLobbies, setSmartImportLobbies] = useState([]);
  const [smartImportSelectedLobbies, setSmartImportSelectedLobbies] = useState([]);
  const [smartImportFileName, setSmartImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);

  const handleProcessGrid = useCallback((grid, fileName) => {
    if (!grid || grid.length === 0) {
      toast.error("Failed to parse sheet data.");
      return;
    }

    const { lobbies, rows } = parseSmartSpreadsheet(grid);
    if (rows.length === 0) {
      toast.error("No player stats could be parsed from the data.");
      return;
    }

    const previewRows = rows.map((row, idx) => {
      const match = findBestMatch(row.parsedName, row.parsedTeam, playerRegs, players);
      return {
        id: idx,
        parsedName: row.parsedName,
        parsedTeam: row.parsedTeam,
        parsedSlot: row.parsedSlot,
        matchedPlayerId: match ? match.matchedPlayerId || match.playerId : null,
        confidence: match ? match.confidence : 'none',
        stats: row.stats
      };
    });

    setSmartImportLobbies(lobbies);
    setSmartImportSelectedLobbies(lobbies);
    setSmartImportRows(previewRows);
    setSmartImportFileName(fileName || 'Pasted Data');
    setShowPaste(false);
    handleOcrClear();
  }, [playerRegs, players]);

  const handleUpdateMatch = (rowId, newPlayerId) => {
    setSmartImportRows(prev => prev.map(row => {
      if (row.id !== rowId) return row;
      if (!newPlayerId) {
        return { ...row, matchedPlayerId: null, confidence: 'none' };
      }
      return { ...row, matchedPlayerId: newPlayerId, confidence: 'high' };
    }));
  };

  const handleCancelSmartImport = () => {
    setSmartImportRows([]);
    setSmartImportLobbies([]);
    setSmartImportSelectedLobbies([]);
    setSmartImportFileName('');
    setPendingFile(null);
  };

  const handleConfirmSmartImport = async () => {
    if (smartImportRows.length === 0) return;
    if (smartImportSelectedLobbies.length === 0) {
      toast.error("Please select at least one lobby to import.");
      return;
    }

    setImporting(true);
    try {
      let addedCount = 0;
      let updatedCount = 0;

      const resultsByLobby = {};
      for (const lobbyNum of smartImportSelectedLobbies) {
        resultsByLobby[lobbyNum] = await getPlayerMatchResultsByDayLobby(tournament.id, day, lobbyNum);
      }

      for (const row of smartImportRows) {
        if (!row.matchedPlayerId) continue;

        const registeredPlayer = playerRegs.find(p => p.playerId === row.matchedPlayerId);
        if (!registeredPlayer) continue;

        const globalPlayer = players.find(p => p.id === row.matchedPlayerId);
        const playerName = globalPlayer?.professionalName || registeredPlayer.professionalName || registeredPlayer.ign;

        for (const lobbyNum of smartImportSelectedLobbies) {
          const stats = row.stats[lobbyNum];
          if (!stats) continue;

          if (stats.kills === null && stats.damage === null && stats.accuracy === null) continue;

          const existingResults = resultsByLobby[lobbyNum].filter(r => r.playerId === row.matchedPlayerId);
          
          const payload = {
            playerId: row.matchedPlayerId,
            playerName,
            teamName: registeredPlayer.teamName || '',
            day,
            lobby: lobbyNum,
            kills: stats.kills === null ? 0 : stats.kills,
            damage: stats.damage === null ? 0 : stats.damage,
            accuracy: stats.accuracy === null ? 0 : stats.accuracy,
            inputMethod: 'smart_import'
          };

          if (existingResults.length > 0) {
            const firstExisting = existingResults[0];
            await updatePlayerMatchResult(tournament.id, firstExisting.id, payload);
            updatedCount++;

            for (let i = 1; i < existingResults.length; i++) {
              await deletePlayerMatchResult(tournament.id, existingResults[i].id);
            }
          } else {
            await savePlayerMatchResult(tournament.id, payload);
            addedCount++;
          }
        }
      }

      toast.success(`Successfully imported stats! Added ${addedCount}, updated ${updatedCount} records.`);
      handleCancelSmartImport();
      await loadData();
    } catch (err) {
      toast.error('Import failed: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  // OCR States
  const [ocrQueue, setOcrQueue] = useState([]);
  const [ocrQueueActiveIndex, setOcrQueueActiveIndex] = useState(null);
  const [lobbyPreviews, setLobbyPreviews] = useState({});
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

    const isKillsEmpty = row.kills === '' || row.kills === null || row.kills === undefined;
    const isDamageEmpty = row.damage === '' || row.damage === null || row.damage === undefined;
    const isAccuracyEmpty = row.accuracy === '' || row.accuracy === null || row.accuracy === undefined;

    if (isKillsEmpty && isDamageEmpty && isAccuracyEmpty) {
      if (row.existingId) {
        try {
          await deletePlayerMatchResult(tournament.id, row.existingId);
          setFormData((prev) => ({ ...prev, [playerId]: { ...prev[playerId], existingId: null, kills: '', damage: '', accuracy: '' } }));
        } catch (err) { console.error('Auto-delete error', err); }
      }
      return;
    }

    const payload = {
      playerId: row.playerId, playerName: row.playerName, teamName: row.teamName,
      day, lobby,
      kills: isKillsEmpty ? null : (parseInt(row.kills) ?? 0),
      damage: isDamageEmpty ? null : (parseFloat(row.damage) ?? 0),
      accuracy: isAccuracyEmpty ? null : (parseFloat(row.accuracy) ?? 0),
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
      const isCSV = /\.csv$/i.test(file.name);
      if (isCSV) {
        const text = await file.text();
        const grid = parseCSVToGrid(text);
        handleProcessGrid(grid, file.name);
      } else {
        const names = await getSheetNames(file);
        if (names.length === 1) {
          const grid = await readExcelAsGrid(file, names[0]);
          handleProcessGrid(grid, file.name);
        } else {
          setPendingFile(file);
          setSheetModal({ sheets: names });
        }
      }
    } catch (err) {
      toast.error('Failed to read file: ' + err.message);
    } finally {
      setImportingFile(false);
    }
  };

  const handleSheetSelect = async (sheetName) => {
    if (!sheetModal || !pendingFile) return;
    setImportingFile(true);
    try {
      const grid = await readExcelAsGrid(pendingFile, sheetName);
      handleProcessGrid(grid, pendingFile.name);
      setSheetModal(null);
      setPendingFile(null);
    } catch (err) {
      toast.error('Failed to parse sheet: ' + err.message);
    } finally {
      setImportingFile(false);
    }
  };

  const handleOcrFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    const oversizedFiles = files.filter(f => f.size > 20 * 1024 * 1024);
    if (oversizedFiles.length > 0) {
      toast.error(`Rejected files exceeding 20MB limit: ${oversizedFiles.map(f => f.name).join(', ')}`);
    }

    const validFiles = files.filter(f => f.size <= 20 * 1024 * 1024);
    if (validFiles.length === 0) return;

    const newItems = validFiles.map((file, idx) => {
      const uniqueId = `${file.name}-${Date.now()}-${idx}`;
      return {
        id: uniqueId,
        file,
        name: file.name,
        lobby: idx + 1,
        notes: '',
        status: 'pending',
        progress: 0,
        results: [],
        warnings: [],
        errorMessage: ''
      };
    });

    setOcrQueue(prev => {
      const updated = [...prev, ...newItems];
      if (prev.length === 0) {
        setOcrQueueActiveIndex(0);
      }
      return updated;
    });

    setIsOcrMode(true);
    setPasteText(''); // Clear paste input
  };

  const handleOcrClear = () => {
    setOcrQueue([]);
    setOcrQueueActiveIndex(null);
    setLobbyPreviews({});
    setIsOcrMode(false);
  };

  const handleOcrProcessAll = async () => {
    const pendingItems = ocrQueue.filter(item => item.status === 'pending' || item.status === 'error');
    if (pendingItems.length === 0) {
      toast.error('No pending images to process.');
      return;
    }

    setOcrQueue(prev => prev.map(item => {
      if (item.status === 'pending' || item.status === 'error') {
        return { ...item, status: 'scanning', progress: 10, errorMessage: '' };
      }
      return item;
    }));

    const promises = pendingItems.map(async (item) => {
      try {
        const progressInterval = setInterval(() => {
          setOcrQueue(prev => prev.map(qi => {
            if (qi.id === item.id && qi.status === 'scanning' && qi.progress < 90) {
              return { ...qi, progress: qi.progress + 15 };
            }
            return qi;
          }));
        }, 1000);

        const data = await uploadAndParseImage(item.file, item.lobby, 'player');
        clearInterval(progressInterval);

        const mappedRows = (data.rows || []).map(row => {
          const nameInput = row.name || '';
          const normalized = nameInput.toLowerCase().replace(/\s+/g, '');
          
          let player = playerRegs.find(p => p.ign?.toLowerCase().replace(/\s+/g, '') === normalized);
          let matchType = 'ign';

          if (!player) {
            player = playerRegs.find(p => p.professionalName?.toLowerCase().replace(/\s+/g, '') === normalized);
            matchType = 'proName';
          }

          return {
            playerId: player?.playerId || null,
            playerName: player?.professionalName || player?.ign || nameInput,
            ign: player?.ign || nameInput,
            teamName: player?.teamName || '',
            matchType: player ? matchType : null,
            kills: row.kills === null ? null : (parseInt(row.kills) || 0),
            originalParsedName: nameInput,
            sourceLine: `Name: ${row.name}, Kills: ${row.kills}`
          };
        });

        setOcrQueue(prev => prev.map(qi => {
          if (qi.id === item.id) {
            return {
              ...qi,
              status: 'ready',
              progress: 100,
              results: mappedRows,
              warnings: data.warnings || [],
              errorMessage: ''
            };
          }
          return qi;
        }));

      } catch (err) {
        console.error(`OCR failed for ${item.name}:`, err);
        setOcrQueue(prev => prev.map(qi => {
          if (qi.id === item.id) {
            return {
              ...qi,
              status: 'error',
              progress: 0,
              errorMessage: err.message || 'Vision API extraction failed'
            };
          }
          return qi;
        }));
      }
    });

    await Promise.all(promises);
    toast.success('Batch scan completed!');
  };

  const handleLobbyCellChange = (lobbyNum, idx, field, val) => {
    setLobbyPreviews(prev => {
      const lobbyData = prev[lobbyNum];
      if (!lobbyData) return prev;

      const updatedResults = lobbyData.results.map((row, i) => {
        if (i !== idx) return row;
        
        let updatedRow = { ...row };
        
        if (field === 'playerName') {
          const nameInput = val;
          const normalized = nameInput.toLowerCase().replace(/\s+/g, '');
          
          let player = playerRegs.find(p => p.ign?.toLowerCase().replace(/\s+/g, '') === normalized);
          let matchType = 'ign';

          if (!player) {
            player = playerRegs.find(p => p.professionalName?.toLowerCase().replace(/\s+/g, '') === normalized);
            matchType = 'proName';
          }

          updatedRow.originalParsedName = nameInput;
          updatedRow.playerId = player?.playerId || null;
          updatedRow.playerName = player?.professionalName || player?.ign || nameInput;
          updatedRow.ign = player?.ign || nameInput;
          updatedRow.teamName = player?.teamName || '';
          updatedRow.matchType = player ? matchType : null;
        } else if (field === 'kills') {
          updatedRow.kills = val === '' ? null : (parseInt(val) || 0);
        }

        return updatedRow;
      });

      return {
        ...prev,
        [lobbyNum]: {
          ...lobbyData,
          results: updatedResults
        }
      };
    });
  };

  const handleLobbyRemoveRow = (lobbyNum, idx) => {
    setLobbyPreviews(old => {
      const lobbyData = old[lobbyNum];
      if (!lobbyData) return old;
      return {
        ...old,
        [lobbyNum]: {
          ...lobbyData,
          results: lobbyData.results.filter((_, i) => i !== idx)
        }
      };
    });
  };

  const handleConfirmAndSaveLobby = async (lobbyNum) => {
    const lobbyData = lobbyPreviews[lobbyNum];
    if (!lobbyData) return;

    const validResults = lobbyData.results.filter(r => r.playerId !== null);
    if (validResults.length === 0) {
      toast.error('No valid matches with registered players to save.');
      return;
    }

    setParsing(true);
    try {
      let updatedCount = 0;
      let addedCount = 0;

      const existingResults = await getPlayerMatchResultsByDayLobby(tournament.id, day, lobbyNum);
      const tempResults = [...existingResults];

      for (const row of validResults) {
        // Find existing index
        const existingIdxs = [];
        tempResults.forEach((r, idx) => {
          if (r.playerId === row.playerId) {
            existingIdxs.push(idx);
          }
        });

        const payload = {
          playerId: row.playerId,
          playerName: row.playerName,
          teamName: row.teamName || '',
          day,
          lobby: lobbyNum,
          kills: row.kills === null ? 0 : row.kills,
          damage: existingIdxs.length > 0 ? tempResults[existingIdxs[0]].damage || 0 : 0,
          accuracy: existingIdxs.length > 0 ? tempResults[existingIdxs[0]].accuracy || 0 : 0,
          inputMethod: 'ocr'
        };

        if (existingIdxs.length > 0) {
          // Update the first existing document
          const firstIdx = existingIdxs[0];
          const existing = tempResults[firstIdx];
          await updatePlayerMatchResult(tournament.id, existing.id, payload);
          tempResults[firstIdx] = { ...existing, ...payload };
          updatedCount++;

          // Delete any extra duplicate documents
          for (let i = 1; i < existingIdxs.length; i++) {
            const idxToDelete = existingIdxs[i];
            const extraDoc = tempResults[idxToDelete];
            await deletePlayerMatchResult(tournament.id, extraDoc.id);
          }

          // Re-filter tempResults to remove the extra deleted documents
          if (existingIdxs.length > 1) {
            const idsToDelete = new Set(existingIdxs.slice(1).map(idx => tempResults[idx].id));
            let filtered = tempResults.filter(r => !idsToDelete.has(r.id));
            tempResults.length = 0;
            tempResults.push(...filtered);
          }
        } else {
          // Save new
          const saved = await savePlayerMatchResult(tournament.id, payload);
          tempResults.push(saved);
          addedCount++;
        }
      }

      toast.success(`Lobby ${lobbyNum} player stats saved! Added ${addedCount}, updated ${updatedCount} records.`);
      
      setLobbyPreviews(prev => ({
        ...prev,
        [lobbyNum]: {
          ...prev[lobbyNum],
          isConfirmed: true
        }
      }));
      
      await loadData();
    } catch (err) {
      toast.error(`Failed to save Lobby ${lobbyNum}: ` + err.message);
    } finally {
      setParsing(false);
    }
  };

  function mergePlayerLobbyRows(rowsList) {
    const mergedMap = new Map();

    rowsList.forEach(row => {
      const key = row.playerId || row.originalParsedName;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, row);
      } else {
        const existing = mergedMap.get(key);
        
        const existingNullCount = (existing.kills === null ? 1 : 0) + (!existing.playerId ? 1 : 0);
        const rowNullCount = (row.kills === null ? 1 : 0) + (!row.playerId ? 1 : 0);

        if (rowNullCount < existingNullCount) {
          mergedMap.set(key, row);
        }
      }
    });

    return Array.from(mergedMap.values());
  }

  // Reactivity to update and merge lobbyPreviews automatically for players
  useEffect(() => {
    const readyItems = ocrQueue.filter(item => item.status === 'ready');
    if (readyItems.length === 0) {
      setLobbyPreviews({});
      return;
    }
    
    const groups = {};
    readyItems.forEach(item => {
      if (!groups[item.lobby]) {
        groups[item.lobby] = [];
      }
      groups[item.lobby].push(...item.results);
    });

    setLobbyPreviews(prev => {
      const nextPreviews = {};
      Object.keys(groups).forEach(lobbyStr => {
        const lobbyNum = parseInt(lobbyStr);
        const merged = mergePlayerLobbyRows(groups[lobbyStr]);
        
        const itemsInLobby = readyItems.filter(item => item.lobby === lobbyNum);
        const warnings = Array.from(new Set(itemsInLobby.flatMap(item => item.warnings || [])));

        const prevLobby = prev[lobbyNum];
        nextPreviews[lobbyNum] = {
          lobby: lobbyNum,
          results: prevLobby && prevLobby.isEditing ? prevLobby.results : merged,
          warnings: warnings,
          isEditing: prevLobby ? prevLobby.isEditing : false,
          isConfirmed: prevLobby ? prevLobby.isConfirmed : false
        };
      });
      return nextPreviews;
    });
  }, [ocrQueue, playerRegs]);

  const sessionSummary = useMemo(() => {
    const lobbies = Object.values(lobbyPreviews);
    if (lobbies.length === 0) return null;

    const allConfirmed = lobbies.every(l => l.isConfirmed);
    if (!allConfirmed) return null;

    let totalKills = 0;
    const nullLobbies = [];

    lobbies.forEach(lobbyData => {
      let lobbyHasNull = false;
      lobbyData.results.forEach(row => {
        if (row.kills === null) {
          lobbyHasNull = true;
        } else {
          totalKills += row.kills;
        }
      });
      if (lobbyHasNull) {
        nullLobbies.push(lobbyData.lobby);
      }
    });

    return {
      totalLobbies: lobbies.length,
      totalKills,
      nullLobbies
    };
  }, [lobbyPreviews]);

  // Check if Roster Update section should be shown
  const ruDays = getRUDays();
  const showRU = ruDays.includes(day);

  const rows = useMemo(() => {
    return Object.values(formData).sort((a, b) => a.slot - b.slot);
  }, [formData]);

  const playersByTeam = useMemo(() => {
    const groups = {};
    rows.forEach(p => {
      const team = p.teamName || 'Unassigned';
      if (!groups[team]) groups[team] = [];
      groups[team].push(p);
    });
    return groups;
  }, [rows]);

  const teams = useMemo(() => {
    return Object.keys(playersByTeam).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });
  }, [playersByTeam]);

  const class2PlayersByTeam = useMemo(() => {
    const groups = {};
    const class2 = Object.values(formData).filter((p) => p.class?.includes('2')).sort((a, b) => a.slot - b.slot);
    class2.forEach(p => {
      const team = p.teamName || 'Unassigned';
      if (!groups[team]) groups[team] = [];
      groups[team].push(p);
    });
    return groups;
  }, [formData]);

  const class2Teams = useMemo(() => {
    return Object.keys(class2PlayersByTeam).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });
  }, [class2PlayersByTeam]);

  // Helpers
  const getClass2Players = () => Object.values(formData).filter((p) => p.class?.includes('2')).sort((a, b) => a.slot - b.slot);
  const getAllPlayers = () => Object.values(formData).sort((a, b) => a.slot - b.slot);
  const isClass2ActiveToday = (p) => {
    const cls = playerClasses.find((c) => c.className === p.class);
    return cls ? cls.activeDays.includes(day) : true;
  };

  if (loading) return <LoadingSpinner size="lg" />;

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
                  setOcrQueue([]);
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
            onClick={() => ocrFileRef.current?.click()}
            >
              <Camera size={24} style={{ color: 'var(--text-muted)', marginBottom: 6 }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--gold)', fontWeight: 600 }}>Scan Images (OCR)</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>Upload vision screenshots</span>
              <input
                ref={ocrFileRef}
                type="file"
                accept="image/*"
                multiple
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

          {/* OCR Batch Queue */}
          {isOcrMode && ocrQueue.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--gold)' }}>Uploaded Screenshots Queue:</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {ocrQueue.map((item, idx) => (
                  <div key={item.id} className="card" style={{
                    padding: 10,
                    border: ocrQueueActiveIndex === idx ? '1px solid var(--border-gold)' : '1px solid var(--border-md)',
                    background: ocrQueueActiveIndex === idx ? 'rgba(201,168,76,0.04)' : 'var(--bg-card)',
                    position: 'relative',
                    margin: 0
                  }} onClick={() => setOcrQueueActiveIndex(idx)}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{
                        width: 50, height: 50,
                        borderRadius: 6,
                        background: 'var(--bg-alt-row)',
                        border: '1px solid var(--border-md)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        <Camera size={20} style={{ color: 'var(--text-muted)' }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
                          {item.name}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Lobby #:</span>
                          <input
                            type="number"
                            className="editable-input"
                            style={{ width: 45, padding: '1px 3px', fontSize: '0.68rem' }}
                            value={item.lobby}
                            onClick={e => e.stopPropagation()}
                            onChange={e => {
                              const val = parseInt(e.target.value) || 1;
                              setOcrQueue(old => old.map(qi => qi.id === item.id ? { ...qi, lobby: val } : qi));
                            }}
                            disabled={item.status === 'scanning'}
                          />
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOcrQueue(old => old.filter(qi => qi.id !== item.id));
                          if (ocrQueueActiveIndex === idx) {
                            setOcrQueueActiveIndex(0);
                          }
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', alignSelf: 'flex-start', padding: 0 }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    
                    <div style={{ marginTop: 6 }} onClick={e => e.stopPropagation()}>
                      <input
                        type="text"
                        className="editable-input"
                        placeholder="Notes (e.g. partial scan)"
                        style={{ width: '100%', padding: '2px 4px', fontSize: '0.68rem' }}
                        value={item.notes}
                        onChange={e => {
                          const val = e.target.value;
                          setOcrQueue(old => old.map(qi => qi.id === item.id ? { ...qi, notes: val } : qi));
                        }}
                        disabled={item.status === 'scanning'}
                      />
                    </div>

                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.68rem' }}>
                      <span>
                        {item.status === 'pending' && <span style={{ color: 'var(--text-muted)' }}>Pending</span>}
                        {item.status === 'scanning' && <span style={{ color: 'var(--gold)' }}>Scanning ({item.progress}%)</span>}
                        {item.status === 'ready' && <span style={{ color: 'var(--success)' }}>Ready</span>}
                        {item.status === 'error' && <span style={{ color: 'var(--danger)' }} title={item.errorMessage}>Failed</span>}
                      </span>
                      {item.status === 'scanning' && (
                        <LoadingSpinner size="sm" style={{ width: 12, height: 12 }} />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleOcrProcessAll}
                  disabled={ocrQueue.filter(item => item.status === 'pending' || item.status === 'error').length === 0}
                >
                  Process All ({ocrQueue.filter(item => item.status === 'pending' || item.status === 'error').length})
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleOcrClear}
                >
                  Clear Queue
                </button>
              </div>
            </div>
          )}

          {/* Lobby Preview Panels */}
          {isOcrMode && Object.values(lobbyPreviews).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--gold)' }}>Lobby Results Preview:</span>
              {Object.values(lobbyPreviews).map((lobbyData) => {
                const hasNull = lobbyData.results.some(r => r.kills === null);
                const isEditing = lobbyData.isEditing;
                const isConfirmed = lobbyData.isConfirmed;

                return (
                  <div key={lobbyData.lobby} className="card" style={{
                    border: isConfirmed ? '1px solid var(--success)' : '1px solid var(--border-md)',
                    background: isConfirmed ? 'rgba(16,185,129,0.02)' : 'var(--bg-card)',
                    opacity: isConfirmed ? 0.8 : 1,
                    margin: 0,
                    padding: 14
                  }}>
                    <div className="flex-between" style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Lobby #{lobbyData.lobby} Scoreboard</span>
                        {isConfirmed && (
                          <span style={{
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: 'white',
                            background: 'var(--success)',
                            padding: '2px 6px',
                            borderRadius: 4,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}>
                            <Check size={10} /> Saved
                          </span>
                        )}
                        {hasNull && !isConfirmed && (
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
                          }}>
                            <AlertTriangle size={10} /> Flagged for review (missing kills)
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!isConfirmed && (
                          <>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setLobbyPreviews(prev => ({
                                  ...prev,
                                  [lobbyData.lobby]: {
                                    ...prev[lobbyData.lobby],
                                    isEditing: !isEditing
                                  }
                                }));
                              }}
                            >
                              {isEditing ? 'Cancel Edit' : 'Edit'}
                            </button>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleConfirmAndSaveLobby(lobbyData.lobby)}
                              disabled={parsing}
                            >
                              {parsing ? 'Saving...' : 'Confirm & Save'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Warnings list */}
                    {lobbyData.warnings && lobbyData.warnings.length > 0 && !isConfirmed && (
                      <div style={{ marginBottom: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: 8 }}>
                        <ul style={{ listStyleType: 'disc', paddingLeft: 16, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          {lobbyData.warnings.map((w, idx) => (
                            <li key={idx}>
                              {w === 'low_confidence' && 'Warning: Vision extraction had low confidence (too many missing kills). Check details.'}
                              {w === 'rank_anomaly' && 'Warning: Rank anomaly detected (ranks are not sequential or have duplicates).'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div style={{ overflowX: 'auto' }}>
                      <table className="data-table" style={{ fontSize: '0.75rem', width: '100%' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-header)' }}>
                            <th>Parsed Name / IGN</th>
                            <th>Matched Player Name</th>
                            <th>Team</th>
                            <th style={{ width: 100 }}>Kills</th>
                            <th style={{ width: 50 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {lobbyData.results.map((row, idx) => {
                            const isNullKills = row.kills === null;
                            const isUnmatched = !row.playerId;
                            const isFallback = row.matchType === 'proName';

                            return (
                              <tr key={idx} style={{
                                background: isNullKills ? 'rgba(245, 158, 11, 0.08)' : isUnmatched ? 'rgba(239, 68, 68, 0.08)' : undefined
                              }}>
                                <td>
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      className="editable-input"
                                      style={{
                                        width: '100%',
                                        fontSize: '0.75rem',
                                        padding: '2px 4px',
                                        borderColor: isUnmatched ? 'var(--danger)' : isFallback ? 'var(--warning)' : undefined
                                      }}
                                      value={row.originalParsedName || ''}
                                      onChange={e => handleLobbyCellChange(lobbyData.lobby, idx, 'playerName', e.target.value)}
                                    />
                                  ) : (row.originalParsedName || '—')}
                                </td>
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontWeight: 600 }}>
                                      {isUnmatched ? 'Unmatched IGN' : row.playerName}
                                    </span>
                                    {isUnmatched && (
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
                                    )}
                                    {isFallback && (
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
                                    )}
                                  </div>
                                </td>
                                <td style={{ color: 'var(--text-secondary)' }}>{row.teamName || '—'}</td>
                                <td>
                                  {isEditing ? (
                                    <input
                                      type="number"
                                      className="editable-input"
                                      style={{ width: 80, fontSize: '0.75rem', padding: '2px 4px' }}
                                      value={row.kills === null ? '' : row.kills}
                                      onChange={e => handleLobbyCellChange(lobbyData.lobby, idx, 'kills', e.target.value)}
                                    />
                                  ) : (
                                    isNullKills ? <span style={{ color: 'var(--warning)', fontWeight: 600 }}>null</span> : row.kills
                                  )}
                                </td>
                                <td>
                                  {isEditing && (
                                    <button
                                      onClick={() => handleLobbyRemoveRow(lobbyData.lobby, idx)}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                                      onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Session Summary Panel */}
          {sessionSummary && (
            <div className="card" style={{ marginTop: 12, border: '2px solid var(--success)', background: 'rgba(16,185,129,0.04)', padding: '16px 20px', margin: 0 }}>
              <h3 style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--success)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Check size={18} /> Session Summary
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: '0.8rem' }}>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Total Lobbies Processed:</span>{' '}
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{sessionSummary.totalLobbies}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-secondary)' }}>Total Kills across Lobbies:</span>{' '}
                  <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--success)' }}>{sessionSummary.totalKills}</strong>
                </div>
              </div>
              {sessionSummary.nullLobbies.length > 0 && (
                <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={14} /> Lobbies flagged for review with null fields: Lobby #{sessionSummary.nullLobbies.join(', #')}
                </div>
              )}
            </div>
          )}

          {/* Parsing errors/warnings (for Paste mode) */}
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

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {!isOcrMode && (
              <>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handlePasteImport}
                  disabled={parsedPreview.length === 0 || parsing}
                >
                  {parsing ? 'Saving stats...' : `Save stats to Lobby ${lobby}`}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const delimiter = pasteText.includes('\t') ? '\t' : (pasteText.includes(',') ? ',' : (pasteText.includes(';') ? ';' : ' '));
                    const grid = pasteText.split('\n').map(l => l.trim()).filter(Boolean).map(r => r.split(delimiter).map(cell => cell.trim()));
                    handleProcessGrid(grid, 'Pasted Data');
                  }}
                  disabled={!pasteText.trim()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <FileSpreadsheet size={12} /> Preview in Smart Importer
                </button>
              </>
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

      {/* Smart Spreadsheet Import Preview */}
      {smartImportRows.length > 0 && (
        <div className="card" style={{ marginBottom: 24, border: '2px solid var(--border-gold)', background: 'var(--bg-card)', padding: 20 }}>
          <div className="flex-between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileSpreadsheet size={24} style={{ color: 'var(--gold)' }} />
                <h3 style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)', margin: 0 }}>
                  Smart Spreadsheet Import Preview ({smartImportFileName})
                </h3>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
                Review matched players and stats. You can manually adjust matches that the system missed using the dropdown.
              </p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={handleCancelSmartImport} disabled={importing}>
              Cancel Import
            </button>
          </div>

          {/* Lobby Selection checklist */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '10px 14px', background: 'var(--bg-alt-row)', borderRadius: 8, marginBottom: 16 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Lobbies to Import:</span>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {smartImportLobbies.map(l => (
                <label key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={smartImportSelectedLobbies.includes(l)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSmartImportSelectedLobbies(prev => [...prev, l].sort((a,b)=>a-b));
                      } else {
                        setSmartImportSelectedLobbies(prev => prev.filter(x => x !== l));
                      }
                    }}
                  />
                  Lobby {l}
                </label>
              ))}
            </div>
          </div>

          {/* Table Container */}
          <div style={{ overflowX: 'auto', maxHeight: 480, border: '1px solid var(--border-md)', borderRadius: 8, marginBottom: 18 }}>
            <table className="data-table" style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-header)', borderBottom: '1px solid var(--border-md)' }}>
                  <th style={{ width: 110, textAlign: 'center', padding: '10px 8px' }}>Match Status</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px' }}>Sheet Row (Name / Team)</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px' }}>Matched Registered Player</th>
                  {smartImportSelectedLobbies.map(l => (
                    <th key={l} style={{ textAlign: 'center', padding: '10px 8px', width: 140 }}>L{l} Stats</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {smartImportRows.map((row) => {
                  const reg = playerRegs.find(p => p.playerId === row.matchedPlayerId);
                  
                  let rowBg = undefined;
                  if (row.confidence === 'none') {
                    rowBg = 'rgba(239, 68, 68, 0.04)';
                  } else if (row.confidence === 'low') {
                    rowBg = 'rgba(245, 158, 11, 0.04)';
                  }

                  return (
                    <tr key={row.id} style={{
                      background: rowBg,
                      borderBottom: '1px solid var(--border-md)'
                    }}>
                      <td style={{ textAlign: 'center', padding: '8px' }}>
                        {row.confidence === 'high' && (
                          <span style={{ color: '#10B981', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Check size={14} /> High
                          </span>
                        )}
                        {row.confidence === 'medium' && (
                          <span style={{ color: 'var(--gold)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Check size={14} /> Med
                          </span>
                        )}
                        {row.confidence === 'low' && (
                          <span style={{ color: '#F59E0B', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={14} /> Low
                          </span>
                        )}
                        {row.confidence === 'none' && (
                          <span style={{ color: '#EF4444', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <X size={14} /> None
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{row.parsedName}</div>
                        {row.parsedTeam && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                            {row.parsedTeam} {row.parsedSlot ? `(Slot ${row.parsedSlot})` : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <select
                          className="form-input"
                          style={{
                            fontSize: '0.78rem',
                            padding: '4px 8px',
                            width: '100%',
                            maxWidth: 320,
                            borderColor: row.confidence === 'none' ? '#EF4444' : undefined,
                            background: 'var(--bg-card)'
                          }}
                          value={row.matchedPlayerId || ''}
                          onChange={(e) => handleUpdateMatch(row.id, e.target.value)}
                        >
                          <option value="">[ Skip Row / Do Not Import ]</option>
                          {playerRegs.map(p => {
                            const globalPlayer = players.find(gp => gp.id === p.playerId);
                            const dispName = globalPlayer?.professionalName || p.professionalName || p.ign;
                            return (
                              <option key={p.playerId} value={p.playerId}>
                                Slot {p.slot}: {dispName} ({p.ign}) - {p.teamName || 'No Team'}
                              </option>
                            );
                          })}
                        </select>
                      </td>
                      {smartImportSelectedLobbies.map(l => {
                        const stat = row.stats[l] || {};
                        const hasKills = stat.kills !== null;
                        const hasDmg = stat.damage !== null;
                        const hasAcc = stat.accuracy !== null;
                        
                        return (
                          <td key={l} style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', padding: '8px' }}>
                            {hasKills || hasDmg || hasAcc ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                                <span style={{ fontWeight: 600 }}>{hasKills ? `${stat.kills} K` : '—'}</span>
                                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                  {hasDmg ? `${Math.round(stat.damage)} D` : '—'} · {hasAcc ? `${stat.accuracy}%` : '—'}
                                </span>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Action Row */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={handleCancelSmartImport} disabled={importing}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleConfirmSmartImport}
              disabled={smartImportSelectedLobbies.length === 0 || importing}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {importing ? (
                <>Importing...</>
              ) : (
                <>
                  <Check size={14} /> Confirm and Import to Day {day}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── SECTION A: Kills ─────────────────────────────── */}
      {/* ── SECTION A: Kills ─────────────────────────────── */}
      {section === 'kills' && smartImportRows.length === 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: '12px',
          marginTop: '16px'
        }}>
          {teams.map(teamName => {
            const teamPlayers = playersByTeam[teamName] || [];
            if (teamPlayers.length === 0) return null;

            return (
              <div key={teamName} className="card" style={{
                margin: 0,
                padding: '14px 16px',
                border: '1px solid var(--border-md)',
                borderRadius: '8px',
                background: 'var(--bg-card)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--border)',
                  paddingBottom: '6px',
                  marginBottom: '4px'
                }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--gold)', letterSpacing: '0.03em' }}>
                    {teamName.toUpperCase()}
                  </span>
                  <span className="data-table-count" style={{ padding: '2px 6px', fontSize: '0.65rem' }}>
                    {teamPlayers.length} PL
                  </span>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {teamPlayers.map(row => {
                    const active = isClass2ActiveToday(row);
                    const hasKills = row.kills !== null && row.kills !== undefined && row.kills !== '';
                    const killsVal = hasKills ? parseInt(row.kills) : 0;
                    return (
                      <div key={row.playerId} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        opacity: active ? 1 : 0.45,
                        padding: '4px 0',
                        borderBottom: '1px dashed var(--border)'
                      }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', width: '20px', textAlign: 'center' }}>
                          {row.slot}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                            {row.playerName}
                          </span>
                          {row.ign && row.ign !== row.playerName && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '6px', fontWeight: 400 }}>
                              · {row.ign}
                            </span>
                          )}
                        </div>
                        <div style={{ width: '60px', display: 'flex', justifyContent: 'center' }}>
                          <ClassBadge playerClass={row.class} />
                        </div>
                        <div style={{ width: '70px' }}>
                          {active ? (
                            <input type="number" min={0} className="editable-input" 
                              style={{ width: '100%', padding: '4px 6px', fontSize: '0.8rem', textAlign: 'center' }}
                              value={row.kills} placeholder="—"
                              onChange={(e) => handleChange(row.playerId, 'kills', e.target.value)}
                              onBlur={() => saveRow(row.playerId)}
                            />
                          ) : <span style={{ color: 'var(--text-muted)', display: 'block', textAlign: 'center', fontSize: '0.8rem' }}>—</span>}
                        </div>
                        <div style={{ width: '50px', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                          {hasKills ? killsVal : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── SECTION B: Damage & Accuracy ────────────────── */}
      {/* ── SECTION B: Damage & Accuracy ────────────────── */}
      {section === 'damage' && smartImportRows.length === 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: '12px',
          marginTop: '16px'
        }}>
          {teams.map(teamName => {
            const teamPlayers = playersByTeam[teamName] || [];
            if (teamPlayers.length === 0) return null;

            return (
              <div key={teamName} className="card" style={{
                margin: 0,
                padding: '14px 16px',
                border: '1px solid var(--border-md)',
                borderRadius: '8px',
                background: 'var(--bg-card)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--border)',
                  paddingBottom: '6px',
                  marginBottom: '4px'
                }}>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--gold)', letterSpacing: '0.03em' }}>
                    {teamName.toUpperCase()}
                  </span>
                  <span className="data-table-count" style={{ padding: '2px 6px', fontSize: '0.65rem' }}>
                    {teamPlayers.length} PL
                  </span>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {teamPlayers.map(row => {
                    const active = isClass2ActiveToday(row);
                    const hasDmg = row.damage !== null && row.damage !== undefined && row.damage !== '';
                    const hasAcc = row.accuracy !== null && row.accuracy !== undefined && row.accuracy !== '';
                    const dmgVal = hasDmg ? parseFloat(row.damage) : 0;
                    const accVal = hasAcc ? parseFloat(row.accuracy) : 0;
                    return (
                      <div key={row.playerId} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        opacity: active ? 1 : 0.45,
                        padding: '6px 0',
                        borderBottom: '1px dashed var(--border)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
                            <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {row.playerName}
                            </span>
                            {row.ign && row.ign !== row.playerName && (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '6px', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                · {row.ign}
                              </span>
                            )}
                          </div>
                          <ClassBadge playerClass={row.class} />
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '2px' }}>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>L{lobby} DMG</span>
                            {active ? (
                              <input type="number" min={0} className="editable-input" 
                                style={{ width: '100%', padding: '3px 6px', fontSize: '0.75rem', textAlign: 'center' }}
                                value={row.damage} placeholder="—"
                                onChange={(e) => handleChange(row.playerId, 'damage', e.target.value)}
                                onBlur={() => saveRow(row.playerId)}
                              />
                            ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>}
                          </div>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>L{lobby} ACC%</span>
                            {active ? (
                              <input type="number" min={0} max={100} step={0.1} className="editable-input" 
                                style={{ width: '100%', padding: '3px 6px', fontSize: '0.75rem', textAlign: 'center' }}
                                value={row.accuracy} placeholder="—"
                                onChange={(e) => handleChange(row.playerId, 'accuracy', e.target.value)}
                                onBlur={() => saveRow(row.playerId)}
                              />
                            ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>}
                          </div>
                          <div style={{ width: '90px', textAlign: 'right', fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: '1.2' }}>
                            <div>Tot: {hasDmg ? Math.round(dmgVal) : '—'}</div>
                            <div>Acc: {hasAcc ? `${accVal.toFixed(1)}%` : '—'}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ROSTER UPDATE (Class 2, Days 3-5) ───────────── */}
      {section === 'rosterUpdate' && showRU && smartImportRows.length === 0 && (
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 16, color: 'var(--cyan)' }}>
            ROSTER UPDATE — Day {day} (Class 2 Players)
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Kills and damage/accuracy for Class 2 players on their active days (Days {ruDays.join(', ')}).
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '12px',
            marginTop: '16px'
          }}>
            {class2Teams.map(teamName => {
              const teamPlayers = class2PlayersByTeam[teamName] || [];
              if (teamPlayers.length === 0) return null;

              return (
                <div key={teamName} className="card" style={{
                  margin: 0,
                  padding: '14px 16px',
                  border: '1px solid var(--cyan)',
                  borderRadius: '8px',
                  background: 'var(--bg-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: '6px',
                    marginBottom: '4px'
                  }}>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--cyan)', letterSpacing: '0.03em' }}>
                      {teamName.toUpperCase()}
                    </span>
                    <span className="data-table-count" style={{ padding: '2px 6px', fontSize: '0.65rem', color: 'var(--cyan)', borderColor: 'var(--cyan)' }}>
                      {teamPlayers.length} PL
                    </span>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {teamPlayers.map(row => {
                      const hasKills = row.kills !== null && row.kills !== undefined && row.kills !== '';
                      const killsVal = hasKills ? parseInt(row.kills) : 0;
                      return (
                        <div key={row.playerId} style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                          padding: '6px 0',
                          borderBottom: '1px dashed var(--border)'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
                              <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {row.playerName}
                              </span>
                              {row.ign && row.ign !== row.playerName && (
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '6px', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  · {row.ign}
                                </span>
                              )}
                            </div>
                            <ClassBadge playerClass={row.class} />
                          </div>
                          
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '2px' }}>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>L{lobby} KILLS</span>
                              <input type="number" min={0} className="editable-input" 
                                style={{ width: '100%', padding: '3px 6px', fontSize: '0.75rem', textAlign: 'center' }}
                                value={row.kills} placeholder="—"
                                onChange={(e) => handleChange(row.playerId, 'kills', e.target.value)}
                                onBlur={() => saveRow(row.playerId)}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>L{lobby} DMG</span>
                              <input type="number" min={0} className="editable-input" 
                                style={{ width: '100%', padding: '3px 6px', fontSize: '0.75rem', textAlign: 'center' }}
                                value={row.damage} placeholder="—"
                                onChange={(e) => handleChange(row.playerId, 'damage', e.target.value)}
                                onBlur={() => saveRow(row.playerId)}
                              />
                            </div>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>L{lobby} ACC%</span>
                              <input type="number" min={0} max={100} step={0.1} className="editable-input" 
                                style={{ width: '100%', padding: '3px 6px', fontSize: '0.75rem', textAlign: 'center' }}
                                value={row.accuracy} placeholder="—"
                                onChange={(e) => handleChange(row.playerId, 'accuracy', e.target.value)}
                                onBlur={() => saveRow(row.playerId)}
                              />
                            </div>
                            <div style={{ width: '60px', textAlign: 'right', fontSize: '0.72rem', color: 'var(--cyan)', lineHeight: '1.2' }}>
                              <div>K: {hasKills ? killsVal : '—'}</div>
                              <div>E: {hasKills ? 1 : '—'}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
