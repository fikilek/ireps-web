import { getFirestore, FieldPath } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";

import {
  TARGETED_BATCH_COLLECTIONS,
  findActorProfile,
  normalizeText,
  normalizeUpper,
} from "./helpers.js";

export const TARGETED_BATCH_ROWS_DEFAULT_LIMIT = 100;
export const TARGETED_BATCH_ROWS_MAX_LIMIT = 200;
export const SALES_DOCUMENT_ID_MISSING = "SALES_DOCUMENT_ID_MISSING";

function fail(code, message) {
  throw new HttpsError(code, message);
}

function logStage(stage, details = {}) {
  console.log("[getTargetedBatchRowsCallable]", {
    stage,
    ...details,
  });
}

function logFailure(stage, error, details = {}) {
  console.error("[getTargetedBatchRowsCallable] FAILED", {
    stage,
    ...details,
    name: error?.name || null,
    code: error?.code || null,
    message: error?.message || String(error),
    stack: error?.stack || null,
  });
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
}

function actorRole(profile, token) {
  return normalizeUpper(firstText(
    token?.role,
    token?.userRole,
    token?.employmentRole,
    profile?.role,
    profile?.userRole,
    profile?.profile?.employment?.role,
    profile?.employment?.role,
    profile?.employment?.position,
  ));
}

function actorSpId(profile, token) {
  return firstText(
    token?.spId,
    token?.serviceProviderId,
    token?.employmentServiceProviderId,
    profile?.profile?.employment?.serviceProvider?.id,
    profile?.employment?.serviceProvider?.id,
    profile?.serviceProvider?.id,
  );
}

function teamMemberIds(team = {}) {
  const ids = new Set();
  const add = (value) => {
    const id = normalizeText(value);
    if (id) ids.add(id);
  };
  (Array.isArray(team.memberUids) ? team.memberUids : []).forEach(add);
  (Array.isArray(team?.scope?.memberUserIds)
    ? team.scope.memberUserIds
    : []).forEach(add);
  [...(Array.isArray(team.members) ? team.members : []),
    ...(Array.isArray(team.users) ? team.users : [])].forEach((member) => {
    if (typeof member === "string") add(member);
    else {
      add(member?.uid);
      add(member?.id);
      add(member?.userId);
    }
  });
  return ids;
}

function parseInput(data = {}) {
  const tbId = normalizeText(data.tbId);
  if (!tbId) fail("invalid-argument", "tbId is required.");

  const requestedLimit = data.limit ?? TARGETED_BATCH_ROWS_DEFAULT_LIMIT;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 ||
      requestedLimit > TARGETED_BATCH_ROWS_MAX_LIMIT) {
    fail("invalid-argument", `limit must be an integer from 1 to ${TARGETED_BATCH_ROWS_MAX_LIMIT}.`);
  }

  let cursor = null;
  if (data.cursor !== undefined && data.cursor !== null) {
    const rowNo = Number(data.cursor?.rowNo);
    const id = normalizeText(data.cursor?.id);
    if (!Number.isInteger(rowNo) || rowNo < 1 || !id) {
      fail("invalid-argument", "cursor must contain a positive integer rowNo and a non-empty id.");
    }
    cursor = { rowNo, id };
  }
  return { tbId, limit: requestedLimit, cursor };
}

async function assertCanView({ db, request, tbId }) {
  const uid = request?.auth?.uid;
  logStage("access_start", { uid: uid || null, tbId });

  if (!uid) fail("unauthenticated", "Authentication is required.");

  const profile = await findActorProfile(db, uid);
  const token = request.auth.token || {};
  const role = actorRole(profile, token);
  const spId = actorSpId(profile, token);

  logStage("actor_resolved", {
    uid,
    tbId,
    role: role || null,
    spId: spId || null,
    profileFound: Boolean(profile),
  });

  if (!["FWR", "SPV"].includes(role)) {
    fail("permission-denied", "Targeted Batch access denied.");
  }

  const parentSnap = await db.collection(TARGETED_BATCH_COLLECTIONS.uploads)
    .doc(tbId).get();

  logStage("parent_batch_loaded", {
    uid,
    tbId,
    exists: parentSnap.exists,
  });

  if (!parentSnap.exists) fail("not-found", "Targeted Batch not found.");

  const allocation = parentSnap.data()?.allocation || {};
  const target = allocation.target || {};
  const allocationStatus = normalizeUpper(allocation.status);
  const targetType = normalizeUpper(allocation.targetType || target.type);
  const targetId = firstText(allocation.targetId, target.id);

  logStage("allocation_resolved", {
    uid,
    tbId,
    allocationStatus: allocationStatus || null,
    targetType: targetType || null,
    targetId: targetId || null,
  });

  if (allocationStatus !== "ALLOCATED" || !targetId) {
    fail("permission-denied", "Targeted Batch access denied.");
  }

  if (targetType === "SP" && spId === targetId) {
    logStage("access_granted", { uid, tbId, targetType, targetId });
    return;
  }

  if (targetType === "TEAM") {
    const teamSnap = await db.collection("teams").doc(targetId).get();
    const memberIds = teamSnap.exists
      ? teamMemberIds(teamSnap.data())
      : new Set();
    const isMember = memberIds.has(uid);

    logStage("team_loaded", {
      uid,
      tbId,
      targetId,
      exists: teamSnap.exists,
      memberCount: memberIds.size,
      isMember,
    });

    if (teamSnap.exists && isMember) {
      logStage("access_granted", { uid, tbId, targetType, targetId });
      return;
    }
  }

  fail("permission-denied", "Targeted Batch access denied.");
}

