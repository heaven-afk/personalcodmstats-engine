import { ref, onValue, set, onDisconnect, serverTimestamp } from 'firebase/database';
import { rtdb } from './firebase';

export function setupPresence(uid) {
  if (!rtdb || !uid || typeof window === 'undefined') {
    return () => {};
  }

  const connectedRef = ref(rtdb, '.info/connected');
  const statusRef = ref(rtdb, `/status/${uid}`);

  const unsubscribe = onValue(connectedRef, async (snap) => {
    if (snap.val() === false) {
      return;
    }

    try {
      // Configure onDisconnect before setting online state
      await onDisconnect(statusRef).set({
        state: 'offline',
        lastChanged: serverTimestamp(),
      });

      // Now set current online status
      await set(statusRef, {
        state: 'online',
        lastChanged: serverTimestamp(),
      });
    } catch (err) {
      console.warn('RTDB presence error:', err);
    }
  });

  return () => {
    unsubscribe();
    try {
      set(statusRef, {
        state: 'offline',
        lastChanged: serverTimestamp(),
      });
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
