# Targeted Batch Card Opening Spinner Assessment

## 1. Executive Summary

This assessment confirms that the missing Level 2 opening feedback is in `iREPS Mobile` and not currently implemented. The Targeted Batch card-level "VIEW ROWS" action is handled in `app/(tabs)/admin/operations/my-workorders.js`, and it directly switches the UI from the Targeted Batch bucket list to the Level 3 Batch Rows view by setting `selectedBucket`. There is no dedicated "opening" state for this tap.

A minimal safe patch would add a short-lived Level 2 opening state scoped to the selected batch card only, then transition to Level 3 after one visible paint opportunity. The Level 3 loading state already exists and should continue to handle row loading after the transition.

## 2. Files Inspected

- `app/(tabs)/admin/operations/my-workorders.js`
- `src/redux/targetedBatchApi.js`
- `c:\dev\ireps-mobile\skills.md`
- `c:\dev\ireps-web\skills.md`

## 3. Confirmed Three-Level Flow

1. Level 1 bucket cards are rendered in `WorkorderManagementSystem` within `BucketTypeLanding`.
2. Selecting Targeted Batches enters Level 2 via `TargetedBatchBucketLanding`.
3. Level 2 individual cards are rendered by `TargetedBatchCard`.
4. Tapping a Level 2 card's VIEW ROWS button calls `openBucket(bucket)` in `WorkorderManagementSystem`.
5. `openBucket(bucket)` for `bucket.bucketType === "TBB"` does:
   - permission check for `bucket?.permissions?.canViewRows === true`
   - `setPreparingBgoDetail(false)`
   - `setSelectedBucket(bucket)`
   - `setSelectedGroup(null)`
   - `setStateFilter("ALL")`
6. With `selectedBucket.bucketType === "TBB"`, the render path shows `TargetedBatchRowsWorklist`.
7. `selectedTargetedBatchId` is derived as `selectedBucket?.bucketType === "TBB" ? selectedBucket?.id : null`.
8. The Targeted Batch rows stream/query starts when `selectedTargetedBatchId` is truthy and permissions allow; this activates `useGetTargetedBatchRowsQuery`.

## 4. Current Level 2 Card Rendering

- Level 2 cards are rendered inside `TargetedBatchBucketLanding`.
- The individual card component is `TargetedBatchCard`.
- The bucket list uses `<ScrollView>` with `buckets.map(...)`.
- No `FlashList` or `FlatList` is used for the Targeted Batch card list.
- Because this is a simple mapped scroll view, there is no `extraData` prop required for Level 2 card rendering.

## 5. Current VIEW ROWS Action Flow

- The exact VIEW ROWS button is the `Pressable` inside `TargetedBatchCard`:
  - `onPress={() => onOpenBucket(bucket)}`
  - `disabled={deciding}`
  - `<Text style={styles.executeBtnText}>VIEW ROWS</Text>`
- `onOpenBucket` is passed from `WorkorderManagementSystem` to `TargetedBatchBucketLanding` to `TargetedBatchCard`.
- The handler invoked when VIEW ROWS is tapped is `openBucket(bucket)` defined in `WorkorderManagementSystem`.
- `openBucket(bucket)` for Targeted Batches does not use any opening spinner state; it simply calls `setSelectedBucket(bucket)`.
- Because `selectedBucket` is used to choose the UI branch, `setSelectedBucket(bucket)` immediately causes the Level 2 bucket-card list to stop rendering.

## 6. Existing Level 3 Loading Behaviour

- Targeted Batch rows are loaded via RTK Query in `useGetTargetedBatchRowsQuery`.
- The query is defined in `src/redux/targetedBatchApi.js` under `getTargetedBatchRows`.
- It uses Firestore `onSnapshot` streaming inside `onCacheEntryAdded`.
- The row query becomes active when:
  - `selectedTargetedBatchId` is set,
  - `selectedBucket?.permissions?.canViewRows === true`,
  - `fieldWorkorderActor` is true.
- Level 3 already renders its own loading message in `TargetedBatchRowsWorklist` when `isLoading` is true and `targetedBatchRowsData` is absent:
  - `Loading Targeted Batch rows...`
  - `Preparing the accepted ERF worklist for premise discovery.`

