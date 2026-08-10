# Targeted Batch Action Spinner Assessment

## 1. Executive Summary

The per-action loading plumbing exists and identifies the correct row and intent. `WorkorderManagementSystem` creates `pendingTargetedBatchAction`; `TargetedBatchRowsWorklist` reduces it to an `openingIntent` only for the matching row; `TargetedBatchRowCard` compares that intent with each action; and `TargetedBatchActionTile` replaces the value with an `ActivityIndicator` when `opening` is true.

The confirmed lifecycle defect is that the warehouse-preparation effect clears `pendingTargetedBatchAction` before calling `updateGeo` and before calling `router.push`. Consequently the indicator is not tied to successful navigation or destination mount, and can disappear while the source screen is still visible. When the target ward is already selected and its warehouse pack is ready, the effect can complete immediately after the pending render, making the indicator extremely brief or not visibly painted. The tile also remains enabled while `opening`, so duplicate taps can replace the request identity.

The smallest safe first patch is confined to loading feedback and action orchestration in `app/(tabs)/admin/operations/my-workorders.js` and `src/features/targetedBatches/TargetedBatchActionTile.js`: yield one native frame after setting the row+intent pending state, disable the opening tile, retain pending state through a successful `router.push`, catch synchronous navigation failures, and centralize guarded cleanup. No routing, validation, streaming, storage, API, Warehouse, or performance redesign is needed.

## 2. Files Inspected

- `app/(tabs)/admin/operations/my-workorders.js`
- `src/features/targetedBatches/TargetedBatchActionTile.js`
- `src/features/targetedBatches/targetedBatchActions.js`
- `src/context/GeoContext.js`
- `src/context/WarehouseContext.js`
- `src/context/warehouseSelectors.js`
- `src/redux/targetedBatchApi.js`
- `src/redux/erfsApi.js`
- `skills.md` (mobile housekeeping)
- `C:/dev/ireps-web/skills.md` (report-repository housekeeping and streaming policy)

## 3. Current Action Flow

1. In `TargetedBatchRowCard` (`my-workorders.js`, action footer around lines 3763-3773), PREMISE, AST, NA, or ERF invokes `onAction({ bucket, row, intent })`. The intent comes from `getTargetedBatchRowActionState` in `src/features/targetedBatches/targetedBatchActions.js`.
2. `prepareTargetedBatchAction` (`my-workorders.js`, around lines 2368-2486) synchronously derives ERF/scope/action state, logs a large diagnostic object, and performs No Access, reference, scope, workbase, and ward validation.
3. On accepted input it increments `targetedBatchRequestSequence`, writes `targetedBatchRequestKeyRef.current`, and calls `setPendingTargetedBatchAction` with `requestKey`, `bucketId`, `rowId`, reference snapshot, ERF/LM/ward data, and `intent`.
4. In the same press handler it immediately calls `updateGeo` to select the target ward and clear ERF/premise/meter. `GeoContext.updateGeo` (`src/context/GeoContext.js`, around lines 247-289) uses a functional state update, applies cascade clearing, and increments `flightSignal`.
5. The ward selection changes the queries and derived values in `WarehouseProvider` (`src/context/WarehouseContext.js`): ERF, premise, meter, and TRN ward queries, `all`, `filtered`, `sync`, and `loading` can update.
6. The pending-action effect (`my-workorders.js`, around lines 1280-1475) waits until active LM/ward matches the request and the ERF pack matches the expected ward cache key. It waits while the warehouse is loading/not ready/refreshing.
7. When the ERF exists, the effect re-finds the streamed row by `rowId`, rejects bucket/row disappearance or changed references, finds and validates premise/meter linkages, builds selected geography and destination context, then navigates according to intent.
8. Critically, on the success branch it calls `setPendingTargetedBatchAction(null)` and clears the request ref before `updateGeo` and before `router.push` (`my-workorders.js`, lines 1371-1382 onward).

## 4. Existing Loading-State Implementation

`pendingTargetedBatchAction` is created by `useState(null)` in `WorkorderManagementSystem` (`my-workorders.js`, lines 963-968). It is passed as `openingAction` to `TargetedBatchRowsWorklist` (lines 2611-2622).

`TargetedBatchRowsWorklist.renderRow` (lines 3610-3616) passes an intent only when `openingAction.rowId === item.id`. `TargetedBatchRowCard` compares that value independently with the PREMISE, AST, NA, and ERF intents (lines 3763-3773). This is a correct rowId+intent identity, subject to row IDs being unique (the stream uses Firestore document IDs and FlashList uses `item.id`).

