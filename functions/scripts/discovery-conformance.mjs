import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import admin from 'firebase-admin';
import { planDiscoveryAccessBackfill } from '../noAccess/discoveryAccessBackfill.js';
import { planDiscoveryCleanupDependencies, recordedTimeToIso } from '../noAccess/discoveryCleanupDependencies.js';
import { normalizeNoAccessAccessData, buildNoAccessLocation, buildNoAccessParentsFromErf, readGpsPoint, NO_ACCESS_RETURN_VISIT_REASON } from '../noAccess/recordNoAccess.js';
import { formatStreetAddress, formatPropertyType } from '../premises/streetAddress.js';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const projectId = option('--project');
assert.equal(projectId, 'ireps2', 'This reviewed maintenance run is DEV-only.');
assert.ok(args.includes('--output'), 'An absolute evidence directory is required.');
const out = option('--output');
assert.ok(path.isAbsolute(out));
fs.mkdirSync(out, { recursive: true });
const apply = args.includes('--apply');
if (apply) {
  assert.ok(args.includes('--reviewed-plan'), 'Apply requires an earlier reviewed dry-run plan.');
  assert.ok(!fs.existsSync(path.join(out, 'backup.json')), 'Use a fresh evidence directory; never overwrite a backup.');
}
const app = admin.initializeApp({ projectId, credential: admin.credential.applicationDefault() });
const db = admin.firestore(app); db.settings({ preferRest: true });
const bucket = admin.storage(app).bucket('ireps2.appspot.com');
const present = x => x != null && String(x).trim() !== '' && String(x).toUpperCase() !== 'NAV';
const objectName = value => {
  try {
    const url = new URL(value);
    if (url.hostname !== 'firebasestorage.googleapis.com') return null;
    const match = url.pathname.match(/^\/v0\/b\/ireps2\.appspot\.com\/o\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
};
const snapshots = new Map();
const cache = new Map();
const get = async refPath => {
  if (!cache.has(refPath)) {
    const ref = db.doc(refPath);
    cache.set(refPath, ref.parent.where(admin.firestore.FieldPath.documentId(), '==', ref.id).get()
      .then(result => result.docs[0] || { exists: false, id: ref.id, ref }));
  }
  const doc = await cache.get(refPath); if (doc.exists) snapshots.set(doc.ref.path, doc); return doc;
};
const readCollection = async name => {
  const snap = await db.collection(name).get();
  for (const doc of snap.docs) snapshots.set(doc.ref.path, doc);
  return snap.docs;
};
const assignPatch = (value, patch) => {
  const result = structuredClone(value);
  for (const [key, entry] of Object.entries(patch)) {
    const parts = key.split('.'); let target = result;
    for (const part of parts.slice(0, -1)) target = target[part] ||= {};
    target[parts.at(-1)] = entry;
  }
  return result;
};
try {
  const trns = await readCollection('trns');
  const discovery = trns.filter(d => d.data().accessData?.trnType === 'METER_DISCOVERY' && d.data().accessData?.access?.hasAccess === 'no');
  console.log(`Checking ${discovery.length} Discovery visits.`);
  const changes = [], deletions = [], files = new Map();
  const inspect = async doc => {
    console.log(`Checking ${doc.id}`);
    const value = doc.data();
    let patch = planDiscoveryAccessBackfill(value) || {};
    let next = assignPatch(value, patch);
    try {
      const oldExplanation = String(value.accessData.access.reasonOther || value.accessData.access.reason || '').trim().replace(/[.!]+$/, '').toLowerCase();
      if (oldExplanation === NO_ACCESS_RETURN_VISIT_REASON.toLowerCase()) {
        next.accessData.access.reasonCode = NO_ACCESS_RETURN_VISIT_REASON;
      }
      // TR-R002 permits null when the capture time was never recorded. Timestamp objects
      // contain a real recorded time; convert their representation, never infer from an ID.
      for (const key of ['createdAt', 'updatedAt', 'createdOnDevice', 'updatedOnDevice']) {
        next.metadata[key] = recordedTimeToIso(value.metadata?.[key]);
      }
      assert.ok(present(value.accessData?.premise?.id), 'MISSING_PREMISE');
      assert.ok(present(value.accessData?.erfId), 'MISSING_ERF');
      const premise = await get(`premises/${value.accessData.premise.id}`);
      const erf = await get(`ireps_erfs/${value.accessData.erfId}`);
      assert.ok(premise.exists, 'PREMISE_NOT_FOUND'); assert.ok(erf.exists, 'ERF_NOT_FOUND');
      assert.equal(premise.data().erfId, value.accessData.erfId, 'PREMISE_ERF_MISMATCH');
      const accessData = normalizeNoAccessAccessData(next.accessData, { metadata: next.metadata, actor: { uid: next.metadata.createdByUid, name: next.metadata.createdByUser } });
      const parents = buildNoAccessParentsFromErf(erf.data());
      assert.ok(present(parents.lmPcode) && present(parents.wardPcode), 'MISSING_WARD_OR_LM');
      const location = readGpsPoint(next.ast?.location) && ['ASSET', 'PREMISE'].includes(next.ast.location.source)
        ? next.ast.location : buildNoAccessLocation({ premiseGeometry: premise.data().geometry });
      const correct = {
        'accessData.access': accessData.access,
        'accessData.parents': parents,
        'accessData.premise': { id: premise.id, address: formatStreetAddress(premise.data().address) || 'NAv', propertyType: formatPropertyType(premise.data().propertyType) || 'NAv' },
        'ast.location': location,
      };
      for (const key of ['createdAt', 'updatedAt', 'createdOnDevice', 'updatedOnDevice']) correct[`metadata.${key}`] = next.metadata[key];
      patch = {};
      for (const [key, entry] of Object.entries(correct)) {
        const previous = key.split('.').reduce((obj, part) => obj?.[part], value);
        if (!isDeepStrictEqual(previous, entry)) patch[key] = entry;
      }
      next = assignPatch(value, patch);
      assert.ok(next.media?.some(m => m.tag === 'noAccessPhoto' && m.url), 'MISSING_PHOTO');
      for (const media of next.media.filter(m => m.tag === 'noAccessPhoto')) {
        const name = objectName(media.url); assert.ok(name, 'UNRESOLVED_PHOTO');
        const [metadata] = await bucket.file(name).getMetadata();
        files.set(name, { name, generation: metadata.generation, exists: true });
      }
      if (Object.keys(patch).length) changes.push({ path: doc.ref.path, patch });
    } catch (error) {
      // A network fault is never evidence that a record needs deleting.
      if (!error.irepsCode && error.name !== 'AssertionError' && error.code !== 404) throw error;
      deletions.push({ id: doc.id, path: doc.ref.path, reason: error.irepsCode || error.message });
    }
  };
  for (let start = 0; start < discovery.length; start += 8) await Promise.all(discovery.slice(start, start + 8).map(inspect));
  changes.sort((a, b) => a.path.localeCompare(b.path));
  deletions.sort((a, b) => a.path.localeCompare(b.path));
  const ids = new Set(deletions.map(d => d.id));
  const relatedCollections = ['asts','premises','registry_premises','registry_meters','registry_erfs','registry_wards','report_trn_no_access','refused_submissions','notifications','tb_rows','tb_uploads','batch_erf_overrides','field_account_data','registry_mread',
    'noAccessReconciliationFailures','account_master','registry_accounts','registry_jobs','bgo_batches','tc_rows','tc_uploads','report_trn_anomaly','report_trn_normalisation','report_trn_user_activity','mread_staging'];
  await Promise.all(relatedCollections.map(readCollection));
  console.log('Reference collections read.');
  const salesIds = new Set();
  for (const doc of snapshots.values()) {
    const value = doc.data();
    if (doc.ref.parent.id === 'tb_rows' && present(value.salesAllMeterId)) salesIds.add(value.salesAllMeterId);
    const context = value.origin?.targetedBatch || value.targetedBatchContext;
    if (context?.salesDocId) salesIds.add(context.salesDocId);
  }
  const salesList = [...salesIds];
  for (let start = 0; start < salesList.length; start += 15) {
    await Promise.all(salesList.slice(start, start + 15).map(id => get(`sales-all-meters/${id}`)));
  }
  console.log(`Checked ${salesIds.size} batch-linked Sales records.`);
  fs.writeFileSync(path.join(out, 'source-audit.json'), JSON.stringify([...snapshots].map(([refPath, doc]) => ({ path: refPath, updateTime: doc.updateTime, fields: doc._fieldsProto, data: doc.data() })), null, 2)+'\n');
  const dependencies = planDiscoveryCleanupDependencies(new Map([...snapshots].map(([refPath, doc]) => [refPath, doc.data()])), ids);
  const matches = [];
  for (const doc of snapshots.values()) {
    if (ids.has(doc.id) && doc.ref.parent.id === 'trns') continue;
    const json = JSON.stringify(doc.data());
    const references = [...ids].filter(id => doc.id === id || json.includes(id));
    if (references.length) matches.push({ path: doc.ref.path, ids: references });
  }
  for (const deletion of deletions) {
    const source = snapshots.get(deletion.path).data();
    for (const media of source.media || []) {
      const name = objectName(media.url || media.uri);
      if (!name) continue;
      if (!files.has(name)) {
        try { const [meta] = await bucket.file(name).getMetadata(); files.set(name, { name, generation: meta.generation, exists: true }); }
        catch (error) { if (error.code !== 404) throw error; files.set(name, { name, exists: false }); }
      }
    }
  }
  const deletedFiles = [...new Set(deletions.flatMap(d => (snapshots.get(d.path).data().media || []).map(m => objectName(m.url || m.uri)).filter(Boolean)))];
  const remainingReferences = [];
  for (const name of deletedFiles) {
    for (const doc of snapshots.values()) {
      if (deletions.some(d => d.path === doc.ref.path) || dependencies.deletes.includes(doc.ref.path)) continue;
      const json = JSON.stringify(doc.data());
      if (json.includes(name) || json.includes(encodeURIComponent(name))) remainingReferences.push({ name, path: doc.ref.path });
    }
  }
  const plan = { checkedAt: new Date().toISOString(), projectId, sourceCount: discovery.length, changes, deletions, dependencies, matches,
    deletedFiles: deletedFiles.map(name => files.get(name)), remainingFileReferences: remainingReferences, inspectedDocuments: snapshots.size };
  fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan, null, 2)+'\n');
  // Firestore's raw value protobufs retain timestamps/references/bytes for an exact restore.
  const backup = [...snapshots].map(([refPath, doc]) => ({ path: refPath, updateTime: doc.updateTime, fields: doc._fieldsProto, data: doc.data() }));
  fs.writeFileSync(path.join(out, 'audit-snapshots.json'), JSON.stringify(backup, null, 2)+'\n');
  console.log(JSON.stringify({ sourceCount: discovery.length, changes: changes.length, deletions: deletions.length, dependencies, remainingReferences, inspectedDocuments: snapshots.size }, null, 2));
  if (apply) {
    const reviewed = JSON.parse(fs.readFileSync(option('--reviewed-plan'), 'utf8'));
    const reviewedContent = p => ({ projectId: p.projectId, changes: p.changes, deletions: p.deletions, dependencies: p.dependencies, deletedFiles: p.deletedFiles, remainingFileReferences: p.remainingFileReferences });
    assert.deepEqual(reviewedContent(plan), reviewedContent(reviewed), 'Source/dependencies changed since review; inspect the new plan before applying.');
    const updates = [...changes, ...dependencies.changes];
    const deletePaths = new Set([...deletions.map(d => d.path), ...dependencies.deletes]);
    // Enumerate descendants, including missing intermediate documents, so parent deletion
    // cannot strand a subcollection. Photos on unexpected child records require review.
    const descendants = [];
    const collectChildren = async ref => {
      for (const collection of await ref.listCollections()) {
        for (const childRef of await collection.listDocuments()) {
          const child = await get(childRef.path);
          if (child.exists) {
            assert.ok(!(child.data().media?.length), `Child media needs review: ${childRef.path}`);
            descendants.push({ path: childRef.path, updateTime: child.updateTime, fields: child._fieldsProto, data: child.data() });
            deletePaths.add(childRef.path);
          }
          await collectChildren(childRef);
        }
      }
    };
    const roots = [...deletePaths];
    for (let start = 0; start < roots.length; start += 8) await Promise.all(roots.slice(start, start + 8).map(refPath => collectChildren(db.doc(refPath))));
    assert.ok(updates.length + deletePaths.size <= 400, 'Run exceeds the reviewed atomic batch limit.');
    const protectedFiles = new Set(remainingReferences.map(r => r.name));
    const toDelete = plan.deletedFiles.filter(file => file.exists && !protectedFiles.has(file.name));
    fs.mkdirSync(path.join(out, 'photos'), { recursive: true });
    const photoBackups = [];
    for (const file of toDelete) {
      const localName = createHash('sha256').update(file.name).digest('hex');
      const [contents] = await bucket.file(file.name, { generation: file.generation }).download();
      fs.writeFileSync(path.join(out, 'photos', localName), contents);
      photoBackups.push({ ...file, backup: `photos/${localName}`, size: contents.length, sha256: createHash('sha256').update(contents).digest('hex') });
    }
    const affected = new Set([...updates.map(p => p.path), ...deletePaths]);
    fs.writeFileSync(path.join(out, 'backup.json'), JSON.stringify({ projectId, at: new Date().toISOString(), records: [...backup.filter(d => affected.has(d.path)), ...descendants], photoBackups }, null, 2)+'\n', { flag: 'wx' });
    const journal = { projectId, firestoreCommitted: false, deletedFiles: [], retainedSharedFiles: [...protectedFiles], missingFiles: plan.deletedFiles.filter(f => !f.exists).map(f => f.name) };
    const saveJournal = () => fs.writeFileSync(path.join(out, 'execution.json'), JSON.stringify(journal, null, 2)+'\n');
    saveJournal();
    const batch = db.batch();
    for (const update of updates) batch.update(db.doc(update.path), update.patch, { lastUpdateTime: snapshots.get(update.path).updateTime });
    for (const refPath of deletePaths) batch.delete(db.doc(refPath), { lastUpdateTime: snapshots.get(refPath).updateTime });
    await batch.commit();
    journal.firestoreCommitted = true; journal.committedAt = new Date().toISOString(); saveJournal();
    for (const file of toDelete) {
      await bucket.file(file.name).delete({ ifGenerationMatch: file.generation });
      journal.deletedFiles.push(file.name); saveJournal();
    }
    journal.finishedAt = new Date().toISOString(); saveJournal();
    console.log(JSON.stringify({ applied: true, updated: updates.length, deleted: deletePaths.size, photosDeleted: journal.deletedFiles.length, descendants: descendants.length }));
  }
  if (args.includes('--verify-cleanup')) {
    assert.ok(!apply, 'Verification is a separate run after the writes and triggers settle.');
    const previousOut = option('--verify-cleanup');
    const previous = JSON.parse(fs.readFileSync(path.join(previousOut, 'plan.json'), 'utf8'));
    const execution = JSON.parse(fs.readFileSync(path.join(previousOut, 'execution.json'), 'utf8'));
    assert.equal(previous.projectId, projectId); assert.equal(execution.firestoreCommitted, true);
    assert.equal(changes.length, 0, 'Remaining records still need backfill.');
    assert.equal(deletions.length, 0, 'Remaining records still violate current validation.');
    assert.equal(discovery.length, previous.sourceCount - previous.deletions.length, 'The reviewed Discovery population changed.');
    const removedIds = new Set(previous.deletions.map(d => d.id));
    for (const deletion of previous.deletions) {
      assert.ok(!snapshots.has(deletion.path), `Visit still exists: ${deletion.path}`);
      assert.equal((await db.doc(deletion.path).listCollections()).length, 0, `Subcollections remain: ${deletion.path}`);
    }
    // The existing deletion trigger can log a missing-premise failure for a visit that no
    // longer exists. Explicit finish mode removes only those now-ownerless repair tickets.
    const tickets = [...snapshots.values()].filter(doc => doc.ref.parent.id === 'noAccessReconciliationFailures' && removedIds.has(doc.id));
    if (tickets.length && args.includes('--finish-cleanup')) {
      fs.writeFileSync(path.join(out, 'deleted-reconciliation-tickets.json'), JSON.stringify(tickets.map(doc => ({ path: doc.ref.path, fields: doc._fieldsProto, data: doc.data() })), null, 2)+'\n', { flag: 'wx' });
      const finish = db.batch();
      for (const doc of tickets) finish.delete(doc.ref, { lastUpdateTime: doc.updateTime });
      await finish.commit();
      for (const doc of tickets) snapshots.delete(doc.ref.path);
    }
    for (const doc of snapshots.values()) {
      const json = JSON.stringify(doc.data());
      assert.ok(![...removedIds].some(id => doc.id === id || json.includes(id)), `Reference remains: ${doc.ref.path}`);
    }
    for (const name of execution.deletedFiles) {
      const [exists] = await bucket.file(name).exists(); assert.equal(exists, false, `Photo remains: ${name}`);
    }
    let checkedPremises = 0;
    for (const doc of snapshots.values()) {
      if (doc.ref.parent.id !== 'premises') continue;
      const expected = trns.filter(trn => trn.data().accessData?.access?.hasAccess === 'no' && trn.data().accessData?.premise?.id === doc.id).map(trn => trn.id).sort();
      assert.deepEqual([...(doc.data().noAccessTrnIds || [])].sort(), expected, `Premise history drift: ${doc.id}`);
      checkedPremises++;
    }
    for (const change of previous.dependencies.changes.filter(item => item.path.startsWith('sales-all-meters/'))) {
      assert.deepEqual(JSON.parse(JSON.stringify(snapshots.get(change.path).data().tbRefs)), change.patch.tbRefs, `Sales row changed: ${change.path}`);
    }
    const result = { verifiedAt: new Date().toISOString(), projectId, conformingDiscoveryVisits: discovery.length,
      deletedVisits: previous.deletions.length, deletedPhotos: execution.deletedFiles.length, checkedPremises,
      inspectedDocuments: snapshots.size, remainingDeletedVisitReferences: 0, remainingDeletedPhotos: 0,
      remainingDeletedVisitSubcollections: 0, repairedDeletionTickets: args.includes('--finish-cleanup') ? tickets.length : 0 };
    fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(result, null, 2)+'\n');
    console.log(JSON.stringify(result));
  }
} finally { await app.delete(); }
