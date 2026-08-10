# Targeted Batch Action Spinner Assessment

## 1. Executive Summary

When a user taps a Targeted Batch row action tile (PREMISE, AST, NA, ERF), the application sets a `pendingTargetedBatchAction` state that carries `rowId` and `intent`. Each `TargetedBatchActionTile` already receives an `opening` prop derived from that state, and the tile component already contains an `ActivityIndicator` that renders conditionally when `opening === true`.

Despite this existing implementation, the spinner does not paint or remain visible reliably. **The assessment identifies two compounding root causes:**

1. **Primary – Missing `extraData` on the FlashList.** The `TargetedBatchRowsWorklist` component renders rows via `@shopify/flash-list`'s `FlashList`. The `openingAction` prop changes outside the `data` array, but `extraData` is never passed to FlashList. FlashList may therefore skip re-rendering row items when `openingAction` changes, so `TargetedBatchActionTile` never receives `opening={true}` in a committed paint.

2. **Secondary – The preparation effect clears `pendingTargetedBatchAction` synchronously after the render commit, before the native side can paint the loading frame.** In the common case where warehouse data for the target ward is already cached, the effect at line 1281 finds the ERF, validates all checks, clears pending, and navigates – all within the same effect execution. React Native may process the clearing state update before the native thread has drawn the spinner frame, making the spinner invisible or imperceptible.

**The fix is small and scoped:** add `extraData={openingAction}` to the FlashList and insert a minimal deferred clear (via `setTimeout(0)` or `InteractionManager.runAfterInteractions`) to ensure the spinner commits to screen before the clearing effect removes it.

---

## 2. Files Inspected

| # | Repository-Relative Path | Role |
|---|---|---|
| 1 | `ireps-mobile/app/(tabs)/admin/operations/my-workorders.js` | Screen: state, prepareTargetedBatchAction, main effect, TargetedBatchRowsWorklist, TargetedBatchRowCard |
| 2 | `ireps-mobile/src/features/targetedBatches/TargetedBatchActionTile.js` | Presentational tile with ActivityIndicator |
| 3 | `ireps-mobile/src/features/targetedBatches/targetedBatchActions.js` | getTargetedBatchRowActionState, snapshotTargetedBatchRefs, targetedBatchRefsMatch, TARGETED_BATCH_INTENTS |
| 4 | `ireps-mobile/src/context/GeoContext.js` | GeoContext: updateGeo, flightSignal, geoState |
| 5 | `ireps-mobile/src/context/WarehouseContext.js` | WarehouseContext: sync status, erfs loading, ward scope |
| 6 | `ireps-mobile/src/features/premises/targetedBatchPremiseContext.js` | buildTargetedBatchContextFromRow, serializeTargetedBatchContext (imported, not deeply inspected) |
| 7 | `ireps-mobile/src/features/targetedBatches/targetedBatchNoAccess.js` | buildTargetedBatchNoAccessContext (imported, not deeply inspected) |

---

## 3. Current Action Flow

### 3.1 Tap → State Sequence

```
User taps PREMISE tile
  │
  ▼
TargetedBatchActionTile.onPress
  → onAction({ bucket, row, intent: actions.premise.intent })
  │  intent = TARGETED_BATCH_INTENTS.OPEN_PREMISE
  ▼
prepareTargetedBatchAction({ bucket, row, intent })          [line 2368]
  ├─ Synchronous validation:
  │   ├─ No Access already-complete check (line 2389)
  │   ├─ Missing bucket/row/erfId check (line 2398)
  │   ├─ Scope LM/ward missing check (line 2406)
  │   ├─ Row LM scope conflict check (line 2414)
  │   ├─ Row ward scope conflict check (line 2425)
  │   ├─ Active LM mismatch check (line 2437)
  │   └─ Target ward availability check (line 2447)
  │
  ├─ Creates requestKey = `${bucket.id}__${row.id}__${++seq}`  [line 2459]
  ├─ setPendingTargetedBatchAction({ requestKey, bucketId,    [line 2462]
  │     rowId, refsSnapshot, erfId, lmPcode, wardPcode,
  │     wardName, ward, intent })
  │
  └─ updateGeo({ selectedWard: targetWard,                    [line 2474]
       selectedErf: null, selectedPremise: null,
       selectedMeter: null, lastSelectionType: "WARD" })
```

### 3.2 Effect Triggered by State Change

