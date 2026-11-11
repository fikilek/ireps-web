const text = (v) => String(v ?? "").trim();
const upper = (v) => text(v).toUpperCase();
const fail = (code, message) => { throw Object.assign(new Error(message), { irepsCode: code }); };
const validId = (v) => text(v) && !text(v).includes("/") && !["NAv", "null", "undefined"].includes(text(v));

export function summarizeMdBgoWorkRows(rows) {
  const active = rows.filter((r) => upper(r?.workflow?.state) !== "CANCELLED");
  return {
    totalRows: active.length,
    notStartedRows: active.filter((r) => ["READY_FOR_ALLOCATION", "ISSUED", "ALLOCATED"].includes(upper(r?.workflow?.state))).length,
    inProgressRows: active.filter((r) => upper(r?.workflow?.state) === "IN_PROGRESS").length,
    completedRows: active.filter((r) => upper(r?.workflow?.state) === "COMPLETED").length,
    premiseCount: new Set(active.map((r) => text(r?.refs?.premiseId)).filter(Boolean)).size,
    meterCount: new Set(active.map((r) => text(r?.refs?.meterId)).filter(Boolean)).size,
  };
}

// All reads happen here. apply() is called with the registration writes in the SAME transaction.
export async function prepareMdBgoRegistration({ tx, db, trnData, astId = null, normalizedMeterNo = null,
  actorUid, actorName, now, noAccess = false }) {
  const context = trnData?.mdBgoContext || trnData?.origin?.mdBgo;
  if (!context) return { applied: false, apply: () => {} };
  if (trnData?.targetedBatchContext || trnData?.origin?.targetedBatch) fail("MD_BGO_CONTEXT_CONFLICT", "A capture cannot belong to both a Targeted Batch and MD BGO.");
  const { batchId, rowId, erfId, premiseId } = context;
  if (![batchId, rowId, erfId, premiseId, actorUid, trnData.id].every(validId) || upper(context.batchMode) !== "BMD") {
    fail("MD_BGO_CONTEXT_INVALID", "MD BGO batch, row, ERF and premise context are required.");
  }
  if (text(trnData?.accessData?.premise?.id) !== premiseId || text(trnData?.accessData?.erfId) !== erfId) {
    fail("MD_BGO_CAPTURE_CONTEXT_MISMATCH", "Capture premise and ERF must match the BGO work row.");
  }
  const batchRef = db.doc(`bgo_batches/${batchId}`);
  const rowRef = db.doc(`bgo_rows/${rowId}`);
  const [batchSnap, rowSnap, premiseSnap, userSnap, erfSnap] = await Promise.all([
    tx.get(batchRef), tx.get(rowRef), tx.get(db.doc(`premises/${premiseId}`)),
    tx.get(db.doc(`users/${actorUid}`)), tx.get(db.doc(`ireps_erfs/${erfId}`)),
  ]);
  const missing = [["batch", batchSnap], ["row", rowSnap], ["premise", premiseSnap], ["actor", userSnap], ["ERF", erfSnap]].filter(([_label, snap]) => !snap.exists).map(([label]) => label);
  if (missing.length) fail("MD_BGO_REFERENCE_NOT_FOUND", `Required MD BGO records are missing: ${missing.join(", ")}.`);
  const batch = batchSnap.data(), anchor = rowSnap.data(), premise = premiseSnap.data(), user = userSnap.data(), erf = erfSnap.data();
  if (upper(user.accountStatus) !== "ACTIVE" || !["FWR", "SPV", "MNG", "ADM", "SPU"].includes(upper(user?.employment?.role))) fail("MD_BGO_ACTOR_INVALID", "An active field-work actor is required.");
  if (upper(batch?.bgo?.batchMode || batch.batchMode) !== "BMD" || upper(batch.operationType) !== "METER_DISCOVERY" ||
    !["ACCEPTED", "IN_PROGRESS", "COMPLETED"].includes(upper(batch?.workflow?.state)) || upper(batch?.bgo?.releaseState) !== "RELEASED_TO_EXECUTION") {
    fail("MD_BGO_BATCH_NOT_ACCEPTED", "This MD BGO batch is not released for field execution.");
  }
  if (text(anchor.bgoBatchId) !== batchId || text(anchor?.erf?.id) !== erfId || upper(anchor.batchMode) !== "BMD" ||
    upper(anchor.operationType) !== "METER_DISCOVERY" || upper(anchor?.workflow?.state) === "CANCELLED") fail("MD_BGO_ROW_CONTEXT_MISMATCH", "The BGO anchor row does not belong to this active batch ERF.");
  if (text(premise.erfId) !== erfId || text(premise?.parents?.wardPcode) !== text(batch?.scope?.wardPcode) ||
    text(premise?.parents?.lmPcode) !== text(batch?.scope?.lmPcode) ||
    text(erf?.admin?.ward?.pcode || erf.wardPcode) !== text(batch?.scope?.wardPcode) ||
    text(trnData?.accessData?.parents?.wardPcode) !== text(batch?.scope?.wardPcode) || text(trnData?.accessData?.parents?.lmPcode) !== text(batch?.scope?.lmPcode)) {
    fail("MD_BGO_CAPTURE_SCOPE_MISMATCH", "The captured premise and ERF do not match the batch municipality and ward.");
  }
  const target = batch.target || batch.bgo?.target || batch.assignment?.targets?.[0] || {};
  const type = upper(target.type || batch.bgo?.targetType), targetId = text(target.id || batch.bgo?.targetId);
  let allowed = type === "USER" && targetId === actorUid;
  if (type === "SP") allowed = targetId === text(user?.employment?.serviceProvider?.id);
  if (type === "TEAM" && validId(targetId)) {
    const team = await tx.get(db.doc(`teams/${targetId}`));
    const members = team.exists ? team.data()?.scope?.memberUserIds || team.data()?.memberUserIds || team.data()?.members || [] : [];
    allowed = members.some((member) => text(typeof member === "string" ? member : member?.uid || member?.id) === actorUid);
  }
  if (!allowed) fail("MD_BGO_BATCH_NOT_ASSIGNED_TO_ACTOR", "This MD BGO batch is no longer assigned to the worker.");
  const snap = await tx.get(db.collection("bgo_rows").where("bgoBatchId", "==", batchId));
  const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const samePremise = rows.filter((r) => text(r?.refs?.premiseId) === premiseId && text(r?.erf?.id) === erfId && upper(r?.workflow?.state) !== "CANCELLED");
  if (!samePremise.length) fail("MD_BGO_PREMISE_ROW_NOT_FOUND", "The premise has not been linked to an MD BGO row.");
  const existing = noAccess ? samePremise.find((r) => (r?.refs?.noAccessTrnIds || []).includes(trnData.id))
    : samePremise.find((r) => r?.refs?.meterId === astId || r?.refs?.trnId === trnData.id);
  if (existing) return { applied: true, rowId: existing.id, alreadyLinked: true, apply: () => {} };
  let row = samePremise.find((r) => r.id === rowId && !r?.refs?.meterId && upper(r?.workflow?.state) !== "COMPLETED") ||
    samePremise.find((r) => !r?.refs?.meterId && upper(r?.workflow?.state) !== "COMPLETED");
  if (!row && noAccess) fail("MD_BGO_ROW_COMPLETED", "This premise work is already completed; No Access cannot reopen it.");
  const create = !row;
  if (create) {
    const rowNo = Math.max(0, ...rows.map((r) => Number(r.rowNo) || 0)) + 1;
    row = { ...samePremise[0], id: `${batchId}_ROW_${rowNo}`, rowNo, refs: { premiseId }, workflow: { state: "IN_PROGRESS" }, meter: null, noAccessCount: 0,
      metadata: { createdAt: now, createdByUid: actorUid, createdByUser: actorName } };
  }
  const next = {
    ...row,
    refs: noAccess ? { ...row.refs, noAccessTrnIds: [...(row.refs?.noAccessTrnIds || []), trnData.id] }
      : { ...row.refs, premiseId, meterId: astId, trnId: trnData.id },
    workflow: { ...row.workflow, state: noAccess ? "IN_PROGRESS" : "COMPLETED", ...(noAccess ? {} : { completedAt: now, completedByUid: actorUid, completedByUser: actorName }) },
    metadata: { ...row.metadata, updatedAt: now, updatedByUid: actorUid, updatedByUser: actorName },
    ...(noAccess ? { noAccessCount: (row.refs?.noAccessTrnIds || []).length + 1 } : { meter: { id: astId, meterNo: normalizedMeterNo, trnId: trnData.id } }),
  };
  const nextRows = create ? [...rows, next] : rows.map((r) => r.id === row.id ? next : r);
  const summary = summarizeMdBgoWorkRows(nextRows);
  const completed = summary.totalRows > 0 && summary.completedRows === summary.totalRows;
  const canonical = { batchId, rowId: row.id, erfId, premiseId, batchMode: "BMD" };
  trnData.origin = { ...(trnData.origin || {}), mdBgo: canonical };
  delete trnData.mdBgoContext;
  return {
    applied: true, rowId: row.id, batchId, batchCompleted: completed,
    apply: () => {
      if (create) tx.create(db.doc(`bgo_rows/${row.id}`), next);
      else tx.update(db.doc(`bgo_rows/${row.id}`), next);
      tx.update(batchRef, Object.fromEntries([
        ...Object.entries(summary).map(([key, value]) => [`summary.${key}`, value]),
        ["workflow.state", completed ? "COMPLETED" : "IN_PROGRESS"],
        ["metadata.updatedAt", now], ["metadata.updatedByUid", actorUid], ["metadata.updatedByUser", actorName],
      ]));
    },
  };
}
