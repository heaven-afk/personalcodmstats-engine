'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '@/lib/firebase';

const AuthContext = createContext(null);
const AUTHORIZED_EMAIL = 'ogadizion01@gmail.com';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const isDemoAllowed = !isFirebaseConfigured && process.env.NODE_ENV !== 'production';

  useEffect(() => {
    if (!isFirebaseConfigured) {
      if (isDemoAllowed) {
        // Offline Demo / Sandbox Mode (Development only)
        const stored = localStorage.getItem('heaven_demo_user');
        if (stored) {
          try { setUser(JSON.parse(stored)); } catch {}
        }
      } else {
        // Fail closed in production when Firebase env vars are missing
        setUser(null);
      }
      setLoading(false);
      return;
    }

    // Live Firebase Auth Mode
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u && u.email !== AUTHORIZED_EMAIL) {
        await signOut(auth);
        setUser(null);
        setLoading(false);
        return;
      }
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, [isDemoAllowed]);

  const login = async (email, password) => {
    if (!isFirebaseConfigured) {
      if (isDemoAllowed) {
        return new Promise((resolve) => {
          setTimeout(() => {
            const mockUser = { email: email || AUTHORIZED_EMAIL, uid: 'demo-user-uid' };
            localStorage.setItem('heaven_demo_user', JSON.stringify(mockUser));
            setUser(mockUser);
            resolve(mockUser);
          }, 800);
        });
      } else {
        throw new Error('Authentication configuration error. Contact system administrator.');
      }
    }

    // Live Firebase login
    const credential = await signInWithEmailAndPassword(auth, email, password);
    if (credential?.user && credential.user.email !== AUTHORIZED_EMAIL) {
      await signOut(auth);
      setUser(null);
      throw new Error('This account is not authorized to access Heaven Stat Engine.');
    }
    return credential;
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
    <AuthContext.Provider value={{ user, loading, login, logout, isDemoMode: isDemoAllowed, authorizedEmail: AUTHORIZED_EMAIL }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
