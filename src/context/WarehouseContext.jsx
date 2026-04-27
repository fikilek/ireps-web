// src/context/WarehouseContext.jsx

import { createContext, useContext, useMemo } from "react";
import { useGeo } from "./GeoContext";

import { useGetGeoFencesByLmQuery } from "../redux/mapGeofencesApi";
import { useGetPremisesByWardQuery } from "../redux/mapPremisesApi";
import { useGetWardBoundariesByLmQuery } from "../redux/mapWardsApi";
import { useGetErfsByWardQuery } from "../redux/wardErfsApi";
import { useGetAstsByLmPcodeWardPcodeQuery } from "../redux/astsApi";

import {
  buildGeoLibrary,
  selectFilteredErfs,
  selectFilteredMeters,
  selectFilteredPrems,
  selectFilteredTrns,
  selectFilteredWards,
} from "./warehouseSelectors";

export const WarehouseContext = createContext(null);

const getLmPcode = (lm) =>
  lm?.pcode || lm?.id || lm?.lmPcode || lm?.localMunicipalityId || null;

const getWardPcode = (ward) =>
  ward?.id || ward?.pcode || ward?.wardPcode || null;

const getGeoFenceWardPcode = (geoFence) =>
  geoFence?.wardPcode ||
  geoFence?.parents?.wardPcode ||
  geoFence?.parents?.wardId ||
  null;

const getErfId = (erf) => erf?.erfId || erf?.id || null;

const getPremiseId = (premise) => premise?.premiseId || premise?.id || null;

const getMeterId = (meter) =>
  meter?.ast?.astData?.astId ||
  meter?.astData?.astId ||
  meter?.meterId ||
  meter?.id ||
  null;

