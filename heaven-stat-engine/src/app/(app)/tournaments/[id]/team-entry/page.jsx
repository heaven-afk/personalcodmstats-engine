'use client';
import { useState, useEffect, useCallback, useMemo, Fragment, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTournament } from '../layout';
import { useAuth } from '@/contexts/AuthContext';
import { getTeamMatchResults, saveTeamMatchResult, updateTeamMatchResult, deleteTeamMatchResult, getBonusPoints, addBonusPoint, updateBonusPoint, deleteBonusPoint } from '@/lib/firestore/matchData';
import { getTeamRegistrations, updateTournament } from '@/lib/firestore/tournaments';
import { getGroups, updateGroup } from '@/lib/firestore/groups';
import { computeDailyStandings } from '@/lib/engine/standings';
import { getPlacementPoints } from '@/lib/engine/scoring';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import {
  Save, Plus, Trash2, ChevronDown, ChevronUp, Upload, X, Check,
  FileSpreadsheet, ClipboardPaste, ChevronRight, Camera, AlertCircle,
  AlertTriangle, Lock, Unlock, Sliders, RefreshCw
} from 'lucide-react';
import { getAllSheetsAsCSV, readExcelAsGrid, parseCSVToGrid, getSheetNames } from '@/lib/importers/csvParser';
import { uploadAndParseImage } from '@/lib/importers/ocrClient';
import { matchOcrRowToTeam } from '@/lib/importers/ocrTeamMatcher';
import { cleanTeamName, stringSimilarity } from '@/lib/utils/similarity';
import { AVAILABLE_MAPS } from '@/lib/constants/maps';
import { getActiveMapConfig } from '@/lib/utils/mapConfig';
import { REVIVE_TYPES, getReviveType } from '@/lib/constants/revives';
import { getActiveReviveConfig, getReviveTypeForMatch } from '@/lib/utils/reviveConfig';

// Distinct color per lobby slot (cycles if >6 lobbies)
const LOBBY_COLORS = [
  { text: '#C9A84C', bg: 'rgba(201,168,76,0.12)',  border: 'rgba(201,168,76,0.4)'  }, // gold   L1
  { text: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.4)'  }, // blue   L2
  { text: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.4)'  }, // emerald L3
  { text: '#8b5cf6', bg: 'rgba(139,92,246,0.12)',  border: 'rgba(139,92,246,0.4)'  }, // purple L4
  { text: '#ef4444', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.4)'   }, // red    L5
  { text: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.4)'  }, // amber  L6
];
const lc = (n) => LOBBY_COLORS[(n - 1) % LOBBY_COLORS.length];

// ─── Smart Team Spreadsheet Parser ───────────────────────────────────────────
function parseSmartTeamSpreadsheet(grid, customConfig = null) {
  if (!grid || grid.length === 0) {
    return { lobbies: [], rows: [], columnMappings: {}, config: null };
  }

  const maxCols = grid.reduce((max, row) => Math.max(max, (row || []).length), 0);

  // If custom configuration is provided by the user
  if (customConfig && typeof customConfig === 'object') {
    const teamCol = customConfig.teamCol !== undefined ? parseInt(customConfig.teamCol) : 0;
    const slotCol = customConfig.slotCol !== undefined ? parseInt(customConfig.slotCol) : -1;
    const startRowIndex = Math.max(0, customConfig.startRowIndex !== undefined ? parseInt(customConfig.startRowIndex) : 1);
    const lobbies = customConfig.lobbies || {};

    const parsedRows = [];
    for (let r = startRowIndex; r < grid.length; r++) {
      const rowData = grid[r];
      if (!rowData || rowData.length === 0) continue;

      const rawTeam = teamCol !== -1 && teamCol < rowData.length ? String(rowData[teamCol] || '').trim() : '';
      const tLower = rawTeam.toLowerCase();
      if (
        !rawTeam ||
        rawTeam === '0' ||
        tLower === 'team' ||
        tLower === 'team name' ||
        tLower === 'teams' ||
        tLower === 'clan' ||
        tLower === 'total' ||
        tLower === 'rank' ||
        tLower === 'standing'
      ) {
        continue;
      }

      const teamName = cleanTeamName(rawTeam);
      const slot = slotCol !== -1 && slotCol < rowData.length ? String(rowData[slotCol] || '').trim() : '';

      const stats = {};
      Object.entries(lobbies).forEach(([lobbyNum, cols]) => {
        const pCol = parseInt(cols.placementCol);
        const kCol = parseInt(cols.killsCol);

        const placeVal = pCol !== -1 && pCol < rowData.length ? rowData[pCol] : '';
        const killsVal = kCol !== -1 && kCol < rowData.length ? rowData[kCol] : '';

        const placement = placeVal !== '' && !isNaN(placeVal) ? parseInt(placeVal) : null;
        const kills = killsVal !== '' && !isNaN(killsVal) ? parseInt(killsVal) : null;

        stats[lobbyNum] = { placement, kills };
      });

      parsedRows.push({
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
        teamCol,
        slotCol,
        startRowIndex,
        lobbies
      }
    };
  }

  // Auto-detection mode: find row containing team or lobby headers
  let headerRowIndex = -1;
  let subheaderRowIndex = -1;

  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const row = grid[r] || [];
    const hasTeam = row.some(cell => {
      const clean = String(cell || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return clean === 'teamname' || clean === 'team' || clean === 'clan' || clean === 'teams' || clean === 'org' || clean === 'squad';
    });
    if (hasTeam) {
      headerRowIndex = r;
      break;
    }
  }

  if (headerRowIndex === -1) {
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const row = grid[r] || [];
      const hasHeaderCell = row.some(cell => {
        const clean = String(cell || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return (
          clean === 'slot' ||
          clean === 'clan' ||
          clean.startsWith('lobby') ||
          clean.startsWith('game') ||
          clean.startsWith('match') ||
          (clean.startsWith('l') && /^\d+$/.test(clean.substring(1)))
        );
      });
      if (hasHeaderCell) {
        headerRowIndex = r;
        break;
      }
    }
  }

  if (headerRowIndex === -1) {
    headerRowIndex = 0;
  }

  const nextRow = grid[headerRowIndex + 1] || [];
  const hasSubheaders = nextRow.some(cell => {
    const cleanSub = String(cell || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return (
      cleanSub.includes('pos') ||
      cleanSub.includes('place') ||
      cleanSub.includes('placement') ||
      cleanSub.includes('rank') ||
      cleanSub.includes('position') ||
      cleanSub.includes('kills') ||
      cleanSub.includes('kill') ||
      cleanSub.includes('pts') ||
      cleanSub.includes('points') ||
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
        clean.includes('placement') ||
        clean.includes('place') ||
        clean.includes('pos') ||
        clean.includes('rank') ||
        clean.includes('kills') ||
        clean.includes('kill') ||
        clean.startsWith('lobby') ||
        clean.startsWith('game') ||
        clean.startsWith('match')
      );
    });
    if (hasCategoryLabels) {
      superHeaderRowIndex = headerRowIndex - 1;
    }
  }

  const headerRow = grid[headerRowIndex] || [];
  const subheaderRow = subheaderRowIndex !== -1 ? grid[subheaderRowIndex] : [];

  let teamCol = -1;
  let slotCol = -1;
  const lobbies = {};

  const checkTeam = (v) => v === 'teamname' || v === 'team' || v === 'clan' || v === 'org' || v === 'club' || v === 'teams' || v === 'squad';
  const checkSlot = (v) => v === 'slot' || v === 'id' || v === 'no' || v === 'index' || v === 'slotno' || v === '#';

  const getCategory = (clean) => {
    if (
      clean.includes('pos') ||
      clean.includes('place') ||
      clean.includes('placement') ||
      clean.includes('rank') ||
      clean.includes('position') ||
      clean.includes('finish') ||
      clean.includes('standing') ||
      clean === 'p'
    ) return 'placement';
    if (
      clean.includes('kills') ||
      clean.includes('kill') ||
      clean.includes('frag') ||
      clean.includes('frags') ||
      clean.includes('pts') ||
      clean.includes('points') ||
      clean === 'k'
    ) return 'kills';
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
      const isTeamOrSlot = checkTeam(cleanVal) || checkSlot(cleanVal);
      if (!isLobby && isTeamOrSlot) {
        lastHeaderCategory = null;
      }
    }

    if (checkTeam(cleanVal) || (subheaderRowIndex !== -1 && checkTeam(cleanSubVal))) {
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
      const isTeamOrSlot = checkTeam(cleanVal) || checkSlot(cleanVal);
      if (!isStatCategory && isTeamOrSlot) {
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
        lobbies[lobbyNum] = { placementCol: -1, killsCol: -1 };
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
        category = getCategory(checkVal) || 'placement';
      }

      const isCarryForwardFromBlank = topLobbyMatch === null && cleanVal === '' && cleanSubVal === '';

      if (category === 'kills') {
        if (!isCarryForwardFromBlank || lobbies[lobbyNum].killsCol === -1) {
          lobbies[lobbyNum].killsCol = c;
        }
      } else {
        if (!isCarryForwardFromBlank || lobbies[lobbyNum].placementCol === -1) {
          lobbies[lobbyNum].placementCol = c;
        }
      }
    }
  }

  // Fallback for adjacent pairs [Pos, Kills, Pos, Kills] starting after teamCol
  if (Object.keys(lobbies).length === 0) {
    if (teamCol === -1) teamCol = 0;
    let lCount = 1;
    for (let c = teamCol + 1; c < maxCols; c += 2) {
      lobbies[lCount] = {
        placementCol: c,
        killsCol: c + 1 < maxCols ? c + 1 : -1,
      };
      lCount++;
    }
  }

  if (teamCol === -1) teamCol = 0;

  const startRowIndex = Math.max(headerRowIndex, subheaderRowIndex) + 1;
  const parsedRows = [];

  for (let r = startRowIndex; r < grid.length; r++) {
    const rowData = grid[r];
    if (!rowData || rowData.length === 0) continue;

    const rawTeam = String(rowData[teamCol] || '').trim();
    const tLower = rawTeam.toLowerCase();
    if (
      !rawTeam ||
      rawTeam === '0' ||
      tLower === 'team' ||
      tLower === 'team name' ||
      tLower === 'teams' ||
      tLower === 'clan' ||
      tLower === 'total' ||
      tLower === 'rank' ||
      tLower === 'standing'
    ) {
      continue;
    }

    const teamName = cleanTeamName(rawTeam);
    const slot = slotCol !== -1 && slotCol < rowData.length ? String(rowData[slotCol] || '').trim() : '';

    const stats = {};
    Object.entries(lobbies).forEach(([lobbyNum, cols]) => {
      const placeVal = cols.placementCol !== -1 && cols.placementCol < rowData.length ? rowData[cols.placementCol] : '';
      const killsVal = cols.killsCol !== -1 && cols.killsCol < rowData.length ? rowData[cols.killsCol] : '';

      const placement = placeVal !== '' && !isNaN(placeVal) ? parseInt(placeVal) : null;
      const kills = killsVal !== '' && !isNaN(killsVal) ? parseInt(killsVal) : null;

      stats[lobbyNum] = { placement, kills };
    });

    parsedRows.push({
      parsedTeam: teamName,
      parsedSlot: slot,
      stats,
    });
  }

  // Ensure default lobby 1 exists if none detected
  if (Object.keys(lobbies).length === 0) {
    lobbies[1] = { placementCol: -1, killsCol: -1 };
  }

  return {
    lobbies: Object.keys(lobbies).map(Number).sort((a, b) => a - b),
    rows: parsedRows,
    columnMappings: lobbies,
    config: {
      teamCol,
      slotCol,
      startRowIndex,
      lobbies
    }
  };
}

