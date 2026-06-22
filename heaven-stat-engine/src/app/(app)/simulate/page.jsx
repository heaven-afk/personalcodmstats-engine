'use client';
import { useState, useEffect, useRef } from 'react';
import {
  FlaskConical, ChevronRight, ChevronLeft, Check, Plus, Trash2,
  Search, Link2, Unlink2, RotateCcw, Download, Copy, Trophy,
  Users, Database, AlertTriangle, ChevronDown, ChevronUp,
  Zap, BarChart2, Target, TrendingUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Papa from 'papaparse';
import { getTournaments } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getPlayerMatchResults } from '@/lib/firestore/matchData';
import { getTeams, getPlayers } from '@/lib/firestore/registry';
import { StatusBadge } from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ScoringConfigEditor, { DEFAULT_PLACEMENT_POINTS } from '@/components/ui/ScoringConfigEditor';
import { runSimulation, levelLabel, levelTier } from '@/lib/engine/simulation';

// ─── Ordinal helper ──────────────────────────────────────────────────────────
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ─── Confidence badge ────────────────────────────────────────────────────────
function ConfidenceBadge({ level }) {
  const styles = {
    own:    { bg: 'rgba(34,197,94,0.12)',  color: '#22C55E', border: 'rgba(34,197,94,0.3)'  },
    player: { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', border: 'rgba(245,158,11,0.3)' },
    field:  { bg: 'rgba(100,116,139,0.15)',color: '#94A3B8', border: '#475569'                },
  };
  const tier = levelTier(level);
  const s = styles[tier];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 999, fontSize: '0.7rem',
      fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>
      {level === 1 && <Check size={10} />}
      {level === 2 && <Users size={10} />}
      {level === 3 && <AlertTriangle size={10} />}
      {levelLabel(level)}
    </span>
  );
}

