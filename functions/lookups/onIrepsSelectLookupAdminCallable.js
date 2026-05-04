import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

import {
  ADMIN_LOOKUP_ACTIONS,
  LOOKUPS_COLLECTION,
  LOOKUP_STATUSES,
  OPTION_STATUSES,
} from "./constants.js";

import {
  resolveAdminActor,
  sanitizeLookupCreateInput,
  sanitizeLookupKey,
  sanitizeLookupPatch,
  sanitizeOptionCode,
  sanitizeOptionCreateInput,
  sanitizeOptionPatch,
  sanitizeString,
} from "./validators.js";

function nowMetadataForCreate(actor) {
  const now = FieldValue.serverTimestamp();

  return {
    createdAt: now,
    createdByUid: actor.uid,
    createdByUser: actor.name,
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByUser: actor.name,
  };
}

function nowMetadataForUpdate(actor) {
  const now = FieldValue.serverTimestamp();

  return {
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByUser: actor.name,
  };
}

function auditRefForLookup(db, lookupKey) {
  return db
    .collection(LOOKUPS_COLLECTION)
    .doc(lookupKey)
    .collection("audit")
    .doc();
}

function makeAuditEntry({
  action,
  lookupKey,
  targetType,
  targetId,
  before = null,
  after = null,
  actor,
}) {
  return {
    action,
    lookupKey,
    targetType,
    targetId,
    before,
    after,
    metadata: {
      createdAt: FieldValue.serverTimestamp(),
      createdByUid: actor.uid,
      createdByUser: actor.name,
    },
  };
}

function serializeLookupDoc(doc) {
  const data = doc.data() || {};

  return {
    id: doc.id,
    lookupKey: data.lookupKey || doc.id,
    title: data.title || "",
    description: data.description || "",
    domain: data.domain || "",
    fieldKey: data.fieldKey || "",
    status: data.status || LOOKUP_STATUSES.DRAFT,
    allowOther: data.allowOther !== false,
    otherCode: data.otherCode || "OTHER",
    otherLabel: data.otherLabel || "Other",
    version: Number(data.version || 1),
    optionCount: Number(data.optionCount || 0),
    system: Boolean(data.system),
    metadata: data.metadata || {},
  };
}

function serializeOptionDoc(doc) {
  const data = doc.data() || {};

  return {
    id: doc.id,
    lookupKey: data.lookupKey || "",
    code: data.code || doc.id,
    label: data.label || "",
    description: data.description || "",
    sortOrder: Number(data.sortOrder ?? 9999),
    status: data.status || OPTION_STATUSES.DRAFT,
    system: Boolean(data.system),
    metadata: data.metadata || {},
  };
}

async function listLookups({ db }) {
  const snap = await db
    .collection(LOOKUPS_COLLECTION)
    .orderBy("domain", "asc")
    .orderBy("title", "asc")
    .get();

  return {
    lookups: snap.docs.map(serializeLookupDoc),
  };
}

async function getLookup({ db, lookupKey }) {
  const lookupRef = db.collection(LOOKUPS_COLLECTION).doc(lookupKey);
  const lookupSnap = await lookupRef.get();

  if (!lookupSnap.exists) {
    throw new HttpsError("not-found", `Lookup ${lookupKey} does not exist.`);
  }

  const optionsSnap = await lookupRef
    .collection("options")
    .orderBy("sortOrder", "asc")
    .orderBy("label", "asc")
    .get();

  return {
    lookup: serializeLookupDoc(lookupSnap),
    options: optionsSnap.docs.map(serializeOptionDoc),
  };
}

async function createLookup({ db, actor, lookupInput }) {
  const clean = sanitizeLookupCreateInput(lookupInput);
  const lookupRef = db.collection(LOOKUPS_COLLECTION).doc(clean.lookupKey);

  await db.runTransaction(async (tx) => {
    const lookupSnap = await tx.get(lookupRef);

    if (lookupSnap.exists) {
      throw new HttpsError(
        "already-exists",
        `Lookup ${clean.lookupKey} already exists.`,
      );
    }

    const payload = {
      lookupKey: clean.lookupKey,
      title: clean.title,
      description: clean.description,
      domain: clean.domain,
      fieldKey: clean.fieldKey,
      status: LOOKUP_STATUSES.DRAFT,
      allowOther: clean.allowOther,
      otherCode: clean.otherCode,
      otherLabel: clean.otherLabel,
      version: 1,
      optionCount: 0,
      system: clean.system,
      metadata: nowMetadataForCreate(actor),
    };

    tx.create(lookupRef, payload);

    tx.set(
      auditRefForLookup(db, clean.lookupKey),
      makeAuditEntry({
        action: ADMIN_LOOKUP_ACTIONS.CREATE_LOOKUP,
        lookupKey: clean.lookupKey,
        targetType: "LOOKUP",
        targetId: clean.lookupKey,
        before: null,
        after: payload,
        actor,
      }),
    );
  });

  return {
    ok: true,
    lookupKey: clean.lookupKey,
  };
}