`TargetedBatchActionTile` (`src/features/targetedBatches/TargetedBatchActionTile.js`, component body) renders `<ActivityIndicator size="small" color="#2563eb" />` instead of its value when `opening` is true. Therefore the indicator is present and correctly targeted in code.

However, `Pressable.disabled` receives only the business-rule `disabled` prop. `opening` is not included. The pressed style likewise treats an opening tile as enabled. Loading therefore does not prevent duplicate taps.

## 5. Confirmed Findings

- Correct identity: `pendingTargetedBatchAction` contains both `rowId` and `intent`; the render chain applies `opening=true` only to the matching tile in the matching row (`my-workorders.js`, `TargetedBatchRowsWorklist.renderRow` and `TargetedBatchRowCard`).
- Indicator exists: `TargetedBatchActionTile` replaces the value with `ActivityIndicator` when `opening` is true.
- Premature success clear: the preparation effect clears pending before `updateGeo` and every success navigation call (`my-workorders.js`, lines 1371 onward).
- No navigation completion signal: no destination-mounted acknowledgement is used, and `router.push` is not awaited. The current state therefore cannot mean “visible until navigation succeeds.”
- Duplicate tap hole: `TargetedBatchActionTile` does not disable itself for `opening`; repeated taps create new sequence/request keys.
- Incomplete request-ref cleanup: several failure clears set pending to null without clearing `targetedBatchRequestKeyRef.current` (row/bucket loss, reference change, premise failure, AST failure, sync error, ERF missing). Stale ref state is usually superseded by a later request but is inconsistent and unsafe.
- Unmount cleanup only nulls `targetedBatchRequestKeyRef.current` (`my-workorders.js`, lines 1175-1177). React state need not be set after unmount, but no mounted/active guard protects work already entering the effect.
- Pre-pending validation is synchronous. It includes a diagnostic `console.log` containing the complete computed action state, references, and scope before the pending setter (`prepareTargetedBatchAction`, lines 2373-2386).
- Warehouse-ready path is fast: if the selected ward and matching cached/live ERF data are already ready, the pending effect can validate and clear immediately after it runs.
- Stream race protection exists: the effect re-finds the row by ID and compares `snapshotTargetedBatchRefs` through `targetedBatchRefsMatch`; it intentionally aborts if linkage changes.

## 6. Root Cause Assessment

### Confirmed root causes

1. The success branch ends the loading state before navigation is attempted. This directly violates “remain visible until navigation succeeds.”
2. The loading flag is not part of the tile's disabled condition, so duplicate taps are allowed.
3. Cleanup is distributed and inconsistent; pending and request-ref state can diverge.

### Likely contributors

- React batches `setPendingTargetedBatchAction` and the same-handler `updateGeo`. The context change can start broad provider/query and screen rerender work in the same update. There is no explicit frame boundary guaranteeing the indicator has reached the native UI before ward preparation begins.
- `WarehouseProvider` recomputes `all` when ward datasets change; `buildGeoLibrary` is part of that memo. `my-workorders.js` also recalculates `targetedBatchRows`, including an `all.erfs.find` per row, and logs mapped row/action diagnostics on streamed changes. These can consume the JS thread and delay an animation frame.
- The effect performs linear searches of streamed rows, ERFs, premises, and meters; OPEN_AST additionally constructs a `Map` over every premise. These operations occur before navigation and can delay subsequent frames, especially for large ward datasets.
- Targeted Batch streams update the RTK Query cache from both `tb_rows` and per-sales-document listeners (`src/redux/targetedBatchApi.js`, `getTargetedBatchRows.onCacheEntryAdded`). Each publish can replace row data, rerender FlashList, and retrigger row memo/effects while preparation is active.

### Unverified hypotheses

- Device-specific JS-thread saturation may prevent the initial spinner frame from being observed. Static code confirms plausible synchronous work but cannot measure frame timing.
- FlashList recycling or update scheduling may amplify the visibility issue. The code has stable keys, so static inspection does not prove a FlashList correctness defect.
- Console serialization cost may be material in the affected build/device. It is positioned before the pending setter, but its actual duration requires profiling.
- The separate OutOfMemory condition may worsen scheduling, but it is not established as the spinner defect's cause.

## 7. State Lifecycle and Clear Paths

Creation/update occurs only in `prepareTargetedBatchAction`, which replaces the full pending object for every accepted tap.

Reads occur in:

- the pending-action `useEffect` (`my-workorders.js`, lines 1280-1475);
- the render pass to `TargetedBatchRowsWorklist.openingAction` (line 2621);
- `TargetedBatchRowsWorklist.renderRow` row-ID check (line 3615);
- `TargetedBatchRowCard` intent comparisons (lines 3763-3773).

Explicit pending clears occur on:

