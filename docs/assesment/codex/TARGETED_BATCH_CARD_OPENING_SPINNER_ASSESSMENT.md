# Targeted Batch Card Opening Spinner Assessment

## 1. Executive Summary

The missing feedback is confirmed in `app/(tabs)/admin/operations/my-workorders.js`. Level 2 is rendered by `TargetedBatchBucketLanding`, which uses a `ScrollView` and `buckets.map(...)` to render `TargetedBatchCard` instances. Each eligible card renders a `Pressable` whose `onPress` calls `onOpenBucket(bucket)` and whose fixed label is `VIEW ROWS` (lines 2970-3040 and 3120-3305).

At the screen level, `onOpenBucket` is `openBucket`. For a Targeted Batch (`bucketType === "TBB"`), that handler validates `permissions.canViewRows`, then synchronously queues `setSelectedBucket(bucket)`, `setSelectedGroup(null)`, and `setStateFilter("ALL")` (lines 1867-1913). On the next React render, `selectedTargetedBatchId` derives from `selectedBucket`, `showTargetedBatchRows` becomes true, the Level 2 conditional branch disappears, and `TargetedBatchRowsWorklist` renders (lines 1019-1022 and 2611-2746). There is no Level 2 opening state, spinner, label change, or duplicate-tap guard.

The smallest safe first patch is confined to `app/(tabs)/admin/operations/my-workorders.js`: add a dedicated `openingTargetedBatchId`, introduce a Targeted-Batch-specific opening handler, set that identity after revalidating the live bucket, block all competing Level 2 `VIEW ROWS` selections while the transition owns the UI, allow one explicit animation-frame boundary, then call the existing selection logic. Pass the identity through `TargetedBatchBucketLanding` to `TargetedBatchCard`; only the matching card shows a small spinner and `OPENING...`. Clear the state immediately after `setSelectedBucket` has queued Level 3 ownership, with guarded cleanup for cancellation/unmount/focus loss. Do not alter APIs, streams, routes, Level 1, Level 3 row actions, ACCEPT/REJECT, or `VIEW TRANSACTIONS`.

## 2. Files Inspected

- Mobile: `skills.md` — repository housekeeping and ZIP rules.
- Web: `skills.md` — repository housekeeping, streaming policy, and delivery rules.
- Mobile: `app/(tabs)/admin/operations/my-workorders.js` — exact current screen implementation and all relevant Level 1/2/3 components, state, handlers, hooks, and conditional rendering.
- Mobile: `src/redux/targetedBatchApi.js` — `getTargetedBatchRows`, including its initial cache value and Firestore listeners.

The supplied commit identifier (`27ba5d2`) was treated as the stated verified baseline. No Git command was run, as explicitly prohibited.

## 3. Confirmed Three-Level Flow

1. Level 1: `WorkorderManagementSystem` renders `BucketTypeLanding` when both `selectedBucket` and `selectedBucketCategory` are null (lines 2673-2690). `openBucketCategory("TBB")` validates bucket-stream readiness, sets `selectedBucketCategory` to `TBB`, and keeps `selectedBucket` null (lines 1838-1855).
2. Level 2: the conditional branch `!selectedBucket && selectedBucketCategory === "TBB"` renders `TargetedBatchBucketLanding` (lines 2691-2703). That component maps `targetedBatchBuckets` to individual `TargetedBatchCard` components (lines 2970-3040).
3. Level 3: the selected card calls `openBucket(bucket)`. The TBB branch sets `selectedBucket(bucket)` (lines 1899-1912). This makes `selectedTargetedBatchId` equal `selectedBucket.id` and `showTargetedBatchRows` true (lines 1019-1022 and 2614-2615). The main conditional then renders `TargetedBatchRowsWorklist` (lines 2733-2746).

This verifies the proposed component chain, with one precision: `selectedTargetedBatchId` is not separately set; it is derived during render from `selectedBucket`.

## 4. Current Level 2 Card Rendering

`TargetedBatchBucketLanding` is the exact Level 2 list component. Its root list mechanism is a `ScrollView`; inside `styles.bucketList`, `buckets.map(...)` creates `TargetedBatchCard` elements keyed by `bucket.id` (lines 2982-3039). It is not a `FlashList` or `FlatList`.

`TargetedBatchCard` is the exact individual-card component (lines 3120-3305). The `VIEW ROWS` element is a `Pressable` at lines 3279-3287:

- `onPress={() => onOpenBucket(bucket)}`
- `disabled={deciding}`
- fixed `Text`: `VIEW ROWS`

There is no Level 2 `extraData` requirement because this is ordinary React `.map` rendering under a `ScrollView`. Passing a changed opening prop causes normal reconciliation. The `extraData={openingAction}` at line 3807 belongs only to the Level 3 `FlashList` and its row-action state.

The current `VIEW ROWS` button is disabled only by the aggregate `deciding` prop. It does not use the card's computed `disabled` value, and it has no opening-specific disabled or visual state (lines 3134-3140 and 3279-3286).

## 5. Current VIEW ROWS Action Flow

The complete confirmed flow is:

`TargetedBatchCard` `VIEW ROWS` `Pressable` (lines 3279-3286)
→ `onOpenBucket(bucket)`
→ `TargetedBatchBucketLanding` forwards `onOpenBucket` unchanged (lines 2970-2980 and 3026-3036)
→ `WorkorderManagementSystem` supplies `openBucket` (lines 2691-2703)
→ `openBucket` checks `bucketType === "TBB"` and `permissions.canViewRows === true`; failure produces the `Targeted Batch Locked` alert (lines 1899-1906)
→ success calls `setPreparingBgoDetail(false)`, `setSelectedBucket(bucket)`, `setSelectedGroup(null)`, and `setStateFilter("ALL")` (lines 1908-1911)
→ React re-renders; `selectedTargetedBatchId` derives from the selected TBB bucket (lines 1019-1022)
→ the Level 2 predicate `!selectedBucket && selectedBucketCategory === "TBB"` becomes false, while `showTargetedBatchRows` becomes true (lines 2691 and 2614-2615)
→ `TargetedBatchRowsWorklist` renders (lines 2733-2746).

Therefore, `setSelectedBucket(bucket)` does replace Level 2 with Level 3 on the next committed render. It is a React state update, not an immediate imperative DOM/native-view replacement inside the handler.

## 6. Existing Level 3 Loading Behaviour

The row query is controlled by `targetedBatchRowsQuerySkipped` (lines 1152-1168). It remains skipped unless all three conditions hold:

- the actor is a field-workorder actor;
- `selectedTargetedBatchId` is truthy;
- `selectedBucket.permissions.canViewRows === true`.

Consequently, the query becomes active as a result of the `selectedBucket` change: that change simultaneously derives `selectedTargetedBatchId` and supplies the permission condition. It is not active before selection, and there is no independent setter for `selectedTargetedBatchId`.

`useGetTargetedBatchRowsQuery` exposes only `data` as `targetedBatchRowsData`, `isLoading` as `isLoadingTargetedBatchRows`, and `error` as `targetedBatchRowsError` in this screen (lines 1157-1168). No `isFetching` value is destructured. `targetedBatchRows` is a `useMemo` projection of `targetedBatchRowsData.rows` enriched with warehouse ERF display data (lines 1264-1293).

The endpoint `getTargetedBatchRows` in `src/redux/targetedBatchApi.js` behaves as follows:

- `queryFn` validates `tbId` and immediately returns `buildTargetedBatchRowsData({ tbId, rows: [] })` (lines 458-463).
- `onCacheEntryAdded` waits for cache data, opens a Firestore `onSnapshot` on `tb_rows` filtered by `tbId`, reconciles per-sales-document listeners, and publishes updated cache data (lines 465-545).
- Cache identity is endpoint plus cleaned `tbId` (lines 546-547).
- Listener and setup errors are logged inside `onCacheEntryAdded`; they are not returned through the RTK Query `error` channel by this code (lines 526-538).

State inventory:

- Selected Targeted Batch: `selectedBucket`; derived ID `selectedTargetedBatchId`.
- Rows loading: `isLoadingTargetedBatchRows`.
- Rows fetching: RTK Query may internally provide `isFetching`, but this screen neither destructures nor renders it; no screen-level fetching state exists.
- Rows streaming: no explicit boolean; an active endpoint cache subscription owns Firestore `unsubscribeRows` plus `salesListeners` until `cacheEntryRemoved`.
- Rows ready: no explicit boolean. Operationally, `targetedBatchRowsData` exists and `isLoadingTargetedBatchRows` is false; rows may legitimately be empty.
- Rows error: `targetedBatchRowsError`, although Firestore listener/setup failures are only logged and therefore do not reliably populate it.

