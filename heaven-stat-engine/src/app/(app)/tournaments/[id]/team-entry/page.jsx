'use client';
import { useState, useEffect, useCallback, useMemo, Fragment, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTournament } from '../layout';
import { getTeamMatchResults, saveTeamMatchResult, updateTeamMatchResult, getBonusPoints, addBonusPoint, updateBonusPoint, deleteBonusPoint } from '@/lib/firestore/matchData';
import { getTeamRegistrations } from '@/lib/firestore/tournaments';
import { computeDailyStandings } from '@/lib/engine/standings';
import { getPlacementPoints } from '@/lib/engine/scoring';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';
import { Save, Plus, Trash2, ChevronDown, ChevronUp, Upload, X, Check, FileSpreadsheet, ClipboardPaste, ChevronRight, Camera, AlertCircle, AlertTriangle } from 'lucide-react';
import { getAllSheetsAsCSV } from '@/lib/importers/csvParser';
import { uploadAndParseImage } from '@/lib/importers/ocrClient';

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

// ─── Team Paste Parser ────────────────────────────────────────────────────────
function parseTeamEntryPaste(text, teamRegs, lobbiesCount) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return { results: [], errors: [] };

  // Determine delimiter
  const delimiter = lines[0].includes('\t') ? '\t' : (lines[0].includes(',') ? ',' : (lines[0].includes(';') ? ';' : ' '));
  const grid = lines.map(line => line.split(delimiter).map(c => c.trim()));

  const firstRow = grid[0];
  const hasHeader = firstRow.some(cell => {
    const c = cell.toLowerCase();
    return c.includes('team') || c.includes('pos') || c.includes('kill') || c.includes('lobby') || c.includes('match') || c.includes('place');
  });

  let dataRows = grid;
  let headers = null;

  if (hasHeader) {
    headers = firstRow;
    dataRows = grid.slice(1);
  }

  const results = [];
  const errors = [];

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const cols = dataRows[rowIndex];
    if (cols.length === 0 || !cols[0]) continue;

    const teamNameInput = cols[0];
    const team = teamRegs.find(t => 
      t.teamName.toLowerCase().replace(/\s+/g, '') === teamNameInput.toLowerCase().replace(/\s+/g, '') ||
      t.clanName?.toLowerCase().replace(/\s+/g, '') === teamNameInput.toLowerCase().replace(/\s+/g, '')
    );

    if (!team) {
      errors.push(`Row ${rowIndex + (hasHeader ? 2 : 1)}: Team "${teamNameInput}" is not registered.`);
      continue;
    }

    const lobbyValues = [];
    if (headers) {
      for (let l = 1; l <= lobbiesCount; l++) {
        let posColIndex = -1;
        let killsColIndex = -1;

        headers.forEach((h, idx) => {
          const lower = h.toLowerCase();
          const matchesLobby = lower.includes(`l${l}`) || lower.includes(`lobby${l}`) || lower.includes(`lobby ${l}`) || lower.includes(`match${l}`) || lower.includes(`match ${l}`) || lower.includes(`game${l}`) || lower.includes(`game ${l}`) || (lower.includes(`${l}`) && (lower.includes('pos') || lower.includes('place') || lower.includes('kill')));
          
          if (matchesLobby) {
            if (lower.includes('pos') || lower.includes('placement') || lower.includes('place') || lower.includes('rank') || lower.includes('position')) {
              posColIndex = idx;
            } else if (lower.includes('kill') || lower.includes('k')) {
              killsColIndex = idx;
            }
          }
        });

        if (posColIndex === -1 && killsColIndex === -1) {
          const pIdx = 1 + (l - 1) * 2;
          const kIdx = 2 + (l - 1) * 2;
          if (pIdx < cols.length) posColIndex = pIdx;
          if (kIdx < cols.length) killsColIndex = kIdx;
        }

        const placement = posColIndex !== -1 && posColIndex < cols.length ? parseInt(cols[posColIndex]) || 0 : 0;
        const kills = killsColIndex !== -1 && killsColIndex < cols.length ? parseInt(cols[killsColIndex]) || 0 : 0;

        if (placement > 0 || kills > 0) {
          lobbyValues.push({ lobby: l, placement, kills });
        }
      }
    } else {
      for (let l = 1; l <= lobbiesCount; l++) {
        const pIdx = 1 + (l - 1) * 2;
        const kIdx = 2 + (l - 1) * 2;
        
        const placement = pIdx < cols.length ? parseInt(cols[pIdx]) || 0 : 0;
        const kills = kIdx < cols.length ? parseInt(cols[kIdx]) || 0 : 0;

        if (placement > 0 || kills > 0) {
          lobbyValues.push({ lobby: l, placement, kills });
        }
      }
    }

    results.push({
      teamId: team.teamId,
      teamName: team.teamName,
      lobbyValues
    });
  }

  return { results, errors };
}

