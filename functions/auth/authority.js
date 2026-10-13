import { HttpsError } from "firebase-functions/v2/https";
import { getUserRole, getUserServiceProviderId, getServiceProviderParentSpClient } from "../teams/helpers.js";

export async function requireActiveRoles(db, uid, roles, reader = db) {
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const ref = db.doc(`users/${uid}`);
  const snap = reader === db ? await ref.get() : await reader.get(ref);
  const actor = snap.data() || {};
  if (!snap.exists || actor.accountStatus !== "ACTIVE" || !roles.includes(getUserRole(actor))) {
    throw new HttpsError("permission-denied", "Your current account does not permit this action.");
  }
  return actor;
}

export function inProviderLineage(rootId, targetId, providers) {
  if (!rootId || !targetId || [rootId, targetId].includes("NAv")) return false;
  const seen = new Set();
  let current = targetId;
  while (current && !seen.has(current)) {
    if (current === rootId) return true;
    seen.add(current);
    current = getServiceProviderParentSpClient(providers.find(p => p.id === current))?.id;
  }
  return false;
}

export function assertManagedUser(actor, target, providers) {
  if (actor.accountStatus !== "ACTIVE") throw new HttpsError("permission-denied", "An active account is required.");
  if (getUserRole(actor) === "MNG" && !inProviderLineage(getUserServiceProviderId(actor), getUserServiceProviderId(target), providers)) {
    throw new HttpsError("permission-denied", "You may change only users within your service-provider lineage.");
  }
}

export function serviceProviderPatch(actor, spId, patch) {
  const role = getUserRole(actor);
  if (actor.accountStatus !== "ACTIVE" || !["SPU", "ADM", "MNG", "SPV"].includes(role)) {
    throw new HttpsError("permission-denied", "Your account may not update service providers.");
  }
  const platform = ["SPU", "ADM"].includes(role);
  if (!platform && getUserServiceProviderId(actor) !== spId) throw new HttpsError("permission-denied", "You may update only your own service provider.");
  const allowed = platform ? ["profile", "owner", "offices", "clients", "status", "workbases", "ownership"] : ["profile", "owner", "offices"];
  if (Object.keys(patch).some(key => !allowed.includes(key))) throw new HttpsError("permission-denied", "The requested service-provider fields are protected.");
  if (!platform && patch.profile && Object.keys(patch.profile).some(key => !["name", "registeredName", "tradingName", "registrationNumber"].includes(key))) {
    throw new HttpsError("permission-denied", "Contract classification is protected.");
  }
  return { ...patch };
}

export function stampFieldSubmission(payload, actor) {
  delete payload.qa;
  // Registration is a field submission. A caller cannot invent office
  // completion/assignment facts to evade the original-submitter check.
  payload.workflow = {};
  payload.assignment = {};
  payload.origin = { ...(payload.origin || {}), channel: "FIELD" };
  payload.serviceProvider = { ...(actor.employment?.serviceProvider || {}) };
  return payload;
}