async function updateLookup({ db, actor, lookupKey, patchInput }) {
  const patch = sanitizeLookupPatch(patchInput);
  const lookupRef = db.collection(LOOKUPS_COLLECTION).doc(lookupKey);

  await db.runTransaction(async (tx) => {
    const lookupSnap = await tx.get(lookupRef);

    if (!lookupSnap.exists) {
      throw new HttpsError("not-found", `Lookup ${lookupKey} does not exist.`);
    }

    const before = serializeLookupDoc(lookupSnap);

    const updatePayload = {
      ...patch,
      version: FieldValue.increment(1),
      "metadata.updatedAt": FieldValue.serverTimestamp(),
      "metadata.updatedByUid": actor.uid,
      "metadata.updatedByUser": actor.name,
    };

    tx.update(lookupRef, updatePayload);

    tx.set(
      auditRefForLookup(db, lookupKey),
      makeAuditEntry({
        action: ADMIN_LOOKUP_ACTIONS.UPDATE_LOOKUP,
        lookupKey,
        targetType: "LOOKUP",
        targetId: lookupKey,
        before,
        after: patch,
        actor,
      }),
    );
  });

  return {
    ok: true,
    lookupKey,
  };
}

async function setLookupStatus({ db, actor, lookupKey, status, action }) {
  const lookupRef = db.collection(LOOKUPS_COLLECTION).doc(lookupKey);

  await db.runTransaction(async (tx) => {
    const lookupSnap = await tx.get(lookupRef);

    if (!lookupSnap.exists) {
      throw new HttpsError("not-found", `Lookup ${lookupKey} does not exist.`);
    }

    const before = serializeLookupDoc(lookupSnap);

    if (before.system && status === LOOKUP_STATUSES.ARCHIVED) {
      throw new HttpsError(
        "failed-precondition",
        "System lookups cannot be archived.",
      );
    }

    tx.update(lookupRef, {
      status,
      version: FieldValue.increment(1),
      ...Object.fromEntries(
        Object.entries(nowMetadataForUpdate(actor)).map(([key, value]) => [
          `metadata.${key}`,
          value,
        ]),
      ),
    });

    tx.set(
      auditRefForLookup(db, lookupKey),
      makeAuditEntry({
        action,
        lookupKey,
        targetType: "LOOKUP",
        targetId: lookupKey,
        before: {
          status: before.status,
        },
        after: {
          status,
        },
        actor,
      }),
    );
  });

  return {
    ok: true,
    lookupKey,
    status,
  };
}

async function createOption({ db, actor, lookupKey, optionInput }) {
  const clean = sanitizeOptionCreateInput(optionInput);

  const lookupRef = db.collection(LOOKUPS_COLLECTION).doc(lookupKey);
  const optionRef = lookupRef.collection("options").doc(clean.code);

  await db.runTransaction(async (tx) => {
    const lookupSnap = await tx.get(lookupRef);

    if (!lookupSnap.exists) {
      throw new HttpsError("not-found", `Lookup ${lookupKey} does not exist.`);
    }

    const optionSnap = await tx.get(optionRef);

    if (optionSnap.exists) {
      throw new HttpsError(
        "already-exists",
        `Option ${clean.code} already exists.`,
      );
    }

    const payload = {
      lookupKey,
      code: clean.code,
      label: clean.label,
      description: clean.description,
      sortOrder: clean.sortOrder,
      status: OPTION_STATUSES.DRAFT,
      system: clean.system,
      metadata: nowMetadataForCreate(actor),
    };

    tx.create(optionRef, payload);

    tx.update(lookupRef, {
      optionCount: FieldValue.increment(1),
      version: FieldValue.increment(1),
      "metadata.updatedAt": FieldValue.serverTimestamp(),
      "metadata.updatedByUid": actor.uid,
      "metadata.updatedByUser": actor.name,
    });

    tx.set(
      auditRefForLookup(db, lookupKey),
      makeAuditEntry({
        action: ADMIN_LOOKUP_ACTIONS.CREATE_OPTION,
        lookupKey,
        targetType: "OPTION",
        targetId: clean.code,
        before: null,
        after: payload,
        actor,
      }),
    );
  });

  return {
    ok: true,
    lookupKey,
    optionCode: clean.code,
  };
}

