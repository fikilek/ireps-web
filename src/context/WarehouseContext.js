// src/context/WarehouseContext.js

import { createContext, useContext, useMemo } from "react";
import { useGeo } from "./GeoContext";

import { useGetPremisesByWardQuery } from "../redux/mapPremisesApi";
import { useGetWardBoundariesByLmQuery } from "../redux/mapWardsApi";

import {
  buildGeoLibrary,
  selectFilteredErfs,
  selectFilteredMeters,
  selectFilteredPrems,
  selectFilteredTrns,
  selectFilteredWards,
} from "./warehouseSelectors";

export const WarehouseContext = createContext(null);

export const WarehouseProvider = ({ children }) => {
  const { geoState } = useGeo();
  const { selectedLm, selectedWard } = geoState || {};

  const lmPcode = selectedLm?.pcode || selectedLm?.id || null;

  const { data: wardsList = [], isLoading: wardsLoading } =
    useGetWardBoundariesByLmQuery(lmPcode, {
      skip: !lmPcode,
    });

  const wards = useMemo(() => {
    if (!lmPcode) return [];

    return (wardsList || []).filter((w) => {
      const parentLm =
        w?.parents?.localMunicipalityId ||
        w?.parents?.localMunicipality?.pcode ||
        w?.admin?.localMunicipality?.pcode ||
        w?.lmPcode ||
        null;

      if (parentLm) return parentLm === lmPcode;

      return String(w?.id || "").startsWith(lmPcode);
    });
  }, [wardsList, lmPcode]);

  const selectedWardIsValid = useMemo(() => {
    if (!lmPcode || !selectedWard?.id) return false;

    return wards.some(
      (w) =>
        (w?.id && w.id === selectedWard.id) ||
        (w?.pcode && w.pcode === selectedWard.id) ||
        (w?.wardPcode && w.wardPcode === selectedWard.id) ||
        (w?.id && w.id === selectedWard?.pcode) ||
        (w?.pcode && w.pcode === selectedWard?.pcode) ||
        (w?.wardPcode && w.wardPcode === selectedWard?.pcode),
    );
  }, [lmPcode, selectedWard?.id, selectedWard?.pcode, wards]);

  const activeWard = selectedWardIsValid ? selectedWard : null;
  const wardPcode = activeWard?.pcode || activeWard?.wardPcode || activeWard?.id || null;
  const scopeReady = !!lmPcode && !!wardPcode;

  // TODO: Add a web operational ERF-by-ward hook. Do not use registry collections for Ward Scope.
  const wardErfs = null;
  const erfsLoading = false;

  const { data: wardPrems = [], isLoading: premsLoading } =
    useGetPremisesByWardQuery(wardPcode, {
      skip: !lmPcode || !wardPcode,
    });

  // TODO: Add a web operational ASTs API when available.
  const cloudMeters = [];
  const metersLoading = false;

  // TODO: Add a web operational TRNs API when available.
  const cloudTrns = [];
  const trnsLoading = false;

  const expectedPackKey =
    lmPcode && wardPcode ? `${lmPcode}__${wardPcode}` : null;

  const currentPackKey =
    wardErfs?.sync?.wardCacheKey ||
    wardErfs?.sync?.packKey ||
    wardErfs?.sync?.key ||
    null;

  const packKeyMatches =
    !!expectedPackKey && currentPackKey === expectedPackKey;

  // Narrow geo ids only for filtered selectors
  const selectedErfId = geoState?.selectedErf?.id || null;
  const selectedPremiseId = geoState?.selectedPremise?.id || null;
  const selectedMeterId =
    geoState?.selectedMeter?.ast?.astData?.astId ||
    geoState?.selectedMeter?.id ||
    null;

  // -------------------------------------------------
  // 1) BASE / STABLE DATA
  // -------------------------------------------------
  const available = useMemo(() => {
    return {
      wards: lmPcode ? wards : [],
    };
  }, [lmPcode, wards]);

  const all = useMemo(() => {
    const allWards = scopeReady ? wards : [];
    const allErfs =
      scopeReady && packKeyMatches ? wardErfs?.metaEntries || [] : [];
    const allPrems = scopeReady ? wardPrems || [] : [];
    const allMeters = scopeReady ? cloudMeters || [] : [];
    const allTrns = scopeReady ? cloudTrns || [] : [];

    const geoLibrary = buildGeoLibrary({
      wards: allWards,
      erfGeoEntries: packKeyMatches ? wardErfs?.geoEntries || {} : {},
    });

    return {
      wards: allWards,
      erfs: allErfs,
      prems: allPrems,
      meters: allMeters,
      trns: allTrns,
      geoLibrary,
    };
  }, [
    scopeReady,
    wards,
    wardErfs,
    wardPrems,
    cloudMeters,
    cloudTrns,
    packKeyMatches,
  ]);

  // -------------------------------------------------
  // 2) FILTERED DATA
  // Only this part should react to leaf geo selection.
  // -------------------------------------------------
  const filtered = useMemo(() => {
    return {
      wards: selectFilteredWards({ wards: all.wards }),
      erfs: selectFilteredErfs({
        erfs: all.erfs,
        selectedErfId,
      }),
      prems: selectFilteredPrems({
        prems: all.prems,
        selectedErfId,
        selectedPremiseId,
      }),
      meters: selectFilteredMeters({
        meters: all.meters,
        selectedErfId,
        selectedPremiseId,
        selectedMeterId,
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
    all.erfs,
    all.prems,
    all.meters,
    all.trns,
    selectedErfId,
    selectedPremiseId,
    selectedMeterId,
  ]);

  // -------------------------------------------------
  // 3) SYNC STATE
  // Keep separate from filtered selection churn.
  // -------------------------------------------------
  const sync = useMemo(() => {
    const wardErfsSync = packKeyMatches
      ? (wardErfs?.sync ?? {
          status: "idle",
          lmPcode,
          wardPcode,
          wardCacheKey: expectedPackKey,
          lastSyncAt: 0,
          firstSnapshotAt: 0,
          lastError: null,
          size: 0,
        })
      : {
          status: !lmPcode ? "idle" : !wardPcode ? "awaiting-ward" : "syncing",
          lmPcode,
          wardPcode,
          wardCacheKey: expectedPackKey,
          size: 0,
          lastSyncAt: 0,
          firstSnapshotAt: 0,
          lastError: null,
        };

    const wardsSync = {
      status: !lmPcode ? "idle" : wardsLoading ? "syncing" : "ready",
      lmPcode,
      firstSnapshotAt: 0,
      lastSyncAt: 0,
      lastError: null,
    };

    const scopeSync = {
      status: !lmPcode
        ? "idle"
        : !selectedWard
          ? "awaiting-ward"
          : selectedWardIsValid
            ? "ready"
            : "invalid-ward",
      lmPcode,
      wardPcode: selectedWard?.pcode || selectedWard?.wardPcode || selectedWard?.id || null,
    };

    const metersSync = {
      status: !lmPcode
        ? "idle"
        : !wardPcode
          ? "awaiting-ward"
          : metersLoading
            ? "syncing"
            : "ready",
      lmPcode,
      wardPcode,
      size: all.meters.length,
      lastError: null,
      firstSnapshotAt: 0,
      lastSyncAt: 0,
    };

    const trnsSync = {
      status: !lmPcode
        ? "idle"
        : !wardPcode
          ? "awaiting-ward"
          : trnsLoading
            ? "syncing"
            : "ready",
      lmPcode,
      wardPcode,
      size: all.trns.length,
      lastError: null,
      firstSnapshotAt: 0,
      lastSyncAt: 0,
    };

    return {
      scope: scopeSync,
      wards: wardsSync,
      erfs: wardErfsSync,
      meters: metersSync,
      trns: trnsSync,
    };
  }, [
    packKeyMatches,
    wardErfs,
    lmPcode,
    wardPcode,
    expectedPackKey,
    wardsLoading,
    metersLoading,
    trnsLoading,
    selectedWard,
    selectedWardIsValid,
    all.meters.length,
    all.trns.length,
  ]);

  const loading =
    (!!lmPcode && wardsLoading) ||
    (scopeReady && erfsLoading) ||
    (scopeReady && premsLoading) ||
    (scopeReady && metersLoading) ||
    (scopeReady && trnsLoading);

  // -------------------------------------------------
  // 4) FINAL PUBLIC VALUE
  // Preserve current contract exactly.
  // -------------------------------------------------
  const value = useMemo(() => {
    return {
      available,
      all,
      filtered,
      sync,
      loading,
    };
  }, [available, all, filtered, sync, loading]);

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
