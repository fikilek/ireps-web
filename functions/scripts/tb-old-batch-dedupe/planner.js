// Targeted Batch rules 1.3.34, TB-R049 and TB-R050: one-off de-duplication of old (0.2.0) batches.
// Pure functions shared by the dry run and by the per-meter transaction, so both decide exactly the same way.
import crypto from "node:crypto";
import { readTbRefBatchId, inspectSalesTbRefsIntegrity, classifySalesWorkStatus, exactKeys, timestampMillis } from "../../salesAllMeters/sales-batch-policy.js";

export const LEGACY_SCHEMA = "0.2.0";
export const COUNT_KEYS = Object.freeze(["totalRows", "acceptedRows", "rejectedRows", "allocatableRows", "allocatedRows", "unallocatedRows", "executionStartedRows", "completedRows"]);

// Owner decisions of 2026-09-16 (TB-R049 B4, TB-R050 exception).
export const OWNER_DECISIONS = Object.freeze({
  "07126146500": Object.freeze({
    ownerTbId: "TGB_20260909_125929_F2OA",
    startedRowRemovals: Object.freeze({ TBR_20260814_105246_J68S_000055: Object.freeze({ trnIds: ["TRN_MDIS_1789122272479_NA_2HGJP"] }) }),
  }),
});
// A completed row found a different meter; the office checks these first (owner decision of 2026-09-16).
export const OFFICE_HOLDS = Object.freeze({
  "07056211829": "OFFICE_CHECK_COMPLETED_ON_ANOTHER_METER",
  "07127211246": "OFFICE_CHECK_COMPLETED_ON_ANOTHER_METER",
  "07152702168": "OFFICE_CHECK_COMPLETED_ON_ANOTHER_METER",
});

// AST metadata times are ISO strings; batch times are Firestore Timestamps.
const millis = value => typeof value === "string" ? (Number.isFinite(Date.parse(value)) ? Date.parse(value) : null) : timestampMillis(value);
const hasContextOf = (salesId, row) => doc => doc.targetedBatchContext?.rowId === row.id || (doc.targetedBatchContext?.salesDocId === salesId && doc.targetedBatchContext?.tbId === row.tbId);

// TB-R049 "field work on a row", ranked: 4 completed, 3 discovery TRN, 2 premise, 1 No Access or any start marker, 0 none.
export function rowEvidence({ salesId, row, tbRefs, trns, premises }) {
  const refs = tbRefs.filter(ref => readTbRefBatchId(ref) === row.tbId);
  const ref = refs.length === 1 ? refs[0] : null;
  const fieldWork = ref?.fieldWork ?? null;
  const rowTrns = trns.filter(hasContextOf(salesId, row));
  const rowPremises = premises.filter(hasContextOf(salesId, row));
  const status = row.execution?.status || "NOT_STARTED";
  const discoveryTrn = Boolean(row.refs?.trnId || fieldWork?.trnId || rowTrns.some(trn => trn.accessData?.access?.hasAccess !== "no"));
  const premise = Boolean(row.refs?.premiseId || fieldWork?.premiseId || rowPremises.length);
  const noAccess = Boolean((Array.isArray(fieldWork?.noAccess) && fieldWork.noAccess.length) || rowTrns.some(trn => trn.accessData?.access?.hasAccess === "no"));
  const marker = Boolean(status !== "NOT_STARTED" || row.execution?.startedAt || row.execution?.completedAt || row.execution?.outcome || row.refs?.meterId || fieldWork || ref?.rowId);
  return {
    rowId: row.id, tbId: row.tbId, rowNo: row.rowNo ?? null, status, refCount: refs.length,
    refIsPreExecution: Boolean(ref && exactKeys(ref, ["id", "date"])),
    meterMatch: fieldWork?.meterMatch ?? null, fieldWorkStatus: fieldWork?.status ?? null,
    discoveryTrn, premise, noAccess, marker,
    rank: status === "COMPLETED" ? 4 : discoveryTrn ? 3 : premise ? 2 : (noAccess || marker) ? 1 : 0,
    trnIds: rowTrns.map(trn => trn.id).sort(), premiseIds: rowPremises.map(p => p.id).sort(),
  };
}

export const holderOf = parent => parent?.allocation?.status === "ALLOCATED" ? (parent.allocation.targetName || parent.allocation.targetId) : "UNALLOCATED";