Level 3 does contain an `ActivityIndicator` and the message `Loading Targeted Batch rows...` in `TargetedBatchRowsWorklist` (lines 3780-3789). The parent passes `isLoadingTargetedBatchRows && !targetedBatchRowsData` (lines 2738-2740). Because `queryFn` immediately supplies an empty data object, the Level 3 loading presentation can be extremely brief or bypassed before the first Firestore snapshot. Thus the handover exists structurally but is not guaranteed to remain visibly loading while the first stream snapshot is pending.

## 7. Confirmed Findings

- No Level 2 card-opening state exists. Neither `WorkorderManagementSystem`, `TargetedBatchBucketLanding`, nor `TargetedBatchCard` has an opening ID/flag for `VIEW ROWS`.
- `processingTargetedBatchAction` is set only by `submitTargetedBatchDecision` around `acceptRejectTargetedBatch` and contains `{ bucketId, action }` for ACCEPT/REJECT (lines 2036-2119). `TargetedBatchCard` interprets every value as `Accepting...` or `Rejecting...` and describes whole-batch decision recording (lines 3226-3239). Reusing it for `VIEW ROWS` would mix navigation preparation with mutation/business-action semantics.
- `pendingTargetedBatchAction` is also unrelated. It is a request object for Level 3 action tiles, keyed by row, bucket, refs, geography, and intent; it drives `openingAction` and Level 3 `FlashList.extraData` (lines 965-1012, 1224-1226, 2563-2603, and 2733-2745). It must not be reused for Level 2 opening.
- Level 2 is `ScrollView` plus `.map`; it needs no `extraData`.
- ACCEPT/REJECT are globally gated by `actionBusy`, which includes `decidingTargetedBatch` (lines 1241-1250). `VIEW ROWS` currently uses `disabled={deciding}`, so it is also blocked while any represented decision mutation is active.
- `VIEW TRANSACTIONS` after acceptance directly selects an optimistic `acceptedBucket` in the success alert callback (lines 2062-2093). It is a distinct post-acceptance path and should remain unchanged.

Likely cause: the transition queues `setSelectedBucket` immediately in the same press handler, so Level 2 is removed at the next commit without any preceding state whose committed UI could show opening feedback.

Unverified runtime hypotheses: exact frame timing varies by React Native renderer/device; a warm RTK Query cache may make Level 3 appear immediately; and whether a user can physically target Batch B between commits depends on event scheduling. These do not change the need for a synchronous logical guard.

## 8. Opening-State Lifecycle Assessment

Use `openingTargetedBatchId`, not a full request object, for the first patch. The operation has one intent (`OPEN_ROWS`), no asynchronous business result, no route payload, and no row/geography validation pipeline. An ID directly expresses the UI requirement and minimizes state and cleanup complexity. A request key/object would only be justified if opening later gains multiple asynchronous phases that can complete out of order.

Recommended sequence:

1. Reject immediately if an opening is already owned (a ref guard is safest because state alone is not updated synchronously).
2. Resolve/revalidate the tapped ID against the current `targetedBatchBuckets`; require the bucket still exists and still has `canViewRows === true`.
3. Store the opening ID in both the ref guard and React state.
4. Schedule one `requestAnimationFrame`.
5. In the callback, revalidate mounted/focused ownership and the live bucket's existence/eligibility, then execute the existing selection updates.
6. Clear the opening state/ref after queuing `setSelectedBucket`; Level 3 owns the next committed UI.

One explicit `requestAnimationFrame` is the smallest reasonable boundary. The state update is committed before the callback is eligible to run, providing a paint opportunity without imposing two frames of latency. Two nested frames are warranted for the heavier Level 3 action preparation already present at lines 2574-2603, but there is no comparable work in `openBucket`. With no explicit boundary, React may batch the opening-state update with `setSelectedBucket`, so the Level 2 spinner is not reliable. Runtime validation should confirm one frame on supported Android/iOS devices; two frames should be a fallback only if profiling proves one does not paint.

Required clear/cancel paths for the proposed state:

- Validation failure before ownership: do not set state; if failure occurs after ownership/revalidation, clear before alerting.
- Selected batch disappears from the live list: cancel/clear before selection. A pre-frame lookup against current buckets is required; optionally an effect can clear an owned ID no longer present.
- Batch becomes ineligible: cancel/clear before selection using the same live lookup and permission check.
- Back or bucket-category change while Level 2 remains visible: cancel the scheduled frame and clear ownership in `backToBucketCategories`/category-opening paths.
- Screen loses focus: cancel/clear in the existing `useFocusEffect` cleanup, alongside the separate Level 3 pending-action cleanup.
- Screen unmounts: cancel the frame and clear the ref; do not call state setters after unmount.
- Newer request: the recommended first patch blocks competing openings, so replacement should not occur. If replacement is deliberately allowed later, it requires a request key; the old callback must observe lost ownership and exit.
- Level 3 takes ownership: clear after queuing the selected bucket. Clearing before selection risks a brief re-enabled button; waiting for row readiness unnecessarily couples Level 2 state to stream behavior.
- Back during the one-frame opening interval: current Level 2 back handler must cancel the scheduled open, not merely change category state.

When Level 2 is conditionally replaced, clearing React state is not required for visible correctness, but clearing the ownership ref/callback is required for lifecycle correctness and to prevent stale state when returning to Level 2. The screen component itself does not unmount during the Level 2→3 conditional swap, so relying on unmount cleanup would be incorrect.

## 9. Rapid-Tap and Stream Race Assessment

- Same Batch A repeatedly: a synchronous ref guard should accept the first tap and ignore subsequent taps. State-only gating can admit two presses before re-render.
- Batch A then Batch B: block all Level 2 `VIEW ROWS` buttons once one opening begins. Allowing B to replace A complicates ownership and can make the visible spinner jump; global temporary blocking is safer for a one-frame transition. Only A should display a spinner, while other cards are disabled without spinners.
- `VIEW ROWS` during ACCEPT/REJECT: retain the existing `deciding`/`actionBusy` gate and also guard in the handler, not only in the `Pressable`. This preserves mutation isolation even if the handler is invoked programmatically or props are stale.
- Stream disappearance: the bucket-list listener may remove or update the bucket during the frame. Re-resolve by ID from current `targetedBatchBuckets`; do not open the stale object captured by the press.
- Post-selection disappearance/ineligibility: current code stores the selected bucket object and has no confirmed reconciliation effect tying it back to `targetedBatchBuckets`. Level 3 can therefore remain selected with stale eligibility. Changing that broader behavior is outside the first-patch scope; document and manually observe it rather than redesigning the stream.
- Row stream error: endpoint listener errors are logged rather than surfaced to `targetedBatchRowsError`, so the Level 3 error card is not guaranteed for listener failures. This is a pre-existing API-state limitation and must not be folded into the spinner patch.

## 10. Minimal Safe Patch Recommendation

Modify only `app/(tabs)/admin/operations/my-workorders.js`:

1. Add `openingTargetedBatchId` state, an ownership ref, and one animation-frame ref near the existing screen state. Keep them distinctly named from the Level 3 `pendingTargetedBatchAction` refs.
2. Add a small idempotent cancellation helper that cancels the scheduled frame, clears ownership, and safely clears state while mounted.
3. Add `openTargetedBatchRows(bucket)` (or specialize the TBB branch of `openBucket`) to validate ID, actor/action busy status, membership in the latest `targetedBatchBuckets`, and `canViewRows`; claim ownership synchronously; set the opening ID; and defer existing selection updates by one frame.
4. Prefer passing `openTargetedBatchRows` as `onOpenBucket` only to `TargetedBatchBucketLanding`, leaving BGO/individual `openBucket` paths untouched.
5. Pass `openingTargetedBatchId` through `TargetedBatchBucketLanding` to every `TargetedBatchCard`.
6. In each card compute `openingThisBatch` and `anyBatchOpening`. For `VIEW ROWS`, show a small `ActivityIndicator` plus `OPENING...` only when `openingThisBatch`; disable the button when `deciding || anyBatchOpening || !fieldWorkorderActor`. Preserve existing styles except for any minimal spinner/text layout adjustment already supported by `actionBtn` (`flexDirection: "row"`, `gap: 6`).
7. Add cancellation to back/category, focus-loss, and unmount paths. Clear after selection is queued. Do not wait for the row stream.

No query redesign, dependency, API, context, storage, route, Level 1, Level 3 tile, decision, or `VIEW TRANSACTIONS` change is needed.

## 11. Files That Would Change

First patch:

- `app/(tabs)/admin/operations/my-workorders.js` only.

No change should be made to `src/redux/targetedBatchApi.js`; it was inspected only to establish activation and loading/stream semantics.

## 12. Risks and Regression Concerns