// ─── Smart Team Matcher Utility ───────────────────────────────────────────
function findBestTeamMatch(parsedTeam, parsedSlot, regs = []) {
  if (!parsedTeam && !parsedSlot) {
    return { matchedTeamId: null, matchedTeamName: 'Unmatched', confidence: 'none' };
  }

  const cleanStr = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pTeamClean = cleanStr(parsedTeam);
  const pSlotNum = parsedSlot ? parseInt(parsedSlot) : null;

  // 1. Slot Number Match
  if (pSlotNum && !isNaN(pSlotNum)) {
    const slotMatch = regs.find(r => Number(r.slot) === pSlotNum);
    if (slotMatch) {
      return {
        matchedTeamId: slotMatch.teamId,
        matchedTeamName: slotMatch.teamName,
        confidence: 'high',
      };
    }
  }

  // 2. Exact or Normalized Name Match
  for (const reg of regs) {
    const regTeamClean = cleanStr(reg.teamName);
    const regClanClean = cleanStr(reg.clanName);
    if (pTeamClean && (pTeamClean === regTeamClean || pTeamClean === regClanClean)) {
      return {
        matchedTeamId: reg.teamId,
        matchedTeamName: reg.teamName,
        confidence: 'high',
      };
    }
  }

  // 3. Substring Inclusion Match
  for (const reg of regs) {
    const regTeamClean = cleanStr(reg.teamName);
    if (pTeamClean && regTeamClean && pTeamClean.length >= 3 && regTeamClean.length >= 3) {
      if (pTeamClean.includes(regTeamClean) || regTeamClean.includes(pTeamClean)) {
        return {
          matchedTeamId: reg.teamId,
          matchedTeamName: reg.teamName,
          confidence: 'medium',
        };
      }
    }
  }

  // 4. Fuzzy Similarity Match
  let bestMatch = null;
  let maxSim = 0;
  for (const reg of regs) {
    const regTeamClean = cleanStr(reg.teamName);
    const sim = stringSimilarity(pTeamClean, regTeamClean);
    if (sim > maxSim) {
      maxSim = sim;
      bestMatch = reg;
    }
  }

  if (bestMatch && maxSim >= 0.70) {
    return {
      matchedTeamId: bestMatch.teamId,
      matchedTeamName: bestMatch.teamName,
      confidence: maxSim >= 0.85 ? 'high' : 'medium',
    };
  }

  return {
    matchedTeamId: null,
    matchedTeamName: parsedTeam || 'Unmatched',
    confidence: 'none',
  };
}

