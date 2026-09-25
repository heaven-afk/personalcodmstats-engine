import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
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
  { id: 'fzfBOCu36E55QFfoBxkW', name: 'FRIENDS OR FOES', stage: 'N/A' },
  { id: 'xLGEeoQ0RBBoKnNflAw3', name: 'ELITE ESPORT', stage: 'N/A' },
  { id: 'cfyGuA5dboYeyGp4XPYC', name: 'MAJOR GAMING LEAGUE TIER 1', stage: 'Tier 1' }
];

async function analyzeAll() {
  const anomalies = [];
  const allPlayerMatchdayRecords = [];

  for (const t of TOURNAMENTS) {
    console.log(`Processing ${t.name}...`);
    const tDoc = await getDoc(doc(db, 'tournaments', t.id));
    const tData = tDoc.data();
    const scoringConfig = tData.scoring || { killPointValue: 2, placementPoints: [] };

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

    // Build lookups
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

    // Inspect team matches by day & team
    // day -> teamId -> { kills, sumPlacement, lobbies: { [lobby]: { placement, kills } }, matchesCount, placementPts }
    const teamDayStats = new Map(); // key: `${day}_${teamId}` or `${day}_${teamNameLower}`
    const teamDayById = new Map(); // key: `${day}_${teamId}`
    const teamDayByName = new Map(); // key: `${day}_${teamNameLower}`

    // Function to calculate placement points based on tournament scoringConfig
    function getPlacementPts(placement) {
      if (!placement || placement <= 0) return 0;
      const ptsList = scoringConfig.placementPoints || [];
      const match = ptsList.find(p => Number(p.position) === Number(placement));
      return match ? Number(match.points) : 0;
    }

    // Check unique days and lobbies
    const dayLobbies = new Map();
    for (const tm of teamMatches) {
      const d = Number(tm.day);
      const l = Number(tm.lobby);
      if (!dayLobbies.has(d)) dayLobbies.set(d, new Set());
      dayLobbies.get(d).add(l);

      const tId = tm.teamId ? String(tm.teamId).trim() : null;
      const tName = tm.teamName ? String(tm.teamName).trim() : '';
      const tNameLower = tName.toLowerCase();

      const dayKeyId = tId ? `${d}_${tId}` : null;
      const dayKeyName = tNameLower ? `${d}_${tNameLower}` : null;

      const initEntry = () => ({
        day: d,
        teamId: tId,
        teamName: tName,
        totalKills: 0,
        sumPlacement: 0,
        matchesWithPlacement: 0,
        totalLobbies: 0,
        placementPts: 0,
        lobbyPlacements: {},
        lobbyKills: {},
      });

      if (dayKeyId) {
        if (!teamDayById.has(dayKeyId)) teamDayById.set(dayKeyId, initEntry());
        const entry = teamDayById.get(dayKeyId);
        entry.totalKills += Number(tm.kills) || 0;
        if (Number(tm.placement) > 0) {
          entry.sumPlacement += Number(tm.placement);
          entry.matchesWithPlacement += 1;
        }
        entry.totalLobbies += 1;
        entry.placementPts += getPlacementPts(tm.placement);
        entry.lobbyPlacements[l] = Number(tm.placement) || null;
        entry.lobbyKills[l] = Number(tm.kills) || 0;
      }

      if (dayKeyName) {
        if (!teamDayByName.has(dayKeyName)) teamDayByName.set(dayKeyName, initEntry());
        const entry = teamDayByName.get(dayKeyName);
        if (!dayKeyId) {
          entry.totalKills += Number(tm.kills) || 0;
          if (Number(tm.placement) > 0) {
            entry.sumPlacement += Number(tm.placement);
            entry.matchesWithPlacement += 1;
          }
          entry.totalLobbies += 1;
          entry.placementPts += getPlacementPts(tm.placement);
          entry.lobbyPlacements[l] = Number(tm.placement) || null;
          entry.lobbyKills[l] = Number(tm.kills) || 0;
        }
      }
    }

    console.log(`  Days in tournament:`, [...dayLobbies.keys()].sort((a,b)=>a-b));
    for (const [d, lSet] of dayLobbies.entries()) {
      console.log(`    Day ${d}: Lobbies = ${[...lSet].sort((a,b)=>a-b).join(', ')} (Count: ${lSet.size})`);
    }

    // Player match results aggregation by: Player + Day
    // Note: player can be identified by playerId or fallback to playerName
    const playerDayMap = new Map(); // key: `${playerId}_${day}` or `${nameLower}_${day}`

    for (const pm of playerMatches) {
      const d = Number(pm.day);
      const l = Number(pm.lobby);
      const rawPid = pm.playerId ? String(pm.playerId).trim() : null;
      const rawPname = pm.playerName ? String(pm.playerName).trim() : '';
      const rawTname = pm.teamName ? String(pm.teamName).trim() : '';

      // Lookup registration
      let reg = null;
      if (rawPid && regByPlayerId.has(rawPid)) reg = regByPlayerId.get(rawPid);
      else if (rawPname && regByName.has(rawPname.toLowerCase())) reg = regByName.get(rawPname.toLowerCase());
      else if (rawPname && regByIgn.has(rawPname.toLowerCase())) reg = regByIgn.get(rawPname.toLowerCase());

      const finalPlayerId = reg?.playerId || reg?.id || rawPid || null;
      const finalPlayerName = reg?.professionalName || rawPname || reg?.playerName || reg?.ign || 'Unknown Player';
      const finalIgn = reg?.ign || rawPname || null;
      const finalTeamName = reg?.teamName || rawTname || 'Unknown Team';
      let finalTeamId = reg?.teamId || null;

      if (!finalTeamId && finalTeamName) {
        const tr = teamByName.get(finalTeamName.toLowerCase());
        if (tr) finalTeamId = tr.teamId || tr.id;
      }

      // Check integrity: missing player name or team name
      if (!rawPname && !reg?.professionalName && !reg?.ign) {
        anomalies.push({
          type: 'MISSING_PLAYER_NAME',
          tournament: t.name,
          day: d,
          lobby: l,
          docId: pm.id,
          data: pm
        });
      }
      if (!finalTeamName || finalTeamName === 'Unknown Team') {
        anomalies.push({
          type: 'MISSING_TEAM_NAME',
          tournament: t.name,
          day: d,
          lobby: l,
          playerId: finalPlayerId,
          playerName: finalPlayerName,
          docId: pm.id
        });
      }

      const pKey = `${finalPlayerId || finalPlayerName.toLowerCase()}_d${d}`;

      if (!playerDayMap.has(pKey)) {
        playerDayMap.set(pKey, {
          tournament: t.name,
          stage: t.stage,
          matchday: d,
          player: finalPlayerName,
          player_id: finalPlayerId,
          ign: finalIgn,
          team: finalTeamName,
          team_id: finalTeamId,
          player_class: reg?.class || null,
          slot: reg?.slot || null,
          kills: 0,
          damage: 0,
          accuracy_sum: 0,
          accuracy_count: 0,
          lobbies_played: 0,
          lobby_kills: {},
          lobby_damage: {},
          lobby_accuracy: {},
          raw_matches: []
        });
      }

      const pEntry = playerDayMap.get(pKey);
      pEntry.kills += Number(pm.kills) || 0;
      pEntry.damage += Number(pm.damage) || 0;
      if (pm.accuracy != null && Number(pm.accuracy) > 0) {
        pEntry.accuracy_sum += Number(pm.accuracy);
        pEntry.accuracy_count += 1;
      }
      pEntry.lobbies_played += 1;
      pEntry.lobby_kills[l] = Number(pm.kills) || 0;
      pEntry.lobby_damage[l] = Number(pm.damage) || 0;
      if (pm.accuracy != null) pEntry.lobby_accuracy[l] = Number(pm.accuracy);
      pEntry.raw_matches.push(pm);

      // Check team consistency
      if (rawTname && pEntry.team && rawTname.toLowerCase() !== pEntry.team.toLowerCase()) {
        anomalies.push({
          type: 'PLAYER_TEAM_MISMATCH_IN_MATCHDAY',
          tournament: t.name,
          matchday: d,
          player: finalPlayerName,
          recordedTeam: pEntry.team,
          lobbyTeam: rawTname,
          lobby: l
        });
      }
    }

    console.log(`  Aggregated ${playerDayMap.size} player-matchdays.`);

    // Now connect team matchday stats (Kill Share, Team Average Placement, Team Total Kills, etc.)
    for (const [pKey, pRecord] of playerDayMap.entries()) {
      const d = pRecord.matchday;
      const tId = pRecord.team_id;
      const tNameLower = pRecord.team.toLowerCase();

      // Find team stats
      let tStats = null;
      if (tId && teamDayById.has(`${d}_${tId}`)) {
        tStats = teamDayById.get(`${d}_${tId}`);
      } else if (teamDayByName.has(`${d}_${tNameLower}`)) {
        tStats = teamDayByName.get(`${d}_${tNameLower}`);
      }

      // If team stats not found in teamMatchResults, check why
      let teamTotalKills = null;
      let teamAvgPlacementRaw = null;
      let teamAvgPlacementHse = null;
      let teamLobbyPlacements = {};
      let teamLobbyKills = {};
      let teamTotalPlacementPts = null;
      let teamMatchdayLobbies = 0;

      if (tStats) {
        teamTotalKills = tStats.totalKills;
        teamMatchdayLobbies = tStats.matchesWithPlacement > 0 ? tStats.matchesWithPlacement : tStats.totalLobbies;
        teamLobbyPlacements = tStats.lobbyPlacements;
        teamLobbyKills = tStats.lobbyKills;
        teamTotalPlacementPts = tStats.placementPts;

        if (tStats.matchesWithPlacement > 0) {
          teamAvgPlacementRaw = tStats.sumPlacement / tStats.matchesWithPlacement;
          teamAvgPlacementHse = Math.round((tStats.sumPlacement / tStats.matchesWithPlacement) * 100) / 100;
        } else if (tStats.totalLobbies > 0 && tStats.sumPlacement > 0) {
          teamAvgPlacementRaw = tStats.sumPlacement / tStats.totalLobbies;
          teamAvgPlacementHse = Math.round((tStats.sumPlacement / tStats.totalLobbies) * 100) / 100;
        }
      } else {
        anomalies.push({
          type: 'MISSING_TEAM_MATCH_RESULTS',
          tournament: t.name,
          matchday: d,
          team: pRecord.team,
          team_id: tId,
          player: pRecord.player
        });
      }

      // Kill share calculation:
      // Raw: playerKills / teamTotalKills * 100
      // HSE: Math.round((p.totalKills / teamTotalKills) * 1000) / 10
      let killShareRaw = null;
      let killShareHse = null;

      if (teamTotalKills != null) {
        if (teamTotalKills > 0) {
          killShareRaw = (pRecord.kills / teamTotalKills) * 100;
          killShareHse = Math.round((pRecord.kills / teamTotalKills) * 1000) / 10;
        } else {
          killShareRaw = 0;
          killShareHse = 0;
          if (pRecord.kills > 0) {
            anomalies.push({
              type: 'PLAYER_KILLS_EXCEED_ZERO_TEAM_KILLS',
              tournament: t.name,
              matchday: d,
              player: pRecord.player,
              playerKills: pRecord.kills,
              teamTotalKills
            });
          }
        }
      } else {
        anomalies.push({
          type: 'MISSING_KILL_SHARE_DUE_TO_NO_TEAM_DATA',
          tournament: t.name,
          matchday: d,
          player: pRecord.player,
          team: pRecord.team
        });
      }

      const avgKillsPerLobbyRaw = pRecord.lobbies_played > 0 ? pRecord.kills / pRecord.lobbies_played : 0;
      const avgKillsPerLobbyHse = pRecord.lobbies_played > 0 ? Math.round((pRecord.kills / pRecord.lobbies_played) * 100) / 100 : 0;
      const avgDamagePerLobby = pRecord.lobbies_played > 0 ? Math.round(pRecord.damage / pRecord.lobbies_played) : 0;
      const avgAccuracy = pRecord.accuracy_count > 0 ? Math.round((pRecord.accuracy_sum / pRecord.accuracy_count) * 10) / 10 : 0;

      const record = {
        tournament: t.name,
        stage: t.stage,
        matchday: d,
        player: pRecord.player,
        player_id: pRecord.player_id,
        ign: pRecord.ign,
        team: pRecord.team,
        team_id: pRecord.team_id,
        kills: pRecord.kills,
        kill_share_raw: killShareRaw,
        kill_share_hse: killShareHse,
        team_average_placement_raw: teamAvgPlacementRaw,
        team_average_placement_hse: teamAvgPlacementHse,
        games: pRecord.lobbies_played,
        team_games: teamMatchdayLobbies,
        team_total_kills: teamTotalKills,
        lobby_kills: pRecord.lobby_kills,
        team_lobby_placements: teamLobbyPlacements,
        team_lobby_kills: teamLobbyKills,
        team_placement_points: teamTotalPlacementPts,
        average_kills_per_game_raw: avgKillsPerLobbyRaw,
        average_kills_per_game_hse: avgKillsPerLobbyHse,
        damage: pRecord.damage,
        average_damage_per_game: avgDamagePerLobby,
        accuracy: avgAccuracy,
      };

      allPlayerMatchdayRecords.push(record);
    }
  }

  console.log(`\n======================================================`);
  console.log(`Total Player-Matchday Records: ${allPlayerMatchdayRecords.length}`);
  console.log(`Total Anomalies Detected: ${anomalies.length}`);
  console.log(`======================================================`);

  const anomalyTypeCounts = {};
  for (const a of anomalies) {
    anomalyTypeCounts[a.type] = (anomalyTypeCounts[a.type] || 0) + 1;
  }
  console.log('Anomaly breakdown by type:', anomalyTypeCounts);

  // Sample record
  console.log('\nSample record:', JSON.stringify(allPlayerMatchdayRecords[0], null, 2));

  // Write scratch test outputs
  fs.writeFileSync('scripts/anomalies_summary.json', JSON.stringify({ anomalyTypeCounts, anomalies: anomalies.slice(0, 50) }, null, 2));
}

analyzeAll().catch(e => { console.error(e); process.exit(1); });
