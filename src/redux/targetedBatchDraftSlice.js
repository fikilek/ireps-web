import { createSlice } from "@reduxjs/toolkit";

import {
  buildTargetedBatchDraft,
  buildTargetedBatchUploadAudit,
  TARGETED_BATCH_DRAFT_STATUSES,
} from "./targetedBatchDraftModel";

const MAX_FRONTEND_UPLOAD_AUDIT_ENTRIES = 50;

const initialState = {
  draft: null,
  uploadAudit: [],
};

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function getDraftRowKey(row = {}, index = 0, tbId = "TB") {
  return firstText(
    row.tbRowId,
    row.uploadRowId,
    row.salesAllMeterId,
    row.sourceSalesAllMeterId,
    row.id,
    row.rowId,
    `${tbId}::ROW::${row.rowNo || index + 1}::${
      row.meterNo || row.meterNoNormalized || "METER"
    }`,
  );
}

function normalizeAllocationTarget(target = {}) {
  const rawType = String(target.type || target.targetType || "")
    .trim()
    .toUpperCase();
  const type = rawType === "SERVICE_PROVIDER" ? "SP" : rawType;
  const id = firstText(target.id, target.targetId);
  const name = firstText(target.name, target.targetName, id);

  if (!["TEAM", "SP"].includes(type) || !id) return null;

  return {
    type,
    id,
    name: name || id,
    memberCount: Number.isFinite(Number(target.memberCount))
      ? Number(target.memberCount)
      : 0,
    source: "FRONTEND_PENDING_BACKEND",
  };
}

function isBackendAllocation(row = {}) {
  return String(row?.allocation?.source || "").trim().toUpperCase() === "BACKEND";
}

function setDraftRows(draft, rows) {
  draft.displayRows = rows;
  draft.rows = rows;
}

