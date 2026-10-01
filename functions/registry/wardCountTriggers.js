import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { affectedWardScopes } from './wardChangeScopes.js';
import { rebuildWardRegistryRow } from './wardBuilder.js';

function sourceTrigger(collection) {
  return onDocumentWritten({document:collection+'/{id}',retry:true,timeoutSeconds:540}, async event => {
    const scopes = affectedWardScopes(collection,event.data?.before?.data(),event.data?.after?.data(),event.params.id);
    const results = await Promise.allSettled(scopes.map(scope => rebuildWardRegistryRow({...scope,reason:'SOURCE_'+collection})));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason; // Eventarc retries failures; no operational writes are repeated.
  });
}
export const onWardSourceCountsWritten = sourceTrigger('wards');
export const onErfWardCountsWritten = sourceTrigger('ireps_erfs');
export const onPremiseWardCountsWritten = sourceTrigger('premises');
export const onMeterWardCountsWritten = sourceTrigger('asts');
export const onTrnWardCountsWritten = sourceTrigger('trns');

// Recover interrupted or failed calculations, including failures from legacy callers.
export const recoverWardCounts = onSchedule({schedule:'every 60 minutes',timeoutSeconds:540}, async () => {
  const db = getFirestore();
  const snapshot = await db.collection('registry_wards').where('calculation.state','in',['PENDING','UNAVAILABLE']).get();
  const failures = [];
  for (const doc of snapshot.docs) {
    const row = doc.data();
    const requestedAt = row.calculation?.requestedAt?.toMillis?.() || 0;
    if (Date.now() - requestedAt < 15 * 60 * 1000) continue;
    try { await rebuildWardRegistryRow({lmPcode:row.localMunicipality?.pcode,wardPcode:row.ward?.pcode,reason:'RECOVERY'}); }
    catch { failures.push(doc.id); }
  }
  if (failures.length) throw new Error('Ward recovery failures: '+failures.join(', '));
});
