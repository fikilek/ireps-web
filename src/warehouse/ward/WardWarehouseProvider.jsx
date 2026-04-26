import { createContext, useMemo } from "react";
import {
  selectMapErfFeatures,
  selectMapGeofencePolygons,
  selectMapMeterMarkers,
  selectMapPremiseMarkers,
  selectScopedErfs,
  selectScopedGeofences,
  selectScopedMeters,
  selectScopedPremises,
  selectSelectedErf,
  selectSelectedGeofence,
  selectSelectedMeter,
  selectSelectedPremise,
  selectSelectedWard,
  selectTableErfRows,
  selectTableGeofenceRows,
  selectTableMeterRows,
  selectTablePremiseRows,
} from "./wardWarehouseSelectors";
import { arrayOrEmpty } from "./wardWarehouseUtils";

const defaultScope = {
  activeLmPcode: null,
  selectedWardPcode: null,
  selectedGeofenceId: null,
  selectedErfId: null,
  selectedPremiseId: null,
  selectedMeterId: null,
  activeLens: null,
};

const defaultOps = {
  wards: [],
  geofences: [],
  erfs: [],
  premises: [],
  meters: [],
};

const defaultWarehouse = {
  scope: defaultScope,
  selected: {
    ward: null,
    geofence: null,
    erf: null,
    premise: null,
    meter: null,
  },
  ops: defaultOps,
  scopedOps: {
    geofences: [],
    erfs: [],
    premises: [],
    meters: [],
  },
  mapData: {
    geofencePolygons: [],
    erfFeatures: [],
    premiseMarkers: [],
    meterMarkers: [],
  },
  tableData: {
    geofenceRows: [],
    erfRows: [],
    premiseRows: [],
    meterRows: [],
  },
  counts: {
    geofences: 0,
    erfs: 0,
    premises: 0,
    meters: 0,
  },
  loading: false,
  errors: [],
};

export const WardWarehouseContext = createContext(defaultWarehouse);

export function WardWarehouseProvider({
  children,
  scope: scopeInput = {},
  ops: opsInput = {},
  loading = false,
  errors = [],
}) {
  const value = useMemo(() => {
    const scope = {
      ...defaultScope,
      ...scopeInput,
    };

    const ops = {
      wards: arrayOrEmpty(opsInput.wards),
      geofences: arrayOrEmpty(opsInput.geofences),
      erfs: arrayOrEmpty(opsInput.erfs),
      premises: arrayOrEmpty(opsInput.premises),
      meters: arrayOrEmpty(opsInput.meters ?? opsInput.asts),
    };

    const scopedOps = {
      geofences: selectScopedGeofences(scope, ops),
      erfs: selectScopedErfs(scope, ops),
      premises: selectScopedPremises(scope, ops),
      meters: selectScopedMeters(scope, ops),
    };

    const mapData = {
      geofencePolygons: selectMapGeofencePolygons(scopedOps),
      erfFeatures: selectMapErfFeatures(scopedOps),
      premiseMarkers: selectMapPremiseMarkers(scopedOps),
      meterMarkers: selectMapMeterMarkers(scopedOps),
    };

    const tableData = {
      geofenceRows: selectTableGeofenceRows(scopedOps),
      erfRows: selectTableErfRows(scopedOps),
      premiseRows: selectTablePremiseRows(scopedOps),
      meterRows: selectTableMeterRows(scopedOps),
    };

    return {
      scope,
      selected: {
        ward: selectSelectedWard(scope, ops),
        geofence: selectSelectedGeofence(scope, ops),
        erf: selectSelectedErf(scope, ops),
        premise: selectSelectedPremise(scope, ops),
        meter: selectSelectedMeter(scope, ops),
      },
      ops,
      scopedOps,
      mapData,
      tableData,
      counts: {
        geofences: scopedOps.geofences.length,
        erfs: scopedOps.erfs.length,
        premises: scopedOps.premises.length,
        meters: scopedOps.meters.length,
      },
      loading,
      errors: arrayOrEmpty(errors),
    };
  }, [errors, loading, opsInput, scopeInput]);

  return <WardWarehouseContext.Provider value={value}>{children}</WardWarehouseContext.Provider>;
}