async function updateOption({ db, actor, lookupKey, optionCode, patchInput }) {
  const patch = sanitizeOptionPatch(patchInput);

  const lookupRef = db.collection(LOOKUPS_COLLECTION).doc(lookupKey);
  const optionRef = lookupRef.collection("options").doc(optionCode);

  await db.runTransaction(async (tx) => {
    const lookupSnap = await tx.get(lookupRef);

    if (!lookupSnap.exists) {
      throw new HttpsError("not-found", `Lookup ${lookupKey} does not exist.`);
    }

    const optionSnap = await tx.get(optionRef);

    if (!optionSnap.exists) {
      throw new HttpsError("not-found", `Option ${optionCode} does not exist.`);
    }

    const before = serializeOptionDoc(optionSnap);

    tx.update(optionRef, {
      ...patch,
      "metadata.updatedAt": FieldValue.serverTimestamp(),
      "metadata.updatedByUid": actor.uid,
      "metadata.updatedByUser": actor.name,
    });

    tx.update(lookupRef, {
      version: FieldValue.increment(1),
      "metadata.updatedAt": FieldValue.serverTimestamp(),
      "metadata.updatedByUid": actor.uid,
      "metadata.updatedByUser": actor.name,
    });

    tx.set(
      auditRefForLookup(db, lookupKey),
      makeAuditEntry({
        action: ADMIN_LOOKUP_ACTIONS.UPDATE_OPTION,
        lookupKey,
        targetType: "OPTION",
        targetId: optionCode,
        before,
        after: patch,
        actor,
      }),
    );
  });

  return {
    ok: true,
    lookupKey,
    optionCode,
  };
}

async function setOptionStatus({
  db,
  actor,
  lookupKey,
  optionCode,
  status,
  action,
}) {
  const lookupRef = db.collection(LOOKUPS_COLLECTION).doc(lookupKey);
  const optionRef = lookupRef.collection("options").doc(optionCode);

  await db.runTransaction(async (tx) => {
    const lookupSnap = await tx.get(lookupRef);

    if (!lookupSnap.exists) {
      throw new HttpsError("not-found", `Lookup ${lookupKey} does not exist.`);
    }

    const optionSnap = await tx.get(optionRef);

    if (!optionSnap.exists) {
      throw new HttpsError("not-found", `Option ${optionCode} does not exist.`);
    }

    const before = serializeOptionDoc(optionSnap);

    if (before.system && status === OPTION_STATUSES.ARCHIVED) {
      throw new HttpsError(
        "failed-precondition",
        "System options cannot be archived.",
      );
    }

    tx.update(optionRef, {
      status,
      "metadata.updatedAt": FieldValue.serverTimestamp(),
      "metadata.updatedByUid": actor.uid,
      "metadata.updatedByUser": actor.name,
    });

    tx.update(lookupRef, {
      version: FieldValue.increment(1),
      "metadata.updatedAt": FieldValue.serverTimestamp(),
      "metadata.updatedByUid": actor.uid,
      "metadata.updatedByUser": actor.name,
    });

    tx.set(
      auditRefForLookup(db, lookupKey),
      makeAuditEntry({
        action,
        lookupKey,
        targetType: "OPTION",
        targetId: optionCode,
        before: {
          status: before.status,
        },
        after: {
          status,
        },
        actor,
      }),
    );
  });

  return {
    ok: true,
    lookupKey,
    optionCode,
    status,
  };
}

