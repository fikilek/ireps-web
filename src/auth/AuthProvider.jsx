import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { auth, db } from "../firebase";
import { AuthContext } from "./AuthContext";

function buildRoleFlags(role) {
  return {
    isSPU: role === "SPU",
    isADM: role === "ADM",
    isMNG: role === "MNG",
    isSPV: role === "SPV",
    isFWR: role === "FWR",
  };
}

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  const [authError, setAuthError] = useState(null);
  const [profileExists, setProfileExists] = useState(false);

  useEffect(() => {
    let unsubscribeProfile = null;

    const unsubscribeAuth = onAuthStateChanged(
      auth,
      (currentUser) => {
        if (unsubscribeProfile) {
          unsubscribeProfile();
          unsubscribeProfile = null;
        }

        setFirebaseUser(currentUser);
        setProfile(null);
        setProfileExists(false);
        setAuthError(null);

        if (!currentUser) {
          setAuthLoading(false);
          setProfileLoading(false);
          return;
        }

        setAuthLoading(false);
        setProfileLoading(true);

        const userProfileRef = doc(db, "users", currentUser.uid);

        unsubscribeProfile = onSnapshot(
          userProfileRef,
          (snapshot) => {
            if (!snapshot.exists()) {
              setProfile(null);
              setProfileExists(false);
              setProfileLoading(false);
              return;
            }

            setProfile({
              id: snapshot.id,
              ...snapshot.data(),
            });

            setProfileExists(true);
            setProfileLoading(false);
          },
          (error) => {
            console.error("AuthProvider profile stream error:", error);
            setAuthError(error);
            setProfile(null);
            setProfileExists(false);
            setProfileLoading(false);
          },
        );
      },
      (error) => {
        console.error("AuthProvider auth stream error:", error);
        setAuthError(error);
        setFirebaseUser(null);
        setProfile(null);
        setProfileExists(false);
        setAuthLoading(false);
        setProfileLoading(false);
      },
    );

    return () => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }

      unsubscribeAuth();
    };
  }, []);

  const value = useMemo(() => {
    const role = profile?.employment?.role || null;
    const roleFlags = buildRoleFlags(role);

    const serviceProvider = profile?.employment?.serviceProvider || null;
    const activeWorkbase = profile?.access?.activeWorkbase || null;
    const workbases = profile?.access?.workbases || [];

    const onboardingStatus = profile?.onboarding?.status || null;
    const isOnboardingComplete = onboardingStatus === "COMPLETED";

    const loading = authLoading || profileLoading;
    const isAuthenticated = Boolean(firebaseUser);
    const profileMissing = isAuthenticated && !loading && !profileExists;

    return {
      firebaseUser,
      profile,

      uid: firebaseUser?.uid || null,
      email: firebaseUser?.email || null,

      role,
      ...roleFlags,

      serviceProvider,
      activeWorkbase,
      workbases,

      onboardingStatus,
      isOnboardingComplete,

      isAuthenticated,
      profileExists,
      profileMissing,

      loading,
      authLoading,
      profileLoading,
      authError,
    };
  }, [
    firebaseUser,
    profile,
    profileExists,
    authLoading,
    profileLoading,
    authError,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