- selected Targeted Batch ID change (lines 1170-1173; also clears request ref);
- selected bucket/row no longer matching (lines 1317-1321);
- streamed row references changing (lines 1323-1326);
- No Access becoming invalid because a field-work meter exists (lines 1343-1353; clears request ref);
- linked premise missing/wrong ERF (lines 1355-1359);
- AST missing/wrong ERF/wrong premise (lines 1361-1367);
- success before geography update/navigation (lines 1371-1372; clears request ref);
- ERF sync error (lines 1428-1438);
- ready warehouse lacking the ERF (lines 1454-1459);
- `backToBucketCategories` (lines 1828-1835);
- `backToBuckets` (lines 1837-1843).

Paths that fail to clear or clear incompletely:

- If active LM/ward never matches pending, the effect returns indefinitely. A later bucket change/back action clears it, but there is no timeout/error transition.
- If the warehouse never exits loading/syncing/refreshing, pending remains indefinitely by design, with no preparation failure boundary.
- If `targetedBatchRequestKeyRef.current !== pending.requestKey`, the effect returns without clearing pending. This can leave a stale indicator if ref/state diverge.
- A thrown exception during validation, selected-context construction, `updateGeo`, serialization, or most `router.push` calls is not covered by a common `try/finally`/failure handler.
- In the No Access branch only `router.push` is wrapped, but pending was already cleared; the catch cannot restore or reliably represent failure.
- The “Meter Discovery requires a premise” and serialization failure branches occur after the success clear. They display an alert with no common cleanup mechanism (state happens already to be clear).
- Unmount clears only the request ref. This avoids setting state on an unmounted component, but an explicit mounted/request guard should prevent late effect work.

## 8. Race Conditions and Streaming Interaction

The `getTargetedBatchRows` endpoint in `src/redux/targetedBatchApi.js` maintains a Firestore `tb_rows` listener plus listeners for referenced sales documents. `publish` rebuilds/enriches all current rows and replaces cached query data. During preparation this can:

- remove the selected row, causing the intended “row no longer available” clear;
- change linkage references, causing the intended snapshot mismatch clear;
- change action intent/value after the tap while the pending identity retains the original intent;
- replace row objects and retrigger `targetedBatchRows` calculation, diagnostics, FlashList rendering, and the preparation effect.

The rowId+reference snapshot checks are important safety controls and must remain. A minimal patch must not pause, replace, poll, or manually refresh the stream. Cleanup must be conditional on the active `requestKey`, so an older effect/failure cannot clear a newer rapid tap. The current request-key comparison protects only the success entry and is not consistently applied to every clear path.

`selectedBucket` can also be replaced from live `bucketCards` (`my-workorders.js`, effect around lines 1658-1679). The pending effect depends on the complete `selectedBucket`, so replacement retriggers it. Bucket ID validation remains necessary; context should preferably be built from the pending bucket identity plus the current matching bucket, with guarded failure if unavailable.

Pending is definitely cleared before destination mount because it is cleared before `router.push`. Navigation can be initiated in the same effect turn immediately after the clear; there is no mount acknowledgement.

## 9. Minimal Safe Patch Recommendation

Keep the existing validation, warehouse preparation, streams, and destinations unchanged. Make only these loading-feedback lifecycle changes:

1. In `WorkorderManagementSystem`, introduce a small guarded `clearPendingTargetedBatchAction(requestKey)` helper that clears both pending state and `targetedBatchRequestKeyRef` only if the key is still active. Use it on every terminal validation/preparation/navigation failure and back/bucket transition.
2. Add an active/mounted ref cleanup so late preparation work cannot navigate or clear a newer request after unmount.
3. After accepting a tap and setting pending, schedule `updateGeo` after one native paint opportunity (for example a requestAnimationFrame boundary, with cancellation on unmount/new request). This is a UI scheduling boundary only; it must not change warehouse logic. Recheck the active `requestKey` before continuing.
4. Do not clear pending before `router.push`. Wrap destination/context construction and `router.push` consistently in `try/catch`; clear on synchronous failure. On a successful push, allow source-screen unmount/blur to end ownership of the source indicator. Because Expo Router `push` is not a destination-mounted promise, do not claim await semantics it does not provide.
5. Pass `disabled={disabled || opening}` (and suppress `onPress`) within `TargetedBatchActionTile`, while preserving the visual spinner. This prevents only the active action's duplicate tap; other tiles/rows remain unaffected as required. If product intent is to prevent conflicting simultaneous preparations globally, enforce that separately in the parent, but that is broader than the stated exact-action requirement.
6. Retain rowId+intent matching and all existing row/reference/premise/AST checks. Do not touch the streaming endpoints or offline ward-pack persistence.

