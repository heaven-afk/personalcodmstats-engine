/**
 * importEngine.js
 * Processes parsed CSV data and saves it to Firestore or local storage.
 * Ensures duplicates are avoided and links tables correctly.
 * Supports row-by-row onProgress callbacks.
 */
import { createTeam, createPlayer } from '@/lib/firestore/registry';
import { getTeamRegistrations, getPlayerRegistrations, addTeamRegistration, addPlayerRegistration } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, saveTeamMatchResult, updateTeamMatchResult, getPlayerMatchResults, savePlayerMatchResult, updatePlayerMatchResult } from '@/lib/firestore/matchData';
import { parseTeamRegistrationCSV, parsePlayerRegistrationCSV, parseTeamMatchCSV, parsePlayerMatchCSV } from './csvParser';

export async function importTeamRegistrations(tournamentId, csvText, onProgress) {
  const { rows, errors } = parseTeamRegistrationCSV(csvText);
  const validRows = rows.filter(r => r.teamName?.trim());
  const total = validRows.length;

  const existingRegs = await getTeamRegistrations(tournamentId);
  const existingNames = new Set(existingRegs.map(r => r.teamName?.toLowerCase()));

  let added = 0;
  let skipped = 0;
  const errorLogs = [];

  for (let i = 0; i < total; i++) {
    const row = validRows[i];
    try {
      if (existingNames.has(row.teamName.toLowerCase())) {
        skipped++;
      } else {
        const team = await createTeam({ teamName: row.teamName.trim(), clanName: row.clanName?.trim() || '' });
        await addTeamRegistration(tournamentId, {
          teamId: team.id,
          teamName: team.teamName,
          clanName: team.clanName,
          slot: row.slot || (existingRegs.length + added + 1),
          tier: row.tier || '',
        });
        added++;
      }
    } catch (err) {
      errorLogs.push(`Row ${row.rowIndex + 1}: ${err.message}`);
    }
    if (onProgress) onProgress(i + 1, total, row.teamName);
  }

  return { added, skipped, errors: errorLogs };
}

export async function importPlayerRegistrations(tournamentId, csvText, onProgress) {
  const { rows, errors } = parsePlayerRegistrationCSV(csvText);
  const validRows = rows.filter(r => r.professionalName?.trim() || r.ign?.trim());
  const total = validRows.length;

  const teamRegs = await getTeamRegistrations(tournamentId);
  const existingRegs = await getPlayerRegistrations(tournamentId);

  // Lookup keys for registered players
  const existingKeys = new Set(existingRegs.map(r => `${(r.professionalName || '').toLowerCase()}|${(r.ign || '').toLowerCase()}`));

  let added = 0;
  let skipped = 0;
  const errorLogs = [];

  for (let i = 0; i < total; i++) {
    const row = validRows[i];
    try {
      const key = `${(row.professionalName || '').toLowerCase()}|${(row.ign || '').toLowerCase()}`;
      if (existingKeys.has(key)) {
        skipped++;
      } else {
        const matchedTeam = teamRegs.find(
          t => t.teamName?.toLowerCase() === row.teamName?.toLowerCase()
        );

        const player = await createPlayer({
          professionalName: row.professionalName || '',
          ign: row.ign || '',
          gender: row.gender || '',
          region: row.region || '',
          country: row.country || '',
          device: row.device || '',
          deviceModel: row.deviceModel || '',
          category: row.class || 'Registered',
        });

        await addPlayerRegistration(tournamentId, {
          playerId: player.id,
          slot: row.slot || (existingRegs.length + added + 1),
          class: row.class || 'Registered',
          teamId: matchedTeam?.teamId || '',
          teamName: row.teamName || '',
          ign: player.ign,
          professionalName: player.professionalName,
        });
        added++;
      }
    } catch (err) {
      errorLogs.push(`Row ${row.rowIndex + 1}: ${err.message}`);
    }
    if (onProgress) onProgress(i + 1, total, row.professionalName || row.ign);
  }

  return { added, skipped, errors: errorLogs };
}

