import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, writeBatch,
  where, limit,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';
import * as localDb from './localStorageDb';
import { deriveRegion, deriveDevice } from '../regionDeviceLogic';
import { cleanTeamName } from '../utils/similarity';

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

    return null; // Return null if professional name is provided but doesn't exist
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
    photoUrl: data.photoUrl || '',
  };

  if (!isFirebaseConfigured) {
    return localDb.localCreatePlayer(enriched);
  }

  const existing = await findPlayerByName(enriched.professionalName, enriched.ign);
  if (existing) {
    const updatedFields = {};

    // ── professionalName is IMMUTABLE — never touch it ──────────────────────

    // ── IGN history accumulation ─────────────────────────────────────────────
    if (enriched.ign?.trim()) {
      const newIgn = enriched.ign.trim();
      const existingHistory = existing.ignHistory?.length
        ? existing.ignHistory
        : (existing.ign ? [existing.ign] : []);
      const alreadyKnown = existingHistory.some(i => i.toLowerCase() === newIgn.toLowerCase());
      if (!alreadyKnown) {
        updatedFields.ignHistory = [...existingHistory, newIgn];
      } else if (!existing.ignHistory) {
        // Backfill the history field if it didn't exist yet
        updatedFields.ignHistory = existingHistory;
      }
      // Always keep currentIGN pointing to the latest import's IGN
      if (newIgn.toLowerCase() !== (existing.currentIGN || existing.ign || '').toLowerCase()) {
        updatedFields.currentIGN = newIgn;
        updatedFields.currentIGNLower = newIgn.toLowerCase();
      }
    }

    // ── Device history accumulation ──────────────────────────────────────────
    const newDevice = enriched.device || '';
    const newModel = enriched.deviceModel || '';
    if (newDevice || newModel) {
      const existingDevHistory = existing.deviceHistory?.length
        ? existing.deviceHistory
        : (existing.device || existing.deviceModel
            ? [{ device: existing.device || '', deviceModel: existing.deviceModel || '' }]
            : []);
      const alreadyKnown = existingDevHistory.some(
        d => d.device?.toLowerCase() === newDevice.toLowerCase()
          && d.deviceModel?.toLowerCase() === newModel.toLowerCase()
      );
      if (!alreadyKnown) {
        updatedFields.deviceHistory = [...existingDevHistory, { device: newDevice, deviceModel: newModel }];
      } else if (!existing.deviceHistory) {
        updatedFields.deviceHistory = existingDevHistory;
      }
      // Update current device pointers to the latest import
      if (newDevice && newDevice !== existing.currentDevice) {
        updatedFields.currentDevice = newDevice;
      }
      if (newModel && newModel !== existing.currentDeviceModel) {
        updatedFields.currentDeviceModel = newModel;
      }
    }

    // ── Demographic fields — only fill in if blank, never overwrite ──────────
    if (enriched.gender && !existing.gender) updatedFields.gender = enriched.gender;
    if (enriched.region && !existing.region) updatedFields.region = enriched.region;
    if (enriched.country && !existing.country) updatedFields.country = enriched.country;

    // ── Category can update freely ───────────────────────────────────────────
    if (enriched.category && enriched.category !== existing.category) {
      updatedFields.category = enriched.category;
    }

    if (Object.keys(updatedFields).length > 0) {
      await updateDoc(doc(db, 'players', existing.id), updatedFields);
      return { ...existing, ...updatedFields };
    }
    return existing;
  }

  // ── New player — initialise all history fields ───────────────────────────
  const newIgn = enriched.ign?.trim() || '';
  const newDevice = enriched.device || '';
  const newModel = enriched.deviceModel || '';

  const ref = await addDoc(collection(db, 'players'), {
    professionalName: '', ign: '', gender: '', region: '', country: '',
    device: '', deviceModel: '', category: 'Registered', photoUrl: '',
    tournamentIds: [], createdAt: serverTimestamp(),
    ...enriched,
    professionalNameLower: (enriched.professionalName || '').toLowerCase().trim(),
    ignLower: newIgn.toLowerCase(),
    // History fields
    currentIGN: newIgn,
    currentIGNLower: newIgn.toLowerCase(),
    ignHistory: newIgn ? [newIgn] : [],
    currentDevice: newDevice,
    currentDeviceModel: newModel,
    deviceHistory: (newDevice || newModel)
      ? [{ device: newDevice, deviceModel: newModel }]
      : [],
  });

  return {
    id: ref.id,
    ...enriched,
    professionalNameLower: (enriched.professionalName || '').toLowerCase().trim(),
    ignLower: newIgn.toLowerCase(),
    currentIGN: newIgn,
    currentIGNLower: newIgn.toLowerCase(),
    ignHistory: newIgn ? [newIgn] : [],
    currentDevice: newDevice,
    currentDeviceModel: newModel,
    deviceHistory: (newDevice || newModel)
      ? [{ device: newDevice, deviceModel: newModel }]
      : [],
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
    return localDb.localFindTeamByName(cleanTeamName(teamName));
  }
  const cleaned = cleanTeamName(teamName);
  if (!cleaned) return null;
  const nameLower = cleaned.toLowerCase();

  // Try querying by teamNameLower first
  let snap = await getDocs(query(collection(db, 'teams'), where('teamNameLower', '==', nameLower), limit(1)));
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

  // Try querying by exact teamName
  snap = await getDocs(query(collection(db, 'teams'), where('teamName', '==', cleaned), limit(1)));
  if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };

  // Fallback to loading all (for legacy compatibility)
  const teams = await getTeams();
  return teams.find((t) => cleanTeamName(t.teamName).toLowerCase() === nameLower) || null;
}

export async function createTeam(data) {
  const cleanedName = cleanTeamName(data.teamName);
  const dataWithCleanedName = { ...data, teamName: cleanedName };

  if (!isFirebaseConfigured) {
    return localDb.localCreateTeam(dataWithCleanedName);
  }
  const existing = await findTeamByName(cleanedName);
  if (existing) return existing;

  // Auto-create clan if clanName provided
  if (dataWithCleanedName.clanName) {
    await ensureClan(dataWithCleanedName.clanName);
  }

  const ref = await addDoc(collection(db, 'teams'), {
    teamName: '', clanName: '', tournamentIds: [], createdAt: serverTimestamp(),
    ...dataWithCleanedName,
    teamNameLower: cleanedName.toLowerCase(),
  });
  return { id: ref.id, ...dataWithCleanedName, teamNameLower: cleanedName.toLowerCase() };
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
