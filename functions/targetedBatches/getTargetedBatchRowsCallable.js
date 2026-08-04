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
  if (!uid) fail("unauthenticated", "Authentication is required.");
  const profile = await findActorProfile(db, uid);
  const token = request.auth.token || {};
  const role = actorRole(profile, token);
  if (!["FWR", "SPV"].includes(role)) fail("permission-denied", "Targeted Batch access denied.");

  const parentSnap = await db.collection(TARGETED_BATCH_COLLECTIONS.uploads).doc(tbId).get();
  if (!parentSnap.exists) fail("not-found", "Targeted Batch not found.");
  const allocation = parentSnap.data()?.allocation || {};
  const target = allocation.target || {};
  const targetType = normalizeUpper(allocation.targetType || target.type);
  const targetId = firstText(allocation.targetId, target.id);
  if (normalizeUpper(allocation.status) !== "ALLOCATED" || !targetId) {
    fail("permission-denied", "Targeted Batch access denied.");
  }

  if (targetType === "SP" && actorSpId(profile, token) === targetId) return;
  if (targetType === "TEAM") {
    const teamSnap = await db.collection("teams").doc(targetId).get();
    if (teamSnap.exists && teamMemberIds(teamSnap.data()).has(uid)) return;
  }
  fail("permission-denied", "Targeted Batch access denied.");
}

export function enrichTargetedBatchRow(row, salesSnapshot) {
  const salesDocId = normalizeText(row?.salesAllMeterId);
  let status = "OK";
  let count = null;
  if (!salesDocId) status = SALES_DOCUMENT_ID_MISSING;
  else if (!salesSnapshot?.exists) status = "SALES_DOCUMENT_MISSING";
  else {
    const sales = salesSnapshot.data() || {};
    const reference = Array.isArray(sales.tbRefs)
      ? sales.tbRefs.find((item) =>
        normalizeText(item?.id) === normalizeText(row.tbId) &&
        normalizeText(item?.rowId) === normalizeText(row.id))
      : undefined;
    if (!reference) status = "TB_REFERENCE_MISSING";
    else if (reference.fieldWork !== undefined &&
      (reference.fieldWork === null || typeof reference.fieldWork !== "object" ||
       Array.isArray(reference.fieldWork))) status = "FIELDWORK_INVALID";
    else if (reference.fieldWork?.noAccess !== undefined &&
      !Array.isArray(reference.fieldWork.noAccess)) status = "FIELDWORK_INVALID";
    else count = reference.fieldWork?.noAccess?.length || 0;
  }
  return { ...row, salesDocId: salesDocId || null, noAccessCount: count,
    noAccessSourceStatus: status };
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
  const { tbId, limit, cursor } = parseInput(request?.data || {});
  await assertCanView({ db, request, tbId });
  let query = db.collection(TARGETED_BATCH_COLLECTIONS.rows)
    .where("tbId", "==", tbId).orderBy("rowNo").orderBy(FieldPath.documentId());
  if (cursor) query = query.startAfter(cursor.rowNo, cursor.id);
  const page = await query.limit(limit + 1).get();
  const selected = page.docs.slice(0, limit);
  const uniqueIds = [...new Set(selected.map((doc) =>
    normalizeText(doc.data()?.salesAllMeterId)).filter(Boolean))];
  const sales = await readSales(db, uniqueIds);
  const rows = selected.map((doc) => {
    const row = { ...doc.data(), id: doc.id };
    return enrichTargetedBatchRow(row, sales.get(normalizeText(row.salesAllMeterId)));
  });
  const statusCounts = rows.reduce((counts, row) => {
    counts[row.noAccessSourceStatus] = (counts[row.noAccessSourceStatus] || 0) + 1;
    return counts;
  }, {});
  const last = rows.at(-1);
  const hasMore = page.docs.length > limit;
  return {
    success: true,
    rows,
    summary: { totalReturned: rows.length, okRows: statusCounts.OK || 0,
      integrityIssueRows: rows.length - (statusCounts.OK || 0) },
    pagination: { limit, hasMore,
      nextCursor: hasMore ? { rowNo: Number(last.rowNo), id: last.id } : null },
    diagnostics: { rowsRead: selected.length, uniqueSalesDocumentIds: uniqueIds.length,
      salesDocumentsRequested: uniqueIds.length,
      salesDocumentsFound: [...sales.values()].filter((snap) => snap.exists).length,
      rowsEnrichedSuccessfully: statusCounts.OK || 0, integrityStatusCounts: statusCounts,
      firestoreWrites: 0 },
  };
}

export const getTargetedBatchRowsCallable = onCall((request) =>
  getTargetedBatchRows({ db: getFirestore(), request }));