// facts: { salesId, sales, meterMaster, rows[], parents{tbId: data}, asts[], discoveringAst, discoveringTrn, trns[], premises[], teams[{ id, memberUserIds[] }] }
export function planMeter(facts) {
  const { salesId, sales, meterMaster, rows, parents } = facts;
  const base = { salesId, rows: rows.map(row => ({ rowId: row.id, tbId: row.tbId, rowNo: row.rowNo ?? null, status: row.execution?.status || "NOT_STARTED", holder: holderOf(parents[row.tbId]) })) };
  const hold = (reason, extra = {}) => ({ ...base, decision: "HOLD", reason, ...extra });
  if (!sales) return hold("SALES_MISSING");
  if (sales.tbRefs !== undefined && !Array.isArray(sales.tbRefs)) return hold("TBREFS_MALFORMED");
  const tbRefs = sales.tbRefs || [];
  const rowTbIds = rows.map(row => row.tbId);
  const refTbIds = tbRefs.map(readTbRefBatchId);
  if (new Set(rowTbIds).size < 2 && new Set(refTbIds.filter(Boolean)).size < 2) return { ...base, decision: "NONE" };

  if (Object.hasOwn(sales, "targetedBatchId")) return hold("TARGETED_BATCH_ID_PRESENT");
  if (new Set(rowTbIds).size !== rowTbIds.length) return hold("SAME_BATCH_TWICE");
  if (refTbIds.includes(null) || new Set(refTbIds).size !== refTbIds.length || !inspectSalesTbRefsIntegrity(tbRefs).valid) return hold("TBREFS_INTEGRITY");
  if ([...rowTbIds].sort().join() !== [...refTbIds].sort().join()) return hold("ROWS_AND_TBREFS_DIFFER");
  if (rows.some(row => row.salesAllMeterId !== salesId || row.idConflict)) return hold("ROW_IDENTITY");
  if (rowTbIds.some(tbId => parents[tbId]?.schemaVersion !== LEGACY_SCHEMA)) return hold("NOT_ONLY_OLD_BATCHES");

  const evidence = rows.map(row => rowEvidence({ salesId, row, tbRefs, trns: facts.trns, premises: facts.premises }));
  const visible = sales.master?.visibility === "VISIBLE";
  const discovered = Boolean(meterMaster?.refs?.asts?.id) || facts.asts.length > 0;
  const salesStatusBefore = classifySalesWorkStatus(sales);
  const withFacts = { ...base, visible, discovered, salesStatusBefore, evidence };
  if (OFFICE_HOLDS[salesId]) return { ...withFacts, decision: "HOLD", reason: OFFICE_HOLDS[salesId] };

  const completedThis = evidence.filter(e => e.status === "COMPLETED" && e.meterMatch === true);
  const completedOther = evidence.filter(e => e.status === "COMPLETED" && e.meterMatch !== true);
  const withWork = evidence.filter(e => e.rank > 0);
  let owner = null, ownerRule = null;
  const decision = OWNER_DECISIONS[salesId];
  if (decision) { owner = decision.ownerTbId; ownerRule = "B4_OWNER_DECISION"; }
  else if (completedOther.length && !visible) return { ...withFacts, decision: "HOLD", reason: "COMPLETED_ON_ANOTHER_METER" };
  else if (completedThis.length > 1) return { ...withFacts, decision: "HOLD", reason: "SEVERAL_COMPLETED_ROWS" };
  else if (completedThis.length === 1) { owner = completedThis[0].tbId; ownerRule = "B1_COMPLETED_THIS_METER"; }
  else if (visible && rowTbIds.includes(facts.discoveringTrn?.targetedBatchContext?.tbId)) { owner = facts.discoveringTrn.targetedBatchContext.tbId; ownerRule = "B2_DISCOVERED_THROUGH_BATCH"; }
  else if (withWork.length === 1) { owner = withWork[0].tbId; ownerRule = "B3_ONLY_BATCH_WITH_FIELD_WORK"; }
  else if (withWork.length > 1) return { ...withFacts, decision: "HOLD", reason: "FIELD_WORK_IN_SEVERAL_BATCHES" };
  else if (visible) {
    const ast = facts.discoveringAst;
    const astAt = millis(ast?.metadata?.createdAt);
    const creatorTeams = discoveringTeams(facts);
    if (!ast || astAt === null || creatorTeams.length !== 1) return { ...withFacts, decision: "HOLD", reason: "B5_DISCOVERING_TEAM_UNKNOWN" };
    const team = creatorTeams[0];
    const held = rowTbIds.filter(tbId => parents[tbId].allocation?.status === "ALLOCATED" && parents[tbId].allocation?.targetType === "TEAM" && parents[tbId].allocation?.targetId === team.id);
    // Only a batch that already existed when the meter was found can have sent the team there.
    const existed = held.filter(tbId => millis(parents[tbId].metadata?.createdAt) !== null && millis(parents[tbId].metadata.createdAt) <= astAt).sort((a, b) => millis(parents[a].metadata.createdAt) - millis(parents[b].metadata.createdAt));
    if (!held.length) return { ...withFacts, decision: "HOLD", reason: "B5_TEAM_HOLDS_NO_BATCH", discoveringTeam: team.id };
    if (!existed.length) return { ...withFacts, decision: "HOLD", reason: "B5_NO_TEAM_BATCH_AT_DISCOVERY", discoveringTeam: team.id };
    owner = existed.at(-1); ownerRule = "B5_DISCOVERING_TEAM_BATCH";
  } else {
    // Untouched in every batch: released from all of them (TB-R050 release conditions).
    if (discovered) return { ...withFacts, decision: "HOLD", reason: "DISCOVERED_NOT_LINKED" };
    if (salesStatusBefore !== "NOT_STARTED") return { ...withFacts, decision: "HOLD", reason: "SALES_STATUS_NOT_NOT_STARTED" };
    if (evidence.some(e => e.status !== "NOT_STARTED" || e.rank !== 0 || !e.refIsPreExecution)) return { ...withFacts, decision: "HOLD", reason: "RELEASE_ROW_NOT_CLEAN" };
    return { ...withFacts, decision: "RELEASE", ownerTbId: null, ownerRowId: null, ownerRule: null, targetedBatchIdAfter: null,
      removals: evidence.map(e => ({ rowId: e.rowId, tbId: e.tbId, rowNo: e.rowNo, released: true, startedException: false })) };
  }

  const ownerRow = rows.find(row => row.tbId === owner);
  if (!ownerRow) return { ...withFacts, decision: "HOLD", reason: "OWNER_BATCH_NOT_AMONG_ROWS" };
  const removals = [];
  for (const e of evidence.filter(x => x.tbId !== owner)) {
    const exception = decision?.startedRowRemovals?.[e.rowId];
    if (exception) {
      const onlyNoAccess = e.status !== "COMPLETED" && !e.discoveryTrn && !e.premise && e.premiseIds.length === 0 && e.trnIds.join() === [...exception.trnIds].sort().join();
      if (!onlyNoAccess) return { ...withFacts, decision: "HOLD", reason: "APPROVED_STARTED_ROW_CHANGED", ownerTbId: owner };
      removals.push({ rowId: e.rowId, tbId: e.tbId, rowNo: e.rowNo, released: false, startedException: true });
      continue;
    }
    if (e.status !== "NOT_STARTED" || e.rank !== 0 || !e.refIsPreExecution) return { ...withFacts, decision: "HOLD", reason: "NON_OWNER_ROW_HAS_FIELD_WORK", ownerTbId: owner };
    removals.push({ rowId: e.rowId, tbId: e.tbId, rowNo: e.rowNo, released: false, startedException: false });
  }
  return { ...withFacts, decision: "DEDUPE", ownerTbId: owner, ownerRowId: ownerRow.id, ownerRule, targetedBatchIdAfter: owner, removals };
}

