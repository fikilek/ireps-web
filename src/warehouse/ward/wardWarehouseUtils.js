export function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

export function includesId(list, id) {
  if (id === undefined || id === null) {
    return false;
  }

  return arrayOrEmpty(list).some((item) => getEntityId(item) === id || item === id);
}

export function getEntityId(entity) {
  if (!entity || typeof entity !== "object") {
    return entity;
  }

  return (
    entity.id ??
    entity._id ??
    entity.uid ??
    entity.pcode ??
    entity.code ??
    entity.erfId ??
    entity.premiseId ??
    entity.meterId ??
    null
  );
}

export function getWardPcode(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }

  return entity.wardPcode ?? entity.ward_pcode ?? entity.wardCode ?? entity.ward_code ?? null;
}

export function getLmPcode(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }

  return entity.lmPcode ?? entity.lm_pcode ?? entity.localMunicipalityPcode ?? entity.local_municipality_pcode ?? null;
}

export function getErfId(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }

  return entity.erfId ?? entity.erf_id ?? entity.erfCode ?? entity.erf_code ?? null;
}

export function getPremiseId(entity) {
  if (!entity || typeof entity !== "object") {
    return null;
  }

  return entity.premiseId ?? entity.premise_id ?? entity.premisesId ?? entity.premises_id ?? null;
}