// ─── Mini rating bar ─────────────────────────────────────────────────────────
function MiniRatingBar({ value, color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 60, fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: 'var(--bg-alt-row)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, value)}%`, height: '100%', background: color, borderRadius: 999, transition: 'width 0.5s ease' }} />
      </div>
      <span style={{ width: 28, fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', textAlign: 'right' }}>{Math.round(value)}</span>
    </div>
  );
}

// ─── Step wizard indicator ───────────────────────────────────────────────────
function StepIndicator({ step, steps }) {
  return (
    <div className="wizard-steps" style={{ marginBottom: 28 }}>
      {steps.map((label, i) => {
        const s = i + 1;
        const done = step > s;
        const active = step === s;
        return (
          <div key={s} className="wizard-step">
            <div className={`wizard-step-circle ${done ? 'done' : active ? 'active' : ''}`}>
              {done ? <Check size={14} /> : s}
            </div>
            <span className={`wizard-step-label ${active ? 'active' : ''}`}>{label}</span>
            {i < steps.length - 1 && <div className={`wizard-step-line ${done ? 'done' : ''}`} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Roster row ──────────────────────────────────────────────────────────────
function RosterRow({ entry, index, globalTeams, globalPlayers, historyPreview, onUpdate, onRemove }) {
  const [searchTerm, setSearchTerm] = useState(entry.teamName || '');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [playerSearch, setPlayerSearch] = useState('');
  const inputRef = useRef(null);

  const teamSuggestions = searchTerm.length > 0
    ? globalTeams.filter(
        (t) =>
          t.teamName?.toLowerCase().includes(searchTerm.toLowerCase()) &&
          t.id !== entry.teamId
      ).slice(0, 6)
    : [];

  const availablePlayers = playerSearch.length > 0
    ? globalPlayers.filter(
        (p) =>
          (p.professionalName?.toLowerCase().includes(playerSearch.toLowerCase()) ||
           p.ign?.toLowerCase().includes(playerSearch.toLowerCase())) &&
          !entry.playerIds.includes(p.id)
      ).slice(0, 6)
    : [];

  const linkedTeam = globalTeams.find((t) => t.id === entry.teamId);
  const preview = historyPreview[entry.teamId] ?? null;

  const handleTeamNameChange = (val) => {
    setSearchTerm(val);
    onUpdate(index, { teamName: val, teamId: '', registryLinked: false });
    setShowSuggestions(true);
  };

  const handleLinkTeam = (team) => {
    setSearchTerm(team.teamName);
    onUpdate(index, { teamName: team.teamName, teamId: team.id, registryLinked: true });
    setShowSuggestions(false);
  };

  const handleUnlink = () => {
    onUpdate(index, { teamId: '', registryLinked: false });
  };

  const addPlayer = (player) => {
    const updated = [...entry.playerIds, player.id];
    onUpdate(index, { playerIds: updated });
    setPlayerSearch('');
  };

  const removePlayer = (pid) => {
    onUpdate(index, { playerIds: entry.playerIds.filter((id) => id !== pid) });
  };

  const linkedPlayers = entry.playerIds.map(
    (pid) => globalPlayers.find((p) => p.id === pid)
  ).filter(Boolean);

  return (
    <div style={{
      background: 'var(--bg-alt-row)', border: '1px solid var(--border-md)',
      borderRadius: 10, padding: 14, position: 'relative',
    }}>
      {/* Team name + registry link row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                ref={inputRef}
                className="form-input"
                value={searchTerm}
                onChange={(e) => handleTeamNameChange(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Team name..."
                style={{ paddingLeft: 32 }}
              />
              <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            </div>
            {entry.registryLinked && entry.teamId ? (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleUnlink}
                title="Unlink from registry"
                style={{ color: 'var(--gold)', flexShrink: 0 }}
              >
                <Unlink2 size={14} />
              </button>
            ) : null}
          </div>

          {/* Registry suggestions */}
          {showSuggestions && teamSuggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
              background: 'var(--bg-card)', border: '1px solid var(--border-md)',
              borderRadius: 8, marginTop: 4, overflow: 'hidden',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {teamSuggestions.map((team) => (
                <button
                  key={team.id}
                  onMouseDown={() => handleLinkTeam(team)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '8px 12px', fontSize: '0.82rem', color: 'var(--text-primary)',
                    background: 'none', textAlign: 'left',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                >
                  <Link2 size={12} style={{ color: 'var(--gold)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{team.teamName}</span>
                  {team.clanName && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{team.clanName}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Remove row */}
        <button
          className="btn btn-ghost btn-sm"
          style={{ color: 'var(--danger)', flexShrink: 0 }}
          onClick={() => onRemove(index)}
          title="Remove team"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Registry status + history preview */}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {entry.registryLinked && entry.teamId ? (
          <span style={{ fontSize: '0.72rem', color: '#22C55E', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Link2 size={10} /> Linked to registry
          </span>
        ) : (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Not linked — type to search registry
          </span>
        )}

        {preview !== null && (
          <span style={{
            fontSize: '0.72rem', padding: '1px 8px', borderRadius: 999,
            background: preview > 0 ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.15)',
            color: preview > 0 ? '#22C55E' : 'var(--text-muted)',
            border: `1px solid ${preview > 0 ? 'rgba(34,197,94,0.3)' : '#475569'}`,
          }}>
            {preview > 0 ? `${preview} historical matches found` : 'No match history in selected tournaments'}
          </span>
        )}
      </div>

      {/* Player roster sub-section */}
      <div style={{ marginTop: 10 }}>
        <button
          onClick={() => setShowPlayers((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem',
            color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer',
          }}
        >
          <Users size={12} />
          {linkedPlayers.length > 0 ? `${linkedPlayers.length} player(s) linked` : 'Add player roster (optional — for fallback estimation)'}
          {showPlayers ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {showPlayers && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg-input)', borderRadius: 8 }}>
            {/* Linked players chips */}
            {linkedPlayers.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {linkedPlayers.map((p) => (
                  <span key={p.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem',
                    background: 'var(--bg-header)', border: '1px solid var(--border-md)',
                    color: 'var(--text-primary)',
                  }}>
                    {p.professionalName || p.ign}
                    <button onClick={() => removePlayer(p.id)} style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Player search */}
            <div style={{ position: 'relative' }}>
              <input
                className="form-input"
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                placeholder="Search players by name or IGN..."
                style={{ fontSize: '0.8rem', paddingLeft: 30 }}
              />
              <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              {availablePlayers.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                  background: 'var(--bg-card)', border: '1px solid var(--border-md)',
                  borderRadius: 8, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  overflow: 'hidden',
                }}>
                  {availablePlayers.map((p) => (
                    <button
                      key={p.id}
                      onMouseDown={() => addPlayer(p)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '7px 12px', fontSize: '0.8rem', color: 'var(--text-primary)',
                        background: 'none', textAlign: 'left', border: 'none', cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    >
                      <span style={{ fontWeight: 600 }}>{p.professionalName || '—'}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{p.ign}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
              Players are used only if the team has no direct match history in the selected tournaments (Level 2 fallback).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Results table row ───────────────────────────────────────────────────────
function ResultRow({ team, index }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = team.level === 1 && team.analyticsDetail?.scores;
  const detail = team.analyticsDetail?.scores;

  const rankStyles = [
    { bg: 'rgba(201,168,76,0.18)', color: 'var(--gold)', border: 'var(--border-gold)' },
    { bg: 'rgba(148,163,184,0.15)', color: '#CBD5E1', border: 'rgba(148,163,184,0.3)' },
    { bg: 'rgba(180,83,9,0.15)', color: '#F97316', border: 'rgba(180,83,9,0.3)' },
  ];
  const rankStyle = rankStyles[team.predictedRank - 1] || {};

  return (
    <>
      <tr
        style={{ borderBottom: '1px solid var(--border)', cursor: hasDetail ? 'pointer' : 'default' }}
        onClick={() => hasDetail && setExpanded((v) => !v)}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = index % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-alt-row)'; }}
      >
        {/* Rank */}
        <td style={{ padding: '10px 14px', width: 60, textAlign: 'center' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 8, fontWeight: 700,
            fontSize: '0.88rem', fontFamily: 'var(--font-mono)',
            background: rankStyle.bg || 'var(--bg-header)',
            color: rankStyle.color || 'var(--text-secondary)',
            border: `1px solid ${rankStyle.border || 'var(--border-md)'}`,
          }}>
            {team.predictedRank}
          </span>
        </td>

        {/* Team name */}
        <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {team.teamName}
            {hasDetail && (
              <span style={{ color: 'var(--text-muted)' }}>
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            )}
          </div>
        </td>

        {/* Final Rating */}
        <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--gold)', fontSize: '0.95rem' }}>
          {team.FINAL_RATING}
        </td>

        {/* Predicted rank + range */}
        <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
          <div>Predicted: <strong style={{ color: 'var(--text-primary)' }}>{ordinal(team.predictedRank)}</strong></div>
          {team.rangeLow !== team.rangeHigh && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              Likely range: {ordinal(team.rangeLow)}–{ordinal(team.rangeHigh)}
            </div>
          )}
        </td>

        {/* Confidence */}
        <td style={{ padding: '10px 14px' }}>
          <ConfidenceBadge level={team.level} />
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && hasDetail && (
        <tr style={{ background: 'rgba(13,27,42,0.6)' }}>
          <td colSpan={5} style={{ padding: '14px 20px 16px 80px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxWidth: 320 }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Component Scores</p>
              <MiniRatingBar value={detail.POWER      ?? 0} color="var(--kill-red)"   label="Power" />
              <MiniRatingBar value={detail.PLACEMENT  ?? 0} color="var(--lobby-blue)" label="Placement" />
              <MiniRatingBar value={detail.CONVERSION ?? 0} color="var(--success)"    label="Conversion" />
              <MiniRatingBar value={detail.FORM        ?? 0} color="var(--gold)"       label="Form" />
              {team.analyticsDetail?.labels && (
                <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Playstyle: <strong style={{ color: 'var(--text-secondary)' }}>{team.analyticsDetail.labels.playstyle}</strong>
                  {' · '}
                  Identity: <strong style={{ color: 'var(--text-secondary)' }}>{team.analyticsDetail.identity || '—'}</strong>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
const STEPS = ['Source Tournaments', 'Event Scoring', 'Participating Teams'];

export default function SimulatePage() {
  const [step, setStep] = useState(1);
  const [running, setRunning] = useState(false);
  const resultsRef = useRef(null);

  // Global data
  const [tournaments, setTournaments] = useState([]);
  const [globalTeams, setGlobalTeams] = useState([]);
  const [globalPlayers, setGlobalPlayers] = useState([]);
  const [loadingGlobal, setLoadingGlobal] = useState(true);

  // Step 1 — source tournaments
  const [selectedTournIds, setSelectedTournIds] = useState(new Set());
  const [loadingData, setLoadingData] = useState(false);
  const [sourceTournamentData, setSourceTournamentData] = useState({}); // id → { teamMatchResults, playerMatchResults }

  // Step 2 — scoring config
  const [eventLabel, setEventLabel] = useState('');
  const [killPointValue, setKillPointValue] = useState(2);
  const [placementPoints, setPlacementPoints] = useState(DEFAULT_PLACEMENT_POINTS);

  // Step 3 — roster
  const [roster, setRoster] = useState([
    { teamName: '', teamId: '', registryLinked: false, playerIds: [] },
  ]);
  const [historyPreview, setHistoryPreview] = useState({}); // teamId → matchCount

  // Results
  const [simResults, setSimResults] = useState(null);

  // Load global data on mount
  useEffect(() => {
    async function loadGlobal() {
      try {
        const [allTournaments, teams, players] = await Promise.all([
          getTournaments(),
          getTeams(),
          getPlayers(),
        ]);
        setTournaments(allTournaments);
        setGlobalTeams(teams);
        setGlobalPlayers(players);
      } catch (err) {
        toast.error('Failed to load registry data: ' + err.message);
      } finally {
        setLoadingGlobal(false);
      }
    }
    loadGlobal();
  }, []);

  // Eligible source tournaments
  const eligibleTournaments = tournaments.filter(
    (t) => t.status === 'completed' || t.status === 'archived'
  );

  // Toggle tournament selection
  const toggleTournament = (id) => {
    setSelectedTournIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSourceTournamentData((d) => {
          const copy = { ...d };
          delete copy[id];
          return copy;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Load match data for newly selected tournaments
  const loadSourceData = async () => {
    const unloaded = [...selectedTournIds].filter((id) => !sourceTournamentData[id]);
    if (unloaded.length === 0) { setStep(2); return; }
    setLoadingData(true);
    try {
      const loaded = await Promise.all(
        unloaded.map(async (id) => {
          const [team, player] = await Promise.all([
            getTeamMatchResults(id),
            getPlayerMatchResults(id),
          ]);
          return [id, { teamMatchResults: team, playerMatchResults: player }];
        })
      );
      setSourceTournamentData((prev) => {
        const next = { ...prev };
        for (const [id, data] of loaded) next[id] = data;
        return next;
      });
      setStep(2);
    } catch (err) {
      toast.error('Failed to load tournament data: ' + err.message);
    } finally {
      setLoadingData(false);
    }
  };

  // Roster handlers
  const addRosterRow = () =>
    setRoster((r) => [...r, { teamName: '', teamId: '', registryLinked: false, playerIds: [] }]);

  const removeRosterRow = (i) => setRoster((r) => r.filter((_, j) => j !== i));

  const updateRosterRow = (i, fields) =>
    setRoster((r) => r.map((row, j) => (j === i ? { ...row, ...fields } : row)));

  // Compute history preview when roster changes (re-scored team match results for step 3)
  useEffect(() => {
    if (step !== 3) return;
    const allTeamResults = Object.values(sourceTournamentData).flatMap(
      (d) => d.teamMatchResults || []
    );
    const preview = {};
    for (const entry of roster) {
      if (!entry.teamId) continue;
      const count = allTeamResults.filter(
        (r) => r.teamId === entry.teamId || r.teamName === entry.teamName
      ).length;
      preview[entry.teamId] = count;
    }
    setHistoryPreview(preview);
  }, [roster, sourceTournamentData, step]);

  // Run simulation
  const handleRunSimulation = async () => {
    const validRoster = roster.filter((r) => r.teamName.trim());
    if (validRoster.length < 2) {
      toast.error('Add at least 2 teams to the roster');
      return;
    }

    setRunning(true);
    try {
      const sourceTournamentDataArray = Object.values(sourceTournamentData);
      const results = runSimulation({
        sourceTournamentData: sourceTournamentDataArray,
        newScoringConfig: {
          killPointValue: Number(killPointValue),
          placementPoints: placementPoints.filter((pp) => pp.position > 0),
        },
        rosterEntries: validRoster.map((r) => ({
          teamId: r.teamId || r.teamName,
          teamName: r.teamName,
          playerIds: r.playerIds,
        })),
        globalPlayers,
      });
      setSimResults(results);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      toast.success(`Simulation complete — ${results.length} teams ranked`);
    } catch (err) {
      toast.error('Simulation failed: ' + err.message);
      console.error(err);
    } finally {
      setRunning(false);
    }
  };

  // Export helpers (identical pattern to Extraction page)
  const exportRows = (results) =>
    results.map((t) => ({
      'Predicted Rank':   t.predictedRank,
      'Team':             t.teamName,
      'Final Rating':     t.FINAL_RATING,
      'Team Rating':      t.TEAM_RATING,
      'Confidence Level': levelLabel(t.level),
      'Likely Range':     `${ordinal(t.rangeLow)}–${ordinal(t.rangeHigh)}`,
      'Power':            t.analyticsDetail?.scores?.POWER ?? '—',
      'Placement':        t.analyticsDetail?.scores?.PLACEMENT ?? '—',
      'Conversion':       t.analyticsDetail?.scores?.CONVERSION ?? '—',
      'Form':             t.analyticsDetail?.scores?.FORM ?? '—',
      'Playstyle':        t.analyticsDetail?.labels?.playstyle ?? '—',
    }));

  const handleCopyJSON = () => {
    try {
      navigator.clipboard.writeText(JSON.stringify(exportRows(simResults), null, 2));
      toast.success('Copied JSON to clipboard!');
    } catch (e) {
      toast.error('Failed to copy: ' + e.message);
    }
  };

  const handleDownloadCSV = () => {
    try {
      const csv = Papa.unparse(exportRows(simResults));
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `simulation_${(eventLabel || 'result').replace(/\s+/g, '_')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('CSV downloaded!');
    } catch (e) {
      toast.error('Failed to download: ' + e.message);
    }
  };

  const handleDownloadExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(exportRows(simResults));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Simulation');
      XLSX.writeFile(wb, `simulation_${(eventLabel || 'result').replace(/\s+/g, '_')}.xlsx`);
      toast.success('Excel downloaded!');
    } catch (e) {
      toast.error('Failed to download: ' + e.message);
    }
  };

  if (loadingGlobal) return <LoadingSpinner size="lg" text="Loading data..." />;

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FlaskConical size={26} style={{ color: 'var(--gold)' }} />
            Event Simulation
          </h1>
          <p className="page-subtitle">
            Forecast a predicted standing for an upcoming event by re-scoring historical match data under the new event's point system.
          </p>
        </div>
      </div>

      {/* Disclaimer banner */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '12px 16px', marginBottom: 24,
        background: 'rgba(201,168,76,0.06)', border: '1px solid var(--border-gold)',
        borderRadius: 10, fontSize: '0.8rem', color: 'var(--text-secondary)',
      }}>
        <AlertTriangle size={15} style={{ color: 'var(--gold)', flexShrink: 0, marginTop: 1 }} />
        <span>
          Simulation results are <strong>temporary</strong> and never saved. All computation uses only completed/archived tournament data as read-only input.
          Results vanish when you navigate away.
        </span>
      </div>

      {/* Step wizard */}
      <StepIndicator step={step} steps={STEPS} />

      {/* ── STEP 1: Source Tournaments ─────────────────────────────────── */}
      {step === 1 && (
        <div className="card">
          <h2 className="card-title" style={{ marginBottom: 4 }}>Select Source Tournaments</h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
            Only completed or archived tournaments are eligible. Match data from all selected tournaments
            will be merged and re-scored under your new event's point system.
          </p>

          {eligibleTournaments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <Database size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
              <p>No completed or archived tournaments found.</p>
              <p style={{ fontSize: '0.8rem', marginTop: 4 }}>Complete at least one tournament first.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {eligibleTournaments.map((t) => {
                const selected = selectedTournIds.has(t.id);
                return (
                  <div
                    key={t.id}
                    onClick={() => toggleTournament(t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
                      border: `1px solid ${selected ? 'var(--gold)' : 'var(--border-md)'}`,
                      background: selected ? 'rgba(201,168,76,0.07)' : 'var(--bg-alt-row)',
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                      border: `2px solid ${selected ? 'var(--gold)' : 'var(--border-md)'}`,
                      background: selected ? 'var(--gold)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {selected && <Check size={12} color="#000" />}
                    </div>

                    {/* Banner thumbnail */}
                    {(t.banner || t.bannerUrl) ? (
                      <img
                        src={t.banner || t.bannerUrl}
                        alt=""
                        style={{ width: 44, height: 26, borderRadius: 5, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border-md)' }}
                      />
                    ) : (
                      <div style={{
                        width: 44, height: 26, borderRadius: 5, flexShrink: 0,
                        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid var(--border-md)',
                      }}>
                        <Trophy size={12} style={{ color: 'var(--gold)', opacity: 0.7 }} />
                      </div>
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{t.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.season || '—'}</div>
                    </div>

                    <StatusBadge status={t.status} />

                    {sourceTournamentData[t.id] && (
                      <span style={{ fontSize: '0.72rem', color: '#22C55E', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Database size={10} />
                        {sourceTournamentData[t.id].teamMatchResults.length} match rows
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <button
              className="btn btn-primary"
              onClick={loadSourceData}
              disabled={selectedTournIds.size === 0 || loadingData}
            >
              {loadingData
                ? <><span className="spinner-sm-inline" /> Loading data...</>
                : <>Next <ChevronRight size={16} /></>
              }
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Scoring Config ─────────────────────────────────────── */}
      {step === 2 && (
        <div className="card">
          <div style={{ marginBottom: 20 }}>
            <h2 className="card-title">Define the Upcoming Event</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              This scoring configuration will be applied retroactively to all historical match data from
              the selected source tournaments. The event label is for display only.
            </p>
          </div>

          <div className="form-field" style={{ marginBottom: 20 }}>
            <label className="form-label">Event Label (display only)</label>
            <input
              className="form-input"
              value={eventLabel}
              onChange={(e) => setEventLabel(e.target.value)}
              placeholder="e.g. MGL Season 6 Finals"
              style={{ maxWidth: 400 }}
            />
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
            <ScoringConfigEditor
              killPointValue={killPointValue}
              setKillPointValue={setKillPointValue}
              placementPoints={placementPoints}
              setPlacementPoints={setPlacementPoints}
              compact
            />
          </div>

          <div className="flex-between" style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-secondary" onClick={() => setStep(1)}>
              <ChevronLeft size={16} /> Back
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setStep(3)}
              disabled={placementPoints.length === 0}
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Participating Roster ───────────────────────────────── */}
      {step === 3 && (
        <div className="card">
          <div style={{ marginBottom: 20 }}>
            <h2 className="card-title">Define the Participating Roster</h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              Add every team you expect to compete. Link teams to the global registry to pull historical match data.
              Teams not found in history will use the player-based fallback or field average.
            </p>
          </div>

          {/* Roster entries */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {roster.map((entry, i) => (
              <RosterRow
                key={i}
                index={i}
                entry={entry}
                globalTeams={globalTeams}
                globalPlayers={globalPlayers}
                historyPreview={historyPreview}
                onUpdate={updateRosterRow}
                onRemove={removeRosterRow}
              />
            ))}
          </div>

          <button className="btn btn-secondary btn-sm" onClick={addRosterRow}>
            <Plus size={13} /> Add Team
          </button>

          {/* Fallback legend */}
          <div style={{ marginTop: 20, padding: '12px 14px', background: 'var(--bg-alt-row)', borderRadius: 8, borderLeft: '3px solid var(--border-gold)' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 8 }}>How ratings are assigned:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <ConfidenceBadge level={1} />
                <span>Team has direct match history in the selected source tournaments</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <ConfidenceBadge level={2} />
                <span>No team history, but ≥1 roster player has individual history — rating derived from player averages</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <ConfidenceBadge level={3} />
                <span>No data at all — assigned the average rating of teams who do have data</span>
              </div>
            </div>
          </div>

          <div className="flex-between" style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-secondary" onClick={() => setStep(2)}>
              <ChevronLeft size={16} /> Back
            </button>
            <button
              className="btn btn-primary"
              onClick={handleRunSimulation}
              disabled={running || roster.filter((r) => r.teamName.trim()).length < 2}
            >
              {running
                ? <><span className="spinner-sm-inline" /> Running...</>
                : <><Zap size={15} /> Run Simulation</>
              }
            </button>
          </div>
        </div>
      )}

      {/* ── RESULTS ────────────────────────────────────────────────────── */}
      {simResults && (
        <div ref={resultsRef} style={{ marginTop: 32 }}>
          {/* Results header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <BarChart2 size={18} style={{ color: 'var(--gold)' }} />
                Predicted Standing
                {eventLabel && (
                  <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                    — {eventLabel}
                  </span>
                )}
              </h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 3 }}>
                {simResults.length} teams · Re-scored under {placementPoints.length} placement tier{placementPoints.length !== 1 ? 's' : ''} · {killPointValue} pts/kill
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={handleCopyJSON} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Copy size={13} /> Copy JSON
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleDownloadCSV} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Download size={13} /> Download CSV
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleDownloadExcel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Download size={13} /> Download Excel
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { setSimResults(null); setStep(3); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <RotateCcw size={13} /> Run Again
              </button>
            </div>
          </div>

          {/* Stats summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Teams Simulated',  value: simResults.length,                                                    icon: Trophy,    color: 'var(--gold)' },
              { label: 'Own History',      value: simResults.filter((t) => t.level === 1).length,                        icon: Database,  color: 'var(--success)' },
              { label: 'Player Estimate',  value: simResults.filter((t) => t.level === 2).length,                        icon: Users,     color: 'var(--warning)' },
              { label: 'Field Average',    value: simResults.filter((t) => t.level === 3).length,                        icon: AlertTriangle, color: 'var(--text-muted)' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
                padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${color}1A`, flexShrink: 0 }}>
                  <Icon size={16} style={{ color }} />
                </div>
                <div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--gold)', lineHeight: 1 }}>{value}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>{label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Results table */}
          <div className="data-table-container">
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr style={{ background: 'var(--bg-header)' }}>
                  <th style={{ padding: '10px 14px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', width: 60, textAlign: 'center', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>Rank</th>
                  <th style={{ padding: '10px 14px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>Team</th>
                  <th style={{ padding: '10px 14px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Zap size={12} style={{ color: 'var(--gold)' }} /> Rating
                    </div>
                  </th>
                  <th style={{ padding: '10px 14px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Target size={12} style={{ color: 'var(--gold)' }} /> Predicted Placement
                    </div>
                  </th>
                  <th style={{ padding: '10px 14px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <TrendingUp size={12} style={{ color: 'var(--gold)' }} /> Confidence
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {simResults.map((team, i) => (
                  <ResultRow key={team.teamId || team.teamName} team={team} index={i} />
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 10, fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Click any <strong style={{ color: 'var(--gold)' }}>Own History</strong> row to expand component scores.
            Placement ranges widen based on data confidence — wider = more uncertainty.
          </p>
        </div>
      )}
    </div>
  );
}
