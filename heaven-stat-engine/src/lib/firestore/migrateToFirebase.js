/**
 * migrateToFirebase.js
 *
 * Reads all data from the browser's localStorage (offline demo mode)
 * and writes it into the live Firebase Firestore database.
 *
 * This should only be called when isFirebaseConfigured is TRUE.
 * The localStorage data is left intact after migration (non-destructive).
 */

import {
  collection, doc, setDoc, addDoc, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readLocal(key, fallback = []) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

// Strip localStorage mock timestamps so Firestore can accept them cleanly
function cleanTimestamps(obj) {
  const cleaned = { ...obj };
  // Remove local mock timestamp objects; Firestore will set its own
  if (cleaned.createdAt && typeof cleaned.createdAt === 'object' && 'toDate' in cleaned.createdAt) {
    delete cleaned.createdAt;
  }
  if (cleaned.completedAt && typeof cleaned.completedAt === 'object' && 'toDate' in cleaned.completedAt) {
    delete cleaned.completedAt;
  }
  return cleaned;
}

// Firestore allows max 500 ops per batch
async function batchWrite(collectionRef, items, getIdFn = null) {
  const BATCH_SIZE = 400;
  let count = 0;
  let batch = writeBatch(db);

  for (const item of items) {
    const { id, ...data } = item;
    const cleanedData = cleanTimestamps(data);
    // Use the local id as the Firestore doc id so references stay consistent
    const docRef = getIdFn
      ? doc(collectionRef, getIdFn(item))
      : doc(collectionRef, id);
    batch.set(docRef, { ...cleanedData, createdAt: serverTimestamp() });
    count++;

    if (count >= BATCH_SIZE) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
  }
}

// ─── Migration Steps ──────────────────────────────────────────────────────────

async function migratePlayers(onProgress) {
  const players = readLocal('heaven_players');
  onProgress({ step: 'players', total: players.length, done: 0 });
  await batchWrite(collection(db, 'players'), players);
  onProgress({ step: 'players', total: players.length, done: players.length });
  return players.length;
}

async function migrateTeams(onProgress) {
  const teams = readLocal('heaven_teams');
  onProgress({ step: 'teams', total: teams.length, done: 0 });
  await batchWrite(collection(db, 'teams'), teams);
  onProgress({ step: 'teams', total: teams.length, done: teams.length });
  return teams.length;
}

async function migrateClans(onProgress) {
  const clans = readLocal('heaven_clans');
  onProgress({ step: 'clans', total: clans.length, done: 0 });
  await batchWrite(collection(db, 'clans'), clans);
  onProgress({ step: 'clans', total: clans.length, done: clans.length });
  return clans.length;
}

async function migrateTournaments(onProgress) {
  const tournaments = readLocal('heaven_tournaments');
  onProgress({ step: 'tournaments', total: tournaments.length, done: 0 });

  for (const tournament of tournaments) {
    const { id, ...data } = tournament;
    const cleanedData = cleanTimestamps(data);
    const tournamentRef = doc(db, 'tournaments', id);
    await setDoc(tournamentRef, { ...cleanedData, createdAt: serverTimestamp() });

    // ── Sub-collections ──────────────────────────────────────────────────────

    // Team Registrations
    const teamRegs = readLocal(`heaven_regs_teams_${id}`);
    if (teamRegs.length > 0) {
      await batchWrite(collection(db, 'tournaments', id, 'teamRegistrations'), teamRegs);
    }

    // Player Registrations
    const playerRegs = readLocal(`heaven_regs_players_${id}`);
    if (playerRegs.length > 0) {
      await batchWrite(collection(db, 'tournaments', id, 'playerRegistrations'), playerRegs);
    }

    // Team Match Results
    const teamResults = readLocal(`heaven_results_teams_${id}`);
    if (teamResults.length > 0) {
      await batchWrite(collection(db, 'tournaments', id, 'teamMatchResults'), teamResults);
    }

    // Player Match Results
    const playerResults = readLocal(`heaven_results_players_${id}`);
    if (playerResults.length > 0) {
      await batchWrite(collection(db, 'tournaments', id, 'playerMatchResults'), playerResults);
    }

    // Bonus Points
    const bonusPoints = readLocal(`heaven_bonus_${id}`);
    if (bonusPoints.length > 0) {
      await batchWrite(collection(db, 'tournaments', id, 'bonusPoints'), bonusPoints);
    }
  }

  onProgress({ step: 'tournaments', total: tournaments.length, done: tournaments.length });
  return tournaments.length;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Migrates all localStorage data to Firestore.
 *
 * @param {function} onProgress  - Callback({ step, total, done, message })
 * @returns {Promise<object>}    - Summary of counts migrated
 */
export async function migrateLocalToFirebase(onProgress = () => {}) {
  const summary = {};

  onProgress({ message: 'Migrating players...' });
  summary.players = await migratePlayers(onProgress);

  onProgress({ message: 'Migrating teams...' });
  summary.teams = await migrateTeams(onProgress);

  onProgress({ message: 'Migrating clans...' });
  summary.clans = await migrateClans(onProgress);

  onProgress({ message: 'Migrating tournaments, registrations & match results...' });
  summary.tournaments = await migrateTournaments(onProgress);

  onProgress({ message: 'Migration complete!', done: true });
  return summary;
}

/**
 * Exports all localStorage data as a downloadable JSON file.
 * This provides a backup before or after migration.
 */
export function exportLocalDatabaseAsJSON() {
  const tournaments = readLocal('heaven_tournaments');

  const fullExport = {
    exportedAt: new Date().toISOString(),
    players: readLocal('heaven_players'),
    teams: readLocal('heaven_teams'),
    clans: readLocal('heaven_clans'),
    tournaments: tournaments.map((t) => ({
      ...t,
      teamRegistrations: readLocal(`heaven_regs_teams_${t.id}`),
      playerRegistrations: readLocal(`heaven_regs_players_${t.id}`),
      teamMatchResults: readLocal(`heaven_results_teams_${t.id}`),
      playerMatchResults: readLocal(`heaven_results_players_${t.id}`),
      bonusPoints: readLocal(`heaven_bonus_${t.id}`),
    })),
  };

  const blob = new Blob([JSON.stringify(fullExport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `heaven-stat-engine-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
