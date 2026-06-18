import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';
import * as localDb from './localStorageDb';

// ─── Tournaments ──────────────────────────────────────────────────────────────
export async function getTournaments() {
  if (!isFirebaseConfigured) {
    return localDb.localGetTournaments();
  }
  const snap = await getDocs(query(collection(db, 'tournaments'), orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getTournament(id) {
  if (!isFirebaseConfigured) {
    return localDb.localGetTournament(id);
  }
  const snap = await getDoc(doc(db, 'tournaments', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createTournament(data) {
  if (!isFirebaseConfigured) {
    return localDb.localCreateTournament(data);
  }
  const ref = await addDoc(collection(db, 'tournaments'), {
    name: '', season: '', description: '', status: 'setup',
    createdAt: serverTimestamp(), completedAt: null,
    structure: { totalDays: 6, lobbiesPerDay: 4, playerClasses: [] },
    scoring: { killPointValue: 2, placementPoints: [], bonusTypes: [] },
    ...data,
  });
  return { id: ref.id, ...data };
}

export async function updateTournament(id, data) {
  if (!isFirebaseConfigured) {
    return localDb.localUpdateTournament(id, data);
  }
  await updateDoc(doc(db, 'tournaments', id), data);
}

export async function setTournamentStatus(id, status) {
  if (!isFirebaseConfigured) {
    return localDb.localSetTournamentStatus(id, status);
  }
  const updates = { status };
  if (status === 'completed') updates.completedAt = serverTimestamp();
  await updateDoc(doc(db, 'tournaments', id), updates);
}

export async function deleteTournament(id) {
  if (!isFirebaseConfigured) {
    return localDb.localDeleteTournament(id);
  }
  await deleteDoc(doc(db, 'tournaments', id));
}

// ─── Team Registrations ───────────────────────────────────────────────────────
export async function getTeamRegistrations(tournamentId) {
  if (!isFirebaseConfigured) {
    return localDb.localGetTeamRegistrations(tournamentId);
  }
  const snap = await getDocs(
    query(collection(db, 'tournaments', tournamentId, 'teamRegistrations'), orderBy('slot'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addTeamRegistration(tournamentId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localAddTeamRegistration(tournamentId, data);
  }
  const ref = await addDoc(
    collection(db, 'tournaments', tournamentId, 'teamRegistrations'),
    { teamId: '', slot: 0, tier: '', ...data }
  );
  return { id: ref.id, ...data };
}

export async function updateTeamRegistration(tournamentId, regId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localUpdateTeamRegistration(tournamentId, regId, data);
  }
  await updateDoc(doc(db, 'tournaments', tournamentId, 'teamRegistrations', regId), data);
}

export async function deleteTeamRegistration(tournamentId, regId) {
  if (!isFirebaseConfigured) {
    return localDb.localDeleteTeamRegistration(tournamentId, regId);
  }
  await deleteDoc(doc(db, 'tournaments', tournamentId, 'teamRegistrations', regId));
}

// ─── Player Registrations ─────────────────────────────────────────────────────
export async function getPlayerRegistrations(tournamentId) {
  if (!isFirebaseConfigured) {
    return localDb.localGetPlayerRegistrations(tournamentId);
  }
  const snap = await getDocs(
    query(collection(db, 'tournaments', tournamentId, 'playerRegistrations'), orderBy('slot'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addPlayerRegistration(tournamentId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localAddPlayerRegistration(tournamentId, data);
  }
  const ref = await addDoc(
    collection(db, 'tournaments', tournamentId, 'playerRegistrations'),
    { playerId: '', slot: 0, class: '', teamId: '', ign: '', ...data }
  );
  return { id: ref.id, ...data };
}

export async function updatePlayerRegistration(tournamentId, regId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localUpdatePlayerRegistration(tournamentId, regId, data);
  }
  await updateDoc(doc(db, 'tournaments', tournamentId, 'playerRegistrations', regId), data);
}

export async function deletePlayerRegistration(tournamentId, regId) {
  if (!isFirebaseConfigured) {
    return localDb.localDeletePlayerRegistration(tournamentId, regId);
  }
  await deleteDoc(doc(db, 'tournaments', tournamentId, 'playerRegistrations', regId));
}