- React state alone is not a sufficient same-tick duplicate guard; use a ref for ownership.
- A captured `bucket` can become stale during the paint boundary; re-resolve it from the latest streamed list.
- Clearing too early can re-enable Level 2 before selection; clearing on row readiness can strand hidden state and couple unrelated lifecycles. Clear immediately after queuing selection.
- Two animation frames add perceptible delay without evidence they are needed for this light transition.
- The existing Level 3 loading UI is structurally correct but may not visibly bridge to the first snapshot because the endpoint immediately supplies empty data. The first patch should not redesign that endpoint.
- Reusing `processingTargetedBatchAction` could show false Accepting/Rejecting semantics and interfere with mutation cleanup.
- Reusing `pendingTargetedBatchAction` could cancel or corrupt Level 3 PREMISE/AST/NA/ERF preparation.
- Changing `VIEW TRANSACTIONS` would broaden scope and risk the accepted-batch flow.

Optional improvements explicitly excluded from the first patch:

- A stream-initialized flag that distinguishes initial empty cache data from the first Firestore snapshot.
- Surfacing `onSnapshot` errors through a dedicated cache/status field.
- Reconciling a selected bucket against live bucket removal/permission changes after Level 3 already owns the UI.
- A generalized request-key state machine for multiple opening intents.
- Performance or OutOfMemory work.

## 13. Manual Test Matrix

| # | Scenario | Expected result |
|---|---|---|
| 1 | Tap `VIEW ROWS` on Batch A | Spinner and `OPENING...` appear only in A; after one paint opportunity Level 3 opens for A. |
| 2 | Rapidly double-tap A | Only the first press claims ownership; one transition/query subscription occurs. |
| 3 | Tap A then immediately B | A remains the only spinning card; B is disabled; Level 3 opens A, never B. |
| 4 | Open a batch with cached/immediately available rows | A still visibly receives opening feedback; Level 3 may render rows immediately without a prolonged loading card. |
| 5 | Open a batch whose rows need to stream | A spinner hands off to Level 3; existing `Loading Targeted Batch rows...` appears if its current predicate remains true, otherwise the existing empty/then-stream update behavior is observed and recorded. |
| 6 | Selected batch disappears during opening | Scheduled selection is cancelled, opening state clears, Level 2 remains, and a clear unavailable message is shown. |
| 7 | Selected batch becomes ineligible during opening | Scheduled selection is cancelled, opening state clears, Level 2 remains, and the locked message is shown. |
| 8 | Row query returns an error | Level 3 error card renders when `targetedBatchRowsError` is populated; separately verify/log the known listener-error limitation without changing it. |
| 9 | User presses Back during opening | Frame is cancelled, opening ownership clears, and Level 1 appears; no delayed Level 3 transition occurs. |
| 10 | Screen loses focus during opening | Cleanup cancels the frame and clears ownership; no off-focus state update/navigation occurs. |
| 11 | Return from Level 3 to Level 2 | No card retains `OPENING...`; all eligible buttons work normally. |
| 12 | ACCEPT and REJECT | Existing per-batch processing UI, mutation, alerts, and disabled behavior remain unchanged. |
| 13 | `VIEW TRANSACTIONS` after acceptance | Existing alert action still opens the accepted batch directly and is unchanged. |
| 14 | Level 1 bucket cards | Existing loading feedback is unchanged. |
| 15 | Level 3 PREMISE / AST / NA / ERF tiles | Existing `pendingTargetedBatchAction`, tile spinners, request keys, frame preparation, and navigation remain unchanged. |

Run these manually with no data-mutating test automation. ACCEPT/REJECT checks should use an approved safe test environment or be observational if mutation is not authorized.

## 14. Final Recommendation

Proceed with a one-file, UI-state-only patch centered on a dedicated `openingTargetedBatchId` plus a synchronous ownership ref and one `requestAnimationFrame`. Display the spinner only on the selected card but disable all Level 2 `VIEW ROWS` buttons for the brief opening interval. Revalidate the live bucket immediately before selection, cancel on back/focus loss/unmount, and clear as soon as `setSelectedBucket` queues Level 3 ownership.

Keep `processingTargetedBatchAction`, `pendingTargetedBatchAction`, the row stream, Level 3 action tiles, ACCEPT/REJECT, and `VIEW TRANSACTIONS` unchanged. The existing Level 3 loading card is a valid handoff target when its predicate is active, but its visibility before the first Firestore snapshot is not guaranteed by the present immediate-empty-data endpoint and should be treated as a separate, optional future assessment.