export default function TeamEntryPage() {
  const { id } = useParams();
  const { tournament, refresh: refreshLayout } = useTournament();
  const { user, isOwner, isOperator } = useAuth();
  const [day, setDay] = useState(1);
  const [teamRegs, setTeamRegs] = useState([]);
  const [allResults, setAllResults] = useState([]);
  const [allBonus, setAllBonus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRef, setShowRef] = useState(false);
  const [saving, setSaving] = useState({});

  const userEmail = user?.email?.toLowerCase();
  const isCreator = (tournament?.createdBy && tournament.createdBy === user?.uid) ||
    (userEmail && tournament?.creatorEmail && tournament.creatorEmail.toLowerCase() === userEmail);
  const isAssigned = (tournament?.editorUids || []).some(
    e => e === user?.uid || (userEmail && e.toLowerCase() === userEmail)
  );
  const canEdit = Boolean(isOwner || isCreator || isAssigned);

  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');

  const isQualifier = tournament?.type === 'qualifier';

  // Lock state — persisted per tournament + day in localStorage
  const lockKey = id ? `lock_team_${id}_day${day}` : null;
  const [isLocked, setIsLocked] = useState(false);

  // Read lock from localStorage whenever day changes
  useEffect(() => {
    if (!lockKey) return;
    try { setIsLocked(localStorage.getItem(lockKey) === 'true'); } catch {}
  }, [lockKey]);

  const handleLock = async () => {
    if (!canEdit) return;
    // Save all pending cell data before locking
    toast.loading('Saving before lock...');
    try { await refresh(); } catch {}
    toast.dismiss();
    try { localStorage.setItem(lockKey, 'true'); } catch {}
    setIsLocked(true);
    toast.success('Day ' + day + ' data locked 🔒');
  };

  const handleUnlock = () => {
    if (!canEdit) return;
    try { localStorage.removeItem(lockKey); } catch {}
    setIsLocked(false);
    toast.success('Day ' + day + ' unlocked 🔓');
  };

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
  const [smartImportTargetDay, setSmartImportTargetDay] = useState(day);

  // Sync smartImportTargetDay when day changes
  useEffect(() => {
    setSmartImportTargetDay(day);
  }, [day]);

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

  // OCR States
  const [ocrQueue, setOcrQueue] = useState([]);
  const [ocrQueueActiveIndex, setOcrQueueActiveIndex] = useState(null);
  const [lobbyPreviews, setLobbyPreviews] = useState({});
  const [isOcrMode, setIsOcrMode] = useState(false);
  const [ocrConcurrency, setOcrConcurrency] = useState(4);
  const ocrFileRef = useRef(null);

  const refresh = useCallback(async () => {
    if (typeof refreshLayout === 'function') {
      try { await refreshLayout(); } catch {}
    }
    const [regs, results, bonus, gList] = await Promise.all([
      getTeamRegistrations(id),
      getTeamMatchResults(id),
      getBonusPoints(id),
      getGroups(id),
    ]);
    setTeamRegs(regs);
    setAllResults(results);
    setAllBonus(bonus);
    setGroups(gList);
    if (gList.length > 0 && (!selectedGroupId || !gList.some(g => g.id === selectedGroupId))) {
      setSelectedGroupId(gList[0].id);
    }
  }, [id, selectedGroupId, refreshLayout]);

  useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh]);

  const hasGroups = groups.length > 0;
  const selectedGroup = hasGroups ? groups.find(g => g.id === selectedGroupId) : null;
  const activeStructure = (selectedGroup?.structure) || (tournament?.structure || {});
  const activeMapConfig = getActiveMapConfig(tournament, selectedGroup);
  const activeReviveConfig = getActiveReviveConfig(tournament, selectedGroup);
  const totalDays = activeStructure.totalDays || 6;
  const lobbiesPerDay = activeStructure.lobbiesPerDay || 4;
  const { scoring = {} } = tournament;
  const { killPointValue = 2, placementPoints = [], bonusTypes = [] } = scoring;

  const activeTeamRegs = useMemo(() => {
    if (!selectedGroupId) return teamRegs;
    return teamRegs.filter(r => r.groupId === selectedGroupId);
  }, [teamRegs, selectedGroupId]);

  const activeResults = useMemo(() => {
    if (!selectedGroupId) return allResults;
    return allResults.filter(r => r.groupId === selectedGroupId);
  }, [allResults, selectedGroupId]);

  const activeBonus = useMemo(() => {
    if (!selectedGroupId) return allBonus;
    return allBonus.filter(b => b.groupId === selectedGroupId);
  }, [allBonus, selectedGroupId]);

  // Smart Spreadsheet Processor
  const handleProcessGrid = useCallback((grid, fileName) => {
    if (!grid || grid.length === 0) {
      toast.error('Failed to parse sheet data.');
      return;
    }

    setSmartImportGrid(grid);
    const { lobbies, rows, columnMappings, config } = parseSmartTeamSpreadsheet(grid);

    if (rows.length === 0) {
      const fallbackConfig = config || {
        teamCol: 0,
        slotCol: -1,
        startRowIndex: 1,
        lobbies: { 1: { placementCol: -1, killsCol: -1 } }
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
      toast('Could not automatically match all columns. Please map your spreadsheet columns below.', { icon: 'ℹ️' });
      return;
    }

    const previewRows = rows.map((row, idx) => {
      const match = findBestTeamMatch(row.parsedTeam, row.parsedSlot, activeTeamRegs);
      return {
        id: idx,
        parsedTeam: row.parsedTeam,
        parsedSlot: row.parsedSlot,
        matchedTeamId: match ? match.matchedTeamId : null,
        matchedTeamName: match ? match.matchedTeamName : 'Unmatched',
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
  }, [activeTeamRegs]);

  const handleProcessPasteText = useCallback((textToProcess) => {
    const raw = (textToProcess !== undefined ? textToProcess : pasteText).trim();
    if (!raw) {
      toast.error('Please paste some spreadsheet data first.');
      return;
    }

    const delimiter = raw.includes('\t') ? '\t' : (raw.includes(',') ? ',' : (raw.includes(';') ? ';' : ' '));
    const grid = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      .filter(l => l.trim().length > 0)
      .map(r => r.split(delimiter).map(cell => cell.trim()));

    handleProcessGrid(grid, 'Pasted Data');
  }, [pasteText, handleProcessGrid]);

  const handleSaveAndReloadMapping = () => {
    if (!smartImportGrid || smartImportGrid.length === 0) {
      toast.error('No spreadsheet data loaded to reload.');
      return;
    }
    if (!mappingDraft) return;

    try {
      const { lobbies, rows, columnMappings, config } = parseSmartTeamSpreadsheet(smartImportGrid, mappingDraft);
      if (rows.length === 0) {
        toast.error('No valid team records found with this mapping. Please verify the Start Row and Team Name column.');
        return;
      }

      const previewRows = rows.map((row, idx) => {
        const match = findBestTeamMatch(row.parsedTeam, row.parsedSlot, activeTeamRegs);
        return {
          id: idx,
          parsedTeam: row.parsedTeam,
          parsedSlot: row.parsedSlot,
          matchedTeamId: match ? match.matchedTeamId : null,
          matchedTeamName: match ? match.matchedTeamName : 'Unmatched',
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
      toast.success('Spreadsheet preview reloaded with updated column mappings!');
    } catch (err) {
      console.error('Failed to reload mapping:', err);
      toast.error('Failed to reload mapping: ' + err.message);
    }
  };

  const handleCancelSmartImport = () => {
    setSmartImportGrid(null);
    setSmartImportRows([]);
    setSmartImportConfig(null);
    setMappingDraft(null);
    setIsEditingMapping(false);
    setSmartImportFileName('');
  };

  const handleConfirmSmartImport = async () => {
    if (!canEdit) {
      toast.error('You do not have permission to edit this tournament');
      return;
    }
    if (smartImportRows.length === 0) {
      toast.error('No team rows to import.');
      return;
    }
    if (smartImportSelectedLobbies.length === 0) {
      toast.error('Please select at least one lobby to import.');
      return;
    }

    setParsing(true);
    let addedCount = 0;
    let updatedCount = 0;

    try {
      for (const row of smartImportRows) {
        if (!row.matchedTeamId) continue;

        for (const lobbyNum of smartImportSelectedLobbies) {
          const lobbyStat = row.stats?.[lobbyNum];
          if (!lobbyStat) continue;

          const placement = lobbyStat.placement;
          const kills = lobbyStat.kills;

          if (placement === null && kills === null) continue;

          const existing = allResults.find(r =>
            r.teamId === row.matchedTeamId &&
            Number(r.day) === Number(smartImportTargetDay) &&
            Number(r.lobby) === Number(lobbyNum) &&
            (selectedGroupId ? r.groupId === selectedGroupId : true)
          );

          if (existing) {
            await updateTeamMatchResult(id, existing.id, {
              placement: placement !== null ? placement : existing.placement,
              kills: kills !== null ? kills : existing.kills,
            });
            updatedCount++;
          } else {
            await saveTeamMatchResult(id, {
              teamId: row.matchedTeamId,
              teamName: row.matchedTeamName || row.parsedTeam,
              day: smartImportTargetDay,
              lobby: lobbyNum,
              placement: placement !== null ? placement : 0,
              kills: kills !== null ? kills : 0,
              reviveType: getReviveTypeForMatch(activeReviveConfig, smartImportTargetDay, lobbyNum),
              ...(selectedGroupId ? { groupId: selectedGroupId } : {})
            });
            addedCount++;
          }
        }
      }

      toast.success(`Successfully imported Day ${smartImportTargetDay} results! Added ${addedCount}, updated ${updatedCount} records.`);
      handleCancelSmartImport();
      await refresh();
    } catch (err) {
      console.error('Failed to save imported smart results:', err);
      toast.error('Failed to save imported results: ' + err.message);
    } finally {
      setParsing(false);
    }
  };

  const handleFlexibleMapChange = async (lobbyNum, newMap) => {
    if (!canEdit) return;
    const currentConfig = activeMapConfig || { mode: 'flexible', map: AVAILABLE_MAPS[0], schedule: {} };
    const currentSchedule = currentConfig.schedule || {};
    const key = `day${day}_lobby${lobbyNum}`;
    const updatedSchedule = {
      ...currentSchedule,
      [key]: newMap,
    };
    const updatedConfig = {
      ...currentConfig,
      mode: currentConfig.mode || 'flexible',
      schedule: updatedSchedule,
    };
    Object.keys(updatedConfig).forEach(k => {
      if (updatedConfig[k] === undefined) {
        delete updatedConfig[k];
      }
    });

    try {
      if (isQualifier && selectedGroupId) {
        await updateGroup(id, selectedGroupId, { mapConfig: updatedConfig });
      } else {
        await updateTournament(id, { mapConfig: updatedConfig });
      }
      toast.success(`Day ${day} Lobby ${lobbyNum} Map set to ${newMap}`);
      await refresh();
    } catch (err) {
      toast.error('Failed to update map schedule: ' + err.message);
    }
  };

  const handleFlexibleReviveChange = async (lobbyNum, newRevive) => {
    if (!canEdit) return;
    const currentConfig = activeReviveConfig || { mode: 'flexible', reviveType: REVIVE_TYPES[0]?.id || 'auto', schedule: {} };
    const currentSchedule = currentConfig.schedule || {};
    const key = `day${day}_lobby${lobbyNum}`;
    const updatedSchedule = {
      ...currentSchedule,
      [key]: newRevive,
    };
    const updatedReviveConfig = {
      ...currentConfig,
      mode: currentConfig.mode || 'flexible',
      reviveType: currentConfig.reviveType || 'auto',
      schedule: updatedSchedule,
    };
    delete updatedReviveConfig.defaultType;
    Object.keys(updatedReviveConfig).forEach(k => {
      if (updatedReviveConfig[k] === undefined) {
        delete updatedReviveConfig[k];
      }
    });

    try {
      if (isQualifier && selectedGroupId) {
        await updateGroup(id, selectedGroupId, { reviveConfig: updatedReviveConfig });
      } else {
        await updateTournament(id, { reviveConfig: updatedReviveConfig });
      }
      toast.success(`Day ${day} Lobby ${lobbyNum} Revive Type set to ${getReviveType(newRevive).label}`);
      await refresh();
    } catch (err) {
      toast.error('Failed to update revive schedule: ' + err.message);
    }
  };

  // Build a lookup: teamId → lobbyNum → { result }
  const dayResults = useMemo(() => activeResults.filter(r => r.day === day), [activeResults, day]);
  const dayBonus = useMemo(() => activeBonus.filter(b => b.day === day), [activeBonus, day]);

  const getResult = (teamId, lobby) => dayResults.find(r => r.teamId === teamId && r.lobby === lobby);

  const handleCellSave = async (teamId, lobby, field, value) => {
    if (isLocked || !canEdit) {
      if (!canEdit) toast.error('You do not have permission to edit this tournament');
      return;
    }
    const key = `${teamId}-${lobby}-${field}`;
    setSaving(s => ({ ...s, [key]: true }));
    try {
      const existing = getResult(teamId, lobby);
      const numVal = Number(value) || 0;
      if (existing) {
        await updateTeamMatchResult(id, existing.id, { [field]: numVal });
        // Optimistic local update — avoid full refresh on every cell blur
        setAllResults(prev => prev.map(r =>
          r.id === existing.id ? { ...r, [field]: numVal } : r
        ));
      } else {
        const saved = await saveTeamMatchResult(id, {
          teamId,
          teamName: activeTeamRegs.find(t => t.teamId === teamId)?.teamName || teamId,
          day,
          lobby,
          placement: 0,
          kills: 0,
          reviveType: getReviveTypeForMatch(activeReviveConfig, day, lobby),
          [field]: numVal,
          ...(isQualifier && selectedGroupId ? { groupId: selectedGroupId } : {})
        });
        setAllResults(prev => [...prev, saved]);
      }
    } catch (e) { toast.error(e.message); await refresh(); }
    finally { setSaving(s => ({ ...s, [key]: false })); }
  };

  const handleFileChange = async (e) => {
    if (!canEdit) {
      toast.error('You do not have permission to edit this tournament');
      return;
    }
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validExt = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!validExt) { toast.error('Only .xlsx, .xls, or .csv files are supported'); return; }

    setImportingFile(true);
    try {
      if (/\.csv$/i.test(file.name)) {
        const text = await file.text();
        const grid = parseCSVToGrid(text);
        handleProcessGrid(grid, file.name);
      } else {
        const names = await getSheetNames(file);
        if (names.length === 1) {
          const grid = await readExcelAsGrid(file, names[0]);
          handleProcessGrid(grid, `${file.name} (${names[0]})`);
        } else {
          setSheetModal({ file, sheets: names, fileName: file.name });
        }
      }
    } catch (err) {
      console.error('Failed to read file:', err);
      toast.error('Failed to read file: ' + err.message);
    } finally {
      setImportingFile(false);
    }
  };

  const handleSheetSelect = async (sheetName) => {
    if (!canEdit) {
      toast.error('You do not have permission to edit this tournament');
      return;
    }
    if (!sheetModal?.file) return;
    try {
      setImportingFile(true);
      const grid = await readExcelAsGrid(sheetModal.file, sheetName);
      handleProcessGrid(grid, `${sheetModal.fileName} (${sheetName})`);
      setSheetModal(null);
    } catch (err) {
      console.error('Failed to read selected sheet:', err);
      toast.error('Failed to read sheet: ' + err.message);
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

    // Pool-based concurrency runner — distributes images across 2 Gemini API keys for 2x throughput
    const runPool = async (tasks, concurrency) => {
      const results = [];
      let idx = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (idx < tasks.length) {
          const current = idx++;
          await tasks[current]();
        }
      });
      await Promise.all(workers);
      return results;
    };

    const tasks = pendingItems.map((item, taskIdx) => async () => {
      const keyIndex = taskIdx % 2; // Alternate: even images → key1, odd images → key2
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

        const data = await uploadAndParseImage(item.file, item.lobby, 'team', keyIndex, { tournamentId: id });

        const mappedRows = (data.rows || []).map(row => {
          const matchResult = matchOcrRowToTeam(row, activeTeamRegs);
          return {
            placement: parseInt(row.rank) || 0,
            slot: row.slot || '',
            ocrTeamName: row.teamName || '',
            kills: row.kills === null || row.kills === undefined ? null : (parseInt(row.kills) || 0),
            teamId: matchResult.teamId,
            teamName: matchResult.teamName || row.teamName || row.slot || '',
            matchMethod: matchResult.matchMethod,
            confidence: matchResult.confidence,
            sourceLine: `Rank: ${row.rank}, Slot: ${row.slot || ''}, Team: ${row.teamName || ''}, Kills: ${row.kills}`
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
        
        let updatedRow = { ...row, [field]: val };
        
        if (field === 'teamId') {
          const selectedTeam = activeTeamRegs.find(t => t.teamId === val);
          if (selectedTeam) {
            updatedRow.teamId = selectedTeam.teamId;
            updatedRow.teamName = selectedTeam.teamName;
            updatedRow.matchMethod = 'manual';
          } else {
            updatedRow.teamId = null;
            updatedRow.teamName = updatedRow.ocrTeamName || updatedRow.slot || '';
            updatedRow.matchMethod = null;
          }
        } else if (field === 'slot' || field === 'ocrTeamName') {
          const matchResult = matchOcrRowToTeam(
            { ...updatedRow, slot: updatedRow.slot, teamName: updatedRow.ocrTeamName },
            activeTeamRegs
          );
          if (matchResult.teamId) {
            updatedRow.teamId = matchResult.teamId;
            updatedRow.teamName = matchResult.teamName;
            updatedRow.matchMethod = matchResult.matchMethod;
          }
        } else if (field === 'placement') {
          updatedRow.placement = parseInt(val) || 0;
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

    const validResults = lobbyData.results.filter(r => r.teamId !== null);
    if (validResults.length === 0) {
      toast.error('No valid matches with registered teams to save.');
      return;
    }

    setParsing(true);
    try {
      let updatedCount = 0;
      let addedCount = 0;

      // Use a local copy of dayResults to track saves synchronously and avoid duplicate creations
      const tempDayResults = [...dayResults];

      for (const row of validResults) {
        // Find all existing entries for this team and lobby
        const existingIdxs = [];
        tempDayResults.forEach((r, idx) => {
          if (r.teamId === row.teamId && r.lobby === lobbyNum) {
            existingIdxs.push(idx);
          }
        });

        const payload = {
          teamId: row.teamId,
          teamName: row.teamName,
          day,
          lobby: lobbyNum,
          placement: row.placement,
          kills: row.kills === null ? 0 : row.kills,
          inputMethod: 'ocr',
          ...(selectedGroupId ? { groupId: selectedGroupId } : {})
        };

        if (existingIdxs.length > 0) {
          // Update the first existing document
          const firstIdx = existingIdxs[0];
          const existing = tempDayResults[firstIdx];
          await updateTeamMatchResult(id, existing.id, payload);
          tempDayResults[firstIdx] = { ...existing, ...payload };
          updatedCount++;

          // Delete any extra duplicate documents
          for (let i = 1; i < existingIdxs.length; i++) {
            const idxToDelete = existingIdxs[i];
            const extraDoc = tempDayResults[idxToDelete];
            await deleteTeamMatchResult(id, extraDoc.id);
          }

          // Re-filter tempDayResults to remove the extra deleted documents
          if (existingIdxs.length > 1) {
            const idsToDelete = new Set(existingIdxs.slice(1).map(idx => tempDayResults[idx].id));
            let filtered = tempDayResults.filter(r => !idsToDelete.has(r.id));
            tempDayResults.length = 0;
            tempDayResults.push(...filtered);
          }
        } else {
          const saved = await saveTeamMatchResult(id, payload);
          tempDayResults.push(saved);
          addedCount++;
        }
      }

      toast.success(`Lobby ${lobbyNum} saved! Added ${addedCount}, updated ${updatedCount} records.`);
      
      setLobbyPreviews(prev => ({
        ...prev,
        [lobbyNum]: {
          ...prev[lobbyNum],
          isConfirmed: true
        }
      }));
      
      await refresh();
    } catch (err) {
      toast.error(`Failed to save Lobby ${lobbyNum}: ` + err.message);
    } finally {
      setParsing(false);
    }
  };

  function mergeLobbyRows(rowsList) {
    if (!rowsList || rowsList.length === 0) return [];

    // Helper to calculate quality score for picking the clearer entry
    const getQualityScore = (row) => {
      let score = 0;
      if (row.teamId) score += 50;
      if (row.kills !== null && row.kills !== undefined) score += 30;
      if (row.placement > 0) score += 20;
      if (row.confidence) score += Math.round((row.confidence || 0) * 10);
      return score;
    };

    // Stage 1: Deduplicate by teamId / slot / teamName
    const teamMap = new Map();
    rowsList.forEach(row => {
      const teamKey = row.teamId
        ? `team_${row.teamId}`
        : (row.slot ? `slot_${row.slot.toLowerCase().trim()}` : (row.ocrTeamName ? `name_${row.ocrTeamName.toLowerCase().trim()}` : null));

      if (!teamKey) {
        teamMap.set(`unmatched_${Math.random()}`, row);
        return;
      }

      if (!teamMap.has(teamKey)) {
        teamMap.set(teamKey, row);
      } else {
        const existing = teamMap.get(teamKey);
        if (getQualityScore(row) > getQualityScore(existing)) {
          teamMap.set(teamKey, row);
        }
      }
    });

    // Stage 2: Deduplicate by placement rank if multiple entries claim the same rank
    const rankMap = new Map();
    Array.from(teamMap.values()).forEach(row => {
      const rankKey = row.placement;
      if (rankKey <= 0) {
        rankMap.set(`norank_${Math.random()}`, row);
      } else if (!rankMap.has(rankKey)) {
        rankMap.set(rankKey, row);
      } else {
        const existing = rankMap.get(rankKey);
        if (getQualityScore(row) > getQualityScore(existing)) {
          rankMap.set(rankKey, row);
        }
      }
    });

    return Array.from(rankMap.values()).sort((a, b) => (a.placement || 999) - (b.placement || 999));
  }

  // Reactivity to update and merge lobbyPreviews automatically
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
        const merged = mergeLobbyRows(groups[lobbyStr]);
        
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
  }, [ocrQueue, activeTeamRegs]);

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

  // Compute live standings for right panel
  const standingsData = useMemo(() => {
    const enriched = [...dayResults.map(r => ({
      ...r,
      teamName: activeTeamRegs.find(t => t.teamId === r.teamId)?.teamName || r.teamId,
      clanName: activeTeamRegs.find(t => t.teamId === r.teamId)?.clanName || '',
    }))];

    // For any registered team that doesn't have any results in enriched,
    // inject a dummy result so they appear in computeDailyStandings
    for (const reg of activeTeamRegs) {
      const hasResult = enriched.some(r => r.teamId === reg.teamId);
      if (!hasResult) {
        enriched.push({
          teamId: reg.teamId,
          teamName: reg.teamName,
          clanName: reg.clanName || '',
          day,
          lobby: 1,
          placement: 0,
          kills: 0,
          damage: 0,
        });
      }
    }

    return computeDailyStandings(enriched, dayBonus, scoring, day);
  }, [dayResults, dayBonus, activeTeamRegs, scoring, day]);

  if (loading) return <LoadingSpinner size="lg" text="Loading team data..." />;

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
              Select which sheet contains the match results:
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
      <div className="page-header">
        <div>
          <h1 className="page-title">Team Entry</h1>
          <p className="page-subtitle">Match data entry · {tournament.name}</p>
        </div>
      </div>

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
          <span><strong>Read-Only Mode:</strong> You have view access to this tournament. Team match results and imports cannot be edited until an administrator grants you editor permissions.</span>
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

      {/* Day selector */}
      <div className="tab-bar" style={{ marginBottom: 20 }}>
        {Array.from({ length: totalDays }, (_, i) => i + 1).map(d => (
          <button key={d} className={`tab ${day === d ? 'active' : ''}`} onClick={() => setDay(d)}>
            Day {d}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 20 }}>
        {/* Main entry table */}
        <div>
          {/* Collapsible reference panel */}
          <div className="card" style={{ marginBottom: 16 }}>
            <button
              className="flex-between"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setShowRef(v => !v)}
            >
              <span className="card-title">Point System Reference</span>
              {showRef ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {showRef && (
              <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {placementPoints.map(pp => (
                  <div key={pp.position} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', background: 'var(--bg-alt-row)', borderRadius: 6, fontSize: '0.8rem', gap: 10 }}>
                    <span style={{ color: 'var(--text-muted)' }}>#{pp.position}</span>
                    <span style={{ fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{pp.points}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="data-table-container">
            <div className="data-table-toolbar">
              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Day {day} — Match Entry</span>
              <span className="data-table-count">{activeTeamRegs.length} teams</span>
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
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                {canEdit && !isLocked && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowPaste(v => !v)}
                    title="Copy and paste results from Excel / Google Sheets"
                  >
                    <ClipboardPaste size={13} style={{ marginRight: 6 }} /> Paste or Upload Day Results
                  </button>
                )}
                {canEdit && (isLocked ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleUnlock}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Unlock size={13} /> Unlock Day {day}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleLock}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Lock size={13} /> Save & Lock Day {day}
                  </button>
                ))}
              </div>
            </div>

            {/* Paste Data Panel — hidden when locked or read-only */}
            {showPaste && !isLocked && canEdit && (
              <div className="card" style={{ margin: '12px 16px', border: '1px solid var(--border-gold)', background: 'rgba(201,168,76,0.02)' }}>
                <div className="flex-between" style={{ marginBottom: 10 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--gold)' }}>
                    Paste or Upload Day {day} Results
                  </span>
                  <button onClick={() => { setShowPaste(false); setPasteText(''); handleOcrClear(); }} style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
                    <X size={15} />
                  </button>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                  Paste columns copied from Excel (Team Name, L1 Placement, L1 Kills, L2 Placement, L2 Kills...) or upload a CSV or Excel file or scan an image.
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
                      placeholder={`Example:\nTeam Alpha\t1\t12\t3\t8\nTeam Beta\t5\t2\t1\t15`}
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
                      onClick={(e) => e.stopPropagation()}
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
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>

                {!isOcrMode && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleProcessPasteText(pasteText)}
                      disabled={!pasteText.trim()}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                    >
                      <Sliders size={14} /> Preview & Map Spreadsheet Columns
                    </button>
                    {pasteText.trim() && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setPasteText('')}
                      >
                        Clear
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setShowPaste(false); setPasteText(''); handleOcrClear(); }}
                    >
                      Cancel
                    </button>
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
                              type="button"
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
                              {item.status === 'error' && (
                                <span style={{ color: 'var(--danger)' }} title={item.errorMessage}>
                                  Failed: {item.errorMessage}
                                </span>
                              )}
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
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleOcrProcessAll}
                        disabled={parsing || ocrQueue.filter(item => item.status === 'pending' || item.status === 'error').length === 0}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                      >
                        <Camera size={14} /> Extract Stats with Vision ({ocrQueue.filter(item => item.status === 'pending' || item.status === 'error').length})
                      </button>
                      <button
                        type="button"
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.86rem', color: 'var(--gold)' }}>Lobby Results Preview:</span>
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
                              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: lc(lobbyData.lobby).text }}>
                                Lobby #{lobbyData.lobby} Scoreboard ({lobbyData.results.length} teams)
                              </span>
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
                                    type="button"
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
                                    type="button"
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
                                  <th style={{ width: 80 }}>Rank</th>
                                  <th style={{ width: 100 }}>Slot</th>
                                  <th>Matched Team Name</th>
                                  <th style={{ width: 100 }}>Kills</th>
                                  <th style={{ width: 50 }}></th>
                                </tr>
                              </thead>
                              <tbody>
                                {lobbyData.results.map((row, idx) => {
                                  const isNullKills = row.kills === null;
                                  const isUnmatched = !row.teamId;

                                  return (
                                    <tr key={idx} style={{
                                      background: isNullKills ? 'rgba(245, 158, 11, 0.08)' : isUnmatched ? 'rgba(239, 68, 68, 0.08)' : undefined
                                    }}>
                                      <td>
                                        {isEditing ? (
                                          <input
                                            type="number"
                                            className="editable-input"
                                            style={{ width: 60, fontSize: '0.75rem', padding: '2px 4px' }}
                                            value={row.placement}
                                            onChange={e => handleLobbyCellChange(lobbyData.lobby, idx, 'placement', e.target.value)}
                                          />
                                        ) : (row.placement === 1 ? '🏆 1st' : `#${row.placement}`)}
                                      </td>
                                      <td>
                                        {isEditing ? (
                                          <input
                                            type="text"
                                            className="editable-input"
                                            style={{ width: 80, fontSize: '0.75rem', padding: '2px 4px' }}
                                            value={row.slot || ''}
                                            onChange={e => handleLobbyCellChange(lobbyData.lobby, idx, 'slot', e.target.value)}
                                          />
                                        ) : (row.slot || '—')}
                                      </td>
                                      <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                          <select
                                            className="editable-input"
                                            style={{
                                              flex: 1,
                                              minWidth: 160,
                                              fontSize: '0.75rem',
                                              padding: '2px 6px',
                                              fontWeight: 600,
                                              color: isUnmatched ? 'var(--danger)' : 'var(--text-primary)',
                                              borderColor: isUnmatched ? 'var(--danger)' : 'var(--border-md)',
                                              background: isUnmatched ? 'rgba(239,68,68,0.06)' : undefined
                                            }}
                                            value={row.teamId || ''}
                                            onChange={e => handleLobbyCellChange(lobbyData.lobby, idx, 'teamId', e.target.value)}
                                          >
                                            <option value="">-- Select Registered Team --</option>
                                            {activeTeamRegs.map(t => (
                                              <option key={t.teamId} value={t.teamId}>
                                                {t.slot ? `[Slot ${t.slot}] ` : ''}{t.teamName} {t.clanName ? `(${t.clanName})` : ''}
                                              </option>
                                            ))}
                                          </select>

                                          {/* Match Status Badge */}
                                          {row.matchMethod === 'slot' && (
                                            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(201,168,76,0.15)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)', fontWeight: 600 }} title="Matched by Slot Number">
                                              Slot Match
                                            </span>
                                          )}
                                          {row.matchMethod === 'exact' && (
                                            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(16,185,129,0.15)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.3)', fontWeight: 600 }} title="Matched by Exact Name">
                                              Exact Name
                                            </span>
                                          )}
                                          {row.matchMethod === 'fuzzy' && (
                                            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(139,92,246,0.15)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.3)', fontWeight: 600 }} title={`Fuzzy matched (${Math.round((row.confidence || 0) * 100)}% match)`}>
                                              Fuzzy ({Math.round((row.confidence || 0) * 100)}%)
                                            </span>
                                          )}
                                          {row.matchMethod === 'manual' && (
                                            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)', fontWeight: 600 }} title="Manually Selected">
                                              Manual
                                            </span>
                                          )}
                                          {isUnmatched && (
                                            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                              <AlertCircle size={11} /> Unmatched
                                            </span>
                                          )}
                                        </div>
                                      </td>
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
                                            type="button"
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
              </div>
            )}

            {/* ── Smart Team Spreadsheet Import Preview & Column Mapping Interface (Top-Level) ── */}
            {isSmartImportActive && (
              <div className="card" style={{
                margin: '12px 16px',
                border: '2px solid var(--border-gold)',
                background: 'var(--bg-card)',
                padding: '18px 20px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                borderRadius: 12
              }}>
                {/* Header & Controls */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                  borderBottom: '1px solid var(--border)',
                  paddingBottom: 14,
                  marginBottom: 16
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{
                        fontWeight: 800,
                        fontSize: '1rem',
                        color: 'var(--gold)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}>
                        <FileSpreadsheet size={18} />
                        Spreadsheet Import Preview: {smartImportFileName}
                      </span>
                      <span className="badge badge-gold" style={{ fontSize: '0.72rem' }}>
                        {smartImportRows.length} Teams Detected
                      </span>
                      <span className="badge badge-secondary" style={{ fontSize: '0.72rem' }}>
                        {smartImportLobbies.length} Lobbies Detected
                      </span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
                      Review matched teams and lobby stats. You can edit column mappings to customize which columns map to placement and kills.
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
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={handleCancelSmartImport}
                      disabled={parsing}
                    >
                      Cancel Import
                    </button>
                  </div>
                </div>

                {/* Lobby Selection checklist & Mapped Columns Summary */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  padding: '12px 14px',
                  background: 'var(--bg-alt-row)',
                  borderRadius: 8,
                  marginBottom: 16
                }}>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Lobbies to Import:
                    </span>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      {smartImportLobbies.length === 0 ? (
                        <span style={{ fontSize: '0.8rem', color: '#EF4444', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          ⚠️ No Lobby columns were mapped! Please edit column mappings below.
                        </span>
                      ) : (
                        smartImportLobbies.map(l => (
                          <label key={l} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            color: 'var(--text-primary)',
                            fontWeight: 600
                          }}>
                            <input
                              type="checkbox"
                              checked={smartImportSelectedLobbies.includes(l)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSmartImportSelectedLobbies(prev => [...prev, l].sort((a,b) => a - b));
                                } else {
                                  setSmartImportSelectedLobbies(prev => prev.filter(x => x !== l));
                                }
                              }}
                            />
                            <span style={{ color: lc(l).text }}>Lobby {l}</span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>

                  {Object.keys(smartImportColumnMappings).length > 0 && (
                    <div style={{
                      fontSize: '0.72rem',
                      color: 'var(--text-secondary)',
                      borderTop: '1px solid var(--border-md)',
                      paddingTop: 6,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 8
                    }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>Mapped Columns:</span>
                        {Object.entries(smartImportColumnMappings).map(([l, cols]) => (
                          <span key={l} style={{ background: 'var(--bg-card)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-md)' }}>
                            L{l} (Pos: col {cols.placementCol === -1 || cols.placementCol === undefined ? 'None' : cols.placementCol}, Kills: col {cols.killsCol === -1 || cols.killsCol === undefined ? 'None' : cols.killsCol})
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
                          Select which spreadsheet columns map to team info and tournament lobby statistics.
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

                    {/* Section 1: Team & Row Settings */}
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        1. Team & Row Settings
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

                        {/* Team Name Column */}
                        <div>
                          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                            Team Name / Clan Column <span style={{ color: 'var(--gold)' }}>*</span>:
                          </label>
                          <select
                            className="form-input"
                            style={{ width: '100%', fontSize: '0.78rem', padding: '5px 8px', background: 'var(--bg-card)' }}
                            value={mappingDraft?.teamCol ?? 0}
                            onChange={(e) => {
                              const val = parseInt(e.target.value);
                              setMappingDraft(prev => ({ ...prev, teamCol: val }));
                            }}
                          >
                            {availableColumns.map(col => (
                              <option key={col.index} value={col.index}>{col.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Slot Column */}
                        <div>
                          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                            Slot Column (Optional):
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

                    {/* Section 2: Lobby Placement & Kill Column Settings */}
                    <div style={{ borderTop: '1px solid var(--border-md)', paddingTop: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          2. Lobby Placement & Kills Columns
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={() => {
                            setMappingDraft(prev => {
                              const currentLobbies = { ...(prev?.lobbies || {}) };
                              const nextLobbyNum = (Math.max(0, ...Object.keys(currentLobbies).map(Number)) || 0) + 1;
                              currentLobbies[nextLobbyNum] = { placementCol: -1, killsCol: -1 };
                              return { ...prev, lobbies: currentLobbies };
                            });
                          }}
                          style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <Plus size={12} /> Add Lobby
                        </button>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                        {mappingDraft?.lobbies && Object.entries(mappingDraft.lobbies).map(([lobbyNum, cols]) => (
                          <div
                            key={lobbyNum}
                            style={{
                              background: 'var(--bg-card)',
                              border: '1px solid var(--border-md)',
                              borderRadius: 8,
                              padding: '10px 12px'
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ fontWeight: 700, fontSize: '0.8rem', color: lc(Number(lobbyNum)).text }}>
                                Lobby {lobbyNum}
                              </span>
                              {Object.keys(mappingDraft.lobbies).length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMappingDraft(prev => {
                                      const updated = { ...prev.lobbies };
                                      delete updated[lobbyNum];
                                      return { ...prev, lobbies: updated };
                                    });
                                  }}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: 0 }}
                                  title={`Remove Lobby ${lobbyNum}`}
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div>
                                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>
                                  Placement / Rank Column:
                                </label>
                                <select
                                  className="form-input"
                                  style={{ width: '100%', fontSize: '0.72rem', padding: '3px 6px', background: 'var(--bg-alt-row)' }}
                                  value={cols.placementCol ?? -1}
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value);
                                    setMappingDraft(prev => ({
                                      ...prev,
                                      lobbies: {
                                        ...prev.lobbies,
                                        [lobbyNum]: { ...prev.lobbies[lobbyNum], placementCol: val }
                                      }
                                    }));
                                  }}
                                >
                                  <option value="-1">[ None / Not Played ]</option>
                                  {availableColumns.map(col => (
                                    <option key={col.index} value={col.index}>{col.label}</option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>
                                  Kills Column:
                                </label>
                                <select
                                  className="form-input"
                                  style={{ width: '100%', fontSize: '0.72rem', padding: '3px 6px', background: 'var(--bg-alt-row)' }}
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
                                  <option value="-1">[ None / Not Played ]</option>
                                  {availableColumns.map(col => (
                                    <option key={col.index} value={col.index}>{col.label}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setIsEditingMapping(false)}
                      >
                        Cancel
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

                {/* Target Day & Import Actions Bar */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                  padding: '12px 14px',
                  background: 'var(--bg-alt-row)',
                  borderRadius: 8,
                  marginBottom: 14
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Import Destination:
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Target Day:</span>
                      <select
                        className="form-select"
                        style={{ margin: 0, padding: '3px 8px', fontSize: '0.8rem', width: 90 }}
                        value={smartImportTargetDay}
                        onChange={e => setSmartImportTargetDay(Number(e.target.value))}
                      >
                        {Array.from({ length: totalDays }, (_, i) => i + 1).map(d => (
                          <option key={d} value={d}>Day {d}</option>
                        ))}
                      </select>
                    </div>

                    {hasGroups && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Target Group:</span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)' }}>
                          {selectedGroup?.groupName || 'Default Group'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleConfirmSmartImport}
                      disabled={parsing || smartImportRows.filter(r => r.matchedTeamId).length === 0}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                    >
                      {parsing ? (
                        <>
                          <LoadingSpinner size="sm" /> Importing...
                        </>
                      ) : (
                        <>
                          <Check size={14} /> Confirm & Import to Day {smartImportTargetDay}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Live Interactive Preview Table */}
                <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border-md)', borderRadius: 8 }}>
                  <table className="data-table" style={{ fontSize: '0.75rem', width: '100%' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-header)' }}>
                        <th style={{ width: 40 }}>#</th>
                        <th style={{ width: 100 }}>Status</th>
                        <th>Parsed Team Name</th>
                        <th>Matched Registered Team</th>
                        <th style={{ width: 70 }}>Slot</th>
                        {smartImportSelectedLobbies.map(l => (
                          <th key={l} style={{ color: lc(l).text }}>
                            L{l} Pos & Kills
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {smartImportRows.length === 0 ? (
                        <tr>
                          <td colSpan={5 + smartImportSelectedLobbies.length} className="empty-row">
                            No team rows found with this column mapping.
                          </td>
                        </tr>
                      ) : (
                        smartImportRows.map((row, idx) => {
                          const isUnmatched = !row.matchedTeamId;
                          return (
                            <tr
                              key={row.id ?? idx}
                              style={{
                                background: isUnmatched ? 'rgba(239, 68, 68, 0.06)' : undefined
                              }}
                            >
                              <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                              <td>
                                {row.confidence === 'high' && (
                                  <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, background: 'rgba(16,185,129,0.15)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.3)', fontWeight: 700 }}>
                                    Matched
                                  </span>
                                )}
                                {row.confidence === 'medium' && (
                                  <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, background: 'rgba(201,168,76,0.15)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)', fontWeight: 700 }}>
                                    Fuzzy Match
                                  </span>
                                )}
                                {isUnmatched && (
                                  <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.15)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                    <AlertCircle size={10} /> Unmatched
                                  </span>
                                )}
                              </td>
                              <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                {row.parsedTeam || '—'}
                              </td>
                              <td>
                                <select
                                  className="editable-input"
                                  style={{
                                    width: '100%',
                                    fontSize: '0.75rem',
                                    padding: '3px 6px',
                                    background: 'var(--bg-card)',
                                    borderColor: isUnmatched ? 'rgba(239, 68, 68, 0.5)' : undefined
                                  }}
                                  value={row.matchedTeamId || ''}
                                  onChange={(e) => {
                                    const selectedId = e.target.value;
                                    const matched = activeTeamRegs.find(t => t.teamId === selectedId);
                                    setSmartImportRows(prev => prev.map(r =>
                                      r.id === row.id
                                        ? {
                                            ...r,
                                            matchedTeamId: selectedId || null,
                                            matchedTeamName: matched ? matched.teamName : 'Unmatched',
                                            confidence: selectedId ? 'high' : 'none'
                                          }
                                        : r
                                    ));
                                  }}
                                >
                                  <option value="">[ Unmatched / Skip Team ]</option>
                                  {activeTeamRegs.map(t => (
                                    <option key={t.teamId} value={t.teamId}>
                                      {t.teamName} {t.clanName ? `[${t.clanName}]` : ''} {t.slot ? `(Slot ${t.slot})` : ''}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)' }}>
                                {row.parsedSlot || '—'}
                              </td>
                              {smartImportSelectedLobbies.map(l => {
                                const stat = row.stats?.[l];
                                const hasPos = stat?.placement !== null && stat?.placement !== undefined;
                                const hasKills = stat?.kills !== null && stat?.kills !== undefined;
                                return (
                                  <td key={l} style={{ fontFamily: 'var(--font-mono)' }}>
                                    {hasPos || hasKills ? (
                                      <span>
                                        <strong style={{ color: 'var(--text-primary)' }}>
                                          {hasPos ? (stat.placement === 1 ? '🏆 1st' : `#${stat.placement}`) : '—'}
                                        </strong>{' '}
                                        <span style={{ color: lc(l).text, fontWeight: 700 }}>
                                          ({hasKills ? `${stat.kills}k` : '—'})
                                        </span>
                                      </span>
                                    ) : (
                                      <span style={{ color: 'var(--text-muted)' }}>—</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Map Assignment Row */}
            <div style={{
              padding: '12px 18px',
              background: 'var(--bg-alt-row)',
              borderBottom: '1px solid var(--border-md)',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap'
            }}>
              {activeMapConfig?.mode === 'flexible' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--gold)' }}>
                    Map for Day {day}:
                  </span>
                  {Array.from({ length: lobbiesPerDay }, (_, i) => i + 1).map(l => {
                    const val = activeMapConfig?.schedule?.[`day${day}_lobby${l}`] || '';
                    const isUnset = !val;
                    return (
                      <div key={`lobby-map-${l}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                        <span style={{ fontWeight: 700, color: lc(l).text }}>L{l}:</span>
                        <select
                          className="form-select"
                          style={{ fontSize: '0.78rem', padding: '3px 8px', borderColor: isUnset ? 'rgba(245,158,11,0.5)' : undefined }}
                          value={val}
                          onChange={e => handleFlexibleMapChange(l, e.target.value)}
                          disabled={isLocked || !canEdit}
                        >
                          <option value="" disabled={val !== ''}>— Not Set —</option>
                          {AVAILABLE_MAPS.map(m => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        {isUnset && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }} title="Map not explicitly assigned yet">
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
                            Unset
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Map: <strong style={{ color: 'var(--gold)' }}>{activeMapConfig?.map || AVAILABLE_MAPS[0]}</strong> <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>(locked — set in Tournament Configuration)</span>
                </div>
              )}
            </div>

            {/* Revive Type Assignment Row */}
            <div style={{
              padding: '10px 18px',
              background: 'var(--bg-card)',
              borderBottom: '1px solid var(--border-md)',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--gold)' }}>
                  Revive Type for Day {day}:
                </span>
                {Array.from({ length: lobbiesPerDay }, (_, i) => i + 1).map(l => {
                  const currentRevive = getReviveTypeForMatch(activeReviveConfig, day, l);
                  const revMeta = getReviveType(currentRevive);
                  return (
                    <div key={`lobby-revive-${l}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                      <span style={{ fontWeight: 700, color: lc(l).text }}>L{l}:</span>
                      <select
                        className="form-select"
                        style={{
                          fontSize: '0.78rem',
                          padding: '3px 8px',
                          color: revMeta.color,
                          borderColor: revMeta.border,
                          backgroundColor: 'var(--bg-app)',
                          fontWeight: 600,
                        }}
                        value={currentRevive}
                        onChange={e => handleFlexibleReviveChange(l, e.target.value)}
                        disabled={isLocked || !canEdit}
                      >
                        {REVIVE_TYPES.map(rt => (
                          <option key={rt.id} value={rt.id} style={{ color: '#E2E8F0', backgroundColor: '#121824' }}>
                            {rt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="data-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SLOT</th>
                    <th>TEAM</th>
                    {Array.from({ length: lobbiesPerDay }, (_, i) => i + 1).map(l => (
                       <Fragment key={`lobby-header-${l}`}>
                         <th style={{
                           color: lc(l).text,
                           background: lc(l).bg,
                           borderLeft: `2px solid ${lc(l).border}`,
                           whiteSpace: 'nowrap',
                         }}>
                           L{l} POS
                         </th>
                         <th style={{
                           color: lc(l).text,
                           background: lc(l).bg,
                           borderRight: `2px solid ${lc(l).border}`,
                           whiteSpace: 'nowrap',
                         }}>
                           L{l} KILLS
                         </th>
                       </Fragment>
                     ))}
                    <th>BONUS+</th>
                    <th>BONUS-</th>
                    <th style={{ background: 'var(--bg-alt-row)' }}>WINS</th>
                    <th style={{ background: 'var(--bg-alt-row)' }}>MATCHES</th>
                    <th style={{ background: 'var(--bg-alt-row)' }}>PLACE PTS</th>
                    <th style={{ background: 'var(--bg-alt-row)' }}>KILLS</th>
                    <th style={{ background: 'var(--bg-alt-row)', color: 'var(--gold)', fontWeight: 700 }}>TOTAL PTS</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTeamRegs.length === 0 ? (
                    <tr><td colSpan={20} className="empty-row">No teams registered for this group — go to Registration first</td></tr>
                  ) : activeTeamRegs.map((reg, ri) => {
                    const lobbyData = Array.from({ length: lobbiesPerDay }, (_, i) => {
                      const r = getResult(reg.teamId, i + 1);
                      return r || { placement: '', kills: '', id: null };
                    });

                    // Compute auto stats
                    const wins = lobbyData.filter(r => r.placement === 1).length;
                    const matches = lobbyData.filter(r => r.placement > 0).length;
                    const placePts = lobbyData.reduce((sum, r) => sum + getPlacementPoints(r.placement, placementPoints), 0);
                    const kills = lobbyData.reduce((sum, r) => sum + (Number(r.kills) || 0), 0);
                    const bonusForTeam = dayBonus.filter(b => b.teamId === reg.teamId);
                    const bonusAdd = bonusForTeam.filter(b => b.amount > 0).reduce((s, b) => s + b.amount, 0);
                    const bonusMinus = Math.abs(bonusForTeam.filter(b => b.amount < 0).reduce((s, b) => s + b.amount, 0));
                    const totalPts = placePts + kills * killPointValue + bonusAdd - bonusMinus;

                    return (
                      <tr key={reg.id} style={{ background: ri % 2 === 1 ? 'var(--bg-alt-row)' : undefined }}>
                        <td className="col-slot">{reg.slot}</td>
                        <td style={{ fontWeight: 600 }}>{reg.teamName}</td>
                        {lobbyData.map((r, li) => (
                          <Fragment key={`${reg.teamId}-l-${li+1}`}>
                            <CellInput
                              value={r.placement === null || r.placement === undefined || r.placement === '' ? '' : r.placement}
                              onSave={v => handleCellSave(reg.teamId, li + 1, 'placement', v)}
                              locked={isLocked || !canEdit}
                              style={{
                                borderLeft: `2px solid ${lc(li + 1).border}`,
                                background: `rgba(${li % 2 === 1 ? '255,255,255,0.01' : '0,0,0,0.01'})`
                              }}
                            />
                            <CellInput
                              value={r.kills === null || r.kills === undefined || r.kills === '' ? '' : r.kills}
                              onSave={v => handleCellSave(reg.teamId, li + 1, 'kills', v)}
                              locked={isLocked || !canEdit}
                              style={{
                                borderRight: `2px solid ${lc(li + 1).border}`,
                                background: `rgba(${li % 2 === 1 ? '255,255,255,0.01' : '0,0,0,0.01'})`
                              }}
                            />
                          </Fragment>
                        ))}
                        <td style={{ color: 'var(--success)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{bonusAdd || '—'}</td>
                        <td style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{bonusMinus || '—'}</td>
                        {/* Auto computed */}
                        <td className="computed-cell">{wins}</td>
                        <td className="computed-cell">{matches}</td>
                        <td className="computed-cell">{placePts}</td>
                        <td className="computed-cell col-kills">{kills}</td>
                        <td className="computed-cell col-gold">{totalPts}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bonus Points management */}
          <BonusPanel
            tournamentId={id}
            day={day}
            teamRegs={activeTeamRegs}
            bonusPoints={dayBonus}
            bonusTypes={bonusTypes}
            onRefresh={refresh}
            groupId={selectedGroupId || null}
            canEdit={canEdit}
          />
        </div>

        {/* Auto-ranked sidebar */}
        <div style={{ width: 300 }}>
          <div className="data-table-container" style={{
            position: 'sticky',
            top: 20,
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 'calc(100vh - 120px)'
          }}>
            <div className="data-table-toolbar" style={{ flexShrink: 0 }}>
              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Live Rankings · Day {day}</span>
            </div>
            <div className="data-table-scroll" style={{ overflowY: 'auto', flex: 1 }}>
              <table className="data-table" style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>RK</th>
                    <th>TEAM</th>
                    <th>W</th>
                    <th>KILLS</th>
                    <th style={{ color: 'var(--gold)' }}>PTS</th>
                  </tr>
                </thead>
                <tbody>
                  {standingsData.length === 0 ? (
                    <tr><td colSpan={5} className="empty-row" style={{ padding: '20px 10px' }}>Enter data to see live rankings</td></tr>
                  ) : standingsData.map((t, i) => (
                    <tr key={t.teamId}>
                      <td>
                        <span className={`rank-badge ${i === 0 ? 'badge-rank1' : i === 1 ? 'badge-rank2' : i === 2 ? 'badge-rank3' : ''}`}>
                          {i + 1}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.teamName}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{t.wins}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--kill-red)' }}>{t.kills}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold)', fontWeight: 700 }}>{t.totalPts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Editable cell input ─────────────────────────────────────────────────────
function CellInput({ value, onSave, locked = false, style = {} }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(String(value ?? ''));
  const isCancelled = useRef(false);
  const prevValue = useRef(value);

  // Only sync from parent when NOT actively editing AND the value actually changed
  useEffect(() => {
    if (!editing && value !== prevValue.current) {
      setLocal(String(value ?? ''));
      prevValue.current = value;
    }
  }, [value, editing]);

  const handleBlur = () => {
    setEditing(false);
    if (!isCancelled.current && local !== String(value ?? '')) {
      onSave(local);
    }
  };

  const handleStartEdit = () => {
    if (locked) return;
    isCancelled.current = false;
    setEditing(true);
  };

  if (editing && !locked) {
    return (
      <td style={{ ...style, padding: '3px 4px', textAlign: 'center' }}>
        <input
          className="editable-input"
          style={{
            width: 44,
            padding: '2px 4px',
            fontSize: '0.75rem',
            height: '22px',
            textAlign: 'center',
            margin: '0 auto',
            display: 'block'
          }}
          type="number"
          value={local}
          autoFocus
          onChange={e => setLocal(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.currentTarget.blur();
            }
            if (e.key === 'Escape') {
              isCancelled.current = true;
              setLocal(String(value ?? ''));
              setEditing(false);
            }
          }}
        />
      </td>
    );
  }
  return (
    <td style={{ ...style, padding: '3px 4px', textAlign: 'center' }}>
      <div
        className={locked ? undefined : 'editable-cell-display'}
        tabIndex={locked ? undefined : 0}
        onClick={handleStartEdit}
        onFocus={handleStartEdit}
        style={{
          padding: '2px 4px',
          fontSize: '0.75rem',
          height: '22px',
          minWidth: '38px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: locked ? 'default' : 'pointer',
          borderRadius: '4px',
          transition: 'all 0.1s',
          margin: '0 auto',
          color: locked ? 'var(--text-secondary)' : undefined,
        }}
      >
        {local !== '' && local !== undefined && local !== null ? <span style={{ fontFamily: 'var(--font-mono)' }}>{local}</span> : <span className="cell-empty">—</span>}
      </div>
    </td>
  );
}

// ─── Bonus Points Panel ──────────────────────────────────────────────────────
function BonusPanel({ tournamentId, day, teamRegs, bonusPoints, bonusTypes, onRefresh, groupId, canEdit = true }) {
  const [adding, setAdding] = useState(false);
  const [newBonus, setNewBonus] = useState({ teamId: '', type: '', amount: '', note: '' });
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!canEdit) return;
    if (!newBonus.teamId || !newBonus.amount) { toast.error('Team and amount required'); return; }
    setSaving(true);
    try {
      let amountNum = Number(newBonus.amount);
      const selectedType = (newBonus.type || '').toLowerCase();
      const isPenaltyType = selectedType.includes('penalty') || selectedType.includes('deduct') || selectedType.includes('violation') || selectedType.includes('fine') || selectedType.includes('minus');
      if (isPenaltyType && amountNum > 0) {
        amountNum = -amountNum;
      }

      await addBonusPoint(tournamentId, {
        teamId: newBonus.teamId,
        day,
        type: newBonus.type || 'Bonus',
        amount: amountNum,
        note: newBonus.note,
        ...(groupId ? { groupId } : {}),
      });
      setNewBonus({ teamId: '', type: '', amount: '', note: '' });
      setAdding(false);
      toast.success(amountNum < 0 ? 'Penalty/Deduction applied' : 'Bonus added');
      await onRefresh();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (bId) => {
    if (!canEdit) return;
    await deleteBonusPoint(tournamentId, bId);
    toast.success('Removed');
    await onRefresh();
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <h3 className="card-title">Bonus / Penalty Points — Day {day}</h3>
        {canEdit && (
          <button className="btn btn-secondary btn-sm" onClick={() => setAdding(v => !v)}>
            <Plus size={13} /> Add
          </button>
        )}
      </div>

      {adding && canEdit && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto auto', gap: 8, marginBottom: 14, alignItems: 'end' }}>
          <div className="form-field">
            <label className="form-label">Team</label>
            <select className="form-select" value={newBonus.teamId} onChange={e => setNewBonus(p => ({ ...p, teamId: e.target.value }))}>
              <option value="">— Select —</option>
              {teamRegs.map(t => <option key={t.id} value={t.teamId}>{t.teamName}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">Type</label>
            <select className="form-select" value={newBonus.type} onChange={e => setNewBonus(p => ({ ...p, type: e.target.value }))}>
              <option value="">— Type —</option>
              {bonusTypes.map(bt => <option key={bt.name} value={bt.name}>{bt.name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">Amount</label>
            <input className="form-input" type="number" placeholder="+5 / -3" value={newBonus.amount} onChange={e => setNewBonus(p => ({ ...p, amount: e.target.value }))} />
          </div>
          <div className="form-field">
            <label className="form-label">Note</label>
            <input className="form-input" placeholder="Optional note..." value={newBonus.note} onChange={e => setNewBonus(p => ({ ...p, note: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 6, paddingBottom: 1 }}>
            <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>{saving ? '...' : 'Add'}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}

      {bonusPoints.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No bonus/penalty entries for Day {day}</p>
      ) : (
        <table className="data-table" style={{ fontSize: '0.82rem' }}>
          <thead>
            <tr>
              <th>Team</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Note</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {bonusPoints.map((b, i) => {
              const team = teamRegs.find(t => t.teamId === b.teamId);
              return (
                <tr key={b.id} style={{ background: i % 2 === 1 ? 'var(--bg-alt-row)' : undefined }}>
                  <td style={{ fontWeight: 600 }}>{team?.teamName || b.teamId}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{b.type}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', color: b.amount > 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>
                    {b.amount > 0 ? '+' : ''}{b.amount}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{b.note || '—'}</td>
                  {canEdit && (
                    <td>
                      <button className="btn btn-ghost" style={{ padding: '3px 5px' }} onClick={() => handleDelete(b.id)}><Trash2 size={12} /></button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