export const targetedBatchDraftSlice = createSlice({
  name: "targetedBatchDraft",
  initialState,
  reducers: {
    updateSalesDraftResolution(state, { payload }) {
      if (state.draft?.id !== payload.tbId || state.draft.uncertainRequest) return;
      for (const row of payload.rows) if (state.draft.retainedIds.includes(row.salesId)) state.draft.resolutions[row.salesId] = row;
      state.draft.confirmation = null;
    },
    saveSalesDraftFence(state, { payload }) {
      if (state.draft?.id !== payload.tbId) return;
      state.draft.savedFence = payload.fence;
      state.draft.confirmation = null;
    },
    removeSalesDraftMeter(state, { payload }) {
      const draft = state.draft;
      if (draft?.id !== payload.tbId || draft.uncertainRequest) return;
      draft.retainedIds = draft.retainedIds.filter(id => id !== payload.salesId);
      draft.authoritativeIds.salesAllMeterIds = [...draft.retainedIds];
      delete draft.resolutions[payload.salesId];
      draft.confirmation = null;
    },
    setSalesDraftConfirmation(state, { payload }) {
      if (state.draft?.id === payload.tbId) state.draft.confirmation = payload.confirmation;
    },
    setSalesDraftUncertainRequest(state, { payload }) {
      if (state.draft?.id === payload.tbId) state.draft.uncertainRequest = payload.request;
    },
    prepareTargetedBatchDraft: {
      reducer(state, action) {
        state.draft = action.payload;
      },
      prepare(payload = {}) {
        return {
          payload: buildTargetedBatchDraft(payload),
        };
      },
    },
    recordTargetedBatchUploadAudit: {
      reducer(state, action) {
        const nextEntry = action.payload;

        if (!Array.isArray(state.uploadAudit)) {
          state.uploadAudit = [];
        }

        const existingIndex = state.uploadAudit.findIndex(
          (entry) => entry?.id === nextEntry.id,
        );

        if (existingIndex >= 0) {
          state.uploadAudit[existingIndex] = nextEntry;
        } else {
          state.uploadAudit.unshift(nextEntry);
        }

        state.uploadAudit = state.uploadAudit.slice(
          0,
          MAX_FRONTEND_UPLOAD_AUDIT_ENTRIES,
        );
      },
      prepare(payload = {}) {
        return {
          payload: buildTargetedBatchUploadAudit(payload),
        };
      },
    },
    applyTargetedBatchDraftAllocations(state, action) {
      const draft = state.draft;
      const payload = action.payload || {};
      const tbId = firstText(payload.tbId);
      const assignments = Array.isArray(payload.assignments)
        ? payload.assignments
        : [];

      if (!draft || draft.id !== tbId || assignments.length === 0) return;

      const assignmentsByRowKey = new Map();
      assignments.forEach((assignment) => {
        const rowKey = firstText(assignment.rowKey);
        const target = normalizeAllocationTarget(assignment.target);
        if (!rowKey || !target) return;
        assignmentsByRowKey.set(rowKey, target);
      });

      if (assignmentsByRowKey.size === 0) return;

      const plannedAt = payload.plannedAt || new Date().toISOString();
      const currentRows = Array.isArray(draft.displayRows)
        ? draft.displayRows
        : Array.isArray(draft.rows)
          ? draft.rows
          : [];

      const nextRows = currentRows.map((row, index) => {
        const rowKey = getDraftRowKey(row, index, draft.id);
        const target = assignmentsByRowKey.get(rowKey);

        if (!target || isBackendAllocation(row)) return row;

        const tbRowId = firstText(row.tbRowId, row.uploadRowId) || null;

        return {
          ...row,
          allocationStatus: "ALLOCATED",
          allocationTargetType: target.type,
          allocationTargetId: target.id,
          allocationTargetName: target.name,
          allocationUpdatedAt: plannedAt,
          allocation: {
            status: "ALLOCATED",
            targetType: target.type,
            targetId: target.id,
            targetName: target.name,
            memberCount: target.memberCount,
            source: "FRONTEND_PENDING_BACKEND",
            plannedAt,
            rowKey,
            tbRowId,
          },
        };
      });

      setDraftRows(draft, nextRows);
    },
    clearTargetedBatchDraftAllocations(state, action) {
      const draft = state.draft;
      const payload = action.payload || {};
      const tbId = firstText(payload.tbId);
      const rowKeys = new Set(
        (Array.isArray(payload.rowKeys) ? payload.rowKeys : [])
          .map((value) => firstText(value))
          .filter(Boolean),
      );

      if (!draft || draft.id !== tbId || rowKeys.size === 0) return;

      const currentRows = Array.isArray(draft.displayRows)
        ? draft.displayRows
        : Array.isArray(draft.rows)
          ? draft.rows
          : [];

      const nextRows = currentRows.map((row, index) => {
        const rowKey = getDraftRowKey(row, index, draft.id);
        if (!rowKeys.has(rowKey) || isBackendAllocation(row)) return row;

        return {
          ...row,
          allocationStatus: "NOT_ALLOCATED",
          allocationTargetType: null,
          allocationTargetId: null,
          allocationTargetName: null,
          allocationUpdatedAt: new Date().toISOString(),
          allocation: null,
        };
      });

      setDraftRows(draft, nextRows);
    },
    confirmTargetedBatchDraft(state) {
      if (!state.draft) return;

      state.draft.status = TARGETED_BATCH_DRAFT_STATUSES.READY_FOR_BACKEND;
      state.draft.confirmedAt = new Date().toISOString();

      const auditEntry = Array.isArray(state.uploadAudit)
        ? state.uploadAudit.find((entry) => entry?.id === state.draft?.id)
        : null;
      if (auditEntry) {
        auditEntry.status = TARGETED_BATCH_DRAFT_STATUSES.READY_FOR_BACKEND;
      }
    },
    reopenTargetedBatchDraft(state) {
      if (!state.draft) return;

      state.draft.status = TARGETED_BATCH_DRAFT_STATUSES.DRAFT;
      state.draft.confirmedAt = null;

      const auditEntry = Array.isArray(state.uploadAudit)
        ? state.uploadAudit.find((entry) => entry?.id === state.draft?.id)
        : null;
      if (auditEntry) {
        auditEntry.status = TARGETED_BATCH_DRAFT_STATUSES.DRAFT;
      }
    },
    clearTargetedBatchDraft(state) {
      state.draft = null;
    },
    clearTargetedBatchUploadAudit(state) {
      state.uploadAudit = [];
    },
  },
});

export const {
  updateSalesDraftResolution, saveSalesDraftFence, removeSalesDraftMeter, setSalesDraftConfirmation, setSalesDraftUncertainRequest,
  prepareTargetedBatchDraft,
  recordTargetedBatchUploadAudit,
  applyTargetedBatchDraftAllocations,
  clearTargetedBatchDraftAllocations,
  confirmTargetedBatchDraft,
  reopenTargetedBatchDraft,
  clearTargetedBatchDraft,
  clearTargetedBatchUploadAudit,
} = targetedBatchDraftSlice.actions;

export const selectTargetedBatchDraft = (state) =>
  state?.targetedBatchDraft?.draft || null;

export const selectTargetedBatchUploadAudit = (state) =>
  Array.isArray(state?.targetedBatchDraft?.uploadAudit)
    ? state.targetedBatchDraft.uploadAudit
    : [];

export default targetedBatchDraftSlice.reducer;
