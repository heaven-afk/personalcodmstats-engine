import {
  collection, collectionGroup, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, writeBatch,
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

export async function createTournament(data, userRole, creatorUid, creatorEmail) {
  const initialEditors = data.editorUids || (creatorUid ? [creatorUid, creatorEmail?.toLowerCase()].filter(Boolean) : []);
  const createdBy = data.createdBy || creatorUid || null;
  const resolvedCreatorEmail = data.creatorEmail || (creatorEmail ? creatorEmail.toLowerCase() : null);

  if (!isFirebaseConfigured) {
    return localDb.localCreateTournament({ ...data, editorUids: initialEditors, createdBy, creatorEmail: resolvedCreatorEmail });
  }
  const payload = {
    name: '', season: '', description: '', status: 'setup',
    type: data.type || 'standard',
    eventStartDate: data.eventStartDate || null,
    eventEndDate: data.eventEndDate || null,
    createdAt: serverTimestamp(), completedAt: null,
    scoring: { killPointValue: 2, placementPoints: [], bonusTypes: [] },
    createdBy,
    creatorEmail: resolvedCreatorEmail,
    editorUids: initialEditors,
    ...data,
    editorUids: data.editorUids !== undefined ? data.editorUids : initialEditors,
  };
  if (payload.type === 'standard' && !payload.structure) {
    payload.structure = { totalDays: 6, lobbiesPerDay: 4, playerClasses: [] };
  }
  const ref = await addDoc(collection(db, 'tournaments'), payload);
  return { id: ref.id, ...payload };
}

export async function updateTournament(id, data) {
  if (!isFirebaseConfigured) {
    return localDb.localUpdateTournament(id, data);
  }
  await updateDoc(doc(db, 'tournaments', id), data);
}

export async function updateTournamentEditors(id, editorUids) {
  if (!isFirebaseConfigured) {
    return localDb.localUpdateTournament(id, { editorUids });
  }
  await updateDoc(doc(db, 'tournaments', id), { editorUids });
}

export async function setTournamentStatus(id, status) {
  if (!isFirebaseConfigured) {
    return localDb.localSetTournamentStatus(id, status);
  }
  const updates = { status };
  if (status === 'completed') updates.completedAt = serverTimestamp();
  await updateDoc(doc(db, 'tournaments', id), updates);
}

export async function setTournamentRanked(id, isRanked, tier) {
  if (!isFirebaseConfigured) {
    // localDb fallback — just update the tournament record
    return localDb.localUpdateTournament(id, {
      isRanked,
      rankedTier: isRanked ? tier : null,
      rankedAt: isRanked ? new Date().toISOString() : null,
    });
  }
  const updates = {
    isRanked: !!isRanked,
    rankedTier: isRanked ? tier : null,
    rankedAt: isRanked ? serverTimestamp() : null,
  };
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
export async function getAllRegistrationsForPlayer(playerId) {
  if (!isFirebaseConfigured) {
    return localDb.localGetAllRegistrationsForPlayer(playerId);
  }
  const snap = await getDocs(
    query(collectionGroup(db, 'playerRegistrations'), where('playerId', '==', playerId))
  );
  return snap.docs.map((d) => ({
    id: d.id,
    tournamentId: d.ref.parent?.parent?.id || '',
    ...d.data(),
  }));
}

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

export async function clearAllPlayerRegistrations(tournamentId, regIds) {
  if (!isFirebaseConfigured) {
    return localDb.localClearAllPlayerRegistrations(tournamentId);
  }
  const chunkSize = 500;
  for (let i = 0; i < regIds.length; i += chunkSize) {
    const chunk = regIds.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    chunk.forEach(id => {
      batch.delete(doc(db, 'tournaments', tournamentId, 'playerRegistrations', id));
    });
    await batch.commit();
  }
}

export async function clearAllTeamRegistrations(tournamentId, regIds) {
  if (!isFirebaseConfigured) {
    return localDb.localClearAllTeamRegistrations(tournamentId);
  }
  const chunkSize = 500;
  for (let i = 0; i < regIds.length; i += chunkSize) {
    const chunk = regIds.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    chunk.forEach(id => {
      batch.delete(doc(db, 'tournaments', tournamentId, 'teamRegistrations', id));
    });
    await batch.commit();
  }
}

