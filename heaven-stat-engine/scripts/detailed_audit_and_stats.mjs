import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = 'C:\\Users\\USER\\.gemini\\antigravity-ide\\brain\\91c86a89-1f8e-4932-acd7-0690b53b2ffc';
const EXPORT_DIR = 'c:\\Users\\USER\\Documents\\Projects\\PersonalStatengine\\heaven-stat-engine\\exports';

const jsonPath = path.join(EXPORT_DIR, 'novaplay_hse_historical_dataset.json');
const records = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

console.log(`Loaded ${records.length} records.`);

// Function to calculate exact percentiles using linear interpolation (standard numpy method)
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (upper >= sorted.length) return sorted[sorted.length - 1];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function median(arr) {
  return percentile(arr, 50);
}

function stdDev(arr, m) {
  if (arr.length <= 1) return 0;
  const avg = m !== undefined ? m : mean(arr);
  const sumSquares = arr.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0);
  return Math.sqrt(sumSquares / arr.length);
}

// -------------------------------------------------------------
// 1. MISSING VALUE AUDIT
// -------------------------------------------------------------
const missingAudit = {
  kills: { count: 0, percentage: 0, affected: [] },
  kill_share: { count: 0, percentage: 0, affected: [] },
  team_average_placement: { count: 0, percentage: 0, affected: [] },
  team_total_kills: { count: 0, percentage: 0, affected: [] },
  games: { count: 0, percentage: 0, affected: [] },
  team_games: { count: 0, percentage: 0, affected: [] }
};

for (const r of records) {
  const tInfo = `${r.tournament} (Day ${r.matchday})`;
  
  if (r.kills == null || isNaN(r.kills)) {
    missingAudit.kills.count++;
    missingAudit.kills.affected.push({ ...r, reason: 'kills is null/NaN' });
  }
  if (r.kill_share == null || isNaN(r.kill_share)) {
    missingAudit.kill_share.count++;
    missingAudit.kill_share.affected.push({ tournament: r.tournament, matchday: r.matchday, player: r.player, team: r.team });
  }
  if (r.team_average_placement == null || isNaN(r.team_average_placement)) {
    missingAudit.team_average_placement.count++;
    missingAudit.team_average_placement.affected.push({ tournament: r.tournament, matchday: r.matchday, player: r.player, team: r.team, reason: 'No placement recorded in teamMatchResults' });
  }
  if (r.team_total_kills == null || isNaN(r.team_total_kills)) {
    missingAudit.team_total_kills.count++;
    missingAudit.team_total_kills.affected.push({ tournament: r.tournament, matchday: r.matchday, player: r.player, team: r.team });
  }
  if (r.games == null || isNaN(r.games)) {
    missingAudit.games.count++;
    missingAudit.games.affected.push({ tournament: r.tournament, matchday: r.matchday, player: r.player });
  }
  if (r.team_games == null || isNaN(r.team_games)) {
    missingAudit.team_games.count++;
    missingAudit.team_games.affected.push({ tournament: r.tournament, matchday: r.matchday, player: r.player, team: r.team });
  }
}

for (const key of Object.keys(missingAudit)) {
  missingAudit[key].percentage = (missingAudit[key].count / records.length) * 100;
}

// -------------------------------------------------------------
// 2. INVALID OR SUSPICIOUS VALUES
// -------------------------------------------------------------
const suspiciousAudit = {
  killShareOver100: [],
  killShareUnder0: [],
  avgPlacementUnder1: [],
  avgPlacementImpossible: [], // > 25
  negativeKills: [],
  zeroGameRecords: [],
  missingTeamData: [],
  playerKillsExceedTeamKills: [],
  mathematicalInconsistencies: []
};

