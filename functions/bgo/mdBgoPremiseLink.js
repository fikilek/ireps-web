import { HttpsError } from "firebase-functions/v2/https";
import { summarizeMdBgoWorkRows } from "./mdBgoRegistration.js";

const text = (value) => String(value ?? "").trim();
const upper = (value) => text(value).toUpperCase();

function fail(code, message) {
  const error = new HttpsError("failed-precondition", message, { code });
  error.irepsCode = code;
  throw error;
}

function teamMemberIds(team = {}) {
  const ids = team?.scope?.memberUserIds || team?.memberUserIds || team?.members || [];
  return Array.isArray(ids)
    ? ids.map((member) => text(typeof member === "string" ? member : member?.uid || member?.id)).filter(Boolean)
    : [];
}

export async function createOrLinkMdBgoPremise({
  db,
  premiseRef,
  premisePayload,
  mdBgoContext = {},
  historyRef,
  actorUid,
  actorName,
  authToken = {},
}) {
  const context = mdBgoContext || {};
  const batchId = text(context?.batchId);
  const rowId = text(context?.rowId);
  const erfId = text(context?.erfId);
  if (!batchId || !rowId || !erfId || upper(context?.batchMode) !== "BMD") {
    fail("MD_BGO_CONTEXT_INVALID", "MD BGO batch, row and ERF context are required.");
  }
  if (text(premisePayload?.erfId) !== erfId) {
    fail("MD_BGO_ERF_MISMATCH", "The premise ERF does not match its MD BGO work item.");
  }

  const batchRef = db.collection("bgo_batches").doc(batchId);
  const rowRef = db.collection("bgo_rows").doc(rowId);
  const erfRef = db.collection("ireps_erfs").doc(erfId);

  return db.runTransaction(async (tx) => {
    const [batchSnap, rowSnap, erfSnap, premiseSnap] = await Promise.all([
      tx.get(batchRef), tx.get(rowRef), tx.get(erfRef), tx.get(premiseRef),
    ]);
    if (!batchSnap.exists) fail("MD_BGO_BATCH_NOT_FOUND", "The MD BGO batch was not found.");
    if (!rowSnap.exists) fail("MD_BGO_ROW_NOT_FOUND", "The MD BGO work row was not found.");
    if (!erfSnap.exists) fail("MD_BGO_ERF_NOT_FOUND", "The batch ERF was not found.");

    const batch = batchSnap.data() || {};
    const row = rowSnap.data() || {};
    const erf = erfSnap.data() || {};
    if (upper(batch?.batchMode || batch?.bgo?.batchMode) !== "BMD" || upper(batch?.operationType) !== "METER_DISCOVERY") {
      fail("MD_BGO_BATCH_TYPE_INVALID", "The selected batch is not an MD BGO batch.");
    }
    if (!["ACCEPTED", "IN_PROGRESS", "COMPLETED"].includes(upper(batch?.workflow?.state)) || upper(batch?.bgo?.releaseState) !== "RELEASED_TO_EXECUTION") {
      fail("MD_BGO_BATCH_NOT_ACCEPTED", "The MD BGO batch has not been accepted for field execution.");
    }
    if (text(row?.id || rowSnap.id) !== rowId || text(row?.bgoBatchId || row?.batchId) !== batchId || text(row?.erf?.id || row?.erfId) !== erfId) {
      fail("MD_BGO_ROW_CONTEXT_MISMATCH", "The row does not belong to the selected batch ERF.");
    }
    if (upper(row?.batchMode) !== "BMD" || upper(row?.operationType) !== "METER_DISCOVERY") {
      fail("MD_BGO_ROW_TYPE_INVALID", "The selected row is not an MD BGO work row.");
    }
    const scope = batch?.scope || {};
    const erfWard = text(erf?.admin?.ward?.pcode || erf?.wardPcode);
    if (erfWard && text(scope?.wardPcode) !== erfWard) {
      fail("MD_BGO_ERF_SCOPE_MISMATCH", "The ERF does not belong to this batch ward.");
    }
    if (text(premisePayload?.parents?.wardPcode) !== text(scope?.wardPcode) || text(premisePayload?.parents?.lmPcode) !== text(scope?.lmPcode)) {
      fail("MD_BGO_PREMISE_SCOPE_MISMATCH", "The premise scope does not match the MD BGO batch.");
    }

    const target = batch?.target || batch?.bgo?.target || batch?.assignment?.targets?.[0] || {};
    const targetType = upper(target?.type || batch?.bgo?.targetType);
    const targetId = text(target?.id || batch?.bgo?.targetId);
    let allowed = targetType === "USER" && targetId === actorUid;
    if (targetType === "SP") {
      const profileSnap = await tx.get(db.collection("users").doc(actorUid));
      const profile = profileSnap.exists ? profileSnap.data() || {} : {};
      const actorSpId = text(
        authToken?.spId || authToken?.serviceProviderId ||
        profile?.employment?.serviceProvider?.id || profile?.serviceProvider?.id,
      );
      allowed = targetId === actorSpId;
    }
    if (targetType === "TEAM" && targetId) {
      const teamSnap = await tx.get(db.collection("teams").doc(targetId));
      allowed = teamSnap.exists && teamMemberIds(teamSnap.data() || {}).includes(actorUid);
    }
    if (!allowed) fail("MD_BGO_BATCH_NOT_ASSIGNED_TO_ACTOR", "This MD BGO batch is not assigned to the current worker.");

    const premiseId = premiseRef.id;
    if (premiseSnap.exists && text(premiseSnap.data()?.erfId) !== erfId) {
      fail("MD_BGO_PREMISE_ERF_MISMATCH", "The existing premise belongs to another ERF.");
    }
    const allRowsSnap = await tx.get(
      db.collection("bgo_rows").where("bgoBatchId", "==", batchId),
    );
    const existingPremiseRow = allRowsSnap.docs.find((doc) => text(doc.data()?.refs?.premiseId) === premiseId);
    if (existingPremiseRow) {
      if (!premiseSnap.exists) tx.set(premiseRef, premisePayload);
      return { linked: true, alreadyLinked: true, rowId: existingPremiseRow.id };
    }

    const currentPremiseId = text(row?.refs?.premiseId);
    if (currentPremiseId && currentPremiseId !== premiseId) {
      const rowNo = allRowsSnap.docs.reduce((max, doc) => Math.max(max, Number(doc.data()?.rowNo || 0)), 0) + 1;
      const nextRowId = `${batchId}_ROW_${rowNo}`;
      const nextRowRef = db.collection("bgo_rows").doc(nextRowId);
      const nextRowSnap = await tx.get(nextRowRef);
      if (nextRowSnap.exists) fail("MD_BGO_ROW_ID_CONFLICT", "The next MD BGO row ID is already in use.");
      const nextRow = {
        ...row,
        id: nextRowId,
        batchId,
        bgoBatchId: batchId,
        rowNo,
        refs: { premiseId },
        meter: null,
        noAccessCount: 0,
        premise: { id: premiseId, premiseNo: text(premisePayload?.premiseNo) || null },
        workflow: { state: "IN_PROGRESS" },
        metadata: { createdAt: premisePayload?.metadata?.createdAt, createdByUid: actorUid, createdByUser: actorName, updatedAt: premisePayload?.metadata?.updatedAt, updatedByUid: actorUid, updatedByUser: actorName },
      };
      tx.create(nextRowRef, nextRow);
      const summary = summarizeMdBgoWorkRows([...allRowsSnap.docs.map((doc) => doc.data()), nextRow]);
      tx.update(batchRef, {
        ...Object.fromEntries(Object.entries(summary).map(([key, value]) => [`summary.${key}`, value])),
        "workflow.state": "IN_PROGRESS",
        "metadata.updatedAt": premisePayload?.metadata?.updatedAt,
      });
      tx.set(premiseRef, premisePayload);
      if (historyRef && !premiseSnap.exists) tx.create(historyRef, {
        eventId: `SUBMIT_${premiseId}`, premiseId, action: "PREMISE_SUBMITTED",
        previousStatus: null, newStatus: "QA_PENDING", sourceVersion: premisePayload?.qa?.sourceVersion || null,
        reasonCode: null, reasonLabel: null, comment: null, actorUid, actorName, actorRole: "FWR",
        timestamp: premisePayload?.metadata?.createdAt, requestId: premiseId,
        lmPcode: scope?.lmPcode || null, wardPcode: scope?.wardPcode || null,
      });
      return { linked: true, alreadyLinked: false, rowId: nextRowId };
    }

    tx.update(rowRef, {
      "refs.premiseId": premiseId,
      premise: { id: premiseId, premiseNo: text(premisePayload?.premiseNo) || null },
      "workflow.state": "IN_PROGRESS",
      "metadata.updatedAt": premisePayload?.metadata?.updatedAt,
      "metadata.updatedByUid": actorUid,
      "metadata.updatedByUser": actorName,
    });
    const summary = summarizeMdBgoWorkRows(allRowsSnap.docs.map((doc) => doc.id === rowId
      ? { ...row, refs: { ...row.refs, premiseId }, workflow: { state: "IN_PROGRESS" } } : doc.data()));
    tx.update(batchRef, { "workflow.state": "IN_PROGRESS", ...Object.fromEntries(Object.entries(summary).map(([key, value]) => [`summary.${key}`, value])), "metadata.updatedAt": premisePayload?.metadata?.updatedAt });
    if (!premiseSnap.exists) tx.create(premiseRef, premisePayload);
    if (historyRef && !premiseSnap.exists) tx.create(historyRef, {
      eventId: `SUBMIT_${premiseId}`, premiseId, action: "PREMISE_SUBMITTED",
      previousStatus: null, newStatus: "QA_PENDING", sourceVersion: premisePayload?.qa?.sourceVersion || null,
      reasonCode: null, reasonLabel: null, comment: null, actorUid, actorName, actorRole: "FWR",
      timestamp: premisePayload?.metadata?.createdAt, requestId: premiseId,
      lmPcode: scope?.lmPcode || null, wardPcode: scope?.wardPcode || null,
    });
    return { linked: true, alreadyLinked: false, rowId };
  });
}
