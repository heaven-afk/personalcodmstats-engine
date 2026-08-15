import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, onSnapshot, query, orderBy
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';

const LOCAL_ALLOWED_USERS_KEY = 'heaven_allowed_users';

function getLocalAllowedUsers() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_ALLOWED_USERS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [
    {
      email: 'ogadizion01@gmail.com',
      role: 'owner',
      username: 'ogadizion01@gmail.com',
      avatarUrl: null,
      editorUids: [],
      addedAt: new Date().toISOString(),
      addedBy: 'system-init',
    }
  ];
}

function saveLocalAllowedUsers(users) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_ALLOWED_USERS_KEY, JSON.stringify(users));
  } catch {}
}

export async function getAllowedUser(email) {
  if (!email) return null;
  const normalizedEmail = email.trim().toLowerCase();

  if (!isFirebaseConfigured) {
    const list = getLocalAllowedUsers();
    return list.find(u => u.email.toLowerCase() === normalizedEmail) || null;
  }

  const docRef = doc(db, 'allowedUsers', normalizedEmail);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return { email: snap.id, ...snap.data() };
}

export async function getAllowedUsers() {
  if (!isFirebaseConfigured) {
    return getLocalAllowedUsers();
  }

  try {
    const q = query(collection(db, 'allowedUsers'), orderBy('addedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ email: d.id, ...d.data() }));
  } catch {
    // Fallback if orderBy index is building
    const snap = await getDocs(collection(db, 'allowedUsers'));
    return snap.docs.map(d => ({ email: d.id, ...d.data() }));
  }
}

export function subscribeAllowedUser(email, onNext, onError) {
  if (!email) return () => {};
  const normalizedEmail = email.trim().toLowerCase();

  if (!isFirebaseConfigured) {
    const user = getLocalAllowedUsers().find(u => u.email.toLowerCase() === normalizedEmail) || null;
    onNext(user);
    return () => {};
  }

  const docRef = doc(db, 'allowedUsers', normalizedEmail);
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        onNext({ email: snap.id, ...snap.data() });
      } else {
        onNext(null);
      }
    },
    onError
  );
}

export function subscribeAllowedUsers(onNext, onError) {
  if (!isFirebaseConfigured) {
    onNext(getLocalAllowedUsers());
    return () => {};
  }

  const collRef = collection(db, 'allowedUsers');
  return onSnapshot(
    collRef,
    (snap) => {
      const users = snap.docs.map(d => ({ email: d.id, ...d.data() }));
      onNext(users);
    },
    onError
  );
}

export async function addAllowedUser({ email, role = 'operator', addedBy, username, avatarUrl = null }) {
  const normalizedEmail = email.trim().toLowerCase();
  const userData = {
    role,
    username: username || normalizedEmail,
    avatarUrl: avatarUrl || null,
    editorUids: [],
    addedAt: isFirebaseConfigured ? serverTimestamp() : new Date().toISOString(),
    addedBy: addedBy || 'unknown-owner',
  };

  if (!isFirebaseConfigured) {
    const list = getLocalAllowedUsers().filter(u => u.email.toLowerCase() !== normalizedEmail);
    list.unshift({ email: normalizedEmail, ...userData });
    saveLocalAllowedUsers(list);
    return { email: normalizedEmail, ...userData };
  }

  const docRef = doc(db, 'allowedUsers', normalizedEmail);
  await setDoc(docRef, userData, { merge: true });
  return { email: normalizedEmail, ...userData };
}

export async function updateAllowedUserProfile(email, { username, avatarUrl }) {
  const normalizedEmail = email.trim().toLowerCase();
  const updates = {};
  if (username !== undefined) updates.username = username.trim();
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl ? avatarUrl.trim() : null;

  if (!isFirebaseConfigured) {
    const list = getLocalAllowedUsers().map(u => {
      if (u.email.toLowerCase() === normalizedEmail) {
        return { ...u, ...updates };
      }
      return u;
    });
    saveLocalAllowedUsers(list);
    return;
  }

  const docRef = doc(db, 'allowedUsers', normalizedEmail);
  await updateDoc(docRef, updates);
}

export async function updateAllowedUserRole(email, role) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!['owner', 'operator'].includes(role)) {
    throw new Error('Invalid role specified');
  }

  if (!isFirebaseConfigured) {
    const list = getLocalAllowedUsers().map(u => {
      if (u.email.toLowerCase() === normalizedEmail) {
        return { ...u, role };
      }
      return u;
    });
    saveLocalAllowedUsers(list);
    return;
  }

  const docRef = doc(db, 'allowedUsers', normalizedEmail);
  await updateDoc(docRef, { role });
}

export async function removeAllowedUser(email) {
  const normalizedEmail = email.trim().toLowerCase();

  if (!isFirebaseConfigured) {
    const list = getLocalAllowedUsers().filter(u => u.email.toLowerCase() !== normalizedEmail);
    saveLocalAllowedUsers(list);
    return;
  }

  const docRef = doc(db, 'allowedUsers', normalizedEmail);
  await deleteDoc(docRef);
}