for (const r of records) {
  // Kill Share > 100%
  if (r.kill_share_raw != null && r.kill_share_raw > 100) {
    suspiciousAudit.killShareOver100.push({
      tournament: r.tournament,
      matchday: r.matchday,
      player: r.player,
      team: r.team,
      playerKills: r.kills,
      teamKills: r.team_total_kills,
      killShareRaw: r.kill_share_raw,
      killShareHse: r.kill_share
    });
  }
  // Kill Share < 0%
  if (r.kill_share_raw != null && r.kill_share_raw < 0) {
    suspiciousAudit.killShareUnder0.push(r);
  }
  // Average placement < 1
  if (r.team_average_placement != null && r.team_average_placement < 1) {
    suspiciousAudit.avgPlacementUnder1.push(r);
  }
  // Average placement > 25
  if (r.team_average_placement != null && r.team_average_placement > 25) {
    suspiciousAudit.avgPlacementImpossible.push(r);
  }
  // Negative kills
  if (r.kills != null && r.kills < 0) {
    suspiciousAudit.negativeKills.push(r);
  }
  // Zero-game records
  if (r.games === 0) {
    suspiciousAudit.zeroGameRecords.push(r);
  }
  // Missing team data
  if (!r.team || r.team.trim() === '' || r.team === 'Unknown Team') {
    suspiciousAudit.missingTeamData.push(r);
  }
  // Player kills exceed team total kills
  if (r.team_total_kills != null && r.kills > r.team_total_kills) {
    suspiciousAudit.playerKillsExceedTeamKills.push({
      tournament: r.tournament,
      matchday: r.matchday,
      player: r.player,
      team: r.team,
      playerKills: r.kills,
      teamKills: r.team_total_kills,
      diff: r.kills - r.team_total_kills
    });
  }
}

// -------------------------------------------------------------
// 3. STATISTICAL ANALYSIS OF KILLS
// -------------------------------------------------------------
function analyzeKills(recordsSubset, label) {
  const killsList = recordsSubset.map(r => Number(r.kills) || 0);
  const min = Math.min(...killsList);
  const max = Math.max(...killsList);
  const avg = mean(killsList);
  const med = median(killsList);
  const p25 = percentile(killsList, 25);
  const p50 = percentile(killsList, 50);
  const p75 = percentile(killsList, 75);
  const p90 = percentile(killsList, 90);
  const p95 = percentile(killsList, 95);
  const p99 = percentile(killsList, 99);
  const std = stdDev(killsList, avg);

  return {
    label,
    sampleSize: killsList.length,
    min,
    max,
    mean: Number(avg.toFixed(3)),
    median: med,
    p25,
    p50,
    p75,
    p90,
    p95,
    p99,
    stdDev: Number(std.toFixed(3)),
    iqr: p75 - p25
  };
}

const overallStats = analyzeKills(records, 'OVERALL COMBINED');
const fofStats = analyzeKills(records.filter(r => r.tournament === 'FRIENDS OR FOES'), 'FRIENDS OR FOES');
const eeStats = analyzeKills(records.filter(r => r.tournament === 'ELITE ESPORT'), 'ELITE ESPORT');
const mglStats = analyzeKills(records.filter(r => r.tournament === 'MAJOR GAMING LEAGUE TIER 1'), 'MAJOR GAMING LEAGUE TIER 1');

console.log('\n=============================================================');
console.log('KILLS STATISTICAL DISTRIBUTION');
console.log('=============================================================');
console.table([overallStats, fofStats, eeStats, mglStats]);

console.log('\n=============================================================');
console.log('MISSING VALUE SUMMARY');
console.log('=============================================================');
for (const [field, data] of Object.entries(missingAudit)) {
  console.log(`${field.padEnd(25)}: Count = ${data.count} (${data.percentage.toFixed(3)}%)`);
}

console.log('\n=============================================================');
console.log('SUSPICIOUS / INVALID VALUE SUMMARY');
console.log('=============================================================');
console.log(`Kill Share > 100%                 : ${suspiciousAudit.killShareOver100.length}`);
console.log(`Kill Share < 0%                   : ${suspiciousAudit.killShareUnder0.length}`);
console.log(`Avg Placement < 1                 : ${suspiciousAudit.avgPlacementUnder1.length}`);
console.log(`Avg Placement > 25 (Impossible)   : ${suspiciousAudit.avgPlacementImpossible.length}`);
console.log(`Negative Kills                    : ${suspiciousAudit.negativeKills.length}`);
console.log(`Zero Game Records                 : ${suspiciousAudit.zeroGameRecords.length}`);
console.log(`Missing Team Data                 : ${suspiciousAudit.missingTeamData.length}`);
console.log(`Player Kills > Team Total Kills   : ${suspiciousAudit.playerKillsExceedTeamKills.length}`);