// Counts exactly as the creators and the allocation/execution Functions keep them.
export function countRows(rows) {
  return {
    totalRows: rows.length,
    acceptedRows: rows.filter(r => r.decision?.status === "ACCEPT").length,
    rejectedRows: rows.filter(r => r.decision?.status === "REJECT").length,
    allocatableRows: rows.filter(r => r.allocation?.allocatable === true).length,
    allocatedRows: rows.filter(r => r.allocation?.status === "ALLOCATED").length,
    unallocatedRows: rows.filter(r => r.allocation?.allocatable === true && r.allocation?.status !== "ALLOCATED").length,
    executionStartedRows: rows.filter(r => (r.execution?.status || "NOT_STARTED") !== "NOT_STARTED").length,
    completedRows: rows.filter(r => r.execution?.status === "COMPLETED").length,
  };
}
// Section 14 completion target, as premiseLink.js getTargetedBatchCompletionTarget.
export const completionTarget = counts => [counts.allocatableRows, counts.acceptedRows, counts.allocatedRows, counts.totalRows].find(n => Number.isInteger(n) && n > 0) || 0;
const reachedTarget = counts => completionTarget(counts) > 0 && counts.completedRows >= completionTarget(counts);
// TB-R050: a parent becomes COMPLETED only when this removal is what takes it to its target.
export const removalCompletesBatch = (rowsBefore, rowsAfter) => !reachedTarget(countRows(rowsBefore)) && reachedTarget(countRows(rowsAfter));
// Teams the discovering AST's creator belongs to (TB-R049 B5).
export const discoveringTeams = facts => (facts.teams || []).filter(t => t.memberUserIds.includes(facts.discoveringAst?.metadata?.createdByUid)).sort((a, b) => a.id.localeCompare(b.id));

