'use client';
import { useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTournament } from '../layout';
import { getAllSheetsAsCSV, parseTeamRegistrationCSV, parsePlayerRegistrationCSV, parseTeamMatchCSV, parsePlayerMatchCSV } from '@/lib/importers/csvParser';
import {
  importTeamRegistrations,
  importPlayerRegistrations,
  importTeamMatchResults,
  importPlayerMatchResults
} from '@/lib/importers/importEngine';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  Upload,
  FileSpreadsheet,
  Shield,
  Users,
  Trophy,
  Play,
  CheckCircle2,
  AlertTriangle,
  X,
  ChevronRight,
  Info
} from 'lucide-react';
import toast from 'react-hot-toast';
import Papa from 'papaparse';

export default function ImportHubPage() {
  const { id: tournamentId } = useParams();
  const { tournament, refresh } = useTournament();

  const fileRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState([]); // Array of { id, name, size, isExcel, sheets: { sheetName: csvText }, mappings: { sheetName: 'skip' | 'teams' | 'players' | 'team_matches' | 'player_matches' } }
  const [results, setResults] = useState(null); // { status: 'success' | 'partial_error' | 'error', details: [...] }
  const [previewSheet, setPreviewSheet] = useState(null); // { fileName, sheetName, csvText, mappingType }

  // Session Progress States
  const [importProgress, setImportProgress] = useState(0);
  const [importStatusText, setImportStatusText] = useState('');

  const handleFilesAdded = async (fileList) => {
    setLoading(true);
    const newFiles = [];
    for (const file of Array.from(fileList)) {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      const isCSV = /\.csv$/i.test(file.name);

      if (!isExcel && !isCSV) {
        toast.error(`${file.name} is not a supported format. Use CSV or Excel.`);
        continue;
      }

      try {
        const sheets = await getAllSheetsAsCSV(file);
        const mappings = {};
        Object.keys(sheets).forEach(sheetName => {
          mappings[sheetName] = guessMapping(sheetName, file.name, sheets[sheetName]);
        });

        newFiles.push({
          id: Math.random().toString(36).substring(7),
          name: file.name,
          size: (file.size / 1024).toFixed(1) + ' KB',
          isExcel,
          sheets,
          mappings
        });
      } catch (err) {
        toast.error(`Error reading ${file.name}: ${err.message}`);
      }
    }

    setFiles(prev => [...prev, ...newFiles]);
    setLoading(false);
  };

  const guessMapping = (sheetName, fileName, csvText) => {
    let headers = [];
    if (csvText) {
      const firstLine = csvText.trim().split('\n')[0] || '';
      const delimiter = firstLine.includes('\t') ? '\t' : (firstLine.includes(';') ? ';' : ',');
      headers = firstLine.split(delimiter).map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    }

    const hasHeader = (names) => names.some(n => headers.includes(n));

    const hasPlayerName = hasHeader(['professionalname', 'proname', 'playername', 'ign', 'playerign', 'player', 'ingamename', 'fullname']);
    const hasTeamName = hasHeader(['teamname', 'team', 'clanname', 'clan']);
    const hasPlacement = hasHeader(['placement', 'position', 'place', 'pos', 'rank', 'rnk']);
    const hasKills = hasHeader(['kills', 'kill']);
    const hasDamage = hasHeader(['damage', 'dmg', 'damagedealt']);
    const hasAccuracy = hasHeader(['accuracy', 'acc', 'accuracypct', 'accuracypercent']);
    const hasDayOrLobby = hasHeader(['day', 'lobby', 'match', 'game']);
    const hasRosterFields = hasHeader(['device', 'devicemodel', 'gender', 'region', 'country', 'category', 'class', 'tier']);

    if (hasDayOrLobby) {
      if (hasPlayerName) {
        return 'player_matches';
      }
      if (hasTeamName || hasPlacement) {
        return 'team_matches';
      }
    }

    if (hasPlacement) {
      return 'team_matches';
    }

    if (hasDamage || hasAccuracy) {
      return 'player_matches';
    }

    if (hasPlayerName && (hasRosterFields || !hasTeamName)) {
      return 'players';
    }
    
    if (hasTeamName && hasPlayerName) {
      if (hasRosterFields) return 'players';
      return 'players';
    }

    if (hasTeamName && !hasPlayerName) {
      return 'teams';
    }

    // Fallback to name-based guessing
    const combined = `${sheetName} ${fileName}`.toLowerCase();
    if (combined.includes('player') && (combined.includes('match') || combined.includes('result') || combined.includes('entry') || combined.includes('stat'))) {
      return 'player_matches';
    }
    if (combined.includes('team') && (combined.includes('match') || combined.includes('result') || combined.includes('entry') || combined.includes('stat'))) {
      return 'team_matches';
    }
    if (combined.includes('team')) return 'teams';
    if (combined.includes('player') || combined.includes('roster')) return 'players';
    if (combined.includes('match') || combined.includes('result') || combined.includes('entry')) return 'team_matches';
    return 'skip';
  };

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const updateMapping = (fileId, sheetName, mappingType) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== fileId) return f;
      return {
        ...f,
        mappings: {
          ...f.mappings,
          [sheetName]: mappingType
        }
      };
    }));
  };

  const handleImport = async () => {
    setLoading(true);
    setResults(null);
    setImportProgress(0);
    setImportStatusText('Analyzing spreadsheets...');

    const importTasks = {
      teams: [],
      players: [],
      team_matches: [],
      player_matches: []
    };

    // Gather all sheet data into their respective task queues
    files.forEach(f => {
      Object.entries(f.sheets).forEach(([sheetName, csvText]) => {
        const m = f.mappings[sheetName];
        if (m && m !== 'skip') {
          importTasks[m].push({ file: f.name, sheet: sheetName, csvText });
        }
      });
    });

    // Count total rows across all tasks to calculate exact progress
    let totalRowsCount = 0;
    
    importTasks.teams.forEach(t => {
      const { rows } = parseTeamRegistrationCSV(t.csvText);
      totalRowsCount += rows.filter(r => r.teamName?.trim()).length;
    });
    importTasks.players.forEach(t => {
      const { rows } = parsePlayerRegistrationCSV(t.csvText);
      totalRowsCount += rows.filter(r => r.professionalName?.trim() || r.ign?.trim()).length;
    });
    importTasks.team_matches.forEach(t => {
      const { rows } = parseTeamMatchCSV(t.csvText);
      totalRowsCount += rows.filter(r => r.teamName?.trim() && Number(r.day) > 0 && Number(r.lobby) > 0).length;
    });
    importTasks.player_matches.forEach(t => {
      const { rows } = parsePlayerMatchCSV(t.csvText);
      totalRowsCount += rows.filter(r => r.playerIGN?.trim() && Number(r.day) > 0 && Number(r.lobby) > 0).length;
    });

    if (totalRowsCount === 0) {
      toast.error('No valid rows found to import.');
      setLoading(false);
      return;
    }

    let processedRowsCount = 0;
    
    const updateProgress = (current, total, name) => {
      processedRowsCount++;
      const pct = Math.min(99, Math.round((processedRowsCount / totalRowsCount) * 100));
      setImportProgress(pct);
      setImportStatusText(`Importing: ${name} (${processedRowsCount} of ${totalRowsCount})`);
    };

    const totalImported = {
      teams: { added: 0, skipped: 0, errors: [] },
      players: { added: 0, skipped: 0, errors: [] },
      team_matches: { added: 0, updated: 0, errors: [] },
      player_matches: { added: 0, updated: 0, errors: [] }
    };

    try {
      // 1. Teams registrations first
      for (const task of importTasks.teams) {
        const res = await importTeamRegistrations(tournamentId, task.csvText, updateProgress);
        totalImported.teams.added += res.added;
        totalImported.teams.skipped += res.skipped;
        if (res.errors.length) {
          totalImported.teams.errors.push(...res.errors.map(e => `[${task.file} > ${task.sheet}] ${e}`));
        }
      }

      // 2. Players registrations next (since they link to teams)
      for (const task of importTasks.players) {
        const res = await importPlayerRegistrations(tournamentId, task.csvText, updateProgress);
        totalImported.players.added += res.added;
        totalImported.players.skipped += res.skipped;
        if (res.errors.length) {
          totalImported.players.errors.push(...res.errors.map(e => `[${task.file} > ${task.sheet}] ${e}`));
        }
      }

      // 3. Match results last
      for (const task of importTasks.team_matches) {
        const res = await importTeamMatchResults(tournamentId, task.csvText, updateProgress);
        totalImported.team_matches.added += res.added;
        totalImported.team_matches.updated += res.updated;
        if (res.errors.length) {
          totalImported.team_matches.errors.push(...res.errors.map(e => `[${task.file} > ${task.sheet}] ${e}`));
        }
      }

      for (const task of importTasks.player_matches) {
        const res = await importPlayerMatchResults(tournamentId, task.csvText, updateProgress);
        totalImported.player_matches.added += res.added;
        totalImported.player_matches.updated += res.updated;
        if (res.errors.length) {
          totalImported.player_matches.errors.push(...res.errors.map(e => `[${task.file} > ${task.sheet}] ${e}`));
        }
      }

      setImportProgress(100);
      setImportStatusText('Import complete!');

      // Compile results summaries
      const summaryDetails = [];
      let hasErrors = false;

      if (importTasks.teams.length) {
        summaryDetails.push({
          title: 'Teams Registration',
          desc: `Imported ${totalImported.teams.added} new teams (${totalImported.teams.skipped} already registered).`,
          errors: totalImported.teams.errors
        });
        if (totalImported.teams.errors.length) hasErrors = true;
      }
      if (importTasks.players.length) {
        summaryDetails.push({
          title: 'Players Registration',
          desc: `Imported ${totalImported.players.added} new players (${totalImported.players.skipped} already registered).`,
          errors: totalImported.players.errors
        });
        if (totalImported.players.errors.length) hasErrors = true;
      }
      if (importTasks.team_matches.length) {
        summaryDetails.push({
          title: 'Team Match Results',
          desc: `Created ${totalImported.team_matches.added} and updated ${totalImported.team_matches.updated} match records.`,
          errors: totalImported.team_matches.errors
        });
        if (totalImported.team_matches.errors.length) hasErrors = true;
      }
      if (importTasks.player_matches.length) {
        summaryDetails.push({
          title: 'Player Match Results',
          desc: `Created ${totalImported.player_matches.added} and updated ${totalImported.player_matches.updated} player match records.`,
          errors: totalImported.player_matches.errors
        });
        if (totalImported.player_matches.errors.length) hasErrors = true;
      }

      setResults({
        status: hasErrors ? 'partial_error' : 'success',
        details: summaryDetails
      });

      if (hasErrors) {
        toast.error('Import completed with some errors.');
      } else {
        toast.success('All data imported successfully!');
        setFiles([]); // clear files on complete success
      }
      await refresh();
    } catch (e) {
      toast.error('Import process failed: ' + e.message);
      setResults({
        status: 'error',
        details: [{ title: 'System Error', desc: e.message, errors: [] }]
      });
    } finally {
      setLoading(false);
    }
  };

  const totalSheetsToImport = files.reduce((acc, f) => {
    return acc + Object.values(f.mappings).filter(m => m !== 'skip').length;
  }, 0);

  return (
    <div className="space-y-6">
      <div className="flex-between pb-4 border-b border-border mb-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-text-primary">
            <FileSpreadsheet size={20} className="text-gold" />
            Bulk Import Hub
          </h2>
          <p className="text-xs text-text-muted mt-1">
            Upload Excel spreadsheets (.xlsx/.xls) or CSV files to batch-import rosters and results.
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
        {/* Main Workspace */}
        <div className="space-y-6">
          {/* Progress Card when session is active */}
          {loading && importProgress >= 0 && (
            <div className="card space-y-3" style={{ background: 'rgba(201,168,76,0.05)', borderColor: 'var(--gold)' }}>
              <div className="flex-between">
                <span style={{ fontWeight: 600, color: 'var(--gold)', fontSize: '0.9rem' }}>Import Session in Progress</span>
                <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--gold)' }}>{importProgress}%</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg-alt-row)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ width: `${importProgress}%`, height: '100%', background: 'var(--gold)', transition: 'width 0.15s ease' }} />
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{importStatusText}</p>
            </div>
          )}

          {/* Drop Zone */}
          {!loading && (
            <div
              style={{
                border: '2px dashed var(--border-md)',
                borderRadius: 'var(--r-md)',
                padding: '40px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'var(--bg-card)',
                transition: 'all 0.15s',
              }}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--gold)'; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border-md)'; }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.style.borderColor = 'var(--border-md)';
                handleFilesAdded(e.dataTransfer.files);
              }}
            >
              <Upload size={36} style={{ color: 'var(--text-muted)', marginBottom: 12, marginInline: 'auto' }} />
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 6 }}>
                <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Click to upload file</span> or drag &amp; drop
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Supports Excel (.xlsx, .xls) and CSV files
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                style={{ display: 'none' }}
                onChange={e => { handleFilesAdded(e.target.files); e.target.value = ''; }}
              />
            </div>
          )}

          {/* Files Mapping list */}
          {files.length > 0 && !loading && (
            <div className="card space-y-4">
              <h3 className="card-title flex items-center justify-between border-b border-border pb-3">
                <span>Map Uploaded Sheets</span>
                <span className="text-xs text-text-muted">{files.length} file(s) loaded</span>
              </h3>

              <div className="space-y-4">
                {files.map(f => (
                  <div
                    key={f.id}
                    style={{
                      border: '1px solid var(--border-md)',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--bg-alt-row)',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Header */}
                    <div className="flex-between" style={{ padding: '12px 16px', background: 'var(--bg-header)', borderBottom: '1px solid var(--border)' }}>
                      <div className="flex items-center gap-3">
                        <FileSpreadsheet size={16} className="text-gold" />
                        <div>
                          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{f.name}</span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 8 }}>{f.size}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => removeFile(f.id)}
                        style={{ color: 'var(--text-muted)' }}
                        className="hover:text-danger transition"
                      >
                        <X size={15} />
                      </button>
                    </div>

                    {/* Sheet list mappings */}
                    <div style={{ padding: '12px 16px' }} className="space-y-3">
                      {Object.keys(f.sheets).map(sheetName => (
                        <div key={sheetName} className="flex-between flex-wrap gap-4" style={{ fontSize: '0.85rem' }}>
                          <div className="flex items-center gap-2">
                            <ChevronRight size={12} style={{ color: 'var(--text-muted)' }} />
                            <span style={{ fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{sheetName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Map as:</span>
                            <select
                              className="form-select text-xs py-1 px-2"
                              style={{ width: 180, height: 30, marginRight: 6 }}
                              value={f.mappings[sheetName]}
                              onChange={e => updateMapping(f.id, sheetName, e.target.value)}
                            >
                              <option value="skip">🛑 Skip / Do not import</option>
                              <option value="teams">🛡️ Teams Registration</option>
                              <option value="players">👥 Players Registration</option>
                              <option value="team_matches">🏆 Team Match Results</option>
                              <option value="player_matches">🎯 Player Match Results</option>
                            </select>
                            <button
                              className="btn btn-secondary btn-xs"
                              style={{ padding: '2px 8px', fontSize: '0.72rem', height: 30, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              onClick={() => setPreviewSheet({ fileName: f.name, sheetName, csvText: f.sheets[sheetName], mappingType: f.mappings[sheetName] })}
                            >
                              👁️ Preview
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={loading || totalSheetsToImport === 0}
                >
                  <Play size={14} />
                  Start Bulk Import ({totalSheetsToImport} sheet{totalSheetsToImport !== 1 ? 's' : ''})
                </button>
              </div>
            </div>
          )}

          {/* Results Summary */}
          {results && (
            <div className="card space-y-4">
              <h3 className="card-title flex items-center gap-2 border-b border-border pb-3">
                {results.status === 'success' ? (
                  <CheckCircle2 size={18} className="text-success" />
                ) : (
                  <AlertTriangle size={18} className="text-warning" />
                )}
                <span>Import Summary</span>
              </h3>

              <div className="space-y-4">
                {results.details.map((det, i) => (
                  <div key={i} style={{ borderBottom: i < results.details.length - 1 ? '1px solid var(--border)' : undefined, paddingBottom: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: 4 }}>{det.title}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{det.desc}</div>
                    {det.errors.length > 0 && (
                      <div style={{ marginTop: 10, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--r-sm)', padding: 10 }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--danger)', marginBottom: 4 }}>Row Warnings / Errors:</div>
                        <ul style={{ listStyleType: 'disc', paddingLeft: 16, fontSize: '0.72rem', color: 'var(--text-secondary)' }} className="space-y-1">
                          {det.errors.slice(0, 10).map((err, idx) => (
                            <li key={idx}>{err}</li>
                          ))}
                          {det.errors.length > 10 && (
                            <li style={{ fontStyle: 'italic', listStyleType: 'none', paddingLeft: 0 }}>...and {det.errors.length - 10} more warnings</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Info/Specs */}
        <div className="space-y-6">
          <div className="card space-y-4">
            <h3 className="card-title flex items-center gap-2">
              <Info size={16} className="text-gold" />
              <span>Expected Column Headers</span>
            </h3>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }} className="space-y-4">
              <p>
                Columns are automatically matched based on their header names. The parser is extremely flexible (case-insensitive, ignores spaces/underscores).
              </p>

              <div className="space-y-2">
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }} className="flex items-center gap-1.5 border-b border-border pb-1">
                  <Shield size={13} className="text-gold" /> Teams Registration
                </div>
                <ul className="space-y-1" style={{ listStyle: 'none', paddingLeft: 0, fontSize: '0.75rem' }}>
                  <li><strong>Team Name</strong>: <code>teamName</code>, <code>team</code>, <code>team_name</code>, <code>name</code></li>
                  <li><strong>Clan Name</strong>: <code>clanName</code>, <code>clan</code>, <code>clan_name</code></li>
                  <li><strong>Tier</strong>: <code>tier</code>, <code>class</code>, <code>group</code></li>
                  <li><strong>Slot</strong>: <code>slot</code>, <code>#</code>, <code>id</code>, <code>index</code></li>
                </ul>
              </div>

              <div className="space-y-2">
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }} className="flex items-center gap-1.5 border-b border-border pb-1">
                  <Users size={13} className="text-gold" /> Players Registration
                </div>
                <ul className="space-y-1" style={{ listStyle: 'none', paddingLeft: 0, fontSize: '0.75rem' }}>
                  <li><strong>Pro Name</strong>: <code>professionalName</code>, <code>proName</code>, <code>playerName</code>, <code>name</code></li>
                  <li><strong>IGN</strong>: <code>ign</code>, <code>inGameName</code>, <code>playerIGN</code></li>
                  <li><strong>Team Name</strong>: <code>teamName</code>, <code>team</code>, <code>clan</code></li>
                  <li><strong>Class/Category</strong>: <code>class</code>, <code>playerClass</code>, <code>category</code>, <code>tier</code></li>
                  <li><strong>Device Model</strong>: <code>deviceModel</code>, <code>model</code>, <code>phone</code></li>
                  <li><span style={{ color: 'var(--text-muted)' }}>* Note: Player Slot is no longer required and will be automatically assigned.</span></li>
                </ul>
              </div>

              <div className="space-y-2">
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }} className="flex items-center gap-1.5 border-b border-border pb-1">
                  <Trophy size={13} className="text-gold" /> Team Match Results
                </div>
                <ul className="space-y-1" style={{ listStyle: 'none', paddingLeft: 0, fontSize: '0.75rem' }}>
                  <li><strong>Day</strong>: <code>day</code>, <code>d</code></li>
                  <li><strong>Lobby</strong>: <code>lobby</code>, <code>l</code>, <code>match</code>, <code>game</code></li>
                  <li><strong>Team Name</strong>: <code>teamName</code>, <code>team</code>, <code>name</code></li>
                  <li><strong>Placement</strong>: <code>placement</code>, <code>position</code>, <code>place</code>, <code>pos</code>, <code>rank</code></li>
                  <li><strong>Kills</strong>: <code>kills</code>, <code>kill</code>, <code>k</code></li>
                </ul>
              </div>

              <div className="space-y-2">
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }} className="flex items-center gap-1.5 border-b border-border pb-1">
                  <Play size={13} className="text-gold" /> Player Match Results
                </div>
                <ul className="space-y-1" style={{ listStyle: 'none', paddingLeft: 0, fontSize: '0.75rem' }}>
                  <li><strong>Day/Lobby</strong>: <code>day</code>, <code>lobby</code></li>
                  <li><strong>Player IGN</strong>: <code>playerIGN</code>, <code>ign</code>, <code>player</code>, <code>name</code></li>
                  <li><strong>Kills</strong>: <code>kills</code>, <code>kill</code></li>
                  <li><strong>Damage</strong>: <code>damage</code>, <code>dmg</code>, <code>damageDealt</code></li>
                  <li><strong>Accuracy</strong>: <code>accuracy</code>, <code>acc</code>, <code>accuracyPct</code></li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
      {loading && importProgress === 0 && <LoadingSpinner size="lg" text="Processing data, please wait..." />}
      {previewSheet && (
        <SheetPreviewModal
          fileName={previewSheet.fileName}
          sheetName={previewSheet.sheetName}
          csvText={previewSheet.csvText}
          mappingType={previewSheet.mappingType}
          onClose={() => setPreviewSheet(null)}
        />
      )}
    </div>
  );
}

function SheetPreviewModal({ fileName, sheetName, csvText, mappingType, onClose }) {
  const { data } = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true
  });

  const headers = data && data.length > 0 ? Object.keys(data[0]) : [];
  const rows = data ? data.slice(0, 30) : [];

  const cleanHeader = (h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-md)',
        borderRadius: 14, padding: 24, width: '95vw', maxWidth: 1300,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
              Sheet Preview: {sheetName}
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Showing first {rows.length} rows from file <code>{fileName}</code>
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={20} />
          </button>
        </div>

        {mappingType && mappingType !== 'skip' && (
          <div style={{
            background: 'var(--bg-alt-row)',
            border: '1px solid var(--border-md)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: '0.8rem'
          }}>
            <strong style={{ color: 'var(--gold)' }}>Column Mapping for {
              mappingType === 'teams' ? 'Teams Registration' :
              mappingType === 'players' ? 'Players Registration' :
              mappingType === 'team_matches' ? 'Team Match Results' : 'Player Match Results'
            }:</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginTop: 8 }}>
              {mappingType === 'teams' && (
                <>
                  <div>Slot: <code>{headers.find(h => ['slot', 'id', 'no', 'index'].includes(cleanHeader(h))) || 'Auto-generated'}</code></div>
                  <div>Team Name: <code>{headers.find(h => ['teamname', 'team', 'name'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Clan Name: <code>{headers.find(h => ['clanname', 'clan'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Tier: <code>{headers.find(h => ['tier', 'class', 'group'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                </>
              )}
              {mappingType === 'players' && (
                <>
                  <div>Pro Name: <code>{headers.find(h => ['professionalname', 'proname', 'playername', 'name', 'fullname'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>IGN: <code>{headers.find(h => ['ign', 'ingamename', 'playerign', 'ingame'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Team: <code>{headers.find(h => ['teamname', 'team', 'clan'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Class: <code>{headers.find(h => ['class', 'playerclass', 'category', 'tier', 'group'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Gender: <code>{headers.find(h => ['gender', 'sex'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Region: <code>{headers.find(h => ['region', 'zone', 'reg'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Country: <code>{headers.find(h => ['country', 'nation', 'cntry'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Device: <code>{headers.find(h => ['device', 'platform', 'dev'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Model: <code>{headers.find(h => ['devicemodel', 'model', 'phone'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                </>
              )}
              {mappingType === 'team_matches' && (
                <>
                  <div>Day: <code>{headers.find(h => ['day', 'd'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Lobby: <code>{headers.find(h => ['lobby', 'l', 'match', 'game'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Team: <code>{headers.find(h => ['teamname', 'team', 'name'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Placement: <code>{headers.find(h => ['placement', 'position', 'place', 'pos', 'rank', 'rnk'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Kills: <code>{headers.find(h => ['kills', 'kill', 'k'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                </>
              )}
              {mappingType === 'player_matches' && (
                <>
                  <div>Day: <code>{headers.find(h => ['day', 'd'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Lobby: <code>{headers.find(h => ['lobby', 'l', 'match', 'game'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Player IGN: <code>{headers.find(h => ['playerign', 'ign', 'player', 'playername', 'name', 'proname'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Team: <code>{headers.find(h => ['teamname', 'team'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Kills: <code>{headers.find(h => ['kills', 'kill', 'k'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Damage: <code>{headers.find(h => ['damage', 'dmg', 'damagedealt'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                  <div>Accuracy: <code>{headers.find(h => ['accuracy', 'acc', 'accuracypct', 'accuracypercent'].includes(cleanHeader(h))) || 'Not found'}</code></div>
                </>
              )}
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="empty-row" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>No rows found in this sheet.</div>
        ) : (
          <div style={{ overflowX: 'auto', border: '1px solid var(--border-md)', borderRadius: 8, maxHeight: '65vh' }}>
            <table className="data-table" style={{ fontSize: '0.75rem', width: '100%', margin: 0 }}>
              <thead>
                <tr style={{ background: 'var(--bg-header)' }}>
                  {headers.map(h => <th key={h} style={{ padding: '8px 12px' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {headers.map(h => <td key={h} style={{ padding: '8px 12px' }}>{row[h] || ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'end', marginTop: 20 }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
