import { createSlice } from "@reduxjs/toolkit";

import {
  buildTargetedBatchDraft,
  TARGETED_BATCH_DRAFT_STATUSES,
} from "./targetedBatchDraftModel";

const initialState = {
  draft: null,
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
    confirmTargetedBatchDraft(state) {
      if (!state.draft) return;

      state.draft.status =
        TARGETED_BATCH_DRAFT_STATUSES.READY_FOR_BACKEND;
      state.draft.confirmedAt = new Date().toISOString();
    },
    reopenTargetedBatchDraft(state) {
      if (!state.draft) return;

      state.draft.status = TARGETED_BATCH_DRAFT_STATUSES.DRAFT;
      state.draft.confirmedAt = null;
    },
    clearTargetedBatchDraft(state) {
      state.draft = null;
    },
  },
});

export const {
  prepareTargetedBatchDraft,
  confirmTargetedBatchDraft,
  reopenTargetedBatchDraft,
  clearTargetedBatchDraft,
} = targetedBatchDraftSlice.actions;

export const selectTargetedBatchDraft = (state) =>
  state?.targetedBatchDraft?.draft || null;

export default targetedBatchDraftSlice.reducer;
