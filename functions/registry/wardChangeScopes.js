export function wardContribution(kind, data, id) {
  if (!data) return null;
  let lmPcode, wardPcode, category = '';
  if (kind === 'wards') {
    lmPcode = data.parents?.localMunicipalityId;
    wardPcode = id;
    category = JSON.stringify([data.code, data.name, data.parents?.provinceId, data.parents?.districtId]);
  } else if (kind === 'ireps_erfs') {
    lmPcode = data.admin?.localMunicipality?.pcode;
    wardPcode = data.admin?.ward?.pcode;
    category = data.erf?.type;
  } else if (kind === 'premises') {
    ({lmPcode, wardPcode} = data.parents || {});
  } else {
    ({lmPcode, wardPcode} = data.accessData?.parents || {});
    if (kind === 'asts') category = JSON.stringify([data.meterType, typeof data.status === 'string' ? data.status : data.status?.state]);
  }
  if (!lmPcode || !wardPcode || lmPcode === 'NAv' || wardPcode === 'NAv') return null;
  return {lmPcode, wardPcode, category:category ?? ''};
}

export function affectedWardScopes(kind, before, after, id) {
  const previous = wardContribution(kind,before,id);
  const next = wardContribution(kind,after,id);
  if (JSON.stringify(previous) === JSON.stringify(next)) return [];
  return [...new Map([previous,next].filter(Boolean).map(({lmPcode,wardPcode}) => [lmPcode+'__'+wardPcode,{lmPcode,wardPcode}])).values()];
}
