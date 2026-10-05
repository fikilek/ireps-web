import { FieldValue } from "firebase-admin/firestore";
import { normalizeNoAccessAccessData, assertNoAccessMedia, buildNoAccessLocation, buildNoAccessParentsFromErf, noAccessParentsAreMissing, noAccessError } from "./recordNoAccess.js";
import { buildRegistrationMetadata } from "../registration/registrationMetadata.js";
import { stripToDeclaredRoot } from "../transactions/trnShape.js";
import { formatStreetAddress, formatPropertyType } from "../premises/streetAddress.js";
import { astMeterNo, checkBatchWork, profileServiceProviderId, recognisedBatchContext } from "../targetedBatches/batch-work-guard.js";
import { serviceProviderName } from "../serviceProviders/serviceProviderName.js";
import { getAssignmentTargets, isAssignedToActor } from "../meterLifecycle/acceptRejectCallable.js";

const text = (v) => String(v ?? "").trim();
const present = (v) => text(v) && text(v).toUpperCase() !== "NAV";
const fail = (code, message) => { throw noAccessError(code, message); };

// Pure construction: neither meter work nor a second outcome is written for an inaccessible meter.
export function buildLifecycleNoAccess({ data, astDoc, premise, erf, actor, now, existing = null, serviceProvider = {}, batch = null }) {
  const accessData = normalizeNoAccessAccessData(data.accessData, { actor, metadata: data.metadata });
  const parents = buildNoAccessParentsFromErf(erf);
  if (noAccessParentsAreMissing(parents) || !present(parents.wardPcode)) fail("NO_ACCESS_GEOGRAPHY_UNRESOLVED", "The ERF has no municipality or ward. Ask the office to correct its geography.");
  assertNoAccessMedia(data.media);
  if (!data.media.some((m) => m?.tag === "noAccessPhoto" && /^https:\/\//i.test(text(m.url)))) {
    fail("NO_ACCESS_PHOTO_REQUIRED", "Upload the No Access photograph before submitting the visit.");
  }
  const metadata = buildRegistrationMetadata({ phoneMetadata: data.metadata, actorUid: actor.uid, actorName: actor.name, nowIso: now });
  if (existing) {
    for (const key of ["createdAt", "createdByUid", "createdByUser"]) metadata[key] = existing.metadata?.[key] ?? null;
  }
  const astId = data.astId || data.ast?.astData?.astId;
  const payload = {
    id: data.id,
    accessData: { trnType: accessData.trnType, erfId: accessData.erfId, erfNo: accessData.erfNo, parents,
      premise: { id: accessData.premise.id, address: formatStreetAddress(premise.address) || "NAv", propertyType: formatPropertyType(premise.propertyType) || "NAv" },
      access: accessData.access },
    metadata, meterType: "NA", status: {},
    ast: { astData: { ...(astDoc.ast?.astData || {}), astId }, location: buildNoAccessLocation({ assetLocation: astDoc.ast?.location, premiseGeometry: premise.geometry }) },
    media: data.media.map(({ uri: _uri, ...item }) => item),
    serviceProvider,
    assignment: existing?.assignment || {},
    origin: { ...(existing?.origin || {}), channel: existing ? "OFFICE" : "FIELD", ...(batch ? { targetedBatch: batch } : {}) },
    workflow: { ...(existing?.workflow || {}), state: "COMPLETED", completedAt: now, completedByUid: actor.uid, completedByUser: actor.name },
  };
  stripToDeclaredRoot(payload, { actor });
  payload.media = [...(existing?.media || []).filter((m) => m.tag === "instructionMedia"), ...payload.media];
  return payload;
}

// The premise link and transaction are committed together; retries never create another visit.
export async function recordLifecycleNoAccess({ db, data, actor, now, isOffice }) {
  const trnId = text(data.id);
  const astId = text(data.astId || data.ast?.astData?.astId);
  const access = normalizeNoAccessAccessData(data.accessData, { actor, metadata: data.metadata });
  const premiseId = access.premise.id;
  const trnRef = db.doc(`trns/${trnId}`);
  const astRef = db.doc(`asts/${astId}`);
  const premiseRef = db.doc(`premises/${premiseId}`);
  return db.runTransaction(async (tx) => {
    const previous = await tx.get(trnRef);
    const existing = previous.exists ? previous.data() : null;
    if (existing && (!isOffice || existing.workflow?.state === "COMPLETED")) {
      const sameVisit = existing.accessData?.access?.hasAccess === "no" && existing.accessData?.trnType === access.trnType &&
        existing.ast?.astData?.astId === astId && existing.accessData?.premise?.id === premiseId &&
        (existing.metadata?.createdOnDeviceByUid || existing.workflow?.completedByUid || existing.metadata?.createdByUid) === actor.uid;
      if (!sameVisit) fail("TRN_ALREADY_EXISTS", "This transaction already records different work. Refresh your work orders before starting another visit.");
      return { success: true, code: "OK", trnId, idempotent: true, message: "No Access is already recorded.", executionOutcome: { outcome: "NO_ACCESS", success: false } };
    }
    if (isOffice && !existing) fail("INSTRUCTION_TRN_NOT_FOUND", "The office instruction no longer exists. Refresh your work orders.");
    if (isOffice && existing.accessData?.trnType !== access.trnType) fail("INVALID_INSTRUCTION_TRN_TYPE", "The visit does not match the issued work type.");
    if (isOffice && !["ACCEPTED", "IN_PROGRESS"].includes(existing.workflow?.state)) fail("INSTRUCTION_NOT_ACCEPTED", "Accept the office instruction before recording this visit.");
    if (isOffice && (existing.ast?.astData?.astId !== astId || existing.accessData?.premise?.id !== premiseId)) fail("INSTRUCTION_ASSET_MISMATCH", "The meter or premise does not match the office instruction.");

    const astSnap = await tx.get(astRef);
    const premiseSnap = await tx.get(premiseRef);
    const erfSnap = await tx.get(db.doc(`ireps_erfs/${access.erfId}`));
    if (!astSnap.exists) fail("AST_NOT_FOUND", "The meter record is missing. Refresh your meters or contact the office.");
    if (!premiseSnap.exists) fail("PREMISE_NOT_FOUND", "The premise is not on the server yet. This visit can be retried after the premise is saved.");
    if (!erfSnap.exists) fail("NO_ACCESS_ERF_NOT_FOUND", "The ERF record is missing. Ask the office to correct this work item.");
    const astDoc = astSnap.data();
    const premise = premiseSnap.data();
    if ((present(astDoc.accessData?.premise?.id) && astDoc.accessData.premise.id !== premiseId) ||
        (present(astDoc.accessData?.erfId) && astDoc.accessData.erfId !== access.erfId) ||
        (present(premise.erfId) && premise.erfId !== access.erfId)) {
      fail("NO_ACCESS_GEOGRAPHY_MISMATCH", "This meter, premise and ERF do not belong together. Refresh the work item or contact the office.");
    }
    let profile = {};
    for (const collection of ["users", "userProfiles", "profiles"]) {
      const snap = await tx.get(db.doc(`${collection}/${actor.uid}`));
      if (snap.exists) { profile = snap.data(); break; }
    }
    const spId = profileServiceProviderId(profile);
    const spSnap = spId ? await tx.get(db.doc(`serviceProviders/${spId}`)) : null;
    if (isOffice) {
      const teamMap = new Map();
      for (const target of getAssignmentTargets(existing).filter((target) => target.type === "TEAM")) {
        const snap = await tx.get(db.doc(`teams/${target.id}`));
        teamMap.set(target.id, snap.data() || {});
      }
      if (!isAssignedToActor({ trnData: existing, actorUid: actor.uid, actorSpId: spId, teamMap })) {
        fail("INSTRUCTION_NOT_ASSIGNED", "This instruction belongs to another worker or team. Ask the office to assign it to you.");
      }
    }
    const decision = await checkBatchWork({ db, read: (ref) => tx.get(ref), meterNo: astMeterNo(astDoc), uid: actor.uid,
      erfId: access.erfId, premiseId, anomaly: [astDoc.ast] });
    if (!decision.allowed) fail(decision.code, decision.message);
    const payload = buildLifecycleNoAccess({ data, astDoc, premise, erf: erfSnap.data(), actor, now, existing: isOffice ? existing : null,
      serviceProvider: spId ? { id: spId, name: serviceProviderName(spSnap?.data()) } : {},
      batch: existing?.origin?.targetedBatch || recognisedBatchContext({ decision, erfId: access.erfId, premiseId }) });
    tx.set(trnRef, payload);
    tx.update(premiseRef, { noAccessTrnIds: FieldValue.arrayUnion(trnId) });
    // Completing office workflow releases the instruction lock, never a physical meter field.
    if (isOffice && astDoc.trnActiveLifecycle?.trnId === trnId) tx.update(astRef, { trnActiveLifecycle: FieldValue.delete() });
    if (isOffice) tx.set(trnRef.collection("history").doc(), { event: "COMPLETED", outcome: "NO_ACCESS", trnId,
      trnType: access.trnType, astId, actorUid: actor.uid, actorName: actor.name, at: now });
    return { success: true, code: "OK", trnId, message: "No Access recorded. Meter state unchanged.",
      astStatusChanged: false, astDataChanged: false, executionOutcome: { outcome: "NO_ACCESS", success: false } };
  });
}