```
useEffect (line 1281)                                      
  deps: [pendingTargetedBatchAction, geoState?.selectedLm,
         geoState?.selectedWard, all?.erfs, all?.geoLibrary,
         all?.prems, all?.meters, targetedBatchRows,
         selectedTargetedBatchId, selectedBucket,
         warehouseLoading, warehouseSync?.erfs, router,
         updateGeo]
  │
  ├─ Guard: pending === null → return
  ├─ Guard: LM/ward mismatch → return (waits for geo update)
  ├─ Guard: warehouse not matching → return
  │
  ├─ findWarehouseErfById(all?.erfs, pending.erfId)        [line 1310]
  │
  ├─ IF warehouseErf found:
  │   ├─ Guard: requestKey stale → return
  │   ├─ Guard: row not in batch anymore → clear + alert
  │   ├─ Guard: refs mismatch → clear + alert
  │   ├─ Guard: NA discovery complete → clear + alert
  │   ├─ Guard: premise linkage error → clear + alert
  │   ├─ Guard: AST linkage error → clear + alert
  │   │
  │   ├─ setPendingTargetedBatchAction(null)               [line 1371]
  │   ├─ updateGeo({ selectedWard, selectedErf, ... })     [line 1374]
  │   ├─ router.push(destination)                          [line 1382+]
  │   └─ return
  │
  └─ IF warehouseErf NOT found:
      ├─ Guard: sync ERROR → clear + alert
      ├─ Guard: loading/syncing/refreshing → return (spinner stays)
      └─ Fallback: clear + "ERF Not Found" alert
```

### 3.3 Render Chain for Spinner Visibility

```
my-workorders re-render
  │
  ▼
TargetedBatchRowsWorklist({ openingAction: pendingTargetedBatchAction, ... })
  │
  ▼
FlashList data={rows} renderItem={renderRow}
  │
  ▼
TargetedBatchRowCard({ openingIntent: openingAction?.rowId === item?.id
                                      ? openingAction?.intent : null })
  │
  ▼
TargetedBatchActionTile({ opening: openingIntent === actions.premise.intent })
  │
  ▼
{opening ? <ActivityIndicator ... /> : <Text ...>{value}</Text>}
```

---

## 4. Existing Loading-State Implementation

### 4.1 State Definition

**File:** `ireps-mobile/app/(tabs)/admin/operations/my-workorders.js`

```javascript
// line 963
const [pendingTargetedBatchAction, setPendingTargetedBatchAction] = useState(null);
const targetedBatchRequestSequence = useRef(0);            // line 968
const targetedBatchRequestKeyRef = useRef(null);            // line 969
```

### 4.2 Propagation to Tiles

**File:** `ireps-mobile/app/(tabs)/admin/operations/my-workorders.js`

```javascript
// line 3612 – TargetedBatchRowsWorklist
openingIntent={openingAction?.rowId === item?.id ? openingAction?.intent : null}
```

```javascript
// line 3755 – TargetedBatchRowCard (PREMISE tile)
<TargetedBatchActionTile label="PREMISE" value={actions.premise.value}
  opening={openingIntent === actions.premise.intent}
  onPress={() => onAction({ bucket, row, intent: actions.premise.intent })} />
```

### 4.3 ActivityIndicator in TargetedBatchActionTile

**File:** `ireps-mobile/src/features/targetedBatches/TargetedBatchActionTile.js`

```javascript
// line 11
{opening ? <ActivityIndicator size="small" color="#2563eb" />
         : <Text style={styles.value}>{value}</Text>}
```

The `Pressable` is also disabled when `opening` is true:

```javascript
// line 6
<Pressable ... disabled={disabled || opening} onPress={onPress} ...>
```

### 4.4 Confirmed: Logic Is Correct for Row + Intent Matching

- `pendingTargetedBatchAction.intent` is set to the exact intent constant (e.g. `TARGETED_BATCH_INTENTS.OPEN_PREMISE`).
- `TargetedBatchRowCard` computes `actions = getTargetedBatchRowActionState(row)`, where `actions.premise.intent = TARGETED_BATCH_INTENTS.OPEN_PREMISE`.
- The comparison `openingIntent === actions.premise.intent` is a string equality check between two values originating from the same frozen constant object.
- `openingAction?.rowId === item?.id` ensures only the correct row's tiles receive `openingIntent`.

**The logic for isolating the correct row and correct action tile is sound.**

---

## 5. Confirmed Findings

These findings are verified against the source code.

### 5.1 `pendingTargetedBatchAction` – Creation