export function enrichTargetedBatchRow(row, salesSnapshot) {
  const salesDocId = normalizeText(row?.salesAllMeterId);
  let status = "OK";
  let count = 0;
  let fieldWorkMeterId = null;

  if (!salesDocId) status = SALES_DOCUMENT_ID_MISSING;
  else if (!salesSnapshot?.exists) status = "SALES_DOCUMENT_MISSING";
  else {
    const sales = salesSnapshot.data() || {};
    const reference = Array.isArray(sales.tbRefs)
      ? sales.tbRefs.find((item) =>
        normalizeText(item?.id) === normalizeText(row.tbId))
      : undefined;

    if (!reference) status = "TB_REFERENCE_MISSING";
    else if (reference.fieldWork !== undefined &&
      (reference.fieldWork === null || typeof reference.fieldWork !== "object" ||
       Array.isArray(reference.fieldWork))) status = "FIELDWORK_INVALID";
    else {
      const fieldWork = reference.fieldWork || {};
      fieldWorkMeterId = normalizeText(fieldWork.meterId) || null;

      if (fieldWork.noAccess !== undefined &&
        !Array.isArray(fieldWork.noAccess)) {
        status = "FIELDWORK_INVALID";
      } else {
        count = fieldWork.noAccess?.length || 0;
      }
    }
  }

  return {
    ...row,
    salesDocId: salesDocId || null,
    noAccessCount: count,
    fieldWorkMeterId,
    noAccessSourceStatus: status,
  };
}

async function readSales(db, ids) {
  const result = new Map();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const refs = ids.slice(offset, offset + 100)
      .map((id) => db.collection(TARGETED_BATCH_COLLECTIONS.sales).doc(id));
    if (!refs.length) continue;
    const snapshots = await db.getAll(...refs);
    snapshots.forEach((snapshot) => result.set(snapshot.id, snapshot));
  }
  return result;
}

export async function getTargetedBatchRows({ db, request }) {
  const uid = request?.auth?.uid || null;
  let tbId = normalizeText(request?.data?.tbId) || null;
  let stage = "callable_start";

  try {
    logStage(stage, {
      uid,
      tbId,
      requestedLimit: request?.data?.limit ?? null,
      hasCursor: Boolean(request?.data?.cursor),
    });

    stage = "parse_input";
    const parsed = parseInput(request?.data || {});
    tbId = parsed.tbId;
    const { limit, cursor } = parsed;

    logStage("input_parsed", {
      uid,
      tbId,
      limit,
      hasCursor: Boolean(cursor),
    });

    stage = "assert_can_view";
    await assertCanView({ db, request, tbId });

    stage = "build_row_query";
    let query = db.collection(TARGETED_BATCH_COLLECTIONS.rows)
      .where("tbId", "==", tbId)
      .orderBy("rowNo")
      .orderBy(FieldPath.documentId());

    if (cursor) query = query.startAfter(cursor.rowNo, cursor.id);

    logStage("row_query_start", {
      uid,
      tbId,
      limit,
      hasCursor: Boolean(cursor),
    });

    stage = "execute_row_query";
    const page = await query.limit(limit + 1).get();

    logStage("row_query_completed", {
      uid,
      tbId,
      documentsRead: page.docs.length,
    });

    stage = "select_rows";
    const selected = page.docs.slice(0, limit);

    stage = "collect_sales_ids";
    const uniqueIds = [...new Set(selected.map((doc) =>
      normalizeText(doc.data()?.salesAllMeterId)).filter(Boolean))];

    logStage("sales_ids_collected", {
      uid,
      tbId,
      selectedRows: selected.length,
      uniqueSalesDocumentIds: uniqueIds.length,
    });

    stage = "read_sales_documents";
    const sales = await readSales(db, uniqueIds);

    logStage("sales_documents_read", {
      uid,
      tbId,
      requested: uniqueIds.length,
      found: [...sales.values()].filter((snap) => snap.exists).length,
    });

    stage = "enrich_rows";
    const rows = selected.map((doc) => {
      const row = { ...doc.data(), id: doc.id };
      return enrichTargetedBatchRow(
        row,
        sales.get(normalizeText(row.salesAllMeterId)),
      );
    });

    const statusCounts = rows.reduce((counts, row) => {
      counts[row.noAccessSourceStatus] =
        (counts[row.noAccessSourceStatus] || 0) + 1;
      return counts;
    }, {});

    const last = rows.at(-1);
    const hasMore = page.docs.length > limit;

    logStage("enrichment_completed", {
      uid,
      tbId,
      rows: rows.length,
      statusCounts,
      hasMore,
    });

    const response = {
      success: true,
      rows,
      summary: {
        totalReturned: rows.length,
        okRows: statusCounts.OK || 0,
        integrityIssueRows: rows.length - (statusCounts.OK || 0),
      },
      pagination: {
        limit,
        hasMore,
        nextCursor: hasMore
          ? { rowNo: Number(last.rowNo), id: last.id }
          : null,
      },
      diagnostics: {
        rowsRead: selected.length,
        uniqueSalesDocumentIds: uniqueIds.length,
        salesDocumentsRequested: uniqueIds.length,
        salesDocumentsFound: [...sales.values()]
          .filter((snap) => snap.exists).length,
        rowsEnrichedSuccessfully: statusCounts.OK || 0,
        integrityStatusCounts: statusCounts,
        firestoreWrites: 0,
      },
    };

    logStage("callable_success", {
      uid,
      tbId,
      rowsReturned: rows.length,
      hasMore,
    });

    return response;
  } catch (error) {
    logFailure(stage, error, { uid, tbId });
    throw error;
  }
}

export const getTargetedBatchRowsCallable = onCall((request) =>
  getTargetedBatchRows({ db: getFirestore(), request }));