## 7. Confirmed Findings

- Exact component rendering Level 2 cards: `TargetedBatchBucketLanding` in `app/(tabs)/admin/operations/my-workorders.js`.
- Exact component rendering VIEW ROWS button: `TargetedBatchCard` in `app/(tabs)/admin/operations/my-workorders.js`.
- Exact handler for VIEW ROWS: `openBucket(bucket)` in `app/(tabs)/admin/operations/my-workorders.js`.
- `setSelectedBucket(bucket)` does immediately replace the Level 2 card list with Level 3 because the render branch switches to `TargetedBatchRowsWorklist` once `selectedBucket.bucketType === "TBB"`.
- Targeted Batch row query/stream becomes active when `selectedTargetedBatchId` changes to a valid batch id and `selectedBucket?.permissions?.canViewRows === true`; it does not start before `selectedBucket` changes.
- Existing states in this codebase:
  - selected Targeted Batch: `selectedBucket` with `bucketType === "TBB"`
  - derived selected batch id: `selectedTargetedBatchId`
  - rows loading: `isLoadingTargetedBatchRows`
  - rows error: `targetedBatchRowsError`
  - row data ready: `targetedBatchRowsData` and `targetedBatchRows`
  - streaming: implicit via RTK Query `onSnapshot`; no separate explicit state variable named "streaming"
- There is an existing Level 3 loading state and it is already used for handover.
- There is no existing Level 2 opening state for VIEW ROWS.
- `processingTargetedBatchAction` is currently restricted to Targeted Batch ACCEPT/REJECT processing:
  - it is only set in `submitTargetedBatchDecision`.
  - it is used to render accept/reject progress in `TargetedBatchCard`.
  - reusing it for VIEW ROWS would mix unrelated business actions and is not advisable.
- Level 2 cards are rendered with `ScrollView` and `.map`.
- No `extraData` prop is required for the Level 2 Targeted Batch card list in the current implementation.

## 8. Opening-State Lifecycle Assessment

### Existing states

- `selectedBucket`: master selection state for the current bucket or batch.
- `selectedBucketCategory`: stage selector between bucket categories.
- `selectedTargetedBatchId`: derived from `selectedBucket` when `bucketType === "TBB"`.
- `pendingTargetedBatchAction`: used for Level 3 row actions, not for Level 2 opening.
- `processingTargetedBatchAction`: used for accept/reject processing only.

### Opening-state lifecycle requirements

The following clear paths should be considered for any new Level 2 opening state:

- validation failure before opening (permission denied or missing view rights)
- selected batch disappears from the live bucket stream
- batch becomes ineligible to view before transition
- user presses Back during opening
- selected bucket category changes
- screen loses focus
- screen unmounts
- a newer batch-opening request replaces the previous one
- Level 3 successfully takes ownership of the navigation flow

### Safest clearing moment

- Because `TargetedBatchBucketLanding` and `TargetedBatchCard` are unmounted once `selectedBucket` becomes TBB, the Level 2 opening spinner state can be cleared as soon as the transition is committed.
- A safe design is to clear the opening state immediately after `setSelectedBucket(bucket)` or in an effect that watches `selectedBucket`/`selectedTargetedBatchId`.
- If the UI introduces a one-frame opening paint delay, the opening state should remain only long enough for that paint and then be cleared when Level 3 is displayed.

### Clear-on-unmount

- Clearing on unmount or focus loss is a good safety measure, especially if the user returns from Level 3 to Level 2.
- The screen already clears `pendingTargetedBatchAction` on blur via `useFocusEffect`, so a new opening state should be cleaned there as well.

## 9. Rapid-Tap and Stream Race Assessment

- Same VIEW ROWS button repeated rapidly:
  - Current `openBucket(bucket)` is idempotent for the same bucket because it only sets `selectedBucket(bucket)`.
  - Without a dedicated opening lock, duplicate taps could still trigger repeated state updates, but they are not likely to break the flow.
  - A safe patch should disable the selected card immediately once the opening state starts.
