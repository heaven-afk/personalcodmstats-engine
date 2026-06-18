'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '@/lib/firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      // Offline Demo / Sandbox Mode
      const stored = localStorage.getItem('heaven_demo_user');
      if (stored) {
        setUser(JSON.parse(stored));
      }
      setLoading(false);
      return;
    }

    // Live Firebase Auth Mode
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const login = async (email, password) => {
    if (!isFirebaseConfigured) {
      // Offline demo login: Allow logging in with any details (simulate network latency)
      return new Promise((resolve) => {
        setTimeout(() => {
          const mockUser = { email: email || 'admin@example.com', uid: 'demo-user-uid' };
          localStorage.setItem('heaven_demo_user', JSON.stringify(mockUser));
          setUser(mockUser);
          resolve(mockUser);
        }, 800);
      });
    }

    // Live Firebase login
    return signInWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    if (!isFirebaseConfigured) {
      localStorage.removeItem('heaven_demo_user');
      setUser(null);
      return;
    }

    // Live Firebase logout
    return signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isDemoMode: !isFirebaseConfigured }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