| Location | Event |
|---|---|
| `my-workorders.js` line 967 | Declared: `useState(null)` |
| `my-workorders.js` line 2462 | **Created** in `prepareTargetedBatchAction` with `{ requestKey, bucketId, rowId, refsSnapshot, erfId, lmPcode, wardPcode, wardName, ward, intent }` |

### 5.2 `pendingTargetedBatchAction` – Cleared

| Line | Context | Trigger |
|---|---|---|
| 1171 | `useEffect` on `[selectedTargetedBatchId]` | User navigates away from the Targeted Batch bucket |
| 1319 | Main effect – row gone | Row no longer in batch after streaming update |
| 1324 | Main effect – refs mismatch | Row linkage changed during preparation |
| 1347 | Main effect – NA already done | `fieldWorkMeterId` already linked for NA intent |
| 1357 | Main effect – premise linkage error | Premise missing or wrong ERF |
| 1365 | Main effect – AST linkage error | AST validation fails for `OPEN_AST` intent |
| 1371 | **Main effect – success path** | All validations pass; pending cleared BEFORE navigation |
| 1429 | Main effect – sync ERROR | Warehouse ERF sync failed with error |
| 1454 | Main effect – ERF not found | Ward synced but ERF missing from warehouse |
| 1830 | `backToBucketCategories()` | User navigates back to category view |
| 1839 | `backToBuckets()` | User navigates back to bucket list |

### 5.3 TargetedBatchActionTile Renders ActivityIndicator

**Confirmed.** `TargetedBatchActionTile.js` line 11 conditionally renders `<ActivityIndicator size="small" color="#2563eb" />` when `opening` is `true`. The `Pressable` is disabled via `disabled={disabled || opening}` (line 6).

### 5.4 FlashList Does Not Receive `extraData`

**Confirmed.** The FlashList in `TargetedBatchRowsWorklist` (line 3678) has these props:

```javascript
<FlashList
  data={rows}
  keyExtractor={(item, index) => item?.id || String(index)}
  renderItem={renderRow}
  estimatedItemSize={122}
  ...
/>
```

`extraData` is **absent**. This is the standard mechanism to inform FlashList/FlatList that external state (outside `data`) has changed and items must re-render.

### 5.5 Effect Clears Pending Before Navigation

**Confirmed.** At line 1371, `setPendingTargetedBatchAction(null)` executes before `updateGeo(...)` and `router.push(...)`. The clearing of `pendingTargetedBatchAction` happens in the same synchronous effect execution as navigation.

### 5.6 The File Is ~5,883 Lines

The monolithic `my-workorders.js` file is approximately 5,883 lines. This means every state change triggers a full component re-render including all inline function components (`TargetedBatchRowsWorklist`, `TargetedBatchRowCard`, `GroupDetail`, `GroupLanding`, `MdBgoErfWorklist`, `BucketTypeLanding`, `RejectModal`, etc.). While this is not a direct spinner bug, it contributes to render cost and increases the latency between state update and native paint.

---

## 6. Root Cause Assessment

### 6.1 Primary Root Cause: Missing `extraData` on FlashList

**Rating: Confirmed – likely the dominant cause**

The `@shopify/flash-list` `FlashList` component, like React Native's `FlatList`, uses internal optimizations to skip re-rendering items when only the `renderItem` function reference changes. The `openingAction` prop is state that lives **outside** the `data` array. Without `extraData={openingAction}`, FlashList has no signal that visible rows must re-render when `openingAction` changes from `null` to a pending action object.

**Result:** Even though `TargetedBatchRowsWorklist` re-renders (because its parent re-renders due to the `setPendingTargetedBatchAction` state update), the FlashList may recycle its existing row views without calling `renderRow` for them. `TargetedBatchRowCard` never receives the updated `openingIntent`, and `TargetedBatchActionTile` never receives `opening={true}`.

**Evidence:**
- `extraData` does not appear anywhere in `my-workorders.js` (grep confirmed).
- FlashList documentation states: "If your renderItem depends on state outside of the data prop, stick it here [extraData]."
- The `renderRow` function (line 3610) closes over `openingAction`, but without `extraData`, FlashList cannot distinguish this closure change from the previous one.

### 6.2 Secondary Root Cause: Effect Clears Pending in Same Tick as Paint

**Rating: Confirmed – amplifies the problem when FlashList does re-render**

Even if FlashList **does** re-render the row (e.g., due to a `data` reference change triggered by `useMemo` recalculation of `targetedBatchRows`), the `useEffect` at line 1281 runs **after the render commit but potentially before the native side paints the frame**.

When the warehouse data for the target ward is already cached (common case for returning to a previously-visited ward):