export async function importTeamMatchResults(tournamentId, csvText, onProgress) {
  const { rows, errors } = parseTeamMatchCSV(csvText);
  const validRows = rows.filter(r => r.teamName?.trim() && Number(r.day) > 0 && Number(r.lobby) > 0);
  const total = validRows.length;

  const teamRegs = await getTeamRegistrations(tournamentId);
  const existingResults = await getTeamMatchResults(tournamentId);

  let added = 0;
  let updated = 0;
  const errorLogs = [];

  for (let i = 0; i < total; i++) {
    const row = validRows[i];
    try {
      // Find registered team
      let teamReg = teamRegs.find(t => t.teamName?.toLowerCase() === row.teamName.toLowerCase());
      let teamId;
      if (teamReg) {
        teamId = teamReg.teamId;
      } else {
        // dynamically register the team if not registered
        const team = await createTeam({ teamName: row.teamName.trim() });
        teamId = team.id;
        teamReg = await addTeamRegistration(tournamentId, {
          teamId,
          teamName: row.teamName.trim(),
          slot: teamRegs.length + 1
        });
        teamRegs.push(teamReg);
      }

      // Check if match result already exists
      const existing = existingResults.find(
        r => Number(r.day) === Number(row.day) && Number(r.lobby) === Number(row.lobby) && r.teamId === teamId
      );

      if (existing) {
        await updateTeamMatchResult(tournamentId, existing.id, {
          placement: row.placement,
          kills: row.kills
        });
        updated++;
      } else {
        const saved = await saveTeamMatchResult(tournamentId, {
          teamId,
          teamName: row.teamName.trim(),
          day: row.day,
          lobby: row.lobby,
          placement: row.placement,
          kills: row.kills
        });
        existingResults.push(saved);
        added++;
      }
    } catch (err) {
      errorLogs.push(`Row ${row.rowIndex + 1}: ${err.message}`);
    }
    if (onProgress) onProgress(i + 1, total, `${row.teamName} (D${row.day} L${row.lobby})`);
  }

  return { added, updated, errors: errorLogs };
}

export async function importPlayerMatchResults(tournamentId, csvText, onProgress) {
  const { rows, errors } = parsePlayerMatchCSV(csvText);
  const validRows = rows.filter(r => r.playerIGN?.trim() && Number(r.day) > 0 && Number(r.lobby) > 0);
  const total = validRows.length;

  const playerRegs = await getPlayerRegistrations(tournamentId);
  const existingResults = await getPlayerMatchResults(tournamentId);

  let added = 0;
  let updated = 0;
  const errorLogs = [];

  for (let i = 0; i < total; i++) {
    const row = validRows[i];
    try {
      const searchName = row.playerIGN || '';
      let playerReg = playerRegs.find(
        p => p.ign?.toLowerCase() === searchName.toLowerCase() || p.professionalName?.toLowerCase() === searchName.toLowerCase()
      );

      let playerId;
      let playerName = searchName;

      if (playerReg) {
        playerId = playerReg.playerId;
        playerName = playerReg.professionalName || playerReg.ign;
      } else {
        // dynamically create and register player
        const player = await createPlayer({ ign: searchName, professionalName: searchName });
        playerId = player.id;
        playerName = player.professionalName || player.ign;
        playerReg = await addPlayerRegistration(tournamentId, {
          playerId,
          ign: searchName,
          professionalName: searchName,
          teamName: row.teamName || '',
          slot: playerRegs.length + 1
        });
        playerRegs.push(playerReg);
      }

      // Check if match result already exists
      const existing = existingResults.find(
        r => Number(r.day) === Number(row.day) && Number(r.lobby) === Number(row.lobby) && r.playerId === playerId
      );

      const payload = {
        playerId,
        playerName,
        teamName: row.teamName || playerReg?.teamName || '',
        day: row.day,
        lobby: row.lobby,
        kills: row.kills,
        damage: row.damage,
        accuracy: row.accuracy
      };

      if (existing) {
        await updatePlayerMatchResult(tournamentId, existing.id, payload);
        updated++;
      } else {
        const saved = await savePlayerMatchResult(tournamentId, payload);
        existingResults.push(saved);
        added++;
      }
    } catch (err) {
      errorLogs.push(`Row ${row.rowIndex + 1}: ${err.message}`);
    }
    if (onProgress) onProgress(i + 1, total, `${playerName} (D${row.day} L${row.lobby})`);
  }

  return { added, updated, errors: errorLogs };
}
