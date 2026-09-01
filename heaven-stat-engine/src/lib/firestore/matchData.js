import {
  collection, collectionGroup, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';
import * as localDb from './localStorageDb';

// ─── Team Match Results ───────────────────────────────────────────────────────
export async function getTeamMatchResults(tournamentId) {
  if (!isFirebaseConfigured) {
    return localDb.localGetTeamMatchResults(tournamentId);
  }
  const snap = await getDocs(
    query(collection(db, 'tournaments', tournamentId, 'teamMatchResults'), orderBy('day'), orderBy('lobby'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getTeamMatchResultsByDayLobby(tournamentId, day, lobby) {
  if (!isFirebaseConfigured) {
    const list = await getTeamMatchResults(tournamentId);
    return list.filter(r => r.day === day && r.lobby === lobby);
  }
  const snap = await getDocs(
    query(
      collection(db, 'tournaments', tournamentId, 'teamMatchResults'),
      where('day', '==', day),
      where('lobby', '==', lobby)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function saveTeamMatchResult(tournamentId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localSaveTeamMatchResult(tournamentId, data);
  }
  const ref = await addDoc(
    collection(db, 'tournaments', tournamentId, 'teamMatchResults'),
    { teamId: '', day: 1, lobby: 1, placement: 0, kills: 0, ...data }
  );
  return { id: ref.id, ...data };
}

export async function updateTeamMatchResult(tournamentId, resultId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localUpdateTeamMatchResult(tournamentId, resultId, data);
  }
  await updateDoc(doc(db, 'tournaments', tournamentId, 'teamMatchResults', resultId), data);
}

export async function deleteTeamMatchResult(tournamentId, resultId) {
  if (!isFirebaseConfigured) {
    return localDb.localDeleteTeamMatchResult(tournamentId, resultId);
  }
  await deleteDoc(doc(db, 'tournaments', tournamentId, 'teamMatchResults', resultId));
}

export async function getTeamMatchResultsByGroup(tournamentId, groupId) {
  if (!isFirebaseConfigured) {
    const list = await getTeamMatchResults(tournamentId);
    return list.filter(r => r.groupId === groupId);
  }
  const snap = await getDocs(
    query(
      collection(db, 'tournaments', tournamentId, 'teamMatchResults'),
      where('groupId', '==', groupId)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getAllMatchResultsForPlayer(playerId) {
  if (!isFirebaseConfigured) {
    return localDb.localGetAllMatchResultsForPlayer(playerId);
  }
  try {
    const snap = await getDocs(
      query(collectionGroup(db, 'playerMatchResults'), where('playerId', '==', playerId))
    );
    return snap.docs.map((d) => ({
      id: d.id,
      tournamentId: d.ref.parent?.parent?.id || '',
      ...d.data(),
    }));
  } catch (err) {
    console.warn('[getAllMatchResultsForPlayer] collectionGroup query failed, using fallback:', err);
    try {
      const tourneysSnap = await getDocs(collection(db, 'tournaments'));
      const tourneys = tourneysSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const allMatchesNested = await Promise.all(
        tourneys.map(async (t) => {
          try {
            const snap = await getDocs(
              query(
                collection(db, 'tournaments', t.id, 'playerMatchResults'),
                where('playerId', '==', playerId)
              )
            );
            return snap.docs.map((d) => ({
              id: d.id,
              tournamentId: t.id,
              ...d.data(),
            }));
          } catch (e) {
            return [];
          }
        })
      );
      return allMatchesNested.flat();
    } catch (fallbackErr) {
      console.error('[getAllMatchResultsForPlayer] Fallback failed:', fallbackErr);
      throw err;
    }
  }
}

export async function getPlayerMatchResults(tournamentId) {
  if (!isFirebaseConfigured) {
    return localDb.localGetPlayerMatchResults(tournamentId);
  }
  const snap = await getDocs(
    query(collection(db, 'tournaments', tournamentId, 'playerMatchResults'), orderBy('day'), orderBy('lobby'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getPlayerMatchResultsByGroup(tournamentId, groupId) {
  if (!isFirebaseConfigured) {
    const list = await getPlayerMatchResults(tournamentId);
    return list.filter(r => r.groupId === groupId);
  }
  const snap = await getDocs(
    query(
      collection(db, 'tournaments', tournamentId, 'playerMatchResults'),
      where('groupId', '==', groupId)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getPlayerMatchResultsByDayLobby(tournamentId, day, lobby) {
  if (!isFirebaseConfigured) {
    const list = await getPlayerMatchResults(tournamentId);
    return list.filter(r => r.day === day && r.lobby === lobby);
  }
  const snap = await getDocs(
    query(
      collection(db, 'tournaments', tournamentId, 'playerMatchResults'),
      where('day', '==', day),
      where('lobby', '==', lobby)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function savePlayerMatchResult(tournamentId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localSavePlayerMatchResult(tournamentId, data);
  }
  const ref = await addDoc(
    collection(db, 'tournaments', tournamentId, 'playerMatchResults'),
    { playerId: '', day: 1, lobby: 1, kills: 0, damage: 0, accuracy: 0, reviveType: 'auto', ...data }
  );
  return { id: ref.id, ...data };
}

export async function updatePlayerMatchResult(tournamentId, resultId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localUpdatePlayerMatchResult(tournamentId, resultId, data);
  }
  await updateDoc(doc(db, 'tournaments', tournamentId, 'playerMatchResults', resultId), data);
}

export async function deletePlayerMatchResult(tournamentId, resultId) {
  if (!isFirebaseConfigured) {
    return localDb.localDeletePlayerMatchResult(tournamentId, resultId);
  }
  await deleteDoc(doc(db, 'tournaments', tournamentId, 'playerMatchResults', resultId));
}

// ─── Bonus Points ─────────────────────────────────────────────────────────────
export async function getBonusPoints(tournamentId) {
  if (!isFirebaseConfigured) {
    return localDb.localGetBonusPoints(tournamentId);
  }
  const snap = await getDocs(
    query(collection(db, 'tournaments', tournamentId, 'bonusPoints'), orderBy('day'), orderBy('teamId'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getBonusPointsByGroup(tournamentId, groupId) {
  if (!isFirebaseConfigured) {
    const list = await getBonusPoints(tournamentId);
    return list.filter(b => b.groupId === groupId);
  }
  const snap = await getDocs(
    query(
      collection(db, 'tournaments', tournamentId, 'bonusPoints'),
      where('groupId', '==', groupId)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addBonusPoint(tournamentId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localAddBonusPoint(tournamentId, data);
  }
  const ref = await addDoc(
    collection(db, 'tournaments', tournamentId, 'bonusPoints'),
    { teamId: '', day: 1, type: '', amount: 0, note: '', ...data }
  );
  return { id: ref.id, ...data };
}

export async function updateBonusPoint(tournamentId, bonusId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localUpdateBonusPoint(tournamentId, bonusId, data);
  }
  await updateDoc(doc(db, 'tournaments', tournamentId, 'bonusPoints', bonusId), data);
}

export async function deleteBonusPoint(tournamentId, bonusId) {
  if (!isFirebaseConfigured) {
    return localDb.localDeleteBonusPoint(tournamentId, bonusId);
  }
  await deleteDoc(doc(db, 'tournaments', tournamentId, 'bonusPoints', bonusId));
}
