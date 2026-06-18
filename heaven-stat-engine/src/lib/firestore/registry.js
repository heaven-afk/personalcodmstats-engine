import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';
import * as localDb from './localStorageDb';
import { deriveRegion, deriveDevice } from '../regionDeviceLogic';

// ─── Players ──────────────────────────────────────────────────────────────────
export async function getPlayers() {
  if (!isFirebaseConfigured) {
    return localDb.localGetPlayers();
  }
  const snap = await getDocs(query(collection(db, 'players'), orderBy('professionalName')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getPlayer(id) {
  if (!isFirebaseConfigured) {
    return localDb.localGetPlayer(id);
  }
  const snap = await getDoc(doc(db, 'players', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function findPlayerByName(professionalName, ign) {
  const players = await getPlayers();
  const pn = professionalName?.toLowerCase();
  const ignLower = ign?.toLowerCase();
  return players.find(
    (p) => p.professionalName?.toLowerCase() === pn || p.ign?.toLowerCase() === ignLower
  ) || null;
}

export async function createPlayer(data) {
  // Auto-derive region and device if not supplied
  const enriched = {
    ...data,
    region: data.region || deriveRegion(data.country || ''),
    device: data.device || deriveDevice(data.deviceModel || ''),
    category: data.category || 'Registered',
  };

  if (!isFirebaseConfigured) {
    return localDb.localCreatePlayer(enriched);
  }
  const existing = await findPlayerByName(enriched.professionalName, enriched.ign);
  if (existing) return existing;
  const ref = await addDoc(collection(db, 'players'), {
    professionalName: '', ign: '', gender: '', region: '', country: '',
    device: '', deviceModel: '', category: 'Registered', tournamentIds: [], createdAt: serverTimestamp(),
    ...enriched,
  });
  return { id: ref.id, ...enriched };
}


export async function updatePlayer(id, data) {
  if (!isFirebaseConfigured) {
    return localDb.localUpdatePlayer(id, data);
  }
  await updateDoc(doc(db, 'players', id), data);
}

export async function deletePlayer(id) {
  if (!isFirebaseConfigured) {
    return localDb.localDeletePlayer(id);
  }
  await deleteDoc(doc(db, 'players', id));
}

// ─── Teams ────────────────────────────────────────────────────────────────────
export async function getTeams() {
  if (!isFirebaseConfigured) {
    return localDb.localGetTeams();
  }
  const snap = await getDocs(query(collection(db, 'teams'), orderBy('teamName')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getTeam(id) {
  if (!isFirebaseConfigured) {
    return localDb.localGetTeam(id);
  }
  const snap = await getDoc(doc(db, 'teams', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function findTeamByName(teamName) {
  const teams = await getTeams();
  return teams.find((t) => t.teamName?.toLowerCase() === teamName?.toLowerCase()) || null;
}

export async function createTeam(data) {
  if (!isFirebaseConfigured) {
    return localDb.localCreateTeam(data);
  }
  const existing = await findTeamByName(data.teamName);
  if (existing) return existing;

  // Auto-create clan if clanName provided
  if (data.clanName) {
    await ensureClan(data.clanName);
  }

  const ref = await addDoc(collection(db, 'teams'), {
    teamName: '', clanName: '', tournamentIds: [], createdAt: serverTimestamp(),
    ...data,
  });
  return { id: ref.id, ...data };
}

export async function updateTeam(id, data) {
  if (!isFirebaseConfigured) {
    return localDb.localUpdateTeam(id, data);
  }
  await updateDoc(doc(db, 'teams', id), data);
}

export async function deleteTeam(id) {
  if (!isFirebaseConfigured) {
    return localDb.localDeleteTeam(id);
  }
  await deleteDoc(doc(db, 'teams', id));
}

// ─── Clans ────────────────────────────────────────────────────────────────────
export async function getClans() {
  if (!isFirebaseConfigured) {
    return localDb.localGetClans();
  }
  const snap = await getDocs(query(collection(db, 'clans'), orderBy('clanName')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function findClanByName(clanName) {
  const clans = await getClans();
  return clans.find((c) => c.clanName?.toLowerCase() === clanName?.toLowerCase()) || null;
}

export async function ensureClan(clanName) {
  if (!isFirebaseConfigured) {
    return localDb.localEnsureClan(clanName);
  }
  if (!clanName) return null;
  const existing = await findClanByName(clanName);
  if (existing) return existing;
  const ref = await addDoc(collection(db, 'clans'), {
    clanName, teamIds: [], createdAt: serverTimestamp(),
  });
  return { id: ref.id, clanName, teamIds: [] };
}

export async function getClan(id) {
  if (!isFirebaseConfigured) {
    return localDb.localGetClan(id);
  }
  const snap = await getDoc(doc(db, 'clans', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
