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

export const targetedBatchDraftSlice = createSlice({
  name: "targetedBatchDraft",
  initialState,
  reducers: {
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
    confirmTargetedBatchDraft(state) {
      if (!state.draft) return;

      state.draft.status =
        TARGETED_BATCH_DRAFT_STATUSES.READY_FOR_BACKEND;
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
  prepareTargetedBatchDraft,
  recordTargetedBatchUploadAudit,
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
