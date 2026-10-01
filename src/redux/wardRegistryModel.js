export const COUNT_FIELDS = ['formalErfs','informalErfs','totalErfs','premises','electricityMeters','waterMeters','totalMeters','trns'];
// Legacy summaries are ready only when all stored counters are valid.
export function mergeWardSummaries(wards, summaries, summaryError = false) {
  const byWard = new Map(summaries.map(s => [s.ward?.pcode, s]));
  return wards.map(ward => {
    const pcode = ward.pcode || ward.id;
    const summary = byWard.get(pcode);
    const valid = summary && COUNT_FIELDS.every(k => typeof summary.counts?.[k] === 'number' && Number.isInteger(summary.counts[k]) && summary.counts[k] >= 0);
    const explicit = summary?.calculation?.state;
    const state = summaryError || explicit === 'UNAVAILABLE' || (explicit === 'READY' && !valid) ? 'UNAVAILABLE' : explicit === 'PENDING' || !valid ? 'PENDING' : 'READY';
    const label = state === 'UNAVAILABLE' ? 'Unavailable' : 'Pending';
    return {...summary, id: summary?.id || ward.parents?.localMunicipalityId + '__' + pcode,
      localMunicipality: { ...summary?.localMunicipality, pcode: ward.parents?.localMunicipalityId },
      ward: {pcode, number: ward.code, name: ward.name},
      calculation: {...summary?.calculation, state},
      counts: state === 'READY' ? summary.counts : Object.fromEntries(COUNT_FIELDS.map(k => [k,label]))};
  });
}
