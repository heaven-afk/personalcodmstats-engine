'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTournament } from '../layout';
import { useAuth } from '@/contexts/AuthContext';
import {
  getPlayerMatchResults, getPlayerMatchResultsByDayLobby, savePlayerMatchResult, updatePlayerMatchResult, deletePlayerMatchResult,
} from '@/lib/firestore/matchData';
import { getPlayerRegistrations, getTeamRegistrations } from '@/lib/firestore/tournaments';
import { getGroups } from '@/lib/firestore/groups';
import { getPlayers } from '@/lib/firestore/registry';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import { Save, Upload, X, Check, FileSpreadsheet, ClipboardPaste, ChevronRight, Camera, AlertCircle, AlertTriangle, Trash2, Lock, Unlock, Sliders, RefreshCw, Plus, Trash } from 'lucide-react';
import { getAllSheetsAsCSV, readExcelAsGrid, parseCSVToGrid, getSheetNames } from '@/lib/importers/csvParser';
import { uploadAndParseImage } from '@/lib/importers/ocrClient';
import { cleanTeamName, stringSimilarity } from '@/lib/utils/similarity';

// Distinct color per lobby slot
const LOBBY_COLORS = [
  { text: '#C9A84C', bg: 'rgba(201,168,76,0.12)',  border: 'rgba(201,168,76,0.4)'  }, // L1 Gold
  { text: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.4)'  }, // L2 Blue
  { text: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.4)'  }, // L3 Emerald
  { text: '#8b5cf6', bg: 'rgba(139,92,246,0.12)',  border: 'rgba(139,92,246,0.4)'  }, // L4 Purple
  { text: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.4)'   }, // L5 Red
  { text: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.4)'  }, // L6 Amber
];
const getLobbyColor = (n) => LOBBY_COLORS[(n - 1) % LOBBY_COLORS.length];

// ─── Revive Types ────────────────────────────────────────────────────────────
import { REVIVE_TYPES, getReviveType } from '@/lib/constants/revives';
import { getActiveReviveConfig, getReviveTypeForMatch } from '@/lib/utils/reviveConfig';