1. Render 1: Spinner appears (`pendingTargetedBatchAction` is non-null)
2. Commit: JS sends shadow tree to native
3. Effect fires: Finds ERF immediately, calls `setPendingTargetedBatchAction(null)`, calls `updateGeo`, calls `router.push`
4. Render 2: Spinner disappears, geo updates
5. Commit: JS sends new shadow tree to native
6. Native thread: May process both commits before painting, showing only the final state (no spinner)

**In React Native's Paper (old) architecture**, the bridge is asynchronous and the JS thread can queue multiple commits before the native thread processes any of them. The intermediate render (with spinner) can be completely "swallowed" by the native side.

**In React Native's Fabric (new) architecture**, effects run after mount which is synchronous with the native side. The native side should process the first commit before the JS thread runs the effect. However, the timing is still extremely tight (sub-millisecond for cached data), and the spinner may appear for a single imperceptible frame.

### 6.3 Contributing Factor: No Deferred Clear

**Rating: Confirmed**

There is no mechanism to ensure the spinner remains visible for at least one paint frame. The clearing of `pendingTargetedBatchAction` (line 1371) happens in the same synchronous effect execution as the navigation trigger. No `setTimeout`, `requestAnimationFrame`, or `InteractionManager.runAfterInteractions` is used.

### 6.4 Causes Evaluated and Ruled Out

| Potential Cause | Assessment | Reason |
|---|---|---|
| `updateGeo` blocks render | Ruled out | `updateGeo` is a `setGeoState` call; state updates are batched in React 18, not synchronous blocking. |
| `WarehouseContext` changes block render | Ruled out | Context changes cause re-renders, not synchronous work. RTK Query fetches are async. |
| Ward warehouse preparation is sync-blocking | Ruled out | Warehouse sync uses RTK Query hooks which are async. |
| Large array searches block render | Ruled out | `findWarehouseErfById` and `findWardByPcode` are O(n) but operate on small arrays (wards/ERFs in a single ward). Not a blocking concern. |
| Large `console.log` blocks render | Unlikely | Console logging is synchronous but runs BEFORE the state update that triggers render. Does not block the spinner frame. |
| Streamed query re-renders block spinner | Ruled out | Streaming updates trigger re-renders, but they don't prevent the spinner from painting. They could cause the "row changed" guard to fire (line 1324), which is a different issue. |
| FlashList re-renders are too slow | Unlikely | FlashList is designed for performance. The row card is simple. |
| `selectedBucket` replacement clears pending | Ruled out | `selectedBucket` does not change during action preparation flow. |
| `targetedBatchRows` recalculation interferes | Unlikely | The `useMemo` for `targetedBatchRows` depends on `all?.erfs` and `all?.geoLibrary`, which don't change during action preparation. |
| GeoContext selection changes clear pending | Ruled out | GeoContext doesn't clear `pendingTargetedBatchAction` directly. |

---

## 7. State Lifecycle and Clear Paths

### 7.1 Complete Clear-Path Inventory

| # | Code Location | Condition | Safety Assessment |
|---|---|---|---|
| 1 | Line 1171, `useEffect([selectedTargetedBatchId])` | `selectedTargetedBatchId` changes (user leaves batch) | ✓ Safe – correct cleanup |
| 2 | Line 1319 | Row no longer exists in `targetedBatchRows` | ✓ Safe – handles streaming deletion |
| 3 | Line 1324 | `targetedBatchRefsMatch` fails | ✓ Safe – handles concurrent linkage changes |
| 4 | Line 1347 | NA intent but `fieldWorkMeterId` already exists | ✓ Safe – prevents duplicate NA |
| 5 | Line 1357 | Premise linkage error | ✓ Safe – validation failure |
| 6 | Line 1365 | AST linkage error | ✓ Safe – validation failure |
| 7 | Line 1371 | **All validations pass (success)** | ⚠️ Clears before native paint possible |
| 8 | Line 1429 | Warehouse sync ERROR status | ✓ Safe – error handling |
| 9 | Line 1454 | ERF not found in synced warehouse | ✓ Safe – error handling |
| 10 | Line 1830 | `backToBucketCategories()` | ✓ Safe – explicit navigation |
| 11 | Line 1839 | `backToBuckets()` | ✓ Safe – explicit navigation |

### 7.2 Clear Paths That Fail to Clear

No paths were identified that fail to clear `pendingTargetedBatchAction` after a terminal state. However, **there is no clear path for screen unmount without explicit back navigation**. The cleanup effect at line 1178 only clears `targetedBatchRequestKeyRef`:

```javascript
useEffect(() => () => {
    targetedBatchRequestKeyRef.current = null;  // line 1178
}, []);
```

If the `my-workorders` screen unmounts while a pending action exists (e.g., the user force-closes the app or a crash occurs), `pendingTargetedBatchAction` is lost with the component state – this is acceptable. However, if the screen stays mounted during tab navigation (common with `expo-router` tabs), the pending action could persist. The per-intent navigation uses `router.push` to different tabs (`/(tabs)/premises`, `/(tabs)/erfs`, `/(tabs)/asts`), which may or may not unmount `my-workorders` depending on the tab layout configuration.

**If tabs keep the screen mounted**, returning to the my-workorders tab would show a stale spinner. However, this is a minor edge case because the effect at line 1281 clears pending before navigation in the success path, and the `selectedTargetedBatchId` effect (line 1171) clears it when the bucket changes.

---

## 8. Race Conditions and Streaming Interaction

### 8.1 Streaming Row Updates During Preparation

The `targetedBatchRows` array (line 1216) is a `useMemo` derived from `targetedBatchRowsData?.rows` (RTK Query streaming data). When the server streams updated rows while `pendingTargetedBatchAction` is non-null:

**Race 1: Row deleted from stream**
- Guard at line 1317: `!currentRow` → clears pending with alert "Targeted Batch row no longer available."
- ✓ Handled correctly.

**Race 2: Row refs changed by stream**
- Guard at line 1322: `!targetedBatchRefsMatch(currentRow, pending.refsSnapshot)` → clears pending with alert.
- ✓ Handled correctly.

**Race 3: Row fields changed (but refs unchanged)**
- No guard for this. The `getTargetedBatchRowActionState` could return different values for `actions.premise.value`, `actions.ast.disabled`, etc.
- However, `openingIntent` comparison still works because `pending.intent` and `actions.*.intent` are both from the frozen constants.
- ⚠️ **Potential issue:** If `actions.ast.disabled` changes from `false` to `true` during preparation for an AST tap, the tile would show as disabled AND spinning. The `opening={true}` still shows the spinner (via `disabled || opening` on the Pressable), so the user sees feedback, but the disabled state could be confusing.
- **Severity:** Low. The refs guard catches the important case (linkage change).

**Race 4: `targetedBatchRows` memo recalculation causes FlashList `data` reference change**
- When `all?.erfs` or `all?.geoLibrary` changes (e.g., warehouse finishes syncing), `targetedBatchRows` is recalculated (new array reference). This changes `rows` → FlashList sees new `data` → FlashList re-renders all items.
- In this specific case, the FlashList DOES re-render items (because `data` changed), and the spinner would appear. But the same render cycle that updated `all?.erfs` also triggers the effect at line 1281 (via `all?.erfs` dep), which clears pending.
- **Net effect:** Spinner becomes visible only at the exact moment warehouse data arrives, then immediately clears. User sees a brief flash at best.

### 8.2 Concurrent Taps (Duplicate Prevention)

The `TargetedBatchActionTile` disables its `Pressable` when `opening` is `true`:

```javascript
<Pressable ... disabled={disabled || opening} onPress={onPress}>
```

However, this only prevents taps on the SAME tile. It does not prevent:
- Tapping a different action on the same row
- Tapping an action on a different row

**Tapping a different action on the same row:**
- `prepareTargetedBatchAction` would be called again with a new intent.
- A new `requestKey` is generated (via `++targetedBatchRequestSequence.current`).
- `setPendingTargetedBatchAction` overwrites the previous pending action.
- The old pending's requestKey guard at line 1314 (`targetedBatchRequestKeyRef.current !== pending.requestKey`) causes the old request to abort silently.
- The new pending action proceeds normally.
- ⚠️ **Risk:** If the user rapidly taps PREMISE then AST on the same row, the PREMISE preparation is dropped silently, and AST preparation proceeds. This is probably acceptable.

**Tapping an action on a different row:**
- Same mechanism as above. The new pending overwrites the old. The old request's key check fails.
- ⚠️ **Risk:** User could accidentally cancel one action by tapping another. Would be better to block all actions while any is pending.

### 8.3 GeoContext `flightSignal` Cascade

`updateGeo` (line 2474 in `prepareTargetedBatchAction`) bumps `flightSignal` in GeoContext. This triggers re-renders in every `useGeo()` consumer, including WarehouseContext. WarehouseContext may start/restart RTK Query fetches based on the new ward. These are asynchronous and do not block the JS thread, but they queue additional state updates that can cause:

- Additional re-renders of `my-workorders`
- Additional FlashList item re-renders
- Additional effect executions

This cascade does **not** prevent the spinner from appearing but adds noise to the render cycle.

---

## 9. Minimal Safe Patch Recommendation

### 9.1 Patch Strategy

The fix addresses both root causes with minimal, targeted changes. It modifies **only** the `my-workorders.js` file.

### 9.2 Change 1: Add `extraData` to FlashList

**Location:** `TargetedBatchRowsWorklist` function, FlashList JSX (approximately line 3678)

**Current:**
```jsx
<FlashList
  data={rows}
  keyExtractor={(item, index) => item?.id || String(index)}
  renderItem={renderRow}
  estimatedItemSize={122}
  ...
/>
```

**Patched:**
```jsx
<FlashList
  data={rows}
  extraData={openingAction}
  keyExtractor={(item, index) => item?.id || String(index)}
  renderItem={renderRow}
  estimatedItemSize={122}
  ...
/>
```

**Effect:** FlashList will re-render visible rows whenever `openingAction` changes, ensuring `TargetedBatchActionTile` receives `opening={true}`.

### 9.3 Change 2: Defer the Success-Path Clear of `pendingTargetedBatchAction`

**Location:** Main `useEffect` at line 1371

**Current:**
```javascript
// line 1371
setPendingTargetedBatchAction(null);
targetedBatchRequestKeyRef.current = null;

updateGeo({
  selectedWard: pending.ward,
  selectedErf,
  selectedPremise: premise || null,
  selectedMeter: pending.intent === TARGETED_BATCH_INTENTS.OPEN_AST ? meter : null,
  lastSelectionType: ...,
});

if (pending.intent === TARGETED_BATCH_INTENTS.OPEN_ERF) router.push("/(tabs)/erfs");
else if (...) ...
```

**Patched:**
```javascript
// Keep the spinner visible until navigation commits.
// InteractionManager.runAfterInteractions defers the clear
// until after the native transition/animation frame.
import { InteractionManager } from "react-native";

// Inside the success path of the effect:
InteractionManager.runAfterInteractions(() => {
  setPendingTargetedBatchAction(null);
  targetedBatchRequestKeyRef.current = null;
});

updateGeo({
  selectedWard: pending.ward,
  selectedErf,
  selectedPremise: premise || null,
  selectedMeter: pending.intent === TARGETED_BATCH_INTENTS.OPEN_AST ? meter : null,
  lastSelectionType: ...,
});

if (pending.intent === TARGETED_BATCH_INTENTS.OPEN_ERF) router.push("/(tabs)/erfs");
else if (...) ...
```

**Alternative (simpler, if `InteractionManager` is undesirable):**
```javascript
// Use setTimeout as a minimal deferral:
setTimeout(() => {
  setPendingTargetedBatchAction(null);
  targetedBatchRequestKeyRef.current = null;
}, 0);
```

**Effect:** The spinner remains committed to the native side for at least one frame before being cleared. Navigation still proceeds immediately (no delay added to navigation).

### 9.4 Change 3 (Optional Safety): Guard Against Overwrite Taps

If desired, add a guard at the top of `prepareTargetedBatchAction` to reject new taps while a pending action exists:

```javascript
function prepareTargetedBatchAction({ bucket, row, intent }) {
  // Block new actions while one is already preparing
  if (pendingTargetedBatchAction) {
    return;
  }
  // ... rest of function
}
```

**Note:** This requires accessing `pendingTargetedBatchAction` from inside `prepareTargetedBatchAction`. Since it's a closure over the state, the stale closure problem applies. Use a ref (`pendingTargetedBatchActionRef`) that mirrors the state for synchronous reads inside the handler.

### 9.5 What Is NOT Changed

- No routing redesign
- No Firestore changes
- No API changes
- No streaming changes
- No local-storage changes
- No Meter Discovery changes
- No premise/AST validation weakening
- No performance optimisation
- No Warehouse redesign
- No OutOfMemory remediation
- No polling or manual refresh introduction
- No removal of safety validations

---

## 10. Files That Would Change

| # | File | Change |
|---|---|---|
| 1 | `ireps-mobile/app/(tabs)/admin/operations/my-workorders.js` | Add `extraData={openingAction}` to FlashList in `TargetedBatchRowsWorklist` |
| 2 | `ireps-mobile/app/(tabs)/admin/operations/my-workorders.js` | Defer `setPendingTargetedBatchAction(null)` in the success path of the main effect (line 1371) |
| 3 | `ireps-mobile/app/(tabs)/admin/operations/my-workorders.js` | (Optional) Add `pendingTargetedBatchActionRef` and guard in `prepareTargetedBatchAction` |

