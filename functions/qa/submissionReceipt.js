import { isSubmittedState } from "../meterLifecycle/trnStateMachine.js";
import { qaEligibility, qaText } from "./model.js";

const stable = value => {
  if (value === null || typeof value !== "object") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(stable);
  return Object.fromEntries(Object.keys(value).sort().filter(key => key !== "uri").map(key => [key, stable(value[key])]));
};
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const subset = (input, saved) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return equal(input, saved);
  return Object.entries(input).filter(([key]) => key !== "uri").every(([key, value]) => subset(value, saved?.[key]));
};

// No new receipt storage: compare the accepted capture or its protected version.
// Missing/transformed facts that cannot prove the operation fail closed, not success.
export function matchesSubmission(snapshot, input, uid) {
  if (!qaEligibility(snapshot).eligible) return false;
  const captured = input.metadata?.createdOnDevice;
  if (!captured || !equal(captured, snapshot.metadata?.createdOnDevice)) return false;
  const author = qaText(snapshot.metadata?.createdOnDeviceByUid || snapshot.workflow?.completedByUid);
  if (author !== uid || (input.metadata?.createdOnDeviceByUid && input.metadata.createdOnDeviceByUid !== uid)) return false;
  if (input.id !== snapshot.id || input.accessData?.trnType !== snapshot.accessData?.trnType
    || input.accessData?.premise?.id !== snapshot.accessData?.premise?.id
    || input.accessData?.erfId !== snapshot.accessData?.erfId
    || input.accessData?.access?.hasAccess !== snapshot.accessData?.access?.hasAccess) return false;
  const astId = input.astId || input.ast?.astData?.astId;
  if (astId && astId !== snapshot.ast?.astData?.astId) return false;
  const fields = ["commissioning", "disconnection", "reconnection", "removal", "inspection", "meterReading", "discovery", "installation", "fieldComment"];
  const workBlock = { METER_COMMISSIONING: "commissioning", METER_DISCONNECTION: "disconnection",
    METER_RECONNECTION: "reconnection", METER_REMOVAL: "removal", METER_INSPECTION: "inspection", METER_READING: "meterReading" }[input.accessData?.trnType];
  if (input.accessData?.access?.hasAccess === "yes" && workBlock && !input[workBlock]) return false;
  if (fields.some(key => input[key] !== undefined && !subset(input[key], snapshot[key]))) return false;
  if (input.accessData?.access?.hasAccess === "no" && !subset(input.accessData.access, snapshot.accessData.access)) return false;
  // Evidence identity and capture stamps must agree; server-resolved names can differ.
  const media = rows => (rows || []).filter(row => row.tag !== "instructionMedia").map(row => ({
    tag: row.tag, url: row.url, type: row.type || null, gps: row.gps || null, at: row.created?.at || null,
  }));
  if (!equal(media(input.media), media(snapshot.media))) return false;
  if (input.ast && !subset(input.ast, snapshot.ast)) return false;
  return true;
}

export async function acceptedSubmission(reader, db, trnId, trn, input, uid) {
  if (!trn || (!isSubmittedState(trn.workflow?.state) && !qaEligibility(trn).eligible)) return false;
  const actor = await reader.get(db.doc(`users/${uid}`));
  if (!actor.exists || actor.data().accountStatus !== "ACTIVE") return false;
  if (matchesSubmission(trn, input, uid)) return true;
  const versions = await reader.get(db.collection(`trns/${trnId}/qaVersions`).limit(100));
  return versions.docs.some(version => matchesSubmission(version.data().snapshot || {}, input, uid));
}
