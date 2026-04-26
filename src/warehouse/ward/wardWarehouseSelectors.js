import {
  arrayOrEmpty,
  getEntityId,
  getErfId,
  getLmPcode,
  getPremiseId,
  getWardPcode,
} from "./wardWarehouseUtils";

export function selectSelectedWard(scope = {}, ops = {}) {
  const wards = arrayOrEmpty(ops.wards);
  const selectedWardPcode = scope.selectedWardPcode;

  if (!selectedWardPcode) {
    return null;
  }

  return wards.find((ward) => getEntityId(ward) === selectedWardPcode || getWardPcode(ward) === selectedWardPcode) ?? null;
}

export function selectSelectedGeofence(scope = {}, ops = {}) {
  return selectById(ops.geofences, scope.selectedGeofenceId);
}

export function selectSelectedErf(scope = {}, ops = {}) {
  return selectById(ops.erfs, scope.selectedErfId);
}

export function selectSelectedPremise(scope = {}, ops = {}) {
  return selectById(ops.premises, scope.selectedPremiseId);
}

export function selectSelectedMeter(scope = {}, ops = {}) {
  return selectById(ops.meters, scope.selectedMeterId);
}

export function selectScopedGeofences(scope = {}, ops = {}) {
  return selectByOperationalScope(arrayOrEmpty(ops.geofences), scope);
}

export function selectScopedErfs(scope = {}, ops = {}) {
  return selectByOperationalScope(arrayOrEmpty(ops.erfs), scope);
}

export function selectScopedPremises(scope = {}, ops = {}) {
  const premises = selectByOperationalScope(arrayOrEmpty(ops.premises), scope);

  if (scope.selectedErfId) {
    return premises.filter((premise) => getErfId(premise) === scope.selectedErfId);
  }

  return premises;
}

export function selectScopedMeters(scope = {}, ops = {}) {
  const meters = selectByOperationalScope(arrayOrEmpty(ops.meters), scope);

  if (scope.selectedPremiseId) {
    return meters.filter((meter) => getPremiseId(meter) === scope.selectedPremiseId);
  }

  if (scope.selectedErfId) {
    return meters.filter((meter) => getErfId(meter) === scope.selectedErfId);
  }

  return meters;
}

export function selectTableGeofenceRows(scopedOps = {}) {
  return arrayOrEmpty(scopedOps.geofences);
}

export function selectTableErfRows(scopedOps = {}) {
  return arrayOrEmpty(scopedOps.erfs);
}

export function selectTablePremiseRows(scopedOps = {}) {
  return arrayOrEmpty(scopedOps.premises);
}

export function selectTableMeterRows(scopedOps = {}) {
  return arrayOrEmpty(scopedOps.meters);
}

export function selectMapGeofencePolygons(scopedOps = {}) {
  return arrayOrEmpty(scopedOps.geofences);
}

export function selectMapErfFeatures(scopedOps = {}) {
  // Viewport and zoom guards will be applied here later, only for map ERF features.
  return arrayOrEmpty(scopedOps.erfs);
}

export function selectMapPremiseMarkers(scopedOps = {}) {
  return arrayOrEmpty(scopedOps.premises);
}

export function selectMapMeterMarkers(scopedOps = {}) {
  return arrayOrEmpty(scopedOps.meters);
}

function selectById(list, id) {
  if (!id) {
    return null;
  }

  return arrayOrEmpty(list).find((entity) => getEntityId(entity) === id) ?? null;
}

function selectByOperationalScope(list, scope = {}) {
  const activeLmPcode = scope.activeLmPcode;
  const selectedWardPcode = scope.selectedWardPcode;

  return arrayOrEmpty(list).filter((entity) => {
    if (selectedWardPcode) {
      return getWardPcode(entity) === selectedWardPcode;
    }

    if (activeLmPcode) {
      return getLmPcode(entity) === activeLmPcode;
    }

    return true;
  });
}
