'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '@/lib/firebase';

const AuthContext = createContext(null);
const AUTHORIZED_OWNER_EMAIL = 'ogadizion01@gmail.com';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); // 'owner' | 'operator' | null
  const [loading, setLoading] = useState(true);

  const isDemoAllowed = !isFirebaseConfigured && process.env.NODE_ENV !== 'production';

  const determineRole = (firebaseUser, tokenResult) => {
    if (!firebaseUser) return null;
    const claimRole = tokenResult?.claims?.role;
    if (claimRole === 'owner' || firebaseUser.email === AUTHORIZED_OWNER_EMAIL) {
      return 'owner';
    }
    if (claimRole === 'operator') {
      return 'operator';
    }
    return null;
  };

  const refreshRole = useCallback(async () => {
    if (!isFirebaseConfigured) return;
    if (auth.currentUser) {
      const tokenResult = await auth.currentUser.getIdTokenResult(true);
      const userRole = determineRole(auth.currentUser, tokenResult);
      setRole(userRole);
      return userRole;
    }
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      if (isDemoAllowed) {
        // Offline Demo / Sandbox Mode (Development only)
        const stored = localStorage.getItem('heaven_demo_user');
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            setUser(parsed);
            setRole(parsed.role || 'owner');
          } catch {}
        }
      } else {
        // Fail closed in production when Firebase env vars are missing
        setUser(null);
        setRole(null);
      }
      setLoading(false);
      return;
    }

    // Live Firebase Auth Mode
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }

      try {
        const tokenResult = await u.getIdTokenResult();
        const userRole = determineRole(u, tokenResult);

        if (!userRole) {
          // Account exists in Firebase Auth but has no assigned role and is not the owner email
          await signOut(auth);
          setUser(null);
          setRole(null);
          setLoading(false);
          return;
        }

        setUser(u);
        setRole(userRole);
      } catch (err) {
        console.error('Error verifying auth claims:', err);
        setUser(null);
        setRole(null);
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [isDemoAllowed]);

  const login = async (email, password) => {
    if (!isFirebaseConfigured) {
      if (isDemoAllowed) {
        return new Promise((resolve) => {
          setTimeout(() => {
            const isOperatorDemo = email?.toLowerCase().includes('operator');
            const mockUser = {
              email: email || AUTHORIZED_OWNER_EMAIL,
              uid: isOperatorDemo ? 'demo-operator-uid' : 'demo-owner-uid',
              role: isOperatorDemo ? 'operator' : 'owner'
            };
            localStorage.setItem('heaven_demo_user', JSON.stringify(mockUser));
            setUser(mockUser);
            setRole(mockUser.role);
            resolve(mockUser);
          }, 600);
        });
      } else {
        throw new Error('Authentication configuration error. Contact system administrator.');
      }
    }

    // Live Firebase login
    const credential = await signInWithEmailAndPassword(auth, email, password);
    if (credential?.user) {
      const tokenResult = await credential.user.getIdTokenResult();
      const userRole = determineRole(credential.user, tokenResult);
      if (!userRole) {
        await signOut(auth);
        setUser(null);
        setRole(null);
        throw new Error('This account does not have an authorized role (Owner or Operator) in Heaven Stat Engine.');
      }
      setUser(credential.user);
      setRole(userRole);
    }
    return credential;
  };

  const logout = async () => {
    if (!isFirebaseConfigured) {
      localStorage.removeItem('heaven_demo_user');
      setUser(null);
      setRole(null);
      return;
    }

    // Live Firebase logout
    setRole(null);
    return signOut(auth);
  };

  const isOwner = role === 'owner';
  const isOperator = role === 'operator';

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        isOwner,
        isOperator,
        loading,
        login,
        logout,
        refreshRole,
        isDemoMode: isDemoAllowed,
        authorizedEmail: AUTHORIZED_OWNER_EMAIL,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
