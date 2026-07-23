import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';
import * as localDb from './localStorageDb';

export async function getGroups(tournamentId) {
  if (!isFirebaseConfigured) {
    return localDb.localGetGroups(tournamentId);
  }
  const snap = await getDocs(
    query(collection(db, 'tournaments', tournamentId, 'groups'), orderBy('createdAt', 'asc'))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getGroup(tournamentId, groupId) {
  if (!isFirebaseConfigured) {
    return localDb.localGetGroup(tournamentId, groupId);
  }
  const snap = await getDoc(doc(db, 'tournaments', tournamentId, 'groups', groupId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createGroup(tournamentId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localCreateGroup(tournamentId, data);
  }
  const ref = await addDoc(
    collection(db, 'tournaments', tournamentId, 'groups'),
    {
      groupName: '',
      structure: { totalDays: 6, lobbiesPerDay: 4, playerClasses: [] },
      advancementCount: 2,
      status: 'setup',
      createdAt: serverTimestamp(),
      ...data,
    }
  );
  return { id: ref.id, ...data };
}

export async function updateGroup(tournamentId, groupId, data) {
  if (!isFirebaseConfigured) {
    return localDb.localUpdateGroup(tournamentId, groupId, data);
  }
  await updateDoc(doc(db, 'tournaments', tournamentId, 'groups', groupId), data);
}

export async function deleteGroup(tournamentId, groupId) {
  if (!isFirebaseConfigured) {
    return localDb.localDeleteGroup(tournamentId, groupId);
  }
  await deleteDoc(doc(db, 'tournaments', tournamentId, 'groups', groupId));
}