export const onIrepsSelectLookupAdminCallable = onCall(async (request) => {
  const db = getFirestore();

  const actor = await resolveAdminActor({
    db,
    auth: request.auth,
  });

  const action = sanitizeString(request.data?.action).toUpperCase();

  logger.info("onIrepsSelectLookupAdminCallable -- START", {
    action,
    uid: actor.uid,
    role: actor.role,
  });

  try {
    switch (action) {
      case ADMIN_LOOKUP_ACTIONS.LIST_LOOKUPS:
        return await listLookups({ db });

      case ADMIN_LOOKUP_ACTIONS.GET_LOOKUP:
        return await getLookup({
          db,
          lookupKey: sanitizeLookupKey(request.data?.lookupKey),
        });

      case ADMIN_LOOKUP_ACTIONS.CREATE_LOOKUP:
        return await createLookup({
          db,
          actor,
          lookupInput: request.data?.lookup,
        });

      case ADMIN_LOOKUP_ACTIONS.UPDATE_LOOKUP:
        return await updateLookup({
          db,
          actor,
          lookupKey: sanitizeLookupKey(request.data?.lookupKey),
          patchInput: request.data?.patch,
        });

      case ADMIN_LOOKUP_ACTIONS.PUBLISH_LOOKUP:
        return await setLookupStatus({
          db,
          actor,
          lookupKey: sanitizeLookupKey(request.data?.lookupKey),
          status: LOOKUP_STATUSES.PUBLISHED,
          action: ADMIN_LOOKUP_ACTIONS.PUBLISH_LOOKUP,
        });

      case ADMIN_LOOKUP_ACTIONS.DISABLE_LOOKUP:
        return await setLookupStatus({
          db,
          actor,
          lookupKey: sanitizeLookupKey(request.data?.lookupKey),
          status: LOOKUP_STATUSES.DISABLED,
          action: ADMIN_LOOKUP_ACTIONS.DISABLE_LOOKUP,
        });

      case ADMIN_LOOKUP_ACTIONS.ARCHIVE_LOOKUP:
        return await setLookupStatus({
          db,
          actor,
          lookupKey: sanitizeLookupKey(request.data?.lookupKey),
          status: LOOKUP_STATUSES.ARCHIVED,
          action: ADMIN_LOOKUP_ACTIONS.ARCHIVE_LOOKUP,
        });

      case ADMIN_LOOKUP_ACTIONS.CREATE_OPTION:
        return await createOption({
          db,
          actor,
          lookupKey: sanitizeLookupKey(request.data?.lookupKey),
          optionInput: request.data?.option,
        });

      case ADMIN_LOOKUP_ACTIONS.UPDATE_OPTION:
        return await updateOption({
          db,
          actor,
          lookupKey: sanitizeLookupKey(request.data?.lookupKey),
          optionCode: sanitizeOptionCode(request.data?.optionCode),
          patchInput: request.data?.patch,
        });

      case ADMIN_LOOKUP_ACTIONS.PUBLISH_OPTION:
        return await setOptionStatus({
          db,
          actor,
          lookupKey: sanitizeLookupKey(request.data?.lookupKey),
          optionCode: sanitizeOptionCode(request.data?.optionCode),
          status: OPTION_STATUSES.PUBLISHED,
          action: ADMIN_LOOKUP_ACTIONS.PUBLISH_OPTION,
        });

      case ADMIN_LOOKUP_ACTIONS.DISABLE_OPTION:
        return await setOptionStatus({
          db,
          actor,
          lookupKey: sanitizeLookupKey(request.data?.lookupKey),
          optionCode: sanitizeOptionCode(request.data?.optionCode),
          status: OPTION_STATUSES.DISABLED,
          action: ADMIN_LOOKUP_ACTIONS.DISABLE_OPTION,
        });

      case ADMIN_LOOKUP_ACTIONS.ARCHIVE_OPTION:
        return await setOptionStatus({
          db,
          actor,
          lookupKey: sanitizeLookupKey(request.data?.lookupKey),
          optionCode: sanitizeOptionCode(request.data?.optionCode),
          status: OPTION_STATUSES.ARCHIVED,
          action: ADMIN_LOOKUP_ACTIONS.ARCHIVE_OPTION,
        });

      default:
        throw new HttpsError(
          "invalid-argument",
          `Unsupported lookup admin action: ${action || "NAv"}`,
        );
    }
  } catch (error) {
    logger.error("onIrepsSelectLookupAdminCallable -- ERROR", {
      action,
      uid: actor.uid,
      message: error?.message || String(error),
      code: error?.code || "unknown",
    });

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      error?.message || "Lookup admin action failed.",
    );
  }
});
