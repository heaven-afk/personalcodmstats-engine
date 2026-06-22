import { getTeam, updateTeam, deleteTeam } from './registry';
import {
  getTournaments,
  getTeamRegistrations,
  updateTeamRegistration,
  deleteTeamRegistration,
  getPlayerRegistrations,
  updatePlayerRegistration,
} from './tournaments';
import {
  getTeamMatchResults,
  updateTeamMatchResult,
  deleteTeamMatchResult,
  getPlayerMatchResults,
  updatePlayerMatchResult,
  getBonusPoints,
  updateBonusPoint,
} from './matchData';

/**
 * Merges a source (duplicate) team into a target (canonical) team.
 * Re-associates all registrations, match results, and bonus points.
 * Deletes the source team from the registry when complete.
 */
export async function mergeTeams(sourceTeamId, targetTeamId) {
  if (!sourceTeamId || !targetTeamId) {
    throw new Error('Source team ID and Target team ID are required.');
  }
  if (sourceTeamId === targetTeamId) {
    throw new Error('Cannot merge a team into itself.');
  }

  const sourceTeam = await getTeam(sourceTeamId);
  const targetTeam = await getTeam(targetTeamId);

  if (!sourceTeam) throw new Error(`Source team not found for ID: ${sourceTeamId}`);
  if (!targetTeam) throw new Error(`Target team not found for ID: ${targetTeamId}`);

  console.log(`Merging Team: "${sourceTeam.teamName}" (${sourceTeamId}) into "${targetTeam.teamName}" (${targetTeamId})...`);

  // 1. Merge basic attributes
  const teamUpdates = {};
  if (!targetTeam.clanName && sourceTeam.clanName) {
    teamUpdates.clanName = sourceTeam.clanName;
  }
  if (!targetTeam.logo && sourceTeam.logo) {
    teamUpdates.logo = sourceTeam.logo;
  }
  if (!targetTeam.logoUrl && sourceTeam.logoUrl) {
    teamUpdates.logoUrl = sourceTeam.logoUrl;
  }

  // Merge tournament ids list (union)
  const sourceTournaments = sourceTeam.tournamentIds || [];
  const targetTournaments = targetTeam.tournamentIds || [];
  const mergedTournaments = Array.from(new Set([...sourceTournaments, ...targetTournaments]));
  teamUpdates.tournamentIds = mergedTournaments;

  await updateTeam(targetTeamId, teamUpdates);

  // Get final consolidated info
  const finalClanName = targetTeam.clanName || teamUpdates.clanName || '';

  // 2. Fetch all tournaments to update database entries
  const tournaments = await getTournaments();

  for (const tourney of tournaments) {
    const tId = tourney.id;

    // A. Team Registrations
    const teamRegs = await getTeamRegistrations(tId);
    const sourceReg = teamRegs.find(r => r.teamId === sourceTeamId);
    const targetReg = teamRegs.find(r => r.teamId === targetTeamId);

    if (sourceReg) {
      if (targetReg) {
        // Both registered. Delete source registration, keeping target's slot/tier.
        await deleteTeamRegistration(tId, sourceReg.id);
      } else {
        // Source registered, target is not. Move registration to target.
        await updateTeamRegistration(tId, sourceReg.id, {
          teamId: targetTeamId,
          teamName: targetTeam.teamName,
          clanName: finalClanName,
        });
      }
    }

    // B. Player Registrations (Update team fields for players on the duplicate team)
    const playerRegs = await getPlayerRegistrations(tId);
    const sourcePlayerRegs = playerRegs.filter(r => r.teamId === sourceTeamId);
    for (const reg of sourcePlayerRegs) {
      await updatePlayerRegistration(tId, reg.id, {
        teamId: targetTeamId,
        teamName: targetTeam.teamName,
        clanName: finalClanName,
      });
    }

    // C. Team Match Results
    const teamResults = await getTeamMatchResults(tId);
    const sourceResults = teamResults.filter(r => r.teamId === sourceTeamId);
    const targetResults = teamResults.filter(r => r.teamId === targetTeamId);

    for (const sRes of sourceResults) {
      // Check if target team already has results in this lobby
      const collision = targetResults.find(tRes => tRes.day === sRes.day && tRes.lobby === sRes.lobby);
      if (collision) {
        // Duplicate results. Delete the duplicate's result.
        await deleteTeamMatchResult(tId, sRes.id);
      } else {
        // Move the result to target team
        await updateTeamMatchResult(tId, sRes.id, {
          teamId: targetTeamId,
          teamName: targetTeam.teamName,
          clanName: finalClanName,
        });
      }
    }

    // D. Player Match Results (Update team information in player match rows)
    const playerResults = await getPlayerMatchResults(tId);
    const sourcePlayerResults = playerResults.filter(r => r.teamId === sourceTeamId);
    for (const pRes of sourcePlayerResults) {
      await updatePlayerMatchResult(tId, pRes.id, {
        teamId: targetTeamId,
        teamName: targetTeam.teamName,
        clanName: finalClanName,
      });
    }

    // E. Bonus Points
    const bonusPoints = await getBonusPoints(tId);
    const sourceBonuses = bonusPoints.filter(b => b.teamId === sourceTeamId);
    for (const bonus of sourceBonuses) {
      await updateBonusPoint(tId, bonus.id, {
        teamId: targetTeamId,
      });
    }
  }

  // 3. Delete the duplicate team
  await deleteTeam(sourceTeamId);
  console.log(`Successfully merged "${sourceTeam.teamName}" into "${targetTeam.teamName}".`);
}
