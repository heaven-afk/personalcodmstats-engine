'use client';
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { auth, isFirebaseConfigured } from '@/lib/firebase';
import { getAllowedUser, subscribeAllowedUser, updateAllowedUserProfile, addAllowedUser } from '@/lib/firestore/allowedUsers';
import { setupPresence, setPresenceOffline } from '@/lib/presence';

const AuthContext = createContext(null);

function getInitialDemoState() {
  if (isFirebaseConfigured || typeof window === 'undefined') {
    return { user: null, role: null, profile: null };
  }
  if (process.env.NODE_ENV === 'production') {
    return { user: null, role: null, profile: null };
  }
  try {
    const stored = localStorage.getItem('heaven_demo_user');
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        user: parsed,
        role: parsed.role || 'owner',
        profile: {
          email: parsed.email,
          username: parsed.username || parsed.email,
          avatarUrl: parsed.avatarUrl || null,
          role: parsed.role || 'owner',
          addedAt: new Date().toISOString(),
          addedBy: 'demo-init',
        },
      };
    }
  } catch {}
  return { user: null, role: null, profile: null };
}

export function AuthProvider({ children }) {
  const [initialDemo] = useState(getInitialDemoState);
  const [user, setUser] = useState(initialDemo.user);
  const [profile, setProfile] = useState(initialDemo.profile);
  const [role, setRole] = useState(initialDemo.role);
  const [loading, setLoading] = useState(!initialDemo.user && isFirebaseConfigured);
  const [authError, setAuthError] = useState(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const isDemoAllowed = !isFirebaseConfigured && process.env.NODE_ENV !== 'production';
  const unsubscribeProfileRef = useRef(null);
  const cleanupPresenceRef = useRef(null);
  const router = useRouter();

  const cleanupSubscriptions = useCallback(() => {
    if (unsubscribeProfileRef.current) {
      unsubscribeProfileRef.current();
      unsubscribeProfileRef.current = null;
    }
    if (cleanupPresenceRef.current) {
      cleanupPresenceRef.current();
      cleanupPresenceRef.current = null;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user?.email) return;
    try {
      const allowedDoc = await getAllowedUser(user.email);
      if (allowedDoc) {
        setProfile(allowedDoc);
        setRole(allowedDoc.role || 'operator');
        return allowedDoc;
      }
    } catch (err) {
      console.error('Error refreshing profile:', err);
    }
  }, [user]);

  const updateProfileData = useCallback(async (updates) => {
    if (!user?.email) throw new Error('No authenticated user');
    await updateAllowedUserProfile(user.email, updates);
    setProfile((prev) => ({ ...prev, ...updates }));
  }, [user]);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }

    // Live Firebase Auth Mode
    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      cleanupSubscriptions();

      if (!u) {
        setUser(null);
        setProfile(null);
        setRole(null);
        setMustChangePassword(false);
        setLoading(false);
        return;
      }

      const email = u.email?.toLowerCase();
      if (!email) {
        await signOut(auth);
        setUser(null);
        setProfile(null);
        setRole(null);
        setMustChangePassword(false);
        setLoading(false);
        return;
      }

      try {
        // Step 1: Query allowedUsers collection
        const allowedDoc = await getAllowedUser(email);

        if (!allowedDoc) {
          console.warn(`Unauthorized login attempt by non-allowlisted email: ${email}`);
          await signOut(auth);
          setUser(null);
          setProfile(null);
          setRole(null);
          setMustChangePassword(false);
          setAuthError("You don't have access to this platform.");
          setLoading(false);
          router.replace('/no-access');
          return;
        }

        // Step 2: Establish user session & live profile subscription
        setUser(u);
        setRole(allowedDoc.role || 'operator');
        setProfile(allowedDoc);
        setMustChangePassword(allowedDoc.mustChangePassword === true);
        setAuthError(null);

        // Step 3: Realtime Database Presence Tracking
        cleanupPresenceRef.current = setupPresence(u.uid, {
          email: u.email,
          username: allowedDoc.username || u.displayName || u.email,
          avatarUrl: allowedDoc.avatarUrl || null,
          role: allowedDoc.role || 'operator',
        });

        // Step 4: Live Firestore listener on allowedUsers/{email}
        unsubscribeProfileRef.current = subscribeAllowedUser(
          email,
          async (liveDoc) => {
            if (!liveDoc) {
              console.warn(`User ${email} was removed from allowlist. Evicting session.`);
              cleanupSubscriptions();
              if (u.uid) await setPresenceOffline(u.uid);
              await signOut(auth);
              setUser(null);
              setProfile(null);
              setRole(null);
              setMustChangePassword(false);
              setAuthError("You don't have access to this platform.");
              router.replace('/no-access');
              return;
            }

            setProfile(liveDoc);
            if (liveDoc.role) {
              setRole(liveDoc.role);
            }
            setMustChangePassword(liveDoc.mustChangePassword === true);
          },
          (err) => {
            console.error('Error listening to allowedUser updates:', err);
          }
        );
      } catch (err) {
        console.error('Error verifying allowlist:', err);
        await signOut(auth);
        setUser(null);
        setProfile(null);
        setRole(null);
        setMustChangePassword(false);
        setAuthError(err.message || 'Authentication error');
      } finally {
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      cleanupSubscriptions();
    };
  }, [cleanupSubscriptions, router]);

  const login = async (email, password) => {
    setAuthError(null);
    const normalizedEmail = email?.trim().toLowerCase();

    if (!isFirebaseConfigured) {
      if (isDemoAllowed) {
        return new Promise((resolve, reject) => {
          setTimeout(async () => {
            const allowedDoc = await getAllowedUser(normalizedEmail);
            const isOperatorEmail = normalizedEmail?.includes('operator');

            if (!allowedDoc && !isOperatorEmail) {
              const err = new Error("You don't have access to this platform.");
              setAuthError(err.message);
              reject(err);
              return;
            }

            const chosenRole = allowedDoc?.role || (isOperatorEmail ? 'operator' : 'owner');
            const mockUser = {
              email: normalizedEmail,
              uid: chosenRole === 'owner' ? 'demo-owner-uid' : 'demo-operator-uid',
              role: chosenRole,
              username: allowedDoc?.username || normalizedEmail,
              avatarUrl: allowedDoc?.avatarUrl || null,
            };

            localStorage.setItem('heaven_demo_user', JSON.stringify(mockUser));
            setUser(mockUser);
            setRole(chosenRole);
            setProfile(mockUser);
            resolve(mockUser);
          }, 400);
        });
      } else {
        throw new Error('Authentication configuration error. Contact system administrator.');
      }
    }

    // Live Firebase login
    const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    if (credential?.user) {
      const allowedDoc = await getAllowedUser(normalizedEmail);
      if (!allowedDoc) {
        await signOut(auth);
        setUser(null);
        setProfile(null);
        setRole(null);
        const err = new Error("You don't have access to this platform.");
        setAuthError(err.message);
        throw err;
      }
    }
    return credential;
  };

  const logout = async () => {
    cleanupSubscriptions();

    if (user?.uid) {
      try {
        setPresenceOffline(user.uid).catch(() => {});
      } catch {}
    }

    try {
      localStorage.removeItem('heaven_demo_user');
    } catch {}

    setUser(null);
    setProfile(null);
    setRole(null);
    setMustChangePassword(false);
    setAuthError(null);

    if (isFirebaseConfigured && auth) {
      try {
        await signOut(auth);
      } catch (err) {
        console.error('Error signing out of Firebase:', err);
      }
    }

    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    } else {
      router.replace('/login');
    }
  };

  const isOwner = role === 'owner';
  const isOperator = role === 'operator';
  const displayName = profile?.username || user?.email || 'User';

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        displayName,
        role,
        isOwner,
        isOperator,
        loading,
        authError,
        mustChangePassword,
        login,
        logout,
        refreshProfile,
        updateProfile: updateProfileData,
        isDemoMode: isDemoAllowed,
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