- Batch A then Batch B quickly:
  - Because there is a window while the opening spinner is being shown, competing taps on another card are possible if the UI does not block additional opens.
  - The safest minimal implementation is to ignore or block further open attempts while an opening operation is in progress.
  - This can be done without showing spinners on the other cards.
- VIEW ROWS while ACCEPT/REJECT processing is active:
  - Current code already disables VIEW ROWS when `deciding` is true.
  - A new opening state should preserve that guard.

## 10. Minimal Safe Patch Recommendation

The smallest safe implementation would be:

1. Add a dedicated Level 2 opening state variable in `WorkorderManagementSystem`, e.g. `openingTargetedBatchId`.
2. In `openBucket(bucket)` for `bucket.bucketType === "TBB"` and `canViewRows`, set `openingTargetedBatchId(bucket.id)` first.
3. Use `requestAnimationFrame` once to delay `setSelectedBucket(bucket)` until after the opening-state paint has a chance to commit.
4. In `TargetedBatchCard`, render the VIEW ROWS button as:
   - spinner + text `OPENING...` when `openingTargetedBatchId === bucket.id`
   - disabled for the selected opening card
   - keep other cards visually unchanged and without spinners
5. Optionally disable other cards from accepting a second open while the opening state is active, but only the selected card should show the spinner.
6. Clear `openingTargetedBatchId` when Level 3 becomes active or when the screen loses focus/unmounts.

This meets the requirement without touching Firestore, API design, routing destinations, query semantics, or unrelated Level 3 action spinners.

## 11. Files That Would Change

- `app/(tabs)/admin/operations/my-workorders.js`
- No `iREPS Web` source files need changing for this mobile-only requirement.

## 12. Risks and Regression Concerns

- Reusing `processingTargetedBatchAction` for VIEW ROWS would mix accept/reject lifecycle state with navigation state and is a regression risk.
- Introducing a new opening state in `my-workorders.js` is the smallest surface area risk.
- If opening state is not cleared when Level 2 unmounts or when focus is lost, it could persist incorrectly when returning to the bucket list.
- If the implementation leaves other cards tappable during the opening frame, competing selections could be triggered.

## 13. Manual Test Matrix

1. Tap VIEW ROWS on Batch A.
2. Rapidly double-tap VIEW ROWS on Batch A.
3. Tap Batch A and immediately tap Batch B.
4. Open a batch whose rows are already cached or immediately available.
5. Open a batch whose rows still need to load or stream.
6. Selected batch disappears during opening.
7. Selected batch becomes ineligible during opening.
8. Row query returns an error.
9. User presses Back during opening.
10. Screen loses focus during opening.
11. User returns from Level 3 to Level 2.
12. ACCEPT and REJECT processing remain unchanged.
13. VIEW TRANSACTIONS remains unchanged.
14. Level 1 bucket-card spinners remain unchanged.
15. Level 3 PREMISE / AST / NA / ERF spinners remain unchanged.

## 14. Final Recommendation

Implement a localized opening state in `app/(tabs)/admin/operations/my-workorders.js` scoped to the selected Targeted Batch card:

- `openingTargetedBatchId` for the selected card
- one `requestAnimationFrame` delay before `setSelectedBucket(bucket)`
- only the selected card shows `OPENING...` and spinner
- duplicate taps on the selected card are blocked
- other cards remain visually normal and may be blocked only logically while the opening is in progress
- clear the opening state when Level 3 is displayed or on blur/unmount

This is the smallest safe patch that fixes the missing Level 2 feedback and preserves the existing Level 3 loading handover.

---

### Confirmed Facts vs. Observations

- Confirmed facts: exact component names, handler names, state variables, render mechanism, query activation condition, and current loading messaging.
- Likely cause: direct `setSelectedBucket(bucket)` transition leaves no time for a Level 2 spinner to render.
- Unverified hypothesis: a one-frame `requestAnimationFrame` boundary is sufficient and preferable to a more complex multi-stage open request object.
- Optional improvement not for first patch: globally disabling all cards during opening. The first patch should focus on the selected card only.