// -------------------------------------------------------------
// 4. RE-GENERATE ENHANCED CSV WITH ALL SPECIFICALLY REQUESTED FIELDS
// -------------------------------------------------------------
const enhancedCsvHeaders = [
  'tournament',
  'stage',
  'matchday',
  'player',
  'player_id',
  'team',
  'team_id',
  'kills',
  'kill_share',
  'raw_kill_share',
  'team_average_placement',
  'raw_team_average_placement',
  'games',
  'team_games',
  'team_total_kills',
  'lobby_kills',
  'individual_lobby_placement',
  'team_lobby_placements',
  'team_lobby_kills',
  'matchday_placement',
  'player_matchday_rank',
  'lobby_1_kills',
  'lobby_2_kills',
  'lobby_3_kills',
  'individual_lobby_1_placement',
  'individual_lobby_2_placement',
  'individual_lobby_3_placement',
  'team_lobby_1_placement',
  'team_lobby_2_placement',
  'team_lobby_3_placement',
  'team_lobby_1_kills',
  'team_lobby_2_kills',
  'team_lobby_3_kills',
  'ign',
  'player_class',
  'total_placement_points',
  'total_kill_points',
  'team_bonus_points',
  'team_total_points',
  'average_kills_per_game',
  'raw_average_kills_per_game',
  'total_damage',
  'average_damage_per_game',
  'average_accuracy'
];

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const csvRows = [enhancedCsvHeaders.join(',')];
for (const r of records) {
  const row = [
    escapeCsv(r.tournament),
    escapeCsv(r.stage),
    escapeCsv(r.matchday),
    escapeCsv(r.player),
    escapeCsv(r.player_id),
    escapeCsv(r.team),
    escapeCsv(r.team_id),
    escapeCsv(r.kills),
    escapeCsv(r.kill_share),
    escapeCsv(r.kill_share_raw),
    escapeCsv(r.team_average_placement),
    escapeCsv(r.team_average_placement_raw),
    escapeCsv(r.games),
    escapeCsv(r.team_games),
    escapeCsv(r.team_total_kills),
    escapeCsv(r.lobby_kills),
    escapeCsv(r.individual_lobby_placement),
    escapeCsv(r.team_lobby_placements),
    escapeCsv(r.team_lobby_kills),
    escapeCsv(r.matchday_placement),
    escapeCsv(r.player_matchday_rank),
    escapeCsv(r.lobby_kills?.['1'] ?? ''),
    escapeCsv(r.lobby_kills?.['2'] ?? ''),
    escapeCsv(r.lobby_kills?.['3'] ?? ''),
    escapeCsv(r.individual_lobby_placement?.['1'] ?? ''),
    escapeCsv(r.individual_lobby_placement?.['2'] ?? ''),
    escapeCsv(r.individual_lobby_placement?.['3'] ?? ''),
    escapeCsv(r.team_lobby_placements?.['1'] ?? ''),
    escapeCsv(r.team_lobby_placements?.['2'] ?? ''),
    escapeCsv(r.team_lobby_placements?.['3'] ?? ''),
    escapeCsv(r.team_lobby_kills?.['1'] ?? ''),
    escapeCsv(r.team_lobby_kills?.['2'] ?? ''),
    escapeCsv(r.team_lobby_kills?.['3'] ?? ''),
    escapeCsv(r.ign),
    escapeCsv(r.player_class),
    escapeCsv(r.total_placement_points),
    escapeCsv(r.total_kill_points),
    escapeCsv(r.team_bonus_points),
    escapeCsv(r.team_total_points),
    escapeCsv(r.average_kills_per_game),
    escapeCsv(r.average_kills_per_game_raw),
    escapeCsv(r.total_damage),
    escapeCsv(r.average_damage_per_game),
    escapeCsv(r.average_accuracy)
  ];
  csvRows.push(row.join(','));
}

const finalCsvContent = csvRows.join('\n');
fs.writeFileSync(path.join(EXPORT_DIR, 'novaplay_hse_historical_dataset.csv'), finalCsvContent);
fs.writeFileSync(path.join(ARTIFACT_DIR, 'novaplay_hse_historical_dataset.csv'), finalCsvContent);
console.log('Updated enhanced CSV written to exports and artifacts successfully.');

// Write full audit stats JSON
const auditExport = {
  summary: {
    totalRecords: records.length,
    tournamentsCount: 3,
    overallKillStats: overallStats,
    tournamentKillStats: {
      'FRIENDS OR FOES': fofStats,
      'ELITE ESPORT': eeStats,
      'MAJOR GAMING LEAGUE TIER 1': mglStats
    }
  },
  missingAudit,
  suspiciousAudit
};

fs.writeFileSync(path.join(EXPORT_DIR, 'novaplay_detailed_audit_stats.json'), JSON.stringify(auditExport, null, 2));
fs.writeFileSync(path.join(ARTIFACT_DIR, 'novaplay_detailed_audit_stats.json'), JSON.stringify(auditExport, null, 2));
console.log('Saved detailed audit stats JSON successfully.');
