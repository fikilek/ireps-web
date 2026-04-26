// src/context/GeoContext.js
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "../auth/useAuth";
import { useGetLmBoundaryByIdQuery } from "../redux/mapLmsApi";

export const GeoContext = createContext(null);

// DEFAULT GEO BOOT MODEL
// Stage 0: LM unknown, Ward unknown
//   - selectedLm = null
//   - selectedWard = null
//   - selectedErf = null
//   - selectedPremise = null
//   - selectedMeter = null
//
// Stage 1: LM known from user workbase, Ward unknown
//   - selectedLm = user workbase
//   - selectedWard = null
//   - selectedErf = null
//   - selectedPremise = null
//   - selectedMeter = null
//
// Stage 2: LM known, Ward manually selected
//   - selectedLm = active LM
//   - selectedWard = active Ward
//   - selectedErf = null
//   - selectedPremise = null
//   - selectedMeter = null
//
// IMPORTANT:
// Warehouse operational data must remain closed until both LM and Ward exist.

const INITIAL_GEO = {
  selectedLm: null,
  selectedWard: null,
  selectedErf: null,
  selectedPremise: null,
  selectedMeter: null,
  selectedGeofence: null,

  lastSelectionType: null,
  flightSignal: 0, // counter, not Date.now
};

export const GeoProvider = ({ children }) => {
  const { profile } = useAuth();
  const workbase = profile?.access?.activeWorkbase || null;
  const workbaseId = workbase?.pcode || workbase?.id || null;

  const [geoState, setGeoState] = useState(INITIAL_GEO);

  useEffect(() => {
    if (!profile) {
      setGeoState(INITIAL_GEO);
      return;
    }

    if (!workbaseId) return;

    setGeoState((prev) => {
      // if a selection already exists, don't overwrite it here
      if (prev.selectedLm) return prev;

      return {
        ...INITIAL_GEO,
        selectedLm: { ...workbase, id: workbaseId },
        lastSelectionType: "LM",
        flightSignal: prev.flightSignal + 1,
      };
    });
  }, [profile, workbase, workbaseId]);

  // 2) HYDRATE: fetch full LM doc
  const { data: remoteLmDoc } = useGetLmBoundaryByIdQuery(workbaseId, {
    skip: !workbaseId,
  });

  useEffect(() => {
    if (!profile || !remoteLmDoc) return;

    // ignore late docs that don't match profile workbase
    if (remoteLmDoc.id !== workbaseId) return;

    setGeoState((prev) => {
      // only hydrate the current LM if it matches and is still placeholder
      if (prev.selectedLm?.id !== remoteLmDoc.id) return prev;

      const prevHasName = !!prev.selectedLm?.name;
      if (prevHasName) return prev;

      return {
        ...prev,
        selectedLm: remoteLmDoc,
        flightSignal: prev.flightSignal + 1,
      };
    });
  }, [profile, remoteLmDoc, workbaseId]);

  /**
   * updateGeo(updates, options)
   * options.silent === true => does NOT bump flightSignal
   */

  const updateGeo = useCallback((updates, options = {}) => {
    setGeoState((prev) => {
      const silent = !!options.silent;

      let next = { ...prev, ...updates };

      // cascade clears
      if ("selectedLm" in updates) {
        const prevLmId = prev?.selectedLm?.id || null;
        const nextLmId = updates?.selectedLm?.id || null;
        const lmChanged = prevLmId !== nextLmId;

        if (lmChanged) {
          next.selectedWard = null;
        }

        next.selectedErf = null;
        next.selectedPremise = null;
        next.selectedMeter = null;
        next.selectedGeofence = null;
      } else if ("selectedWard" in updates) {
        next.selectedErf = null;
        next.selectedPremise = null;
        next.selectedMeter = null;
        next.selectedGeofence = null;
      } else if ("selectedErf" in updates) {
        next.selectedPremise = null;
        next.selectedMeter = null;
      } else if ("selectedPremise" in updates) {
        next.selectedMeter = null;
      }

      if (!silent) {
        next.flightSignal = prev.flightSignal + 1;
      }

      return next;
    });
  }, []);

  /**
   * setActiveWorkbaseWard({ lm, ward })
   * Atomic LM + Ward switch.
   * This is the new AppHeader switch path.
   */
  const setActiveWorkbaseWard = useCallback(({ lm, ward }) => {
    if (!lm?.id || !ward?.id) return;

    setGeoState((prev) => ({
      ...INITIAL_GEO,
      selectedLm: lm,
      selectedWard: ward,
      lastSelectionType: "WARD",
      flightSignal: prev.flightSignal + 1,
    }));
  }, []);

  /**
   * resetGeo()
   * Clears UI selection WITHOUT triggering Pilot.
   * Keeps LM + Ward so the active scope remains stable.
   */
  const resetGeo = useCallback(() => {
    setGeoState((prev) => ({
      ...INITIAL_GEO,
      selectedLm: prev.selectedLm,
      selectedWard: prev.selectedWard,
      flightSignal: prev.flightSignal,
    }));
  }, []);

  const selectGeofence = useCallback(
    (geofence, options = {}) => {
      updateGeo(
        {
          selectedGeofence: geofence,
          lastSelectionType: "GEOFENCE",
        },
        options,
      );
    },
    [updateGeo],
  );

  const clearGeofence = useCallback(
    (options = {}) => {
      updateGeo(
        {
          selectedGeofence: null,
          lastSelectionType: null,
        },
        options,
      );
    },
    [updateGeo],
  );

  const value = useMemo(
    () => ({
      geoState,
      updateGeo,
      resetGeo,
      setGeoState,
      setActiveWorkbaseWard,
      selectGeofence,
      clearGeofence,
    }),
    [
      geoState,
      updateGeo,
      resetGeo,
      setActiveWorkbaseWard,
      selectGeofence,
      clearGeofence,
    ],
  );

  return <GeoContext.Provider value={value}>{children}</GeoContext.Provider>;
};

export const useGeo = () => {
  const ctx = useContext(GeoContext);
  if (!ctx) throw new Error("useGeo must be used within GeoProvider");
  return ctx;
};