export const WarehouseProvider = ({ children }) => {
  const { geoState } = useGeo();

  const {
    selectedLm,
    selectedWard,
    selectedGeofence,
    selectedErf,
    selectedPremise,
    selectedMeter,
  } = geoState || {};

  const lmPcode = getLmPcode(selectedLm);
  const selectedWardPcode = getWardPcode(selectedWard);
  const selectedGeofenceId = selectedGeofence?.id || null;

  const {
    data: wardsList = [],
    isLoading: wardsLoading,
    isFetching: wardsFetching,
    error: wardsError,
  } = useGetWardBoundariesByLmQuery(lmPcode, {
    skip: !lmPcode,
  });

  const {
    data: geoFencesList = [],
    isLoading: geoFencesLoading,
    isFetching: geoFencesFetching,
    error: geoFencesError,
  } = useGetGeoFencesByLmQuery(lmPcode, {
    skip: !lmPcode,
  });

  const wards = useMemo(() => {
    if (!lmPcode) return [];

    return (wardsList || []).filter((ward) => {
      const parentLm =
        ward?.parents?.localMunicipalityId ||
        ward?.parents?.localMunicipality?.pcode ||
        ward?.admin?.localMunicipality?.pcode ||
        ward?.lmPcode ||
        null;

      if (parentLm) return parentLm === lmPcode;

      return String(getWardPcode(ward) || "").startsWith(lmPcode);
    });
  }, [wardsList, lmPcode]);

  const selectedWardIsValid = useMemo(() => {
    if (!lmPcode || !selectedWardPcode) return false;

    return wards.some((ward) => getWardPcode(ward) === selectedWardPcode);
  }, [lmPcode, selectedWardPcode, wards]);

  const activeWard = selectedWardIsValid ? selectedWard : null;
  const wardPcode = getWardPcode(activeWard);
  const scopeReady = !!lmPcode && !!wardPcode;

  const wardGeofences = useMemo(() => {
    const geoFencesArr = Array.isArray(geoFencesList) ? geoFencesList : [];

    if (!wardPcode) return geoFencesArr;

    return geoFencesArr.filter((geoFence) => {
      const geoFenceWardPcode = getGeoFenceWardPcode(geoFence);

      if (!geoFenceWardPcode) return true;

      return geoFenceWardPcode === wardPcode;
    });
  }, [geoFencesList, wardPcode]);

  const selectedGeofenceData = useMemo(() => {
    if (!selectedGeofenceId) return null;

    return (
      geoFencesList.find((geoFence) => geoFence?.id === selectedGeofenceId) ||
      null
    );
  }, [geoFencesList, selectedGeofenceId]);

  const {
    data: wardErfs = [],
    isLoading: erfsLoading,
    isFetching: erfsFetching,
    error: erfsError,
  } = useGetErfsByWardQuery(
    { lmPcode, wardPcode },
    {
      skip: !scopeReady,
    },
  );

  const {
    data: wardPrems = [],
    isLoading: premsLoading,
    isFetching: premsFetching,
    error: premsError,
  } = useGetPremisesByWardQuery(wardPcode, {
    skip: !scopeReady,
  });
  console.log(`warehose --wardPrems`, wardPrems);

  const {
    data: cloudMeters = [],
    isLoading: metersLoading,
    isFetching: metersFetching,
    error: metersError,
  } = useGetAstsByLmPcodeWardPcodeQuery(
    { lmPcode, wardPcode },
    {
      skip: !scopeReady,
    },
  );

  // TODO: Add a web operational TRNs API when available.
  const cloudTrns = [];
  const trnsLoading = false;
  const trnsFetching = false;
  const trnsError = null;

  const expectedPackKey =
    lmPcode && wardPcode ? `${lmPcode}__${wardPcode}` : null;

  // Web warehouse ERFs are normal arrays from wardErfsApi.
  // This replaces the mobile ERF pack-key model for now.
  const packKeyMatches = scopeReady;

  // Narrow geo ids only for filtered selectors.
  const selectedErfId = getErfId(selectedErf);
  const selectedPremiseId = getPremiseId(selectedPremise);
  const selectedMeterId = getMeterId(selectedMeter);

  // -------------------------------------------------
  // 1) BASE / STABLE DATA
  // -------------------------------------------------
  const available = useMemo(() => {
    return {
      wards: lmPcode ? wards : [],
      geofences: lmPcode ? geoFencesList || [] : [],
    };
  }, [lmPcode, wards, geoFencesList]);

  const all = useMemo(() => {
    const allWards = lmPcode ? wards : [];
    const allGeofences = lmPcode ? wardGeofences : [];
    const allErfs = scopeReady ? wardErfs || [] : [];
    const allPrems = scopeReady ? wardPrems || [] : [];
    const allMeters = scopeReady ? cloudMeters || [] : [];
    const allTrns = scopeReady ? cloudTrns || [] : [];

    const geoLibrary = buildGeoLibrary({
      wards: allWards,
      erfGeoEntries: {},
    });

    return {
      wards: allWards,
      geofences: allGeofences,
      erfs: allErfs,
      prems: allPrems,
      meters: allMeters,
      trns: allTrns,
      geoLibrary,
    };
  }, [
    lmPcode,
    scopeReady,
    wards,
    wardGeofences,
    wardErfs,
    wardPrems,
    cloudMeters,
    cloudTrns,
  ]);

  // -------------------------------------------------
  // 2) FILTERED DATA
  // Only this part should react to leaf geo selection.
  // Geofence remains a lens, not a territorial parent.
  // -------------------------------------------------
  const filtered = useMemo(() => {
    // const filteredGeofences = selectedGeofenceId
    //   ? all.geofences.filter((geoFence) => geoFence?.id === selectedGeofenceId)
    //   : all.geofences;

    // Geofences are map overlays/lenses.
    // Keep all ward geofences visible even when one is selected.
    const filteredGeofences = all.geofences;

    // console.log("🧭 WAREHOUSE GEOFENCE DEBUG", {
    //   selectedGeofenceId,
    //   allPremCount: all.prems.length,
    //   filteredPremCount: selectFilteredPrems({
    //     prems: all.prems,
    //     selectedErfId,
    //     selectedPremiseId,
    //     selectedGeofenceId,
    //   }).length,
    //   samplePremises: all.prems.slice(0, 5).map((premise) => ({
    //     id: premise?.id,
    //     premiseId: premise?.premiseId,
    //     erfNo: premise?.erfNo,
    //     geofenceRefs: premise?.geofenceRefs,
    //     geofenceIds: premise?.geofenceIds,
    //   })),
    // });

    return {
      wards: selectFilteredWards({ wards: all.wards }),
      geofences: filteredGeofences,
      erfs: selectFilteredErfs({
        erfs: all.erfs,
        selectedErfId,
      }),
      prems: selectFilteredPrems({
        prems: all.prems,
        selectedErfId,
        selectedPremiseId,
        selectedGeofenceId,
      }),
      meters: selectFilteredMeters({
        meters: all.meters,
        selectedErfId,
        selectedPremiseId,
        selectedMeterId,
        selectedGeofenceId,
      }),
      trns: selectFilteredTrns({
        trns: all.trns,
        selectedErfId,
        selectedPremiseId,
        selectedMeterId,
      }),
    };
  }, [
    all.wards,
    all.geofences,
    all.erfs,
    all.prems,
    all.meters,
    all.trns,
    selectedGeofenceId,
    selectedErfId,
    selectedPremiseId,
    selectedMeterId,
  ]);

  // -------------------------------------------------
  // 3) SYNC STATE
  // Keep separate from filtered selection churn.
  // -------------------------------------------------
  const sync = useMemo(() => {
    const scopeSync = {
      status: !lmPcode
        ? "idle"
        : !selectedWard
          ? "awaiting-ward"
          : selectedWardIsValid
            ? "ready"
            : "invalid-ward",
      lmPcode,
      wardPcode,
    };

    const wardsSync = {
      status: !lmPcode
        ? "idle"
        : wardsLoading || wardsFetching
          ? "syncing"
          : wardsError
            ? "error"
            : "ready",
      lmPcode,
      size: all.wards.length,
      firstSnapshotAt: 0,
      lastSyncAt: 0,
      lastError: wardsError || null,
    };

    const geofencesSync = {
      status: !lmPcode
        ? "idle"
        : geoFencesLoading || geoFencesFetching
          ? "syncing"
          : geoFencesError
            ? "error"
            : "ready",
      lmPcode,
      wardPcode,
      size: all.geofences.length,
      selectedGeofenceId,
      firstSnapshotAt: 0,
      lastSyncAt: 0,
      lastError: geoFencesError || null,
    };

    const wardErfsSync = {
      status: !lmPcode
        ? "idle"
        : !wardPcode
          ? "awaiting-ward"
          : erfsLoading || erfsFetching
            ? "syncing"
            : erfsError
              ? "error"
              : "ready",
      lmPcode,
      wardPcode,
      wardCacheKey: expectedPackKey,
      size: all.erfs.length,
      firstSnapshotAt: 0,
      lastSyncAt: 0,
      lastError: erfsError || null,
    };

    const premisesSync = {
      status: !lmPcode
        ? "idle"
        : !wardPcode
          ? "awaiting-ward"
          : premsLoading || premsFetching
            ? "syncing"
            : premsError
              ? "error"
              : "ready",
      lmPcode,
      wardPcode,
      size: all.prems.length,
      firstSnapshotAt: 0,
      lastSyncAt: 0,
      lastError: premsError || null,
    };

    const metersSync = {
      status: !lmPcode
        ? "idle"
        : !wardPcode
          ? "awaiting-ward"
          : metersLoading || metersFetching
            ? "syncing"
            : metersError
              ? "error"
              : "pending",
      lmPcode,
      wardPcode,
      size: all.meters.length,
      lastError: metersError || null,
      firstSnapshotAt: 0,
      lastSyncAt: 0,
    };

    const trnsSync = {
      status: !lmPcode
        ? "idle"
        : !wardPcode
          ? "awaiting-ward"
          : trnsLoading || trnsFetching
            ? "syncing"
            : trnsError
              ? "error"
              : "pending",
      lmPcode,
      wardPcode,
      size: all.trns.length,
      lastError: trnsError || null,
      firstSnapshotAt: 0,
      lastSyncAt: 0,
    };

    return {
      scope: scopeSync,
      wards: wardsSync,
      geofences: geofencesSync,
      erfs: wardErfsSync,
      premises: premisesSync,
      meters: metersSync,
      trns: trnsSync,
    };
  }, [
    all.wards.length,
    all.geofences.length,
    all.erfs.length,
    all.prems.length,
    all.meters.length,
    all.trns.length,
    erfsError,
    erfsFetching,
    erfsLoading,
    expectedPackKey,
    geoFencesError,
    geoFencesFetching,
    geoFencesLoading,
    lmPcode,
    metersError,
    metersFetching,
    metersLoading,
    premsError,
    premsFetching,
    premsLoading,
    selectedGeofenceId,
    selectedWard,
    selectedWardIsValid,
    trnsError,
    trnsFetching,
    trnsLoading,
    wardPcode,
    wardsError,
    wardsFetching,
    wardsLoading,
  ]);

  const loading =
    (!!lmPcode && (wardsLoading || wardsFetching)) ||
    (!!lmPcode && (geoFencesLoading || geoFencesFetching)) ||
    (scopeReady && (erfsLoading || erfsFetching)) ||
    (scopeReady && (premsLoading || premsFetching)) ||
    (scopeReady && (metersLoading || metersFetching)) ||
    (scopeReady && (trnsLoading || trnsFetching));

  // -------------------------------------------------
  // 4) FINAL PUBLIC VALUE
  // Preserve mobile contract, with web geofences added.
  // -------------------------------------------------
  const value = useMemo(() => {
    return {
      available,
      all,
      filtered,
      sync,
      loading,

      // Helpful scope values for early web consumers like ErfsPage / MapPage.
      scope: {
        lmPcode,
        wardPcode,
        selectedGeofenceId,
        scopeReady,
      },

      selected: {
        lm: selectedLm || null,
        ward: activeWard || null,
        geofence: selectedGeofenceData || selectedGeofence || null,
        erf: selectedErf || null,
        premise: selectedPremise || null,
        meter: selectedMeter || null,
      },
    };
  }, [
    activeWard,
    available,
    all,
    filtered,
    lmPcode,
    loading,
    scopeReady,
    selectedErf,
    selectedGeofence,
    selectedGeofenceData,
    selectedGeofenceId,
    selectedLm,
    selectedMeter,
    selectedPremise,
    sync,
    wardPcode,
  ]);

  return (
    <WarehouseContext.Provider value={value}>
      {children}
    </WarehouseContext.Provider>
  );
};

export const useWarehouse = () => {
  const ctx = useContext(WarehouseContext);

  if (!ctx) {
    throw new Error("useWarehouse must be used within WarehouseProvider");
  }

  return ctx;
};
