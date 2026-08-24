import { ref, onValue, set, remove, onDisconnect, serverTimestamp } from 'firebase/database';
import { rtdb } from './firebase';

export function setupPresence(uid, profile = {}) {
  if (!rtdb || !uid || typeof window === 'undefined') {
    return () => {};
  }

  const connectedRef = ref(rtdb, '.info/connected');
  const statusRef = ref(rtdb, `/status/${uid}`);

  const email = (profile?.email || '').toLowerCase().trim();
  const username = profile?.username || profile?.displayName || email || 'User';
  const avatarUrl = profile?.avatarUrl || null;
  const role = profile?.role || 'operator';

  const unsubscribe = onValue(connectedRef, async (snap) => {
    if (snap.val() === false) {
      return;
    }

    try {
      // Configure onDisconnect before setting online state
      await onDisconnect(statusRef).set({
        state: 'offline',
        uid,
        email,
        username,
        avatarUrl,
        role,
        lastChanged: serverTimestamp(),
      });

      // Now set current online status
      await set(statusRef, {
        state: 'online',
        uid,
        email,
        username,
        avatarUrl,
        role,
        lastChanged: serverTimestamp(),
      });
    } catch (err) {
      console.warn('[Presence] RTDB set error:', err);
    }
  });

  return () => {
    unsubscribe();
    try {
      set(statusRef, {
        state: 'offline',
        uid,
        email,
        username,
        avatarUrl,
        role,
        lastChanged: serverTimestamp(),
      }).catch(() => {});
    } catch {}
  };
}

export function setupTournamentPresence(tournamentId, user, profile, pathname = '') {
  if (!rtdb || !tournamentId || !user?.uid || typeof window === 'undefined') {
    return () => {};
  }

  const connectedRef = ref(rtdb, '.info/connected');
  const tourRef = ref(rtdb, `/tournaments_presence/${tournamentId}/${user.uid}`);

  const email = (user.email || profile?.email || '').toLowerCase().trim();
  const username = profile?.username || user.displayName || email || 'User';
  const avatarUrl = profile?.avatarUrl || null;
  const role = profile?.role || 'operator';

  const unsubscribe = onValue(connectedRef, async (snap) => {
    if (snap.val() === false) return;
    try {
      await onDisconnect(tourRef).remove();
      await set(tourRef, {
        uid: user.uid,
        email,
        username,
        avatarUrl,
        role,
        pathname: pathname || '',
        lastActive: serverTimestamp(),
      });
    } catch (err) {
      console.warn('[Tournament Presence] RTDB set error:', err);
    }
  });

  return () => {
    unsubscribe();
    try {
      remove(tourRef).catch(() => {});
    } catch {}
  };
}

export async function setPresenceOffline(uid) {
  if (!rtdb || !uid) return;
  try {
    const statusRef = ref(rtdb, `/status/${uid}`);
    await set(statusRef, {
      state: 'offline',
      lastChanged: serverTimestamp(),
    });
  } catch {}
}