A destination-mounted handshake would be stronger than source unmount for absolute confirmation, but it would expand the patch across four destinations and routing contracts. For the first loading-only patch, keeping state through successful `push` and letting source unmount terminate it is the smallest safe correction. Manual tests must verify source-screen behavior when navigation is rejected or throws.

## 10. Files That Would Change

- `app/(tabs)/admin/operations/my-workorders.js` — pending lifecycle, guarded cleanup, frame boundary, failure handling, unmount guard.
- `src/features/targetedBatches/TargetedBatchActionTile.js` — disable/suppress the specific opening tile.

No other source file should change for the first patch.

## 11. Risks and Regression Concerns

- A frame boundary introduces cancellation responsibility when a new request, back action, bucket change, or unmount occurs.
- Clearing by stale closures can erase a newer request unless every terminal path checks `requestKey`.
- Keeping pending through `router.push` must not set state after unmount. Use refs/cancellation, not delayed unconditional setters.
- PREMISE has two possible intents (`OPEN_PREMISE` or the AST tile's `START_METER_DISCOVERY` is separate); tests must assert the displayed tile, not infer from destination alone.
- Existing premise and AST validation is safety-critical and must remain unchanged.
- Streaming row replacement is expected. The patch must not freeze row data or replace streaming with refetch/polling.
- Offline MMKV ERF packs may be immediately usable but carry `refreshStatus: pending/refreshing`; the spinner must remain visible through that existing refresh behavior without changing it.

## 12. Manual Test Matrix

For every case, use at least two rows and verify only the tapped row+intent spins, its value is covered, its duplicate tap is ignored, other tiles/rows do not spin, and the indicator persists until navigation leaves the source or an alert reports failure.

| Action | Setup | Expected destination/result | Required loading assertions |
|---|---|---|---|
| PREMISE | Valid row with linked premise | Premises screen with exact premise selected | PREMISE tile only; immediate paint; persists through ward preparation/navigation |
| PREMISE | Valid row without linked premise | Premises screen at exact ERF context | PREMISE tile only; validation unchanged |
| AST | Linked premise and valid linked meter | AST screen with exact meter selected | AST tile only; persists; wrong-ERF/wrong-premise meter still fails safely |
| AST | Linked premise, no meter | Meter Discovery form | AST tile only (intent `START_METER_DISCOVERY`); targeted context retained |
| NA | No field-work meter | Targeted Batch No Access screen | NA tile only; context serialization/navigation failure clears safely |
| NA | Field-work meter appears before or during preparation | “Discovery Complete” alert | No navigation; active pending clears; validation remains enforced |
| ERF | Valid referenced ERF | ERFs screen with exact ERF selected | ERF tile only; remains until source leaves |
| ERF | ERF absent after warehouse ready | ERF-not-found alert | Indicator clears and tile becomes tappable again |

Regression checks:

- Normal Meter Discovery opened outside Targeted Batch remains unchanged.
- Targeted Batch `tb_rows` and sales-document changes continue to appear live with no polling/manual refresh.
- Premise linkage mismatch and AST ERF/premise mismatch still block navigation.
- No Access remains blocked after discovery and works when allowed.
- Cached/offline ward data continues through the existing local-storage workflow; test online refresh, cached offline, and unavailable ward data.
- Force each navigation call to throw/reject in a test harness: alert appears, exact pending state clears, and retry works.
- While preparation is active, update the selected row without changing refs (indicator stays), change refs (safe abort/clear), and delete the row (safe abort/clear).
- Rapidly tap the same tile: one accepted request/navigation. Tap another action/row during preparation and confirm behavior matches the chosen parent policy without stale request cleanup affecting the latest request.
- Switch bucket/back/unmount during preparation: no late navigation and no retained request ref.
- Test target ward already active/ready and target ward requiring a new live/cached pack; both must visibly paint the first frame.

## 13. Relationship to the OutOfMemory Crash

Large warehouse arrays, context recomputation, logging, and stream-driven rerenders can plausibly delay frames and may also participate in a separate memory/performance problem. They do not explain away the confirmed premature-clear and duplicate-tap defects. The first patch should not optimize arrays, redesign WarehouseContext, alter streams, or attempt OutOfMemory remediation. Profile and remediate that later as an independent workstream.

## 14. Final Recommendation

Implement the two-file loading-only patch: guarantee a paint opportunity after setting the exact rowId+intent pending state, make the opening tile non-interactive, centralize request-key-guarded failure cleanup, and stop clearing before navigation. Preserve every current validation, stream, offline cache, and route. Validate on a physical low-end device with both a ready cached ward and a newly loading ward; static inspection establishes the lifecycle defects but device instrumentation is required to quantify the original frame delay and confirm immediate native paint.