// ─── Smart Spreadsheet Parser ────────────────────────────────────────────────
function parseSmartSpreadsheet(grid, customConfig = null) {
  if (!grid || grid.length === 0) {
    return { lobbies: [], rows: [], columnMappings: {}, config: null };
  }

  const maxCols = grid.reduce((max, row) => Math.max(max, (row || []).length), 0);

  // If custom configuration is provided by the user
  if (customConfig && typeof customConfig === 'object') {
    const playerCol = customConfig.playerCol !== undefined ? parseInt(customConfig.playerCol) : 0;
    const teamCol = customConfig.teamCol !== undefined ? parseInt(customConfig.teamCol) : -1;
    const slotCol = customConfig.slotCol !== undefined ? parseInt(customConfig.slotCol) : -1;
    const startRowIndex = Math.max(0, customConfig.startRowIndex !== undefined ? parseInt(customConfig.startRowIndex) : 1);
    const lobbies = customConfig.lobbies || {};

    const parsedRows = [];
    for (let r = startRowIndex; r < grid.length; r++) {
      const rowData = grid[r];
      if (!rowData || rowData.length === 0) continue;

      const playerName = playerCol !== -1 && playerCol < rowData.length ? String(rowData[playerCol] || '').trim() : '';
      const pLower = playerName.toLowerCase();
      if (
        !playerName || 
        playerName === '0' || 
        pLower === 'player name' || 
        pLower === 'player' || 
        pLower === 'ign' || 
        pLower === 'name' || 
        pLower === 'players'
      ) {
        continue;
      }

      const teamName = teamCol !== -1 && teamCol < rowData.length ? cleanTeamName(String(rowData[teamCol] || '').trim()) : '';
      const slot = slotCol !== -1 && slotCol < rowData.length ? String(rowData[slotCol] || '').trim() : '';

      const stats = {};
      Object.entries(lobbies).forEach(([lobbyNum, cols]) => {
        const kCol = parseInt(cols.killsCol);
        const dCol = parseInt(cols.damageCol);
        const aCol = parseInt(cols.accuracyCol);

        const killsVal = kCol !== -1 && kCol < rowData.length ? rowData[kCol] : '';
        const damageVal = dCol !== -1 && dCol < rowData.length ? rowData[dCol] : '';
        const accuracyVal = aCol !== -1 && aCol < rowData.length ? rowData[aCol] : '';

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

    const lobbyList = Object.keys(lobbies).map(Number).sort((a, b) => a - b);
    return {
      lobbies: lobbyList,
      rows: parsedRows,
      columnMappings: lobbies,
      config: {
        playerCol,
        teamCol,
        slotCol,
        startRowIndex,
        lobbies
      }
    };
  }

  // Auto-detection mode
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
        clean === 'ign' ||
        clean === 'team' ||
        clean === 'clan' ||
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
      cleanSub.includes('kill') ||
      cleanSub.startsWith('lobby') || 
      cleanSub.startsWith('game') ||
      cleanSub.startsWith('match') ||
      (cleanSub.startsWith('l') && /^\d+$/.test(cleanSub.substring(1)))
    );
  });
  if (hasSubheaders) {
    subheaderRowIndex = headerRowIndex + 1;
  }

  let superHeaderRowIndex = -1;
  if (headerRowIndex > 0) {
    const prevRow = grid[headerRowIndex - 1] || [];
    const hasCategoryLabels = prevRow.some(cell => {
      const clean = String(cell || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return (
        clean.includes('kill') || 
        clean.includes('damage') || 
        clean.includes('dmg') || 
        clean.includes('accuracy') || 
        clean.includes('ccurc') || 
        clean.includes('acc')
      );
    });
    if (hasCategoryLabels) {
      superHeaderRowIndex = headerRowIndex - 1;
    }
  }

  const headerRow = grid[headerRowIndex] || [];
  const subheaderRow = subheaderRowIndex !== -1 ? grid[subheaderRowIndex] : [];

  let playerCol = -1;
  let teamCol = -1;
  let slotCol = -1;
  const lobbies = {};

  const checkPlayer = (v) => v === 'playername' || v === 'player' || v === 'ign' || v === 'name' || v === 'players';
  const checkTeam = (v) => v === 'teamname' || v === 'team' || v === 'clan' || v === 'org' || v === 'club';
  const checkSlot = (v) => v === 'slot' || v === 'id' || v === 'no' || v === 'index' || v === 'slotno' || v === '#';

  const getCategory = (clean) => {
    if (clean.includes('damage') || clean.includes('dmg')) return 'damage';
    if (
      clean.includes('ccurc') || 
      clean.includes('acc') || 
      clean.includes('accuracy') || 
      clean.includes('pct') || 
      clean.includes('percent')
    ) return 'accuracy';
    if (clean.includes('kills') || clean.includes('kill') || clean === 'pts' || clean === 'killsmatch') return 'kills';
    return null;
  };

  let lastTopLobbyNum = null;
  let currentCategory = null;
  let lastHeaderCategory = null;

  for (let c = 0; c < maxCols; c++) {
    const cellVal = String(headerRow[c] || '').trim();
    const cleanVal = cellVal.toLowerCase().replace(/[^a-z0-9]/g, '');
    const subCellVal = subheaderRowIndex !== -1 ? String(subheaderRow[c] || '').trim() : '';
    const cleanSubVal = subCellVal.toLowerCase().replace(/[^a-z0-9]/g, '');

    const superCellVal = superHeaderRowIndex !== -1 ? String(grid[superHeaderRowIndex][c] || '').trim() : '';
    const cleanSuperVal = superCellVal.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (superHeaderRowIndex !== -1) {
      const categoryFromSuper = getCategory(cleanSuperVal);
      if (categoryFromSuper !== null) {
        currentCategory = categoryFromSuper;
      } else if (superCellVal !== '') {
        currentCategory = null;
      }
    }

    const headerCategoryMatch = getCategory(cleanVal);
    if (headerCategoryMatch !== null) {
      lastHeaderCategory = headerCategoryMatch;
    } else if (cellVal !== '') {
      const isLobby = cellVal.toLowerCase().includes('lobby') || cellVal.toLowerCase().includes('game') || cellVal.toLowerCase().includes('match') || /^l\s*\d+/i.test(cellVal);
      const isPlayerOrTeam = checkPlayer(cleanVal) || checkTeam(cleanVal) || checkSlot(cleanVal);
      if (!isLobby && isPlayerOrTeam) {
        lastHeaderCategory = null;
      }
    }

    if (checkPlayer(cleanVal) || (subheaderRowIndex !== -1 && checkPlayer(cleanSubVal))) {
      if (playerCol === -1) {
        playerCol = c;
      }
    } else if (checkTeam(cleanVal) || (subheaderRowIndex !== -1 && checkTeam(cleanSubVal))) {
      if (teamCol === -1) {
        teamCol = c;
      }
    } else if (checkSlot(cleanVal) || (subheaderRowIndex !== -1 && checkSlot(cleanSubVal))) {
      if (slotCol === -1) {
        slotCol = c;
      }
    }

    const matchVal = (val) => {
      const match = val.match(/lobby\s*(\d+)/i) || 
                    val.match(/game\s*(\d+)/i) || 
                    val.match(/match\s*(\d+)/i) || 
                    val.match(/\bl\s*(\d+)/i);
      return match ? parseInt(match[1]) : null;
    };

    const topLobbyMatch = matchVal(cellVal);
    if (topLobbyMatch !== null) {
      lastTopLobbyNum = topLobbyMatch;
    } else if (cellVal !== '') {
      const isStatCategory = getCategory(cleanVal) !== null;
      const isPlayerOrTeam =
        checkPlayer(cleanVal) || checkTeam(cleanVal) || checkSlot(cleanVal);
      if (!isStatCategory && isPlayerOrTeam) {
        lastTopLobbyNum = null;
      }
    }

    let lobbyNum = topLobbyMatch;
    if (lobbyNum === null && subheaderRowIndex !== -1) {
      lobbyNum = matchVal(subCellVal);
    }
    if (lobbyNum === null && lastTopLobbyNum !== null) {
      const topIsStat = getCategory(cleanVal) !== null;
      const subIsStat = getCategory(cleanSubVal) !== null;
      if (cellVal === '' || topIsStat || subIsStat) {
        lobbyNum = lastTopLobbyNum;
      }
    }

    if (lobbyNum !== null) {
      if (!lobbies[lobbyNum]) {
        lobbies[lobbyNum] = { killsCol: -1, damageCol: -1, accuracyCol: -1 };
      }

      let category = null;
      if (subheaderRowIndex !== -1 && getCategory(cleanSubVal) !== null) {
        category = getCategory(cleanSubVal);
      } else if (lastHeaderCategory !== null) {
        category = lastHeaderCategory;
      } else if (superHeaderRowIndex !== -1 && currentCategory !== null) {
        category = currentCategory;
      } else {
        const checkVal = subheaderRowIndex !== -1 ? cleanSubVal : cleanVal;
        category = getCategory(checkVal) || 'kills';
      }

      const isCarryForwardFromBlank = topLobbyMatch === null && cleanVal === '' && cleanSubVal === '';

      if (category === 'damage') {
        if (!isCarryForwardFromBlank || lobbies[lobbyNum].damageCol === -1) {
          lobbies[lobbyNum].damageCol = c;
        }
      } else if (category === 'accuracy') {
        if (!isCarryForwardFromBlank || lobbies[lobbyNum].accuracyCol === -1) {
          lobbies[lobbyNum].accuracyCol = c;
        }
      } else {
        if (!isCarryForwardFromBlank || lobbies[lobbyNum].killsCol === -1) {
          lobbies[lobbyNum].killsCol = c;
        }
      }
    }
  }

  if (playerCol === -1) playerCol = 0;

  const startRowIndex = Math.max(headerRowIndex, subheaderRowIndex) + 1;
  const parsedRows = [];

  for (let r = startRowIndex; r < grid.length; r++) {
    const rowData = grid[r];
    if (!rowData || rowData.length === 0) continue;

    const playerName = String(rowData[playerCol] || '').trim();
    const pLower = playerName.toLowerCase();
    if (
      !playerName || 
      playerName === '0' || 
      pLower === 'player name' || 
      pLower === 'player' || 
      pLower === 'ign' || 
      pLower === 'name' || 
      pLower === 'players'
    ) {
      continue;
    }

    const teamName = teamCol !== -1 ? cleanTeamName(String(rowData[teamCol] || '').trim()) : '';
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

  // Ensure default lobby 1 exists if none detected
  if (Object.keys(lobbies).length === 0) {
    lobbies[1] = { killsCol: -1, damageCol: -1, accuracyCol: -1 };
  }

  return {
    lobbies: Object.keys(lobbies).map(Number).sort((a, b) => a - b),
    rows: parsedRows,
    columnMappings: lobbies,
    config: {
      playerCol,
      teamCol,
      slotCol,
      startRowIndex,
      lobbies
    }
  };
}

// ─── Smart Player Matcher Utility ──────────────────────────────────────────
function matchPlayerByName(parsedName, parsedTeam, regs, allPlayers) {
  if (!parsedName || !parsedName.trim()) {
    return { playerId: null, playerName: 'Unmatched', ign: '', teamName: '', accuracy: 0, matchType: null, confidence: 'none' };
  }

  const cleanStr = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pNameClean = cleanStr(parsedName);
  const pTeamClean = cleanStr(parsedTeam);

  if (!pNameClean) {
    return { playerId: null, playerName: parsedName, ign: parsedName, teamName: '', accuracy: 0, matchType: null, confidence: 'none' };
  }

  let bestMatch = null;
  let maxScore = -1;
  let maxAccuracy = 0;
  let matchType = null;

  for (const reg of regs) {
    const globalPlayer = allPlayers.find(p => p.id === reg.playerId);
    const ign = reg.ign || globalPlayer?.ign || '';
    const profName = reg.professionalName || globalPlayer?.professionalName || '';
    const regTeam = reg.teamName || '';

    const ignClean = cleanStr(ign);
    const profClean = cleanStr(profName);
    const regTeamClean = cleanStr(regTeam);

    let ignSim = 0;
    let profSim = 0;

    // IGN Similarity
    if (ignClean) {
      if (pNameClean === ignClean) {
        ignSim = 1.0;
      } else if (pNameClean.length >= 3 && (pNameClean.includes(ignClean) || ignClean.includes(pNameClean))) {
        ignSim = 0.88;
      } else {
        ignSim = stringSimilarity(pNameClean, ignClean);
      }
    }

    // Professional Name Similarity
    if (profClean) {
      if (pNameClean === profClean) {
        profSim = 1.0;
      } else if (pNameClean.length >= 3 && (pNameClean.includes(profClean) || profClean.includes(pNameClean))) {
        profSim = 0.88;
      } else {
        profSim = stringSimilarity(pNameClean, profClean);
      }
    }

    let bestSim = 0;
    let currentType = null;

    if (profSim >= ignSim) {
      bestSim = profSim;
      currentType = profSim === 1.0 ? 'exact_proName' : 'fuzzy_proName';
    } else {
      bestSim = ignSim;
      currentType = ignSim === 1.0 ? 'exact_ign' : 'fuzzy_ign';
    }

    // Team boost if available
    let teamBoost = 0;
    if (pTeamClean && regTeamClean) {
      if (pTeamClean === regTeamClean) teamBoost = 0.12;
      else if (pTeamClean.includes(regTeamClean) || regTeamClean.includes(pTeamClean)) teamBoost = 0.06;
    }

    let finalScore = bestSim + teamBoost;
    let accuracyPct = Math.min(100, Math.round(bestSim * 100));

    if (bestSim >= 0.40 && finalScore > maxScore) {
      maxScore = finalScore;
      maxAccuracy = accuracyPct;
      matchType = currentType;
      bestMatch = reg;
    }
  }

  if (bestMatch) {
    const globalPlayer = allPlayers.find(p => p.id === bestMatch.playerId);
    let confidence = 'low';
    if (maxAccuracy >= 85) confidence = 'high';
    else if (maxAccuracy >= 70) confidence = 'medium';
    else if (maxAccuracy >= 50) confidence = 'low';
    else confidence = 'none';

    return {
      playerId: bestMatch.playerId,
      playerName: globalPlayer?.professionalName || bestMatch.professionalName || bestMatch.ign || bestMatch.playerId,
      ign: bestMatch.ign || globalPlayer?.ign || '',
      teamName: bestMatch.teamName || '',
      accuracy: maxAccuracy,
      matchType,
      confidence
    };
  }

  return {
    playerId: null,
    playerName: parsedName,
    ign: parsedName,
    teamName: parsedTeam || '',
    accuracy: 0,
    matchType: null,
    confidence: 'none'
  };
}

function findBestMatch(parsedName, parsedTeam, regs, allPlayers) {
  const match = matchPlayerByName(parsedName, parsedTeam, regs, allPlayers);
  if (!match || !match.playerId) return null;
  return {
    matchedPlayerId: match.playerId,
    playerId: match.playerId,
    playerName: match.playerName,
    confidence: match.confidence,
    accuracy: match.accuracy,
    matchType: match.matchType
  };
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
  const { user, isOwner, isOperator } = useAuth();
  const [day, setDay] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [playerRegs, setPlayerRegs] = useState([]);
  const [players, setPlayers] = useState([]);

  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');

  const isQualifier = tournament?.type === 'qualifier';
  const selectedGroup = isQualifier ? groups.find(g => g.id === selectedGroupId) : null;
  const activeStructure = isQualifier ? (selectedGroup?.structure || {}) : (tournament?.structure || {});
  const totalDays = activeStructure.totalDays || 6;
  const lobbiesPerDay = activeStructure.lobbiesPerDay || 4;
  const maxLobbies = lobbiesPerDay; // L1, L2, L3...

  const userEmail = user?.email?.toLowerCase();
  const isCreator = (tournament?.createdBy && tournament.createdBy === user?.uid) ||
    (userEmail && tournament?.creatorEmail && tournament.creatorEmail.toLowerCase() === userEmail);
  const isAssigned = (tournament?.editorUids || []).some(
    e => e === user?.uid || (userEmail && e.toLowerCase() === userEmail)
  );
  const canEdit = Boolean(isOwner || isCreator || isAssigned);

  // Lock state — persisted per tournament + day in localStorage
  const lockKey = tournament?.id ? `lock_player_${tournament.id}_day${day}` : null;
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (!lockKey) return;
    try { setIsLocked(localStorage.getItem(lockKey) === 'true'); } catch {}
  }, [lockKey]);

  const handleLock = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      for (const pid of Object.keys(formData)) {
        for (let l = 1; l <= maxLobbies; l++) {
          await saveRow(pid, l);
        }
      }
    } catch {}
    setSaving(false);
    try { localStorage.setItem(lockKey, 'true'); } catch {}
    setIsLocked(true);
    toast.success(`Day ${day} data locked 🔒`);
  };

  const handleUnlock = () => {
    if (!canEdit) return;
    try { localStorage.removeItem(lockKey); } catch {}
    setIsLocked(false);
    toast.success(`Day ${day} unlocked 🔓`);
  };
  const [section, setSection] = useState('kills'); // 'kills' | 'damage'

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
  const [smartImportGrid, setSmartImportGrid] = useState(null);
  const [smartImportConfig, setSmartImportConfig] = useState(null);
  const [mappingDraft, setMappingDraft] = useState(null);
  const [isEditingMapping, setIsEditingMapping] = useState(false);
  const [smartImportRows, setSmartImportRows] = useState([]);
  const [smartImportLobbies, setSmartImportLobbies] = useState([]);
  const [smartImportSelectedLobbies, setSmartImportSelectedLobbies] = useState([]);
  const [smartImportColumnMappings, setSmartImportColumnMappings] = useState({});
  const [smartImportFileName, setSmartImportFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);

  const isSmartImportActive = Boolean((smartImportGrid && smartImportGrid.length > 0) || smartImportRows.length > 0);

  const availableColumns = useMemo(() => {
    if (!smartImportGrid || smartImportGrid.length === 0) return [];
    const maxCols = smartImportGrid.reduce((max, row) => Math.max(max, (row || []).length), 0);
    const cols = [];
    for (let c = 0; c < maxCols; c++) {
      const headerSamples = [];
      for (let r = 0; r < Math.min(smartImportGrid.length, 3); r++) {
        const val = String(smartImportGrid[r]?.[c] || '').trim();
        if (val && !headerSamples.includes(val)) {
          headerSamples.push(val);
        }
      }
      const sampleText = headerSamples.join(' / ');
      cols.push({
        index: c,
        label: `Col ${c}${sampleText ? `: "${sampleText.length > 25 ? sampleText.substring(0, 25) + '...' : sampleText}"` : ' (empty)'}`
      });
    }
    return cols;
  }, [smartImportGrid]);

  const handleProcessGrid = useCallback((grid, fileName) => {
    if (!grid || grid.length === 0) {
      toast.error("Failed to parse sheet data.");
      return;
    }

    setSmartImportGrid(grid);
    const { lobbies, rows, columnMappings, config } = parseSmartSpreadsheet(grid);

    if (rows.length === 0) {
      const fallbackConfig = config || {
        playerCol: 0,
        teamCol: -1,
        slotCol: -1,
        startRowIndex: 1,
        lobbies: { 1: { killsCol: -1, damageCol: -1, accuracyCol: -1 } }
      };
      setSmartImportConfig(fallbackConfig);
      setMappingDraft(fallbackConfig);
      setSmartImportLobbies(Object.keys(fallbackConfig.lobbies).map(Number));
      setSmartImportSelectedLobbies(Object.keys(fallbackConfig.lobbies).map(Number));
      setSmartImportColumnMappings(fallbackConfig.lobbies || {});
      setSmartImportRows([]);
      setSmartImportFileName(fileName || 'Imported Spreadsheet');
      setIsEditingMapping(true);
      setShowPaste(false);
      handleOcrClear();
      toast("No player stats could be automatically parsed. Please map your spreadsheet columns below.", { icon: 'ℹ️' });
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

    setSmartImportConfig(config);
    setMappingDraft(config);
    setSmartImportLobbies(lobbies);
    setSmartImportSelectedLobbies(lobbies);
    setSmartImportColumnMappings(columnMappings || {});
    setSmartImportRows(previewRows);
    setSmartImportFileName(fileName || 'Imported Spreadsheet');
    setIsEditingMapping(false);
    setShowPaste(false);
    handleOcrClear();
  }, [playerRegs, players]);

  const handleSaveAndReloadMapping = () => {
    if (!smartImportGrid || smartImportGrid.length === 0) {
      toast.error("No spreadsheet data loaded to reload.");
      return;
    }
    if (!mappingDraft) return;

    try {
      const { lobbies, rows, columnMappings, config } = parseSmartSpreadsheet(smartImportGrid, mappingDraft);
      if (rows.length === 0) {
        toast.error("No valid player records found with this mapping. Please verify the Start Row and Player Name column.");
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

      setSmartImportConfig(config);
      setSmartImportLobbies(lobbies);
      setSmartImportSelectedLobbies(lobbies);
      setSmartImportColumnMappings(columnMappings || {});
      setSmartImportRows(previewRows);
      setIsEditingMapping(false);
      toast.success("Spreadsheet preview reloaded with updated column mappings!");
    } catch (err) {
      console.error("Failed to reload mapping:", err);
      toast.error("Failed to reload mapping: " + err.message);
    }
  };

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
    setSmartImportColumnMappings({});
    setSmartImportFileName('');
    setSmartImportGrid(null);
    setSmartImportConfig(null);
    setMappingDraft(null);
    setIsEditingMapping(false);
    setPendingFile(null);
  };

  const handleConfirmSmartImport = async () => {
    if (!canEdit) {
      toast.error('You do not have permission to import stats for this tournament.');
      return;
    }
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

      const promises = [];

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
            promises.push(updatePlayerMatchResult(tournament.id, firstExisting.id, payload));
            updatedCount++;

            for (let i = 1; i < existingResults.length; i++) {
              promises.push(deletePlayerMatchResult(tournament.id, existingResults[i].id));
            }
          } else {
            promises.push(savePlayerMatchResult(tournament.id, payload));
            addedCount++;
          }
        }
      }

      if (promises.length > 0) {
        await Promise.all(promises);
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
  const [ocrConcurrency, setOcrConcurrency] = useState(4);
  const ocrFileRef = useRef(null);

  // Active revive configuration from tournament / group (configured in Team Entry)
  const activeReviveConfig = getActiveReviveConfig(tournament, selectedGroup);

  // Live preview parse effect
  useEffect(() => {
    if (!pasteText.trim()) {
      if (smartImportFileName === 'Pasted Data') {
        handleCancelSmartImport();
      }
      setParsedPreview([]);
      setPasteErrors([]);
      return;
    }

    const delimiter = pasteText.includes('\t') ? '\t' : (pasteText.includes(',') ? ',' : (pasteText.includes(';') ? ';' : ' '));
    const grid = pasteText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      .filter(l => l.trim().length > 0)
      .map(r => r.split(delimiter).map(cell => cell.trim()));

    try {
      const { lobbies, rows, columnMappings, config } = parseSmartSpreadsheet(grid);
      if (rows.length > 0) {
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

        setSmartImportGrid(grid);
        setSmartImportConfig(config);
        setMappingDraft(config);
        setSmartImportLobbies(lobbies);
        setSmartImportSelectedLobbies(lobbies);
        setSmartImportColumnMappings(columnMappings || {});
        setSmartImportRows(previewRows);
        setSmartImportFileName('Pasted Data');
        setIsEditingMapping(false);
      } else {
        const { results, errors } = parsePlayerEntryPaste(pasteText, playerRegs);
        setParsedPreview(results);
        setPasteErrors(errors);
      }
    } catch (err) {
      console.error("Auto smart import parse error:", err);
      const { results, errors } = parsePlayerEntryPaste(pasteText, playerRegs);
      setParsedPreview(results);
      setPasteErrors(errors);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteText, playerRegs, players]);

  // formData: playerId → { playerId, slot, playerName, ign, teamName, lobbies: { 1: {kills, damage, accuracy, existingId}, ... } }
  const [formData, setFormData] = useState({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [regs, allPlayers, results, teamRegs, gList] = await Promise.all([
        getPlayerRegistrations(tournament.id),
        getPlayers(),
        getPlayerMatchResults(tournament.id),
        getTeamRegistrations(tournament.id),
        getGroups(tournament.id),
      ]);

      setGroups(gList);
      if (gList.length > 0 && (!selectedGroupId || !gList.some(g => g.id === selectedGroupId))) {
        setSelectedGroupId(gList[0].id);
      }

      const activeGroupRegs = selectedGroupId
        ? regs.filter(r => r.groupId === selectedGroupId)
        : regs;

      const enrichedRegs = activeGroupRegs.map(reg => {
        const teamReg = teamRegs.find(t => t.teamId === reg.teamId || (reg.teamName && t.teamName?.toLowerCase() === reg.teamName.toLowerCase()));
        return {
          ...reg,
          slot: teamReg ? teamReg.slot : reg.slot
        };
      });

      setPlayerRegs(enrichedRegs);
      setPlayers(allPlayers);

      const dayResults = results.filter((r) => r.day === day);
      const activeStruct = (selectedGroupId && gList.find(g => g.id === selectedGroupId)?.structure) || (tournament?.structure || {});
      const numLobbies = activeStruct.lobbiesPerDay || 4;

      const fd = {};
      for (const reg of enrichedRegs) {
        const globalPlayer = allPlayers.find((p) => p.id === reg.playerId);
        const playerDayResults = dayResults.filter((r) => r.playerId === reg.playerId);

        const lobbies = {};
        for (let l = 1; l <= numLobbies; l++) {
          const existing = playerDayResults.find((r) => r.lobby === l);
          lobbies[l] = {
            kills: existing?.kills ?? '',
            damage: existing?.damage ?? '',
            accuracy: existing?.accuracy ?? '',
            existingId: existing?.id || null,
          };
        }

        fd[reg.playerId] = {
          playerId: reg.playerId,
          slot: reg.slot,
          playerName: globalPlayer?.professionalName || reg.ign || reg.playerId,
          ign: reg.ign || globalPlayer?.ign || '',
          teamName: reg.teamName || '',
          lobbies,
        };
      }
      setFormData(fd);
    } catch (err) { toast.error('Load failed'); console.error(err); }
    finally { setLoading(false); }
  }, [tournament.id, day, isQualifier, selectedGroupId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleChange = (playerId, lobbyNum, field, val) => {
    if (isLocked || !canEdit) return;
    setFormData((prev) => {
      const pForm = prev[playerId] || {};
      const pLobbies = pForm.lobbies || {};
      const curLobby = pLobbies[lobbyNum] || { kills: '', damage: '', accuracy: '', existingId: null };
      return {
        ...prev,
        [playerId]: {
          ...pForm,
          lobbies: {
            ...pLobbies,
            [lobbyNum]: {
              ...curLobby,
              [field]: val
            }
          }
        }
      };
    });
  };

  const saveRow = async (playerId, lobbyNum) => {
    if (isLocked || !canEdit) return;
    const pForm = formData[playerId];
    if (!pForm || !pForm.lobbies || !pForm.lobbies[lobbyNum]) return;
    const row = pForm.lobbies[lobbyNum];

    const isKillsEmpty = row.kills === '' || row.kills === null || row.kills === undefined;
    const isDamageEmpty = row.damage === '' || row.damage === null || row.damage === undefined;
    const isAccuracyEmpty = row.accuracy === '' || row.accuracy === null || row.accuracy === undefined;

    if (isKillsEmpty && isDamageEmpty && isAccuracyEmpty) {
      if (row.existingId) {
        try {
          await deletePlayerMatchResult(tournament.id, row.existingId);
          setFormData((prev) => ({
            ...prev,
            [playerId]: {
              ...prev[playerId],
              lobbies: {
                ...prev[playerId].lobbies,
                [lobbyNum]: { ...prev[playerId].lobbies[lobbyNum], existingId: null, kills: '', damage: '', accuracy: '' }
              }
            }
          }));
        } catch (err) { console.error('Auto-delete error', err); }
      }
      return;
    }

    const payload = {
      playerId: pForm.playerId,
      playerName: pForm.playerName,
      teamName: pForm.teamName,
      day,
      lobby: lobbyNum,
      kills: isKillsEmpty ? null : (parseInt(row.kills) ?? 0),
      damage: isDamageEmpty ? null : (parseFloat(row.damage) ?? 0),
      accuracy: isAccuracyEmpty ? null : (parseFloat(row.accuracy) ?? 0),
      ...(isQualifier && selectedGroupId ? { groupId: selectedGroupId } : {}),
      reviveType: getReviveTypeForMatch(activeReviveConfig, day, lobbyNum),
    };

    try {
      if (row.existingId) {
        await updatePlayerMatchResult(tournament.id, row.existingId, payload);
      } else {
        const saved = await savePlayerMatchResult(tournament.id, payload);
        setFormData((prev) => ({
          ...prev,
          [playerId]: {
            ...prev[playerId],
            lobbies: {
              ...prev[playerId].lobbies,
              [lobbyNum]: { ...prev[playerId].lobbies[lobbyNum], existingId: saved.id }
            }
          }
        }));
      }
    } catch (err) { console.error('Auto-save error', err); }
  };

  const handleBulkSave = async () => {
    if (isLocked || !canEdit) {
      toast.error('You do not have permission to edit this tournament');
      return;
    }
    setSaving(true);
    try {
      for (const pid of Object.keys(formData)) {
        for (let l = 1; l <= maxLobbies; l++) {
          await saveRow(pid, l);
        }
      }
      toast.success(`Day ${day} player data saved`);
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handlePasteImport = async () => {
    if (!canEdit) {
      toast.error('You do not have permission to edit this tournament');
      return;
    }
    if (parsedPreview.length === 0) {
      toast.error('No valid player entry results parsed.');
      return;
    }
    setParsing(true);
    try {
      let updatedCount = 0;
      let addedCount = 0;

      for (const item of parsedPreview) {
        const targetLobby = 1;
        const existing = formData[item.playerId]?.lobbies?.[targetLobby]?.existingId;
        const payload = {
          playerId: item.playerId,
          playerName: item.playerName,
          teamName: item.teamName,
          day,
          lobby: targetLobby,
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
    if (!canEdit) {
      toast.error('You do not have permission to edit this tournament');
      return;
    }
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
    if (!canEdit) {
      toast.error('You do not have permission to edit this tournament');
      return;
    }
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

    // Pool-based concurrency runner — limits simultaneous Gemini calls
    const runPool = async (tasks, concurrency) => {
      let idx = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (idx < tasks.length) {
          const current = idx++;
          await tasks[current]();
        }
      });
      await Promise.all(workers);
    };

    const tasks = pendingItems.map((item) => async () => {
      let progressInterval = null;
      try {
        progressInterval = setInterval(() => {
          setOcrQueue(prev => prev.map(qi => {
            if (qi.id === item.id && qi.status === 'scanning') {
              return { ...qi, progress: Math.min(85, qi.progress + 15) };
            }
            return qi;
          }));
        }, 800);

        const data = await uploadAndParseImage(item.file, item.lobby, 'player');

        const mappedRows = (data.rows || []).map(row => {
          const nameInput = row.name || '';
          const match = matchPlayerByName(nameInput, '', playerRegs, players);

          return {
            playerId: match.playerId,
            playerName: match.playerName,
            ign: match.ign,
            teamName: match.teamName,
            matchType: match.matchType,
            matchAccuracy: match.accuracy,
            confidence: match.confidence,
            kills: row.kills === null || row.kills === undefined ? null : (parseInt(row.kills) || 0),
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
      } finally {
        if (progressInterval) clearInterval(progressInterval);
      }
    });

    await runPool(tasks, ocrConcurrency);
    toast.success('Batch scan completed!');
  };

  const handleLobbyCellChange = (lobbyNum, idx, field, val) => {
    setLobbyPreviews(prev => {
      const lobbyData = prev[lobbyNum];
      if (!lobbyData) return prev;

      const updatedResults = lobbyData.results.map((row, i) => {
        if (i !== idx) return row;
        
        let updatedRow = { ...row };
        
        if (field === 'playerId') {
          if (!val) {
            updatedRow.playerId = null;
            updatedRow.playerName = 'Unmatched';
            updatedRow.ign = '';
            updatedRow.teamName = '';
            updatedRow.matchType = null;
            updatedRow.matchAccuracy = 0;
            updatedRow.confidence = 'none';
          } else {
            const regPlayer = playerRegs.find(p => p.playerId === val);
            const globalP = players.find(gp => gp.id === val);
            updatedRow.playerId = val;
            updatedRow.playerName = globalP?.professionalName || regPlayer?.professionalName || regPlayer?.ign || val;
            updatedRow.ign = regPlayer?.ign || globalP?.ign || val;
            updatedRow.teamName = regPlayer?.teamName || '';
            updatedRow.matchType = 'manual';
            updatedRow.matchAccuracy = 100;
            updatedRow.confidence = 'high';
          }
        } else if (field === 'playerName') {
          const nameInput = val;
          const match = matchPlayerByName(nameInput, '', playerRegs, players);

          updatedRow.originalParsedName = nameInput;
          updatedRow.playerId = match.playerId;
          updatedRow.playerName = match.playerName;
          updatedRow.ign = match.ign;
          updatedRow.teamName = match.teamName;
          updatedRow.matchType = match.matchType;
          updatedRow.matchAccuracy = match.accuracy;
          updatedRow.confidence = match.confidence;
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
    if (!canEdit) {
      toast.error('You do not have permission to edit this tournament');
      return;
    }
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
    if (!rowsList || rowsList.length === 0) return [];

    const getQualityScore = (row) => {
      let score = 0;
      if (row.playerId) score += 50;
      if (row.kills !== null && row.kills !== undefined) score += 30;
      if (row.matchType === 'ign') score += 20;
      else if (row.matchType === 'proName') score += 10;
      return score;
    };

    const mergedMap = new Map();

    rowsList.forEach(row => {
      const key = row.playerId
        ? `pid_${row.playerId}`
        : `name_${(row.originalParsedName || row.playerName || '').toLowerCase().replace(/\s+/g, '')}`;

      if (!mergedMap.has(key)) {
        mergedMap.set(key, row);
      } else {
        const existing = mergedMap.get(key);
        if (getQualityScore(row) > getQualityScore(existing)) {
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

  // Helpers
  const getAllPlayers = () => Object.values(formData).sort((a, b) => a.slot - b.slot);

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

      {/* Group Selector */}
      {groups.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--gold)' }}>Select Group:</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {groups.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => { setSelectedGroupId(g.id); setDay(1); }}
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

      {!canEdit && (
        <div style={{
          padding: '12px 16px',
          borderRadius: 10,
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
          color: '#93c5fd',
          fontSize: '0.85rem'
        }}>
          <AlertCircle size={18} style={{ color: '#60a5fa', flexShrink: 0 }} />
          <span><strong>Read-Only Mode:</strong> You have viewing access to this tournament. Player stats entry and smart imports cannot be edited until an administrator grants you editor permissions.</span>
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
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button className={`btn btn-sm ${section === 'kills' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSection('kills')}>Section A · Kills</button>
          <button className={`btn btn-sm ${section === 'damage' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSection('damage')}>Section B · Damage/Acc</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isLocked && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: '0.72rem', fontWeight: 700, color: '#ef4444',
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 6, padding: '2px 8px'
            }}>
              <Lock size={11} /> Locked
            </span>
          )}
          {canEdit && !isLocked && (
            <button
              className="btn btn-secondary"
              onClick={() => setShowPaste(v => !v)}
              title="Paste player stats from spreadsheet"
            >
              <ClipboardPaste size={14} style={{ marginRight: 6 }} /> Paste or Upload Stats
            </button>
          )}
          {canEdit && !isLocked && (
            <button className="btn btn-secondary" onClick={handleBulkSave} disabled={saving}>
              <Save size={14} /> {saving ? 'Saving...' : 'Save All'}
            </button>
          )}
          {canEdit && (isLocked ? (
            <button
              className="btn btn-secondary"
              onClick={handleUnlock}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Unlock size={13} /> Unlock
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleLock}
              disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Lock size={13} /> {saving ? 'Saving...' : 'Save & Lock'}
            </button>
          ))}
        </div>
      </div>

      {/* Paste Data Panel — hidden when locked or when read-only */}
      {showPaste && !isLocked && canEdit && (
        <div className="card" style={{ marginBottom: 24, border: '1px solid var(--border-gold)', background: 'rgba(201,168,76,0.02)' }}>
          <div className="flex-between" style={{ marginBottom: 10 }}>
            <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--gold)' }}>
              Paste or Upload Player Stats (Day {day})
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

              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Parallel Workers:</span>
                  <select
                    className="form-select"
                    style={{ fontSize: '0.72rem', padding: '3px 6px', width: 60 }}
                    value={ocrConcurrency}
                    onChange={e => setOcrConcurrency(Number(e.target.value))}
                    title="Number of images processed simultaneously"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
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
                            <th>Parsed IGN (Screenshot)</th>
                            <th>Matched Player Name</th>
                            <th>System Accuracy / Match Read</th>
                            <th>Team</th>
                            <th style={{ width: 100 }}>Kills</th>
                            <th style={{ width: 50 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {lobbyData.results.map((row, idx) => {
                            const isNullKills = row.kills === null;
                            const isUnmatched = !row.playerId || row.confidence === 'none';

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
                                        borderColor: isUnmatched ? 'var(--danger)' : row.confidence === 'low' ? 'var(--warning)' : undefined
                                      }}
                                      value={row.originalParsedName || ''}
                                      onChange={e => handleLobbyCellChange(lobbyData.lobby, idx, 'playerName', e.target.value)}
                                    />
                                  ) : (row.originalParsedName || '—')}
                                </td>
                                <td>
                                  {isEditing ? (
                                    <select
                                      className="editable-input"
                                      style={{ width: '100%', fontSize: '0.75rem', padding: '2px 4px' }}
                                      value={row.playerId || ''}
                                      onChange={e => handleLobbyCellChange(lobbyData.lobby, idx, 'playerId', e.target.value)}
                                    >
                                      <option value="">-- Unmatched --</option>
                                      {playerRegs.map(p => (
                                        <option key={p.playerId} value={p.playerId}>
                                          {p.professionalName || p.ign} ({p.teamName || 'No Team'})
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <div>
                                      <span style={{ fontWeight: 600 }}>
                                        {isUnmatched ? 'Unmatched IGN' : row.playerName}
                                      </span>
                                      {row.ign && row.ign !== row.playerName && (
                                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: 6 }}>
                                          (IGN: {row.ign})
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  {isUnmatched ? (
                                    <span style={{
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      color: 'white',
                                      background: 'var(--danger)',
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4
                                    }}>
                                      <AlertCircle size={10} /> Unmatched (0%)
                                    </span>
                                  ) : row.confidence === 'high' ? (
                                    <span style={{
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      color: '#10B981',
                                      background: 'rgba(16,185,129,0.12)',
                                      border: '1px solid rgba(16,185,129,0.3)',
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4
                                    }}>
                                      <Check size={10} /> {row.matchAccuracy}% ({row.matchType === 'exact_proName' ? 'Exact Pro Name' : row.matchType === 'exact_ign' ? 'Exact IGN' : row.matchType === 'manual' ? 'Manual Selection' : 'High Accuracy'})
                                    </span>
                                  ) : row.confidence === 'medium' ? (
                                    <span style={{
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      color: 'var(--gold)',
                                      background: 'rgba(201,168,76,0.12)',
                                      border: '1px solid rgba(201,168,76,0.3)',
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4
                                    }}>
                                      <Check size={10} /> {row.matchAccuracy}% ({row.matchType?.includes('proName') ? 'Pro Name Match' : 'IGN Match'})
                                    </span>
                                  ) : (
                                    <span style={{
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      color: '#F59E0B',
                                      background: 'rgba(245,158,11,0.12)',
                                      border: '1px solid rgba(245,158,11,0.3)',
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4
                                    }} title="Confidence Low - Check if the matched Pro Name or IGN is correct">
                                      <AlertTriangle size={10} /> {row.matchAccuracy}% ({row.matchType?.includes('proName') ? 'Pro Name' : 'IGN'})
                                    </span>
                                  )}
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
            {!isOcrMode && parsedPreview.length > 0 && !isSmartImportActive && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handlePasteImport}
                disabled={parsing}
              >
                {parsing ? 'Saving stats...' : `Save stats to Day ${day}`}
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

      {/* Smart Spreadsheet Import Preview */}
      {isSmartImportActive && (
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
                Review matched players and stats. You can edit column mappings to customize which columns map to each metric.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (!isEditingMapping && !mappingDraft && smartImportConfig) {
                    setMappingDraft(JSON.parse(JSON.stringify(smartImportConfig)));
                  }
                  setIsEditingMapping(prev => !prev);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Sliders size={14} />
                {isEditingMapping ? 'Hide Column Mapping' : 'Edit Column Mapping'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleCancelSmartImport} disabled={importing}>
                Cancel Import
              </button>
            </div>
          </div>

          {/* Lobby Selection checklist & Mapped Columns Summary */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px', background: 'var(--bg-alt-row)', borderRadius: 8, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Lobbies to Import:</span>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                {smartImportLobbies.length === 0 ? (
                  <span style={{ fontSize: '0.8rem', color: '#EF4444', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    ⚠️ No Lobby columns were mapped! Please edit column mappings below.
                  </span>
                ) : (
                  smartImportLobbies.map(l => (
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
                  ))
                )}
              </div>
            </div>
            {Object.keys(smartImportColumnMappings).length > 0 && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-md)', paddingTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>Mapped Columns:</span>
                  {Object.entries(smartImportColumnMappings).map(([l, cols]) => (
                    <span key={l} style={{ background: 'var(--bg-card)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-md)' }}>
                      L{l} (Kills: col {cols.killsCol === -1 || cols.killsCol === undefined ? 'None' : cols.killsCol}, Dmg: col {cols.damageCol === -1 || cols.damageCol === undefined ? 'None' : cols.damageCol}, Acc: col {cols.accuracyCol === -1 || cols.accuracyCol === undefined ? 'None' : cols.accuracyCol})
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={() => {
                    if (!isEditingMapping && !mappingDraft && smartImportConfig) {
                      setMappingDraft(JSON.parse(JSON.stringify(smartImportConfig)));
                    }
                    setIsEditingMapping(prev => !prev);
                  }}
                  style={{ fontSize: '0.72rem', color: 'var(--gold)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Sliders size={12} /> {isEditingMapping ? 'Close Editor' : 'Edit Columns'}
                </button>
              </div>
            )}
          </div>

          {/* ── Collapsible Column Mapping Editor Panel ── */}
          {isEditingMapping && (
            <div style={{
              background: 'var(--bg-alt-row)',
              border: '1px solid var(--border-gold)',
              borderRadius: 8,
              padding: '16px 18px',
              marginBottom: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 16
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                <div>
                  <h4 style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--gold)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sliders size={16} /> Column Mapping Configuration
                  </h4>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
                    Select which spreadsheet columns map to player info and tournament lobby statistics.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveAndReloadMapping}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}
                  >
                    <RefreshCw size={13} /> Save & Reload Preview
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setIsEditingMapping(false)}
                    style={{ fontSize: '0.78rem' }}
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Section 1: Player & Row Identifiers */}
              <div>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  1. Player & Row Settings
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  {/* Data Starts at Row */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Data Starts At Row:
                    </label>
                    <select
                      className="form-input"
                      style={{ width: '100%', fontSize: '0.78rem', padding: '5px 8px', background: 'var(--bg-card)' }}
                      value={mappingDraft?.startRowIndex ?? 1}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setMappingDraft(prev => ({ ...prev, startRowIndex: val }));
                      }}
                    >
                      {smartImportGrid && Array.from({ length: Math.min(smartImportGrid.length, 12) }, (_, i) => {
                        const previewText = (smartImportGrid[i] || []).filter(Boolean).slice(0, 3).join(' | ');
                        return (
                          <option key={i} value={i}>
                            Row {i + 1}{previewText ? ` (${previewText.length > 25 ? previewText.substring(0, 25) + '...' : previewText})` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Player Name / IGN Column */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Player Name / IGN <span style={{ color: 'var(--gold)' }}>*</span>:
                    </label>
                    <select
                      className="form-input"
                      style={{ width: '100%', fontSize: '0.78rem', padding: '5px 8px', background: 'var(--bg-card)' }}
                      value={mappingDraft?.playerCol ?? 0}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setMappingDraft(prev => ({ ...prev, playerCol: val }));
                      }}
                    >
                      {availableColumns.map(col => (
                        <option key={col.index} value={col.index}>{col.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Team Name Column */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Team Name (Optional):
                    </label>
                    <select
                      className="form-input"
                      style={{ width: '100%', fontSize: '0.78rem', padding: '5px 8px', background: 'var(--bg-card)' }}
                      value={mappingDraft?.teamCol ?? -1}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setMappingDraft(prev => ({ ...prev, teamCol: val }));
                      }}
                    >
                      <option value="-1">[ None / Not in Sheet ]</option>
                      {availableColumns.map(col => (
                        <option key={col.index} value={col.index}>{col.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Slot Column */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Slot # / Index (Optional):
                    </label>
                    <select
                      className="form-input"
                      style={{ width: '100%', fontSize: '0.78rem', padding: '5px 8px', background: 'var(--bg-card)' }}
                      value={mappingDraft?.slotCol ?? -1}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setMappingDraft(prev => ({ ...prev, slotCol: val }));
                      }}
                    >
                      <option value="-1">[ None / Not in Sheet ]</option>
                      {availableColumns.map(col => (
                        <option key={col.index} value={col.index}>{col.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 2: Lobby Metrics */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    2. Lobby Metrics Mapping
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => {
                      setMappingDraft(prev => {
                        const currentLobbies = prev?.lobbies ? { ...prev.lobbies } : {};
                        const existingNums = Object.keys(currentLobbies).map(Number);
                        const nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;
                        currentLobbies[nextNum] = { killsCol: -1, damageCol: -1, accuracyCol: -1 };
                        return { ...prev, lobbies: currentLobbies };
                      });
                    }}
                    style={{ fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--gold)' }}
                  >
                    <Plus size={13} /> Add Lobby
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                  {mappingDraft?.lobbies && Object.entries(mappingDraft.lobbies).map(([lobbyNum, cols]) => {
                    const lNum = parseInt(lobbyNum);
                    const lobbyColor = getLobbyColor(lNum);
                    const lobbyCount = Object.keys(mappingDraft.lobbies).length;

                    return (
                      <div
                        key={lobbyNum}
                        style={{
                          border: `1px solid ${lobbyColor.border}`,
                          background: 'var(--bg-card)',
                          borderRadius: 6,
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-md)', paddingBottom: 4 }}>
                          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: lobbyColor.text }}>
                            Lobby {lobbyNum} Metrics
                          </span>
                          {lobbyCount > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                setMappingDraft(prev => {
                                  const newLobbies = { ...prev.lobbies };
                                  delete newLobbies[lobbyNum];
                                  return { ...prev, lobbies: newLobbies };
                                });
                              }}
                              style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: 2 }}
                              title={`Remove Lobby ${lobbyNum}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>

                        {/* Kills Col */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: 60 }}>Kills:</span>
                          <select
                            className="form-input"
                            style={{ flex: 1, fontSize: '0.74rem', padding: '3px 6px', background: 'var(--bg-alt-row)' }}
                            value={cols.killsCol ?? -1}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setMappingDraft(prev => ({
                                ...prev,
                                lobbies: {
                                  ...prev.lobbies,
                                  [lobbyNum]: { ...prev.lobbies[lobbyNum], killsCol: val }
                                }
                              }));
                            }}
                          >
                            <option value="-1">[ None ]</option>
                            {availableColumns.map(col => (
                              <option key={col.index} value={col.index}>{col.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Damage Col */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: 60 }}>Damage:</span>
                          <select
                            className="form-input"
                            style={{ flex: 1, fontSize: '0.74rem', padding: '3px 6px', background: 'var(--bg-alt-row)' }}
                            value={cols.damageCol ?? -1}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setMappingDraft(prev => ({
                                ...prev,
                                lobbies: {
                                  ...prev.lobbies,
                                  [lobbyNum]: { ...prev.lobbies[lobbyNum], damageCol: val }
                                }
                              }));
                            }}
                          >
                            <option value="-1">[ None ]</option>
                            {availableColumns.map(col => (
                              <option key={col.index} value={col.index}>{col.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Accuracy Col */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', minWidth: 60 }}>Accuracy:</span>
                          <select
                            className="form-input"
                            style={{ flex: 1, fontSize: '0.74rem', padding: '3px 6px', background: 'var(--bg-alt-row)' }}
                            value={cols.accuracyCol ?? -1}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setMappingDraft(prev => ({
                                ...prev,
                                lobbies: {
                                  ...prev.lobbies,
                                  [lobbyNum]: { ...prev.lobbies[lobbyNum], accuracyCol: val }
                                }
                              }));
                            }}
                          >
                            <option value="-1">[ None ]</option>
                            {availableColumns.map(col => (
                              <option key={col.index} value={col.index}>{col.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer Save & Reload button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border-md)', paddingTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (smartImportConfig) setMappingDraft(JSON.parse(JSON.stringify(smartImportConfig)));
                    setIsEditingMapping(false);
                  }}
                >
                  Cancel Mapping Changes
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveAndReloadMapping}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <RefreshCw size={13} /> Save & Reload Preview
                </button>
              </div>
            </div>
          )}

          {/* Table Container / Empty State */}
          {smartImportRows.length === 0 ? (
            <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-alt-row)', borderRadius: 8, margin: '14px 0', border: '1px dashed var(--border-gold)' }}>
              <AlertCircle size={32} style={{ color: 'var(--gold)', margin: '0 auto 10px' }} />
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>No player stats preview available yet</div>
              <p style={{ fontSize: '0.8rem', maxWidth: 460, margin: '6px auto 14px' }}>
                Map your spreadsheet columns above to match player names and lobby stats, then click <strong>"Save & Reload Preview"</strong>.
              </p>
              {!isEditingMapping && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    if (!mappingDraft && smartImportConfig) {
                      setMappingDraft(JSON.parse(JSON.stringify(smartImportConfig)));
                    }
                    setIsEditingMapping(true);
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Sliders size={14} /> Open Column Mapping Editor
                </button>
              )}
            </div>
          ) : (
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
          )}

          {/* Action Row */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (!isEditingMapping && !mappingDraft && smartImportConfig) {
                  setMappingDraft(JSON.parse(JSON.stringify(smartImportConfig)));
                }
                setIsEditingMapping(prev => !prev);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Sliders size={15} />
              {isEditingMapping ? 'Hide Column Mapping' : 'Edit Column Mapping'}
            </button>
            <button className="btn btn-secondary" onClick={handleCancelSmartImport} disabled={importing}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleConfirmSmartImport}
              disabled={smartImportRows.length === 0 || smartImportSelectedLobbies.length === 0 || importing}
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
      {section === 'kills' && !isSmartImportActive && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
            gap: '14px',
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

                {/* Table Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  borderBottom: '1px solid var(--border-md)',
                  paddingBottom: '4px',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  color: 'var(--text-muted)'
                }}>
                  <span style={{ width: '18px', textAlign: 'center' }}>#</span>
                  <span style={{ flex: 1, minWidth: 0 }}>PLAYER</span>
                  {Array.from({ length: maxLobbies }, (_, i) => i + 1).map(l => {
                    const col = getLobbyColor(l);
                    return (
                      <span key={l} style={{
                        width: '46px',
                        textAlign: 'center',
                        color: col.text,
                        background: col.bg,
                        border: `1px solid ${col.border}`,
                        borderRadius: '4px',
                        padding: '1px 0',
                        fontSize: '0.65rem',
                        fontWeight: 700
                      }}>
                        L{l}
                      </span>
                    );
                  })}
                  <span style={{ width: '45px', textAlign: 'right', color: 'var(--gold)' }}>TOT</span>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {teamPlayers.map(row => {
                    const totalKills = Array.from({ length: maxLobbies }, (_, i) => i + 1).reduce((acc, l) => {
                      const k = row.lobbies?.[l]?.kills;
                      return acc + (k !== null && k !== undefined && k !== '' ? parseInt(k) || 0 : 0);
                    }, 0);
                    const hasAnyKills = Array.from({ length: maxLobbies }, (_, i) => i + 1).some(l => {
                      const k = row.lobbies?.[l]?.kills;
                      return k !== null && k !== undefined && k !== '';
                    });

                    return (
                      <div key={row.playerId} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 0',
                        borderBottom: '1px dashed var(--border)'
                      }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', width: '18px', textAlign: 'center' }}>
                          {row.slot}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.playerName}
                          </div>
                          {row.ign && row.ign !== row.playerName && (
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {row.ign}
                            </div>
                          )}
                        </div>

                        {Array.from({ length: maxLobbies }, (_, i) => i + 1).map(l => (
                          <div key={l} style={{ width: '46px' }}>
                            {isLocked || !canEdit ? (
                              <span style={{ display: 'block', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                {row.lobbies?.[l]?.kills !== '' && row.lobbies?.[l]?.kills !== null && row.lobbies?.[l]?.kills !== undefined
                                  ? row.lobbies[l].kills
                                  : '—'}
                              </span>
                            ) : (
                              <PlayerStatInput
                                value={row.lobbies?.[l]?.kills}
                                onSave={(v) => { handleChange(row.playerId, l, 'kills', v); saveRow(row.playerId, l); }}
                                inputStyle={{ width: '100%', padding: '3px 2px', fontSize: '0.78rem', textAlign: 'center' }}
                              />
                            )}
                          </div>
                        ))}

                        <div style={{ width: '45px', textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: hasAnyKills ? 'var(--gold)' : 'var(--text-muted)' }}>
                          {hasAnyKills ? totalKills : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        </>
      )}

      {/* ── SECTION B: Damage & Accuracy ────────────────── */}
      {section === 'damage' && !isSmartImportActive && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))',
          gap: '14px',
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
                gap: '10px'
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
                    let totDmg = 0;
                    let hasDmgCount = 0;
                    let accSum = 0;
                    let hasAccCount = 0;

                    for (let l = 1; l <= maxLobbies; l++) {
                      const d = row.lobbies?.[l]?.damage;
                      const a = row.lobbies?.[l]?.accuracy;
                      if (d !== null && d !== undefined && d !== '') {
                        totDmg += parseFloat(d) || 0;
                        hasDmgCount++;
                      }
                      if (a !== null && a !== undefined && a !== '') {
                        accSum += parseFloat(a) || 0;
                        hasAccCount++;
                      }
                    }

                    const avgAcc = hasAccCount > 0 ? (accSum / hasAccCount) : 0;

                    return (
                      <div key={row.playerId} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '6px 0',
                        borderBottom: '1px dashed var(--border)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                              #{row.slot}
                            </span>
                            <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {row.playerName}
                            </span>
                            {row.ign && row.ign !== row.playerName && (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                · {row.ign}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                            Tot: <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{hasDmgCount > 0 ? Math.round(totDmg) : '—'}</span> | Avg Acc: <span style={{ color: 'var(--cyan)', fontWeight: 600 }}>{hasAccCount > 0 ? `${avgAcc.toFixed(1)}%` : '—'}</span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                          {Array.from({ length: maxLobbies }, (_, i) => i + 1).map(l => {
                            const col = getLobbyColor(l);
                            return (
                              <div key={l} style={{
                                flex: 1,
                                minWidth: '95px',
                                background: 'var(--bg-alt-row)',
                                border: `1px solid ${col.border}`,
                                borderRadius: '6px',
                                padding: '6px 8px'
                              }}>
                                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: col.text, marginBottom: '4px', textAlign: 'center' }}>
                                  LOBBY {l}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  <div>
                                    <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block', marginBottom: '1px' }}>DMG</span>
                                    {isLocked || !canEdit ? (
                                      <span style={{ display: 'block', fontSize: '0.75rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                        {row.lobbies?.[l]?.damage !== '' && row.lobbies?.[l]?.damage !== null && row.lobbies?.[l]?.damage !== undefined
                                          ? Math.round(parseFloat(row.lobbies[l].damage))
                                          : '—'}
                                      </span>
                                    ) : (
                                      <PlayerStatInput
                                        value={row.lobbies?.[l]?.damage}
                                        step={1}
                                        onSave={(v) => { handleChange(row.playerId, l, 'damage', v); saveRow(row.playerId, l); }}
                                        inputStyle={{ width: '100%', padding: '2px 4px', fontSize: '0.75rem', textAlign: 'center' }}
                                      />
                                    )}
                                  </div>
                                  <div>
                                    <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'block', marginBottom: '1px' }}>ACC %</span>
                                    {isLocked || !canEdit ? (
                                      <span style={{ display: 'block', fontSize: '0.75rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                        {row.lobbies?.[l]?.accuracy !== '' && row.lobbies?.[l]?.accuracy !== null && row.lobbies?.[l]?.accuracy !== undefined
                                          ? `${parseFloat(row.lobbies[l].accuracy).toFixed(1)}%`
                                          : '—'}
                                      </span>
                                    ) : (
                                      <PlayerStatInput
                                        value={row.lobbies?.[l]?.accuracy}
                                        step={0.1}
                                        max={100}
                                        onSave={(v) => { handleChange(row.playerId, l, 'accuracy', v); saveRow(row.playerId, l); }}
                                        inputStyle={{ width: '100%', padding: '2px 4px', fontSize: '0.75rem', textAlign: 'center' }}
                                      />
                                    )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Isolated per-cell stat input ─────────────────────────────────────────────
// Uses local state to avoid re-rendering the entire player list on each keystroke.
function PlayerStatInput({ value, onSave, step = 1, min = 0, max, inputStyle = {} }) {
  const [local, setLocal] = useState(value === null || value === undefined || value === '' ? '' : String(value));
  const prevProp = useRef(value);

  // Sync from parent only when it genuinely changed (e.g. after loadData)
  useEffect(() => {
    const normalized = value === null || value === undefined || value === '' ? '' : String(value);
    if (normalized !== String(prevProp.current ?? '')) {
      setLocal(normalized);
      prevProp.current = value;
    }
  }, [value]);

  const handleBlur = () => {
    const normalized = value === null || value === undefined || value === '' ? '' : String(value);
    if (local !== normalized) {
      onSave(local);
    }
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      className="editable-input"
      style={inputStyle}
      value={local}
      placeholder="—"
      onChange={e => setLocal(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