**No other source files need modification.**

---

## 11. Risks and Regression Concerns

### 11.1 `extraData` Risk

- **Risk:** FlashList may re-render MORE items than necessary, increasing render cost.
- **Mitigation:** `openingAction` changes infrequently (only on user tap and clear). The re-render cost is negligible compared to the benefit of correct UI feedback. FlashList is designed to handle `extraData` efficiently.

### 11.2 Deferred Clear Risk

- **Risk (InteractionManager):** If the user navigates away and back quickly, the deferred `setPendingTargetedBatchAction(null)` could fire on an unmounted component. React 18 handles this gracefully (state updates on unmounted components are no-ops), but it's messy.
- **Mitigation:** Use the `targetedBatchRequestKeyRef` to check whether the pending action is still the current one before clearing:
  ```javascript
  const currentKey = pending.requestKey;
  InteractionManager.runAfterInteractions(() => {
    if (targetedBatchRequestKeyRef.current === currentKey) {
      setPendingTargetedBatchAction(null);
      targetedBatchRequestKeyRef.current = null;
    }
  });
  ```
- **Risk (setTimeout):** A `setTimeout(0)` deferred clear could fire between navigation frames, causing a brief flash of the spinner on the destination screen if the tab keeps `my-workorders` mounted. This is cosmetic and unlikely to be noticed.

### 11.3 Existing Guards Still Function

All existing safety guards (requestKey check, refs match, row presence, premise/AST validation, NA complete check) remain untouched. The spinner still clears on validation failure (the error paths at lines 1319, 1324, 1347, 1357, 1365, 1429, 1454 are not deferred).

---

## 12. Manual Test Matrix

### 12.1 Action-Specific Tests

| # | Action | Steps | Expected Behavior |
|---|---|---|---|
| P1 | PREMISE | Tap PREMISE on a row without a linked premise | Spinner appears immediately inside PREMISE tile. Stays visible while warehouse syncs. Clears when navigation to premises screen occurs. |
| P2 | PREMISE | Tap PREMISE on a row with a linked premise | Spinner appears immediately. Navigates to premises screen with premise pre-selected. Spinner clears. |
| P3 | PREMISE | Tap PREMISE, then tap PREMISE again (double-tap) | Second tap is ignored (Pressable disabled while `opening={true}`). Only one navigation occurs. |
| A1 | AST | Tap AST on a row with linked meter | Spinner appears in AST tile. Navigates to AST screen. Spinner clears. |
| A2 | AST | Tap AST on a row without meter ("DISCOVER" state) | Spinner appears in AST tile. Navigates to Meter Discovery (premises/form). Spinner clears. |
| A3 | AST | Tap AST on a row with LINKAGE ISSUE | Tile is disabled, tap does nothing. No spinner. |
| A4 | AST | Tap AST on a row with "PREMISE REQUIRED" helper | Tile is disabled, tap does nothing. No spinner. |
| N1 | NA | Tap NA on a row without fieldWorkMeterId | Spinner appears in NA tile. Navigates to No Access screen. Spinner clears. |
| N2 | NA | Tap NA on a row with DISCOVERY COMPLETE | Tile is disabled, tap does nothing. No spinner. |
| N3 | NA | Tap NA on a row where meter already linked | Alert "A meter is already linked." No navigation. Pending cleared. |
| E1 | ERF | Tap ERF on a valid row | Spinner appears in ERF tile. Navigates to ERF screen. Spinner clears. |
| E2 | ERF | Tap ERF on a row without erfId | Tile is disabled, tap does nothing. No spinner. |

### 12.2 Cross-Row and Multi-Tap Tests

| # | Test | Steps | Expected Behavior |
|---|---|---|---|
| X1 | Different row | Tap PREMISE on row 1, observe, then tap PREMISE on row 2 | Row 1 spinner appears and later clears. Row 2 spinner appears (or row 1 is cancelled and row 2 starts). No crash. |
| X2 | Rapid alternating taps | Rapidly tap PREMISE on row 1, then AST on row 1 | First tap wins (spinner on PREMISE). Second tap either ignored (if spinner blocks) or overwrites. Only one navigation. |
| X3 | Tap during streaming | Tap PREMISE while rows are actively streaming in | Spinner appears. If the target row is deleted by stream, spinner clears with alert. If row changes but refs match, operation proceeds normally. |