export default function TeamEntryPage() {
  const { id } = useParams();
  const { tournament } = useTournament();
  const [day, setDay] = useState(1);
  const [teamRegs, setTeamRegs] = useState([]);
  const [allResults, setAllResults] = useState([]);
  const [allBonus, setAllBonus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRef, setShowRef] = useState(false);
  const [saving, setSaving] = useState({});

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
  const [ocrQueue, setOcrQueue] = useState([]);
  const [ocrQueueActiveIndex, setOcrQueueActiveIndex] = useState(null);
  const [lobbyPreviews, setLobbyPreviews] = useState({});
  const [isOcrMode, setIsOcrMode] = useState(false);
  const ocrFileRef = useRef(null);

  const { structure = {}, scoring = {} } = tournament;
  const totalDays = structure.totalDays || 6;
  const lobbiesPerDay = structure.lobbiesPerDay || 4;
  const { killPointValue = 2, placementPoints = [], bonusTypes = [] } = scoring;

  const refresh = useCallback(async () => {
    const [regs, results, bonus] = await Promise.all([
      getTeamRegistrations(id),
      getTeamMatchResults(id),
      getBonusPoints(id),
    ]);
    setTeamRegs(regs);
    setAllResults(results);
    setAllBonus(bonus);
  }, [id]);

  useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh]);

  // Live preview parse effect
  useEffect(() => {
    if (!pasteText.trim()) {
      setParsedPreview([]);
      setPasteErrors([]);
      return;
    }
    const { results, errors } = parseTeamEntryPaste(pasteText, teamRegs, lobbiesPerDay);
    setParsedPreview(results);
    setPasteErrors(errors);
  }, [pasteText, teamRegs, lobbiesPerDay]);

  // Build a lookup: teamId → lobbyNum → { result }
  const dayResults = useMemo(() => allResults.filter(r => r.day === day), [allResults, day]);
  const dayBonus = useMemo(() => allBonus.filter(b => b.day === day), [allBonus, day]);

  const getResult = (teamId, lobby) => dayResults.find(r => r.teamId === teamId && r.lobby === lobby);

  const handleCellSave = async (teamId, lobby, field, value) => {
    const key = `${teamId}-${lobby}-${field}`;
    setSaving(s => ({ ...s, [key]: true }));
    try {
      const existing = getResult(teamId, lobby);
      const numVal = Number(value) || 0;
      if (existing) {
        await updateTeamMatchResult(id, existing.id, { [field]: numVal });
      } else {
        await saveTeamMatchResult(id, { teamId, teamName: teamRegs.find(t => t.teamId === teamId)?.teamName || teamId, day, lobby, placement: 0, kills: 0, [field]: numVal });
      }
      await refresh();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(s => ({ ...s, [key]: false })); }
  };

  const handlePasteImport = async () => {
    if (parsedPreview.length === 0) {
      toast.error('No valid team entry results parsed.');
      return;
    }
    setParsing(true);
    try {
      let updatedCount = 0;
      let addedCount = 0;

      for (const row of parsedPreview) {
        for (const lv of row.lobbyValues) {
          const existing = dayResults.find(r => r.teamId === row.teamId && r.lobby === lv.lobby);
          if (existing) {
            await updateTeamMatchResult(id, existing.id, { placement: lv.placement, kills: lv.kills });
            updatedCount++;
          } else {
            await saveTeamMatchResult(id, {
              teamId: row.teamId,
              teamName: row.teamName,
              day,
              lobby: lv.lobby,
              placement: lv.placement,
              kills: lv.kills
            });
            addedCount++;
          }
        }
      }

      toast.success(`Successfully saved match results! Added ${addedCount}, updated ${updatedCount} records.`);
      setPasteText('');
      setShowPaste(false);
      await refresh();
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

        const data = await uploadAndParseImage(item.file, item.lobby, 'team');
        clearInterval(progressInterval);

        const mappedRows = (data.rows || []).map(row => {
          const numericSlot = parseInt(row.slot) || 0;
          const team = teamRegs.find(t => t.slot === numericSlot);
          return {
            placement: parseInt(row.rank) || 0,
            slot: row.slot,
            kills: row.kills === null ? null : (parseInt(row.kills) || 0),
            teamId: team?.teamId || null,
            teamName: team?.teamName || null,
            sourceLine: `Rank: ${row.rank}, Slot: ${row.slot}, Kills: ${row.kills}`
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
        
        let updatedRow = { ...row, [field]: val };
        
        if (field === 'slot') {
          const numericSlot = parseInt(val) || 0;
          const team = teamRegs.find(t => t.slot === numericSlot);
          updatedRow.teamId = team?.teamId || null;
          updatedRow.teamName = team?.teamName || null;
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

      for (const row of validResults) {
        const existing = dayResults.find(r => r.teamId === row.teamId && r.lobby === lobbyNum);
        const payload = {
          teamId: row.teamId,
          teamName: row.teamName,
          day,
          lobby: lobbyNum,
          placement: row.placement,
          kills: row.kills === null ? 0 : row.kills,
          inputMethod: 'ocr'
        };

        if (existing) {
          await updateTeamMatchResult(id, existing.id, payload);
          updatedCount++;
        } else {
          await saveTeamMatchResult(id, payload);
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
    const mergedMap = new Map();

    rowsList.forEach(row => {
      const rankKey = row.placement;
      if (!mergedMap.has(rankKey)) {
        mergedMap.set(rankKey, row);
      } else {
        const existing = mergedMap.get(rankKey);
        
        const existingNullCount = (existing.kills === null ? 1 : 0) + (!existing.teamId ? 1 : 0);
        const rowNullCount = (row.kills === null ? 1 : 0) + (!row.teamId ? 1 : 0);

        if (rowNullCount < existingNullCount) {
          mergedMap.set(rankKey, row);
        }
      }
    });

    return Array.from(mergedMap.values()).sort((a, b) => a.placement - b.placement);
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
  }, [ocrQueue, teamRegs]);

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
    const enriched = dayResults.map(r => ({
      ...r,
      teamName: teamRegs.find(t => t.teamId === r.teamId)?.teamName || r.teamId,
      clanName: teamRegs.find(t => t.teamId === r.teamId)?.clanName || '',
    }));
    return computeDailyStandings(enriched, dayBonus, scoring, day);
  }, [dayResults, dayBonus, teamRegs, scoring, day]);

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
              <span className="data-table-count">{teamRegs.length} teams</span>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowPaste(v => !v)}
                  title="Copy and paste results from Excel / Google Sheets"
                >
                  <ClipboardPaste size={13} style={{ marginRight: 6 }} /> Paste or Upload Day Results
                </button>
              </div>
            </div>

            {/* Paste Data Panel */}
            {showPaste && (
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
                        setOcrResults([]);
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
                      Previewing Parsed Results ({parsedPreview.length} teams mapped):
                    </div>
                    <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-md)', borderRadius: 'var(--r-sm)' }}>
                      <table className="data-table" style={{ fontSize: '0.75rem', width: '100%' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-header)' }}>
                            <th>Team</th>
                            {Array.from({ length: lobbiesPerDay }, (_, i) => i + 1).map(l => (
                              <th key={l}>L{l} Pos & Kills</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {parsedPreview.map((item, idx) => (
                            <tr key={idx}>
                              <td style={{ fontWeight: 600 }}>{item.teamName}</td>
                              {Array.from({ length: lobbiesPerDay }, (_, i) => i + 1).map(l => {
                                const lv = item.lobbyValues.find(v => v.lobby === l);
                                return (
                                  <td key={l} style={{ fontFamily: 'var(--font-mono)' }}>
                                    {lv ? `${lv.placement} place (${lv.kills} kills)` : '—'}
                                  </td>
                                );
                              })}
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
                                  >
                                    Confirm & Save
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
                                        ) : row.placement}
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
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <span style={{ fontWeight: 600 }}>
                                            {isUnmatched ? 'Unmatched Slot' : row.teamName}
                                          </span>
                                          {isUnmatched && (
                                            <AlertCircle size={14} style={{ color: 'var(--danger)' }} title="No registered team matches this slot" />
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

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setShowPaste(false); setPasteText(''); handleOcrClear(); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
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
                  {teamRegs.length === 0 ? (
                    <tr><td colSpan={20} className="empty-row">No teams registered — go to Registration first</td></tr>
                  ) : teamRegs.map((reg, ri) => {
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
                              value={r.placement || ''}
                              onSave={v => handleCellSave(reg.teamId, li + 1, 'placement', v)}
                            />
                            <CellInput
                              value={r.kills || ''}
                              onSave={v => handleCellSave(reg.teamId, li + 1, 'kills', v)}
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
            teamRegs={teamRegs}
            bonusPoints={dayBonus}
            bonusTypes={bonusTypes}
            onRefresh={refresh}
          />
        </div>

        {/* Auto-ranked sidebar */}
        <div style={{ width: 300 }}>
          <div className="data-table-container" style={{ position: 'sticky', top: 20 }}>
            <div className="data-table-toolbar">
              <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Live Rankings · Day {day}</span>
            </div>
            <div className="data-table-scroll">
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
function CellInput({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);

  useEffect(() => { setLocal(value); }, [value]);

  if (editing) {
    return (
      <td>
        <input
          className="editable-input"
          style={{ width: 56 }}
          type="number"
          value={local}
          autoFocus
          onChange={e => setLocal(e.target.value)}
          onBlur={() => { setEditing(false); if (local !== value) onSave(local); }}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab') { setEditing(false); if (local !== value) onSave(local); }
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
      >
        {local !== '' && local !== 0 ? <span style={{ fontFamily: 'var(--font-mono)' }}>{local}</span> : <span className="cell-empty">—</span>}
      </div>
    </td>
  );
}

// ─── Bonus Points Panel ──────────────────────────────────────────────────────
function BonusPanel({ tournamentId, day, teamRegs, bonusPoints, bonusTypes, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [newBonus, setNewBonus] = useState({ teamId: '', type: '', amount: '', note: '' });
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newBonus.teamId || !newBonus.amount) { toast.error('Team and amount required'); return; }
    setSaving(true);
    try {
      await addBonusPoint(tournamentId, {
        teamId: newBonus.teamId,
        day,
        type: newBonus.type || 'Bonus',
        amount: Number(newBonus.amount),
        note: newBonus.note,
      });
      setNewBonus({ teamId: '', type: '', amount: '', note: '' });
      setAdding(false);
      toast.success('Bonus added');
      await onRefresh();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (bId) => {
    await deleteBonusPoint(tournamentId, bId);
    toast.success('Removed');
    await onRefresh();
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <h3 className="card-title">Bonus / Penalty Points — Day {day}</h3>
        <button className="btn btn-secondary btn-sm" onClick={() => setAdding(v => !v)}>
          <Plus size={13} /> Add
        </button>
      </div>

      {adding && (
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
              <th></th>
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
                  <td>
                    <button className="btn btn-ghost" style={{ padding: '3px 5px' }} onClick={() => handleDelete(b.id)}><Trash2 size={12} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
