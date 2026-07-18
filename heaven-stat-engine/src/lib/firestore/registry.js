import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, writeBatch,
  where, limit,
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
  if (!isFirebaseConfigured) {
    return localDb.localFindPlayerByName(professionalName, ign);
  }
  
  const pnLower = professionalName?.trim().toLowerCase();
  const ignLower = ign?.trim().toLowerCase();

  if (pnLower) {
    // Try query by professionalNameLower
    let snap = await getDocs(query(collection(db, 'players'), where('professionalNameLower', '==', pnLower), limit(1)));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    
    // Try query by exact professionalName
    snap = await getDocs(query(collection(db, 'players'), where('professionalName', '==', professionalName.trim()), limit(1)));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  if (ignLower) {
    // Try query by ignLower
    let snap = await getDocs(query(collection(db, 'players'), where('ignLower', '==', ignLower), limit(1)));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    
    // Try query by exact ign
    snap = await getDocs(query(collection(db, 'players'), where('ign', '==', ign.trim()), limit(1)));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  // Fallback to loading all (for legacy data compatibility)
  const allPlayers = await getPlayers();
  return allPlayers.find(p => 
    (pnLower && p.professionalName?.toLowerCase() === pnLower) ||
    (ignLower && p.ign?.toLowerCase() === ignLower)
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
  if (existing) {
    const updatedFields = {};
    const checkFields = ['professionalName', 'ign', 'gender', 'region', 'country', 'device', 'deviceModel', 'category'];
    for (const field of checkFields) {
      if (enriched[field] && enriched[field] !== existing[field]) {
        updatedFields[field] = enriched[field];
        if (field === 'professionalName') {
          updatedFields.professionalNameLower = enriched.professionalName.toLowerCase().trim();
        }
        if (field === 'ign') {
          updatedFields.ignLower = enriched.ign.toLowerCase().trim();
        }
      }
    }
    if (Object.keys(updatedFields).length > 0) {
      await updateDoc(doc(db, 'players', existing.id), updatedFields);
      return { ...existing, ...updatedFields };
    }
    return existing;
  }
  const ref = await addDoc(collection(db, 'players'), {
    professionalName: '', ign: '', gender: '', region: '', country: '',
    device: '', deviceModel: '', category: 'Registered', tournamentIds: [], createdAt: serverTimestamp(),
    ...enriched,
    professionalNameLower: (enriched.professionalName || '').toLowerCase().trim(),
    ignLower: (enriched.ign || '').toLowerCase().trim(),
  });
  return { 
    id: ref.id, 
    ...enriched,
    professionalNameLower: (enriched.professionalName || '').toLowerCase().trim(),
    ignLower: (enriched.ign || '').toLowerCase().trim(),
  };
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
  if (!isFirebaseConfigured) {
    return localDb.localFindTeamByName(teamName);
  }
  if (!teamName?.trim()) return null;
  const nameLower = teamName.trim().toLowerCase();

  // Try querying by teamNameLower first
  let snap = await getDocs(query(collection(db, 'teams'), where('teamNameLower', '==', nameLower), limit(1)));
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

  // Try querying by exact teamName
  snap = await getDocs(query(collection(db, 'teams'), where('teamName', '==', teamName.trim()), limit(1)));
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

  // Fallback to loading all (for legacy compatibility)
  const teams = await getTeams();
  return teams.find((t) => t.teamName?.toLowerCase() === nameLower) || null;
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
    teamNameLower: (data.teamName || '').toLowerCase().trim(),
  });
  return { id: ref.id, ...data, teamNameLower: (data.teamName || '').toLowerCase().trim() };
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
  if (!isFirebaseConfigured) {
    return localDb.localFindClanByName(clanName);
  }
  if (!clanName?.trim()) return null;
  const nameLower = clanName.trim().toLowerCase();

  // Try querying by clanNameLower first
  let snap = await getDocs(query(collection(db, 'clans'), where('clanNameLower', '==', nameLower), limit(1)));
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

  // Try querying by exact clanName
  snap = await getDocs(query(collection(db, 'clans'), where('clanName', '==', clanName.trim()), limit(1)));
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

  // Legacy fallback
  const clans = await getClans();
  return clans.find((c) => c.clanName?.toLowerCase() === nameLower) || null;
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
    clanNameLower: clanName.toLowerCase().trim(),
  });
  return { id: ref.id, clanName, teamIds: [], clanNameLower: clanName.toLowerCase().trim() };
}

export async function getClan(id) {
  if (!isFirebaseConfigured) {
    return localDb.localGetClan(id);
  }
  const snap = await getDoc(doc(db, 'clans', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