### 12.3 Regression Checks

| # | Area | Test | Expected Behavior |
|---|---|---|---|
| R1 | Meter Discovery | From TBB row, tap AST (DISCOVER) → navigate to premises/form | Meter Discovery works normally. Targeted batch context is passed. |
| R2 | Targeted Batch streaming | Open a TBB bucket, wait for rows to stream in | Rows appear incrementally. No interruption from action preparation. |
| R3 | Premise validation | Tap PREMISE on a row with broken premise linkage | Alert "Premise Linkage Error." Spinner clears. No navigation. |
| R4 | AST validation | Tap AST on a row with broken AST linkage | Alert "AST Linkage Error." Spinner clears. No navigation. |
| R5 | No Access | Tap NA on a valid row | Navigate to No Access screen with correct context. |
| R6 | Offline/local-storage | Enable airplane mode, tap an action | Should fail gracefully. Pending should clear on error. |
| R7 | Navigation failure | Force navigation to fail (e.g., invalid route) | Pending should clear. No stuck spinner. |
| R8 | Streamed row updates during preparation | Have server push a row update while pending is active | If refs changed: alert + spinner clears. If refs unchanged: operation proceeds. |
| R9 | Repeated rapid taps | Rapidly tap the same action 5+ times | Only the first tap triggers preparation. No duplicate navigations. No crash. |
| R10 | Back navigation during preparation | Tap action, then quickly tap "Buckets" back button | Pending is cleared by `backToBuckets()`. Spinner disappears. No stuck state. |
| R11 | Ward change during preparation | Not applicable in current flow (ward is set by prepareTargetedBatchAction) | N/A |
| R12 | Different bucket selected during preparation | Cannot happen because bucket selection triggers `backToBuckets` which clears pending | N/A |

---

## 13. Relationship to the OutOfMemory Crash

### 13.1 Assessment

The OutOfMemory crash is a **separate workstream** and is not caused by the spinner/state behavior described in this report.

However, there is a tangential relationship worth noting:

- The monolithic `my-workorders.js` file (5,883 lines) contains many inline components, effects, and memos. Every state change during action preparation triggers a full re-render of this component tree.
- If a memory-intensive operation (e.g., loading large warehouse datasets) coincides with action preparation, the combined memory pressure could contribute to OOM conditions.
- The `console.log` at line 1243 (`[MY WORKORDERS][TB ROW ACTION STATE]`) logs the full action state of every row. With many rows, this creates a large object in the JS heap on every `targetedBatchRows` change. This is unrelated to the spinner but contributes to memory pressure.

### 13.2 Recommendation

**Do not combine the spinner fix with OOM remediation.** The spinner fix is a 2-3 line change. The OOM fix requires a separate, thorough investigation of memory usage patterns, component splitting, and console log reduction.

---

## 14. Final Recommendation

### 14.1 Summary

The loading spinner mechanism is architecturally present and logically correct, but two implementation gaps prevent it from working:

1. **Missing `extraData` on FlashList** prevents the list from re-rendering items when `openingAction` changes.
2. **Synchronous clearing of `pendingTargetedBatchAction`** in the preparation effect removes the spinner before the native side can paint it.

### 14.2 Confidence

| Finding | Confidence | Basis |
|---|---|---|
| Spinner logic is correct for row+intent isolation | High | Code inspection confirms string equality on shared constants |
| FlashList `extraData` is missing | High | Grep confirmed zero instances in file; this is a documented FlashList/FlatList requirement |
| Effect clears pending synchronously | High | Line 1371 is a direct `setPendingTargetedBatchAction(null)` before `router.push` |
| React Native may swallow intermediate render | Medium-High | Well-documented behavior of RN Paper architecture; Fabric improves this but not guaranteed |
| Spinner cannot paint due to missing `extraData` | High | Without `extraData`, FlashList has no reason to re-render unchanged `data` items |
| Both causes must be fixed | High | Fixing only one leaves the spinner unreliable |

### 14.3 Recommended Implementation Order

1. Add `extraData={openingAction}` to the FlashList (one line, zero risk)
2. Defer the success-path `setPendingTargetedBatchAction(null)` using `InteractionManager.runAfterInteractions` or `setTimeout(0)` (two lines, low risk)
3. Test per the matrix in Section 12
4. (Separate workstream) Address the OutOfMemory crash

---

*Assessment completed by deepseek. No source files were modified. No Git actions were performed. No Firebase deployments were executed.*
