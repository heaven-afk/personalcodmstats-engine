'use client';
import { useState, useEffect } from 'react';
import { ref, onValue, off } from 'firebase/database';
import { rtdb } from '@/lib/firebase';

export function useUserPresence(uid) {
  const [presence, setPresence] = useState({
    state: 'offline',
    lastChanged: null,
    isOnline: false,
  });

  useEffect(() => {
    if (!rtdb || !uid) {
      return;
    }

    const statusRef = ref(rtdb, `/status/${uid}`);
    const unsubscribe = onValue(statusRef, (snap) => {
      const data = snap.val();
      if (data) {
        setPresence({
          state: data.state || 'offline',
          lastChanged: data.lastChanged || null,
          isOnline: data.state === 'online',
        });
      } else {
        setPresence({ state: 'offline', lastChanged: null, isOnline: false });
      }
    });

    return () => {
      off(statusRef);
    };
  }, [uid]);

  return presence;
}

export function useAllPresence() {
  const [presenceMap, setPresenceMap] = useState({});

  useEffect(() => {
    if (!rtdb) {
      return;
    }

    const allStatusRef = ref(rtdb, '/status');
    const unsubscribe = onValue(allStatusRef, (snap) => {
      const data = snap.val();
      if (data && typeof data === 'object') {
        setPresenceMap(data);
      } else {
        setPresenceMap({});
      }
    });

    return () => {
      off(allStatusRef);
    };
  }, []);

  return presenceMap;
}