// What decides the plan. Parent counts, status and update times are left out: other meters of the same
// batch change them during the run, and they are recounted inside each transaction anyway.
function stable(value) {
  if (value === null || value === undefined) return null;
  if (typeof value?.toMillis === "function") return { _ts: value.toMillis() };
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export function fingerprint(facts) {
  const { sales, meterMaster } = facts;
  const material = {
    sales: sales ? { hasTargetedBatchId: Object.hasOwn(sales, "targetedBatchId"), targetedBatchId: sales.targetedBatchId ?? null, tbRefs: sales.tbRefs ?? null, visibility: sales.master?.visibility ?? null } : null,
    meterMaster: meterMaster ? { astsId: meterMaster.refs?.asts?.id ?? null, salesId: meterMaster.refs?.sales?.id ?? null } : null,
    rows: [...facts.rows].sort((a, b) => a.id.localeCompare(b.id)).map(r => ({ id: r.id, tbId: r.tbId, rowNo: r.rowNo, salesAllMeterId: r.salesAllMeterId, execution: r.execution, refs: r.refs, decision: r.decision?.status ?? null, allocation: { status: r.allocation?.status ?? null, targetType: r.allocation?.targetType ?? null, targetId: r.allocation?.targetId ?? null, allocatable: r.allocation?.allocatable ?? null } })),
    parents: Object.keys(facts.parents).sort().map(id => { const p = facts.parents[id]; return p ? { id, schemaVersion: p.schemaVersion, allocation: { status: p.allocation?.status ?? null, targetType: p.allocation?.targetType ?? null, targetId: p.allocation?.targetId ?? null }, acceptance: p.acceptance?.status ?? null, createdAt: p.metadata?.createdAt } : { id, missing: true }; }),
    asts: facts.asts.map(a => ({ id: a.id, createdByUid: a.metadata?.createdByUid ?? null, createdAt: a.metadata?.createdAt ?? null })).sort((a, b) => a.id.localeCompare(b.id)),
    discoveringAst: facts.discoveringAst ? { id: facts.discoveringAst.id, createdByUid: facts.discoveringAst.metadata?.createdByUid ?? null, createdAt: facts.discoveringAst.metadata?.createdAt ?? null } : null,
    discoveringTrn: facts.discoveringTrn ? { id: facts.discoveringTrn.id, context: facts.discoveringTrn.targetedBatchContext ?? null } : null,
    discoveringTeams: discoveringTeams(facts).map(t => t.id),
    trns: facts.trns.map(t => ({ id: t.id, context: t.targetedBatchContext ?? null, hasAccess: t.accessData?.access?.hasAccess ?? null })).sort((a, b) => a.id.localeCompare(b.id)),
    premises: facts.premises.map(p => ({ id: p.id, context: p.targetedBatchContext ?? null })).sort((a, b) => a.id.localeCompare(b.id)),
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable(material))).digest("hex");
}

// The parts of a plan that must be identical between the approved dry run and the transaction.
export const planSignature = plan => JSON.stringify({ decision: plan.decision, reason: plan.reason ?? null, ownerTbId: plan.ownerTbId ?? null, ownerRowId: plan.ownerRowId ?? null, ownerRule: plan.ownerRule ?? null, targetedBatchIdAfter: plan.targetedBatchIdAfter ?? null, removals: (plan.removals || []).map(r => [r.rowId, r.tbId, r.released, r.startedException]) });
