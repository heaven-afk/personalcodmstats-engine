import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { computeDailyStandings, computeDailyPlayerStandings } from '../src/lib/engine/standings.js';
import fs from 'fs';
import path from 'path';

const firebaseConfig = {
  apiKey: "AIzaSyDD1I7waKhyxl8wMv_xIx3nvdC-nzOBYgE",
  authDomain: "heaven-stat-engine.firebaseapp.com",
  projectId: "heaven-stat-engine",
  storageBucket: "heaven-stat-engine.firebasestorage.app",
  messagingSenderId: "33950859525",
  appId: "1:33950859525:web:32b519e58076f13294b76c"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const TOURNAMENTS = [
  { id: 'fzfBOCu36E55QFfoBxkW', name: 'FRIENDS OR FOES', stage: 'Standard' },
  { id: 'xLGEeoQ0RBBoKnNflAw3', name: 'ELITE ESPORT', stage: 'Standard' },
  { id: 'cfyGuA5dboYeyGp4XPYC', name: 'MAJOR GAMING LEAGUE TIER 1', stage: 'Tier 1' }
];

const ARTIFACT_DIR = 'C:\\Users\\USER\\.gemini\\antigravity-ide\\brain\\91c86a89-1f8e-4932-acd7-0690b53b2ffc';
const EXPORT_DIR = 'c:\\Users\\USER\\Documents\\Projects\\PersonalStatengine\\heaven-stat-engine\\exports';

async function runExtraction() {
  console.log('Starting NovaPlay Historical Extraction...');

  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }

  const allRecords = [];
  const anomalies = [];
  const coverageStats = {
    tournamentsCount: TOURNAMENTS.length,
    tournaments: [],
    totalPlayerMatchdayRecords: 0,
    totalUniquePlayers: 0,
    totalUniqueTeams: 0,
    totalMatchdays: 0,
    tournamentBreakdown: {}
  };

  const globalPlayerIds = new Set();
  const globalPlayerNames = new Set();
  const globalTeamIds = new Set();
  const globalTeamNames = new Set();

  for (const t of TOURNAMENTS) {
    console.log(`\n======================================================`);
    console.log(`Extracting: ${t.name} (Stage/Tier: ${t.stage})`);
    console.log(`======================================================`);

    const tDoc = await getDoc(doc(db, 'tournaments', t.id));
    const tData = tDoc.data();
    const scoringConfig = tData.scoring || { killPointValue: 2, placementPoints: [] };
    const structureConfig = tData.structure || { totalDays: 6, lobbiesPerDay: 3 };

    const [pRegsSnap, tRegsSnap, pMatchSnap, tMatchSnap, bonusSnap] = await Promise.all([
      getDocs(collection(db, 'tournaments', t.id, 'playerRegistrations')),
      getDocs(collection(db, 'tournaments', t.id, 'teamRegistrations')),
      getDocs(collection(db, 'tournaments', t.id, 'playerMatchResults')),
      getDocs(collection(db, 'tournaments', t.id, 'teamMatchResults')),
      getDocs(collection(db, 'tournaments', t.id, 'bonusPoints')),
    ]);

    const playerRegs = pRegsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const teamRegs = tRegsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const playerMatches = pMatchSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const teamMatches = tMatchSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const bonusPoints = bonusSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Registrations mapping
    const teamById = new Map();
    const teamByName = new Map();
    for (const tr of teamRegs) {
      if (tr.teamId) teamById.set(String(tr.teamId).trim(), tr);
      if (tr.id) teamById.set(String(tr.id).trim(), tr);
      if (tr.teamName) teamByName.set(String(tr.teamName).trim().toLowerCase(), tr);
    }

    const regByPlayerId = new Map();
    const regByIgn = new Map();
    const regByName = new Map();
    for (const pr of playerRegs) {
      if (pr.playerId) regByPlayerId.set(String(pr.playerId).trim(), pr);
      if (pr.id) regByPlayerId.set(String(pr.id).trim(), pr);
      if (pr.ign) regByIgn.set(String(pr.ign).trim().toLowerCase(), pr);
      if (pr.professionalName) regByName.set(String(pr.professionalName).trim().toLowerCase(), pr);
      if (pr.playerName) regByName.set(String(pr.playerName).trim().toLowerCase(), pr);
    }

    // Determine actual matchdays present
    const matchdaysSet = new Set();
    for (const m of playerMatches) if (m.day) matchdaysSet.add(Number(m.day));
    for (const m of teamMatches) if (m.day) matchdaysSet.add(Number(m.day));
    const sortedDays = [...matchdaysSet].sort((a, b) => a - b);

    const tourneyPlayerIds = new Set();
    const tourneyPlayerNames = new Set();
    const tourneyTeamNames = new Set();
    let tourneyRecordCount = 0;

    const dayLobbyCounts = {};

    for (const d of sortedDays) {
      // HSE daily standings
      const dailyTeamStandings = computeDailyStandings(teamMatches, bonusPoints, scoringConfig, d);
      const dailyPlayerStandings = computeDailyPlayerStandings(
        playerMatches,
        playerRegs,
        { structure: structureConfig, scoring: scoringConfig },
        d,
        teamMatches
      );

      // Build daily team map
      // teamId -> team standing object
      const teamStandingById = new Map();
      const teamStandingByName = new Map();
      for (let idx = 0; idx < dailyTeamStandings.length; idx++) {
        const ts = dailyTeamStandings[idx];
        const rank = idx + 1;
        const entry = {
          ...ts,
          matchday_placement: rank,
        };
        if (ts.teamId) teamStandingById.set(String(ts.teamId).trim(), entry);
        if (ts.teamName) teamStandingByName.set(String(ts.teamName).trim().toLowerCase(), entry);
      }

      // Check lobby counts for this day
      const dayTeamMatches = teamMatches.filter(r => Number(r.day) === d);
      const distinctLobbies = new Set(dayTeamMatches.map(r => Number(r.lobby)));
      dayLobbyCounts[`Day_${d}`] = distinctLobbies.size;

      // Now iterate through dailyPlayerStandings
      for (const p of dailyPlayerStandings) {
        tourneyRecordCount++;
        allRecords.push(p); // placeholder, replace with structured record below

        if (p.playerId) {
          tourneyPlayerIds.add(p.playerId);
          globalPlayerIds.add(p.playerId);
        }
        if (p.playerName) {
          tourneyPlayerNames.add(p.playerName);
          globalPlayerNames.add(p.playerName);
        }
        if (p.teamName) {
          tourneyTeamNames.add(p.teamName);
          globalTeamNames.add(p.teamName);
        }
        if (p.teamId) {
          globalTeamIds.add(p.teamId);
        }
      }
    }

    coverageStats.tournamentBreakdown[t.name] = {
      tournamentId: t.id,
      stage: t.stage,
      matchdays: sortedDays,
      lobbiesPerDay: dayLobbyCounts,
      playerMatchdayRecords: tourneyRecordCount,
      uniquePlayers: tourneyPlayerNames.size,
      uniqueTeams: tourneyTeamNames.size,
    };
    coverageStats.totalMatchdays += sortedDays.length;
  }

  // Clear allRecords and build exact standardized schema
  allRecords.length = 0;

  for (const t of TOURNAMENTS) {
    const tDoc = await getDoc(doc(db, 'tournaments', t.id));
    const tData = tDoc.data();
    const scoringConfig = tData.scoring || { killPointValue: 2, placementPoints: [] };
    const structureConfig = tData.structure || { totalDays: 6, lobbiesPerDay: 3 };

    const [pRegsSnap, tRegsSnap, pMatchSnap, tMatchSnap, bonusSnap] = await Promise.all([
      getDocs(collection(db, 'tournaments', t.id, 'playerRegistrations')),
      getDocs(collection(db, 'tournaments', t.id, 'teamRegistrations')),
      getDocs(collection(db, 'tournaments', t.id, 'playerMatchResults')),
      getDocs(collection(db, 'tournaments', t.id, 'teamMatchResults')),
      getDocs(collection(db, 'tournaments', t.id, 'bonusPoints')),
    ]);

    const playerRegs = pRegsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const teamRegs = tRegsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const playerMatches = pMatchSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const teamMatches = tMatchSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const bonusPoints = bonusSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const teamById = new Map();
    const teamByName = new Map();
    for (const tr of teamRegs) {
      if (tr.teamId) teamById.set(String(tr.teamId).trim(), tr);
      if (tr.id) teamById.set(String(tr.id).trim(), tr);
      if (tr.teamName) teamByName.set(String(tr.teamName).trim().toLowerCase(), tr);
    }

    const regByPlayerId = new Map();
    const regByIgn = new Map();
    const regByName = new Map();
    for (const pr of playerRegs) {
      if (pr.playerId) regByPlayerId.set(String(pr.playerId).trim(), pr);
      if (pr.id) regByPlayerId.set(String(pr.id).trim(), pr);
      if (pr.ign) regByIgn.set(String(pr.ign).trim().toLowerCase(), pr);
      if (pr.professionalName) regByName.set(String(pr.professionalName).trim().toLowerCase(), pr);
      if (pr.playerName) regByName.set(String(pr.playerName).trim().toLowerCase(), pr);
    }

    const matchdaysSet = new Set();
    for (const m of playerMatches) if (m.day) matchdaysSet.add(Number(m.day));
    for (const m of teamMatches) if (m.day) matchdaysSet.add(Number(m.day));
    const sortedDays = [...matchdaysSet].sort((a, b) => a - b);

    for (const d of sortedDays) {
      const dailyTeamStandings = computeDailyStandings(teamMatches, bonusPoints, scoringConfig, d);
      const dailyPlayerStandings = computeDailyPlayerStandings(
        playerMatches,
        playerRegs,
        { structure: structureConfig, scoring: scoringConfig },
        d,
        teamMatches
      );

      const teamStandingById = new Map();
      const teamStandingByName = new Map();
      for (let idx = 0; idx < dailyTeamStandings.length; idx++) {
        const ts = dailyTeamStandings[idx];
        const rank = idx + 1;
        const entry = {
          ...ts,
          matchday_placement: rank,
        };
        if (ts.teamId) teamStandingById.set(String(ts.teamId).trim(), entry);
        if (ts.teamName) teamStandingByName.set(String(ts.teamName).trim().toLowerCase(), entry);
      }

      for (const p of dailyPlayerStandings) {
        // Resolve team standing
        let ts = null;
        if (p.teamId && teamStandingById.has(String(p.teamId).trim())) {
          ts = teamStandingById.get(String(p.teamId).trim());
        } else if (p.teamName && teamStandingByName.has(String(p.teamName).trim().toLowerCase())) {
          ts = teamStandingByName.get(String(p.teamName).trim().toLowerCase());
        }

        // Individual lobby breakdown for player
        const playerLobbyKills = {};
        const playerLobbyDamage = {};
        const playerLobbyAccuracy = {};
        const playerLobbyPlacement = {};

        if (p.lobbies) {
          for (const [lobbyNum, lData] of Object.entries(p.lobbies)) {
            playerLobbyKills[lobbyNum] = lData.kills ?? 0;
            playerLobbyDamage[lobbyNum] = lData.damage ?? 0;
            playerLobbyAccuracy[lobbyNum] = lData.accuracy ?? null;
          }
        }

        // Team lobby breakdown
        const teamLobbyPlacements = {};
        const teamLobbyKills = {};
        let teamMatchesWithPlacement = 0;
        let teamSumPlacement = 0;

        if (ts && ts.lobbyData) {
          for (const lRes of ts.lobbyData) {
            const lNum = String(lRes.lobby);
            teamLobbyPlacements[lNum] = Number(lRes.placement) || null;
            teamLobbyKills[lNum] = Number(lRes.kills) || 0;
            if (Number(lRes.placement) > 0) {
              teamMatchesWithPlacement++;
              teamSumPlacement += Number(lRes.placement);
            }
            if (playerLobbyKills[lNum] !== undefined) {
              playerLobbyPlacement[lNum] = Number(lRes.placement) || null;
            }
          }
        }

        // Raw & HSE Calculations
        const teamTotalKills = p.teamTotalKills ?? (ts ? ts.kills : null);
        const kills = p.totalKills ?? 0;

        let killShareRaw = null;
        let killShareHse = null;
        if (teamTotalKills != null) {
          if (teamTotalKills > 0) {
            killShareRaw = (kills / teamTotalKills) * 100;
            killShareHse = Math.round((kills / teamTotalKills) * 1000) / 10;
          } else {
            killShareRaw = 0;
            killShareHse = 0;
          }
        }

        let teamAvgPlacementRaw = null;
        let teamAvgPlacementHse = null;
        if (ts) {
          const validLobbies = teamMatchesWithPlacement > 0 ? teamMatchesWithPlacement : (ts.matches || 0);
          if (validLobbies > 0 && ts.sumOfPositions > 0) {
            teamAvgPlacementRaw = ts.sumOfPositions / validLobbies;
            teamAvgPlacementHse = Math.round((ts.sumOfPositions / validLobbies) * 100) / 100;
          }
        }

        const games = p.matches ?? Object.keys(playerLobbyKills).length;
        const avgKillsPerGameRaw = games > 0 ? kills / games : 0;
        const avgKillsPerGameHse = games > 0 ? Math.round((kills / games) * 100) / 100 : 0;

        // Anomaly Checks
        if (!p.playerName || p.playerName.trim() === '' || p.playerName === 'Unknown Player') {
          anomalies.push({
            type: 'MISSING_PLAYER_NAME',
            tournament: t.name,
            matchday: d,
            playerId: p.playerId,
            team: p.teamName
          });
        }
        if (!p.teamName || p.teamName.trim() === '' || p.teamName === 'Unknown Team') {
          anomalies.push({
            type: 'MISSING_TEAM_NAME',
            tournament: t.name,
            matchday: d,
            player: p.playerName,
            playerId: p.playerId
          });
        }
        if (teamTotalKills == null) {
          anomalies.push({
            type: 'MISSING_TEAM_DATA_FOR_KILL_SHARE',
            tournament: t.name,
            matchday: d,
            player: p.playerName,
            team: p.teamName,
            details: 'Team results document missing for this matchday in teamMatchResults'
          });
        }
        if (teamAvgPlacementRaw == null) {
          anomalies.push({
            type: 'MISSING_TEAM_AVERAGE_PLACEMENT',
            tournament: t.name,
            matchday: d,
            player: p.playerName,
            team: p.teamName,
            details: 'Team placements missing or unrecorded for this matchday'
          });
        }

        // Record schema
        const record = {
          tournament: t.name,
          stage: t.stage,
          matchday: d,
          player: p.playerName,
          player_id: p.playerId || null,
          ign: p.ign || null,
          team: p.teamName,
          team_id: p.teamId || (ts ? ts.teamId : null) || null,
          player_class: p.class || null,
          kills: kills,
          kill_share: killShareHse,
          kill_share_raw: killShareRaw,
          team_average_placement: teamAvgPlacementHse,
          team_average_placement_raw: teamAvgPlacementRaw,
          games: games,
          team_games: ts ? ts.matches : 0,
          team_total_kills: teamTotalKills,
          lobby_kills: playerLobbyKills,
          lobby_damage: playerLobbyDamage,
          lobby_accuracy: playerLobbyAccuracy,
          individual_lobby_placement: playerLobbyPlacement,
          team_lobby_placements: teamLobbyPlacements,
          team_lobby_kills: teamLobbyKills,
          matchday_placement: ts ? ts.matchday_placement : null,
          player_matchday_rank: p.rank ?? null,
          total_placement_points: ts ? ts.placementPts : null,
          total_kill_points: ts ? ts.killPts : null,
          team_bonus_points: ts ? ts.bonusPts : null,
          team_total_points: ts ? ts.totalPts : null,
          average_kills_per_game: avgKillsPerGameHse,
          average_kills_per_game_raw: avgKillsPerGameRaw,
          total_damage: p.totalDamage ?? 0,
          average_damage_per_game: p.avgDamage ?? 0,
          average_accuracy: p.avgAccuracy ?? 0,
          accuracy_samples_count: p.accuracyCount ?? 0,
        };

        allRecords.push(record);
      }
    }
  }

  // Cross-tournament player multi-team check
  const playerTeamsAcrossTourneys = new Map();
  for (const r of allRecords) {
    const pKey = r.player_id || r.player;
    if (!playerTeamsAcrossTourneys.has(pKey)) playerTeamsAcrossTourneys.set(pKey, new Map());
    const tourneyTeams = playerTeamsAcrossTourneys.get(pKey);
    const tourneyKey = `${r.tournament}_D${r.matchday}`;
    tourneyTeams.set(tourneyKey, r.team);
  }

  // Identify players playing under multiple teams within the same tournament
  const playerTourneyTeams = new Map();
  for (const r of allRecords) {
    const pKey = `${r.tournament}:::${r.player}`;
    if (!playerTourneyTeams.has(pKey)) playerTourneyTeams.set(pKey, new Set());
    playerTourneyTeams.get(pKey).add(r.team);
  }
  for (const [pKey, teamsSet] of playerTourneyTeams.entries()) {
    if (teamsSet.size > 1) {
      const [tourney, player] = pKey.split(':::');
      anomalies.push({
        type: 'PLAYER_APPEARS_UNDER_MULTIPLE_TEAMS',
        tournament: tourney,
        player: player,
        teams: [...teamsSet],
        details: `Player played under ${teamsSet.size} different team names across matchdays in the same tournament.`
      });
    }
  }

  coverageStats.totalPlayerMatchdayRecords = allRecords.length;
  coverageStats.totalUniquePlayers = globalPlayerNames.size;
  coverageStats.totalUniqueTeams = globalTeamNames.size;

  console.log(`\n======================================================`);
  console.log(`EXTRACTION COMPLETE:`);
  console.log(`- Tournaments: ${coverageStats.tournamentsCount}`);
  console.log(`- Total Matchdays: ${coverageStats.totalMatchdays}`);
  console.log(`- Unique Players: ${coverageStats.totalUniquePlayers}`);
  console.log(`- Unique Teams: ${coverageStats.totalUniqueTeams}`);
  console.log(`- Total Player-Matchday Records: ${coverageStats.totalPlayerMatchdayRecords}`);
  console.log(`- Total Anomalies Flagged: ${anomalies.length}`);
  console.log(`======================================================`);

  // Write JSON dataset
  const jsonPathExport = path.join(EXPORT_DIR, 'novaplay_hse_historical_dataset.json');
  const jsonPathArtifact = path.join(ARTIFACT_DIR, 'novaplay_hse_historical_dataset.json');
  fs.writeFileSync(jsonPathExport, JSON.stringify(allRecords, null, 2));
  fs.writeFileSync(jsonPathArtifact, JSON.stringify(allRecords, null, 2));
  console.log(`Saved JSON to: ${jsonPathExport} and ${jsonPathArtifact}`);

  // Write CSV dataset (flattened)
  const csvHeaders = [
    'tournament',
    'stage',
    'matchday',
    'player',
    'player_id',
    'ign',
    'team',
    'team_id',
    'player_class',
    'kills',
    'kill_share',
    'kill_share_raw',
    'team_average_placement',
    'team_average_placement_raw',
    'games',
    'team_games',
    'team_total_kills',
    'lobby_1_kills',
    'lobby_2_kills',
    'lobby_3_kills',
    'lobby_1_placement',
    'lobby_2_placement',
    'lobby_3_placement',
    'matchday_placement',
    'player_matchday_rank',
    'total_placement_points',
    'total_kill_points',
    'team_bonus_points',
    'team_total_points',
    'average_kills_per_game',
    'average_kills_per_game_raw',
    'total_damage',
    'average_damage_per_game',
    'average_accuracy'
  ];

  function escapeCsv(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const csvRows = [csvHeaders.join(',')];
  for (const r of allRecords) {
    const row = [
      escapeCsv(r.tournament),
      escapeCsv(r.stage),
      escapeCsv(r.matchday),
      escapeCsv(r.player),
      escapeCsv(r.player_id),
      escapeCsv(r.ign),
      escapeCsv(r.team),
      escapeCsv(r.team_id),
      escapeCsv(r.player_class),
      escapeCsv(r.kills),
      escapeCsv(r.kill_share),
      escapeCsv(r.kill_share_raw),
      escapeCsv(r.team_average_placement),
      escapeCsv(r.team_average_placement_raw),
      escapeCsv(r.games),
      escapeCsv(r.team_games),
      escapeCsv(r.team_total_kills),
      escapeCsv(r.lobby_kills['1'] ?? ''),
      escapeCsv(r.lobby_kills['2'] ?? ''),
      escapeCsv(r.lobby_kills['3'] ?? ''),
      escapeCsv(r.individual_lobby_placement['1'] ?? ''),
      escapeCsv(r.individual_lobby_placement['2'] ?? ''),
      escapeCsv(r.individual_lobby_placement['3'] ?? ''),
      escapeCsv(r.matchday_placement),
      escapeCsv(r.player_matchday_rank),
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

  const csvContent = csvRows.join('\n');
  const csvPathExport = path.join(EXPORT_DIR, 'novaplay_hse_historical_dataset.csv');
  const csvPathArtifact = path.join(ARTIFACT_DIR, 'novaplay_hse_historical_dataset.csv');
  fs.writeFileSync(csvPathExport, csvContent);
  fs.writeFileSync(csvPathArtifact, csvContent);
  console.log(`Saved CSV to: ${csvPathExport} and ${csvPathArtifact}`);

  // Write Quality Report JSON
  const qualityReport = {
    coverage: coverageStats,
    anomaliesSummary: {
      totalAnomalies: anomalies.length,
      anomalies
    }
  };
  const reportPathExport = path.join(EXPORT_DIR, 'novaplay_data_quality_report.json');
  const reportPathArtifact = path.join(ARTIFACT_DIR, 'novaplay_data_quality_report.json');
  fs.writeFileSync(reportPathExport, JSON.stringify(qualityReport, null, 2));
  fs.writeFileSync(reportPathArtifact, JSON.stringify(qualityReport, null, 2));
  console.log(`Saved Quality Report to: ${reportPathExport} and ${reportPathArtifact}`);

  console.log('All files saved successfully!');
}

runExtraction().catch(e => { console.error('Error during extraction:', e); process.exit(1); });
