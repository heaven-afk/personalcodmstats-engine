'use client';
import { useState, useEffect } from 'react';
import { ref, onValue, off } from 'firebase/database';
import { rtdb } from '@/lib/firebase';

export function useUserPresence(identifier) {
  const [presence, setPresence] = useState({
    state: 'offline',
    lastChanged: null,
    isOnline: false,
    username: null,
    email: null,
    avatarUrl: null,
    role: null,
  });

  useEffect(() => {
    if (!rtdb || !identifier) {
      setPresence({ state: 'offline', lastChanged: null, isOnline: false, username: null, email: null, avatarUrl: null, role: null });
      return;
    }

    const cleanId = String(identifier).trim();
    const isEmail = cleanId.includes('@');

    if (!isEmail) {
      // Direct UID lookup
      const statusRef = ref(rtdb, `/status/${cleanId}`);
      const unsubscribe = onValue(statusRef, (snap) => {
        const data = snap.val();
        if (data) {
          setPresence({
            state: data.state || 'offline',
            lastChanged: data.lastChanged || null,
            isOnline: data.state === 'online',
            username: data.username || null,
            email: data.email || null,
            avatarUrl: data.avatarUrl || null,
            role: data.role || null,
          });
        } else {
          setPresence({ state: 'offline', lastChanged: null, isOnline: false, username: null, email: null, avatarUrl: null, role: null });
        }
      });

      return () => {
        off(statusRef);
      };
    } else {
      // Lookup by email from all status
      const allStatusRef = ref(rtdb, '/status');
      const targetEmail = cleanId.toLowerCase();

      const unsubscribe = onValue(allStatusRef, (snap) => {
        const data = snap.val();
        if (data && typeof data === 'object') {
          const match = Object.values(data).find(p => p?.email?.toLowerCase() === targetEmail);
          if (match) {
            setPresence({
              state: match.state || 'offline',
              lastChanged: match.lastChanged || null,
              isOnline: match.state === 'online',
              username: match.username || null,
              email: match.email || null,
              avatarUrl: match.avatarUrl || null,
              role: match.role || null,
            });
            return;
          }
        }
        setPresence({ state: 'offline', lastChanged: null, isOnline: false, username: null, email: null, avatarUrl: null, role: null });
      });

      return () => {
        off(allStatusRef);
      };
    }
  }, [identifier]);

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

export function useTournamentPresence(tournamentId) {
  const [activeUsers, setActiveUsers] = useState([]);

  useEffect(() => {
    if (!rtdb || !tournamentId) {
      setActiveUsers([]);
      return;
    }

    const tourRef = ref(rtdb, `/tournaments_presence/${tournamentId}`);
    const unsubscribe = onValue(tourRef, (snap) => {
      const data = snap.val();
      if (data && typeof data === 'object') {
        const list = Object.values(data).filter(u => u && u.uid);
        setActiveUsers(list);
      } else {
        setActiveUsers([]);
      }
    });

    return () => {
      off(tourRef);
    };
  }, [tournamentId]);

  return activeUsers;
}

