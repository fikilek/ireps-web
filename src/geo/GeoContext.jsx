import {
  createContext,
  useCallback,
  useMemo,
  useState,
} from "react";

export const GeoContext = createContext(null);

const INITIAL_GEO = {
  selectedLm: null,
  selectedWard: null,
  selectedErf: null,
  selectedPremise: null,
  selectedMeter: null,
  selectedGeofence: null,
  lastSelectionType: null,
  flightSignal: 0,
};

const SELECTION_KEYS = [
  "selectedLm",
  "selectedWard",
  "selectedErf",
  "selectedPremise",
  "selectedMeter",
  "selectedGeofence",
  "lastSelectionType",
];

const hasSelectionChanged = (prev, next) =>
  SELECTION_KEYS.some((key) => !Object.is(prev[key], next[key]));

export const GeoProvider = ({ children }) => {
  const [geoState, setGeoState] = useState(INITIAL_GEO);

  const updateGeo = useCallback((updates, options = {}) => {
    setGeoState((prev) => {
      const silent = options.silent === true;
      const next = { ...prev, ...updates };

      if ("selectedLm" in updates) {
        next.selectedWard = null;
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

      if (!silent && hasSelectionChanged(prev, next)) {
        next.flightSignal = prev.flightSignal + 1;
      }

      return next;
    });
  }, []);

  const resetGeo = useCallback(() => {
    setGeoState((prev) => {
      const next = {
        ...INITIAL_GEO,
        flightSignal: prev.flightSignal,
      };

      if (hasSelectionChanged(prev, next)) {
        next.flightSignal = prev.flightSignal + 1;
      }

      return next;
    });
  }, []);

  const selectLm = useCallback(
    (lm, options = {}) => {
      updateGeo(
        {
          selectedLm: lm,
          lastSelectionType: "LM",
        },
        options,
      );
    },
    [updateGeo],
  );

  const selectWard = useCallback(
    (ward, options = {}) => {
      updateGeo(
        {
          selectedWard: ward,
          lastSelectionType: "WARD",
        },
        options,
      );
    },
    [updateGeo],
  );

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

  const selectErf = useCallback(
    (erf, options = {}) => {
      updateGeo(
        {
          selectedErf: erf,
          lastSelectionType: "ERF",
        },
        options,
      );
    },
    [updateGeo],
  );

  const selectPremise = useCallback(
    (premise, options = {}) => {
      updateGeo(
        {
          selectedPremise: premise,
          lastSelectionType: "PREMISE",
        },
        options,
      );
    },
    [updateGeo],
  );

  const selectMeter = useCallback(
    (meter, options = {}) => {
      updateGeo(
        {
          selectedMeter: meter,
          lastSelectionType: "METER",
        },
        options,
      );
    },
    [updateGeo],
  );

  const clearLeafSelection = useCallback(() => {
    updateGeo({
      selectedErf: null,
      selectedPremise: null,
      selectedMeter: null,
      lastSelectionType: null,
    });
  }, [updateGeo]);

  const value = useMemo(
    () => ({
      geoState,
      updateGeo,
      resetGeo,
      selectLm,
      selectWard,
      selectGeofence,
      clearGeofence,
      selectErf,
      selectPremise,
      selectMeter,
      clearLeafSelection,
    }),
    [
      geoState,
      updateGeo,
      resetGeo,
      selectLm,
      selectWard,
      selectGeofence,
      clearGeofence,
      selectErf,
      selectPremise,
      selectMeter,
      clearLeafSelection,
    ],
  );

  return <GeoContext.Provider value={value}>{children}</GeoContext.Provider>;
};
