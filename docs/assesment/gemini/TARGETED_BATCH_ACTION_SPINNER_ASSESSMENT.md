# Targeted Batch Action Spinner Assessment

**Agent Name:** gemini  
**Assessment Date:** 2026-08-05  
**Active Mobile Repository:** `C:\dev\ireps-mobile`  
**Report Repository:** `C:\dev\ireps-web`  
**Target File Path:** `C:\dev\ireps-web\docs\assesment\gemini\TARGETED_BATCH_ACTION_SPINNER_ASSESSMENT.md`

---

## 1. Executive Summary

This read-only technical assessment investigates a UI responsiveness and loading-feedback defect in the **iREPS Mobile** application on the **My Workorders** screen (`C:\dev\ireps-mobile\app\(tabs)\admin\operations\my-workorders.js`). 

When a user taps any of the four Targeted Batch row action tiles (**PREMISE**, **AST**, **NA**, or **ERF**):
1. The tap is accepted.
2. Preparation work (validation, geographical context updates, warehouse lookup) is performed.
3. Navigation eventually occurs.
4. During the delay, the UI appears silent or frozen, with no visible spinner painting on the tapped action tile.

### Key Finding
The spinner implementation is **not missing**. The `TargetedBatchActionTile` component (`src/features/targetedBatches/TargetedBatchActionTile.js`) already contains an `ActivityIndicator` and correctly receives `opening = true` when `pendingTargetedBatchAction` matches the tile's `rowId` and `intent`. 

The spinner fails to paint visibly or remain visible to the user for two primary technical reasons:

1. **JavaScript Thread Saturation & Lack of Paint Frame Yield:** When a tile is tapped, `prepareTargetedBatchAction` invokes `setPendingTargetedBatchAction(...)` and immediately executes heavy synchronous context work (`updateGeo(...)`, geographical calculations, RTK Query selector re-evaluations, and verbose string console logging) in the exact same event loop tick. The single React Native JS thread is saturated before it can yield control to the native thread to paint the `<ActivityIndicator>` frame.
2. **Synchronous Immediate Reset of Loading State Before Navigation Finishes:** When the batch's ward is already the active workbase ward (the standard operational state), the `useEffect` watching `pendingTargetedBatchAction` resolves instantly in the same/next microtask cycle and calls `setPendingTargetedBatchAction(null)` on line 1371 **before** initiating `router.push(...)`. Consequently, `pendingTargetedBatchAction` is reset to `null` while `my-workorders.js` is still mounted and visible, causing the tile to revert to its static value while navigation is pending.

---

## 2. Files Inspected

The following source files within `C:\dev\ireps-mobile` were inspected to trace and analyze the issue:

1. `app/(tabs)/admin/operations/my-workorders.js`
   - Defines screen state, `pendingTargetedBatchAction` hook, action handler (`prepareTargetedBatchAction`), resolution `useEffect`, and components `TargetedBatchRowsWorklist` and `TargetedBatchRowCard`.
2. `src/features/targetedBatches/TargetedBatchActionTile.js`
   - Action tile UI component rendering `ActivityIndicator` when `opening === true`.
3. `src/features/targetedBatches/targetedBatchActions.js`
   - Action helper utilities defining `TARGETED_BATCH_INTENTS`, `getTargetedBatchRowActionState`, `snapshotTargetedBatchRefs`, and `targetedBatchRefsMatch`.
4. `src/features/targetedBatches/targetedBatchNoAccess.js`
   - Context builder for the No Access workflow (`buildTargetedBatchNoAccessContext`).
5. `src/features/premises/targetedBatchPremiseContext.js`
   - Context builder and serializer for Targeted Batch Meter Discovery (`buildTargetedBatchContextFromRow`, `serializeTargetedBatchContext`).
6. `src/context/GeoContext.js`
   - Context provider managing active municipality and ward state via `updateGeo`.
7. `src/context/WarehouseContext.js`
   - Central warehouse provider managing ward ERF, Premise, AST, and TRN data and selector calculations.
8. Repository Governance Documents:
   - `C:\dev\ireps-mobile\skills.md`
   - `C:\dev\ireps-web\skills.md`

---

## 3. Current Action Flow

The complete execution sequence from user tap to screen navigation is structured as follows:

```
[ User Taps Tile (PREMISE / AST / NA / ERF) ]
                    │
                    ▼
TargetedBatchActionTile.onPress
                    │
                    ▼
TargetedBatchRowCard.onAction({ bucket, row, intent })
                    │
                    ▼
my-workorders.js :: prepareTargetedBatchAction({ bucket, row, intent })
  ├── 1. Perform synchronous validation (disabled check, row ready, LM & Ward scope matching, active workbase check)
  ├── 2. setPendingTargetedBatchAction({ requestKey, bucketId, rowId, refsSnapshot, erfId, lmPcode, wardPcode, wardName, ward, intent })
  └── 3. updateGeo({ selectedWard: targetWard, selectedErf: null, selectedPremise: null, selectedMeter: null, lastSelectionType: "WARD" })  <-- Synchronous
                    │
                    ▼
React State Batching & Effect Queue
                    │
                    ▼
my-workorders.js :: useEffect [watching pendingTargetedBatchAction] (Lines 1280–1475)
  ├── 1. Validate active LM & Ward match pending scope
  ├── 2. Validate warehouse sync status & find warehouse ERF (findWarehouseErfById)
  ├── 3. Verify row still exists & refs match (targetedBatchRefsMatch)
  ├── 4. Validate linkage constraints (Premise & AST presence/belonging)
  ├── 5. setPendingTargetedBatchAction(null)  <-- CLEARS SPINNER IMMEDIATELY (Line 1371)
  ├── 6. updateGeo(...) with target entity (Erf / Premise / Meter)
  └── 7. router.push(destinationPath) (e.g. /premises, /asts, /erfs, /premises/form, /targeted-batch-no-access)
```

---

## 4. Existing Loading-State Implementation

### Component Level (`TargetedBatchActionTile.js`)
`TargetedBatchActionTile` accepts the `opening` prop (boolean, default `false`).
Lines 4–15 of `src/features/targetedBatches/TargetedBatchActionTile.js`:

```javascript
export default function TargetedBatchActionTile({ label, value, helperText, icon, tone = "default", disabled = false, opening = false, onPress }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled || opening} onPress={onPress} style={...}>
      <View style={styles.labelRow}>...</View>
      {opening ? <ActivityIndicator size="small" color="#2563eb" /> : <Text style={styles.value}>{value}</Text>}
      {helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
    </Pressable>
  );
}
```

### Screen & Prop Binding Level (`my-workorders.js`)
1. **State Declaration (Line 966):**
   `const [pendingTargetedBatchAction, setPendingTargetedBatchAction] = useState(null);`
2. **Worklist Prop Passing (Lines 2611–2622):**
   `<TargetedBatchRowsWorklist ... openingAction={pendingTargetedBatchAction} />`
3. **Card Intent Matching (Line 3615):**
   `openingIntent={openingAction?.rowId === item?.id ? openingAction?.intent : null}`
4. **Tile Prop Binding (Lines 3763–3773):**
   - **PREMISE:** `opening={openingIntent === actions.premise.intent}`
   - **AST:** `opening={openingIntent === actions.ast.intent}`
   - **NA:** `opening={openingIntent === actions.noAccess.intent}`
   - **ERF:** `opening={openingIntent === actions.erf.intent}`

**Conclusion:** The prop binding architecture correctly targets only the exact row and exact action intent selected.

---

## 5. Confirmed Findings

1. **Confirmed Fact:** `TargetedBatchActionTile.js` contains a valid `<ActivityIndicator size="small" color="#2563eb" />` component which renders when `opening === true`.
2. **Confirmed Fact:** `TargetedBatchRowCard` computes `openingIntent` by comparing `openingAction.rowId === item.id`. Only the specific tile whose `intent` matches `openingAction.intent` receives `opening = true`.
3. **Confirmed Fact:** When `prepareTargetedBatchAction` is invoked (line 2462), `setPendingTargetedBatchAction({...})` and `updateGeo({...})` are executed synchronously in the exact same event handler.
4. **Confirmed Fact:** In the standard workflow where the user is working within their active ward, `targetWarehouseMatches` evaluates to `true` on the initial execution of the `pendingTargetedBatchAction` `useEffect` (line 1280).
5. **Confirmed Fact:** Inside `useEffect`, `setPendingTargetedBatchAction(null)` is called on line 1371 **before** `router.push(...)` is called.
6. **Confirmed Fact:** When `setPendingTargetedBatchAction(null)` is called on line 1371, `openingAction` immediately becomes `null`, forcing `opening = false` across all action tiles while `my-workorders.js` remains mounted during router transition.

---

## 6. Root Cause Assessment

### Primary Root Cause 1: Premature Reset of Loading State Before Navigation Completes
In `my-workorders.js` line 1371, `setPendingTargetedBatchAction(null)` is invoked synchronously inside the `useEffect` right before calling `router.push(...)`. Because Expo Router screen navigation is asynchronous and mounting the target route takes multiple frame ticks, clearing `pendingTargetedBatchAction` back to `null` immediately removes the `<ActivityIndicator>` from the DOM. The user sees the spinner vanish (or never paint) while the current screen remains active and unresponsive.

### Primary Root Cause 2: Single JS Thread Saturation & Lack of Frame Yield
When a user taps an action tile, `prepareTargetedBatchAction` executes:
1. `setPendingTargetedBatchAction({...})`
2. `updateGeo({...})` synchronously in the same callback block.

Calling `updateGeo` triggers an immediate cascade of state updates:
- `GeoContext` updates `selectedWard` and increments `flightSignal`.
- `WarehouseProvider` (`src/context/WarehouseContext.js`) re-evaluates RTK Query hooks and runs heavy data selector functions: `buildGeoLibrary`, `selectFilteredErfs`, `selectFilteredPrems`, `selectFilteredMeters`, and `selectFilteredTrns`.
- `my-workorders.js` re-evaluates `targetedBatchRows` `useMemo` (which loops over all rows, matches ERFs, and formats strings).
- `my-workorders.js` executes verbose logging (`console.log('[MY WORKORDERS][TB ROW ACTION STATE]', ...)`), stringifying full state trees for all rows in the batch.

Because all of this work happens synchronously within the single React Native JS thread, the thread remains 100% occupied and cannot yield to the native UI/compositor thread to paint the intermediate frame where `opening === true`.

### Delay / Blocking Matrix Analysis

| Operational Factor | Can Block/Delay Spinner Paint? | Assessment & Mechanism |
| :--- | :--- | :--- |
| `updateGeo` | **YES** | Triggers immediate `GeoContext` update & `flightSignal` increment in the tap tick. |
| `WarehouseContext` changes | **YES** | Causes full re-execution of warehouse selectors (`buildGeoLibrary`, etc.). |
| Ward warehouse preparation | **YES** | If ward ERFs are loading (`syncStatus === 'syncing'`), delays resolution until RTK query completes. |
| Large array searches | **YES** | `findWarehouseErfById`, `findPremise`, `findMeter` execute array searches across ward datasets. |
| Large console logging | **YES** | Lines 1249–1278 log the entire formatted row array on state changes. |
| Streamed query rerenders | **YES** | Inbound Firestore snapshot updates force re-calculation of `targetedBatchRows`. |
| `FlashList` rerenders | **YES** | FlashList re-renders item rows upon state/context mutation. |
| `selectedBucket` replacement | **NO** | `selectedBucket` remains static during row action taps. |
| `targetedBatchRows` recalculation | **YES** | `useMemo` re-calculates mapped rows on `all.erfs` or data updates. |
| `GeoContext` selection changes | **YES** | Synchronous mutation of `geoState` cascades through all subscribed providers. |

---

## 7. State Lifecycle and Clear Paths

### Creation Path
- **Line 2462 (`my-workorders.js`):** `setPendingTargetedBatchAction({ requestKey, bucketId, rowId, refsSnapshot, erfId, lmPcode, wardPcode, wardName, ward, intent })`.

### Read Paths
- **Line 1281 (`my-workorders.js`):** `const pending = pendingTargetedBatchAction;` (inside resolution `useEffect`).
- **Line 2621 (`my-workorders.js`):** `openingAction={pendingTargetedBatchAction}` (passed to `TargetedBatchRowsWorklist`).

### All Existing Clear Paths

| Line # in `my-workorders.js` | Trigger / Condition | Context |
| :--- | :--- | :--- |
| **Line 1171** | `useEffect [selectedTargetedBatchId]` | Cleared when switching Targeted Batches. |
| **Line 1319** | `selectedTargetedBatchId !== pending.bucketId \|\| !currentRow` | Cleared if selected batch or row is missing. |
| **Line 1324** | `!targetedBatchRefsMatch(currentRow, pending.refsSnapshot)` | Cleared if row refs change during preparation. |
| **Line 1347** | `intent === RECORD_NO_ACCESS && fieldWorkMeterId` | Cleared if No Access disabled (meter already linked). |
| **Line 1357** | `premiseId && (!premise \|\| getPremiseErfId !== erfId)` | Cleared on Premise linkage mismatch. |
| **Line 1365** | `intent === OPEN_AST && linkage mismatch` | Cleared on AST linkage mismatch. |
| **Line 1371** | Pre-navigation success path | **Prematurely clears state right before `router.push`.** |
| **Line 1429** | `syncStatus === "ERROR"` | Cleared when ward ERF sync fails. |
| **Line 1454** | `warehouseErf` not found after sync | Cleared when ERF is missing in ward. |
| **Line 1830** | `backToBucketCategories()` | Cleared when navigating back to landing. |
| **Line 1839** | `backToBuckets()` | Cleared when navigating back to buckets list. |

### Missing Clear Paths
- **Component Unmount / Blur:** The cleanup function in line 1175 (`useEffect(() => () => { targetedBatchRequestKeyRef.current = null; }, [])`) resets the request key ref but **fails** to clear `pendingTargetedBatchAction`. If the screen unmounts while an action is pending, `pendingTargetedBatchAction` remains in state.

---

## 8. Race Conditions and Streaming Interaction

### 1. Live Targeted Batch Streaming Interaction
`useGetTargetedBatchRowsQuery` (lines 1107–1114) establishes a live Firestore `onSnapshot` stream for rows. 

If a stream update arrives while `pendingTargetedBatchAction` is active:
1. `targetedBatchRowsData` updates.
2. `targetedBatchRows` `useMemo` re-computes.
3. The resolution `useEffect` (line 1280) re-runs.
4. Line 1323 checks `targetedBatchRefsMatch(currentRow, pending.refsSnapshot)`.
   - If the row was modified or deleted by another user, `targetedBatchRefsMatch` returns `false`, safely aborting the action via `setPendingTargetedBatchAction(null)` and displaying an `Alert` ("Targeted Batch row changed").
   - If the row update did not alter core refs (`erfId`, `premiseId`, `meterId`, `trnId`), preparation continues seamlessly.

### 2. Rapid Tap Race Conditions
- **Same Tile Taps:** In `TargetedBatchActionTile.js` (line 6), `disabled={disabled || opening}` prevents triggering `onPress` while `opening === true`.
- **Different Tile Taps on Same/Other Rows:** In `prepareTargetedBatchAction` (lines 2368–2486), there is currently **no early guard** checking `if (pendingTargetedBatchAction) return;`. If a user rapidly taps another action tile before React processes `setPendingTargetedBatchAction`, a new action request key is generated, overwriting the pending state.

---

## 9. Minimal Safe Patch Recommendation

To resolve the loading feedback defect without modifying routing, Firestore schemas, API structures, streaming mechanics, local storage, or validation rules, the patch must implement four targeted adjustments:

### Patch 1: Defer Heavy Context Operations to Allow Immediate Frame Paint
In `prepareTargetedBatchAction` (`my-workorders.js`), update the handler to invoke `setPendingTargetedBatchAction` immediately, and defer `updateGeo` to the next animation frame using `requestAnimationFrame` (or `setTimeout(..., 0)`). This yields JS execution back to React Native to commit and paint the `<ActivityIndicator>` on screen immediately.

```javascript
// Desired Pattern in prepareTargetedBatchAction:
setPendingTargetedBatchAction({ ... });

requestAnimationFrame(() => {
  updateGeo({
    selectedWard: targetWard,
    selectedErf: null,
    selectedPremise: null,
    selectedMeter: null,
    lastSelectionType: "WARD",
  });
});
```

### Patch 2: Retain Loading State Until Screen Transition / Unmount
Do **not** call `setPendingTargetedBatchAction(null)` on line 1371 before `router.push(...)`. Allow `pendingTargetedBatchAction` to remain active while `router.push(...)` executes so that the spinner stays visible throughout the navigation transition. 

Clear `pendingTargetedBatchAction(null)` on screen blur / unmount, or when returning to `my-workorders.js` via navigation focus listener (`useFocusEffect`).

### Patch 3: Add Rapid-Tap Guard in Handler
Add an early return at the start of `prepareTargetedBatchAction`:

```javascript
if (pendingTargetedBatchAction) {
  return; // Prevent duplicate or concurrent action requests
}
```

### Patch 4: Ensure Complete Cleanup on Unmount / Blur
Update the unmount cleanup effect (line 1175) to clear `pendingTargetedBatchAction`:

```javascript
useEffect(() => () => {
  targetedBatchRequestKeyRef.current = null;
  setPendingTargetedBatchAction(null);
}, []);
```

---

## 10. Files That Would Change

Only **one** file requires modification for this minimal safe patch:

- `C:\dev\ireps-mobile\app\(tabs)\admin\operations\my-workorders.js`

No changes are required for `TargetedBatchActionTile.js`, `targetedBatchActions.js`, `GeoContext.js`, `WarehouseContext.js`, or any web/backend file.

---

## 11. Risks and Regression Concerns

| Functional Area | Potential Risk | Mitigation Strategy |
| :--- | :--- | :--- |
| **Meter Discovery** | Context context serialization failure could leave spinner stuck if not handled. | Ensure error catch blocks explicitly call `setPendingTargetedBatchAction(null)`. |
| **Targeted Batch Streaming** | Inbound row updates while spinner active. | Preserved `targetedBatchRefsMatch` check safely aborts and clears spinner on ref changes. |
| **Premise Validation** | Premise missing or mismatched. | Existing validation paths already call `setPendingTargetedBatchAction(null)` and pop Alert. |
| **AST Validation** | AST linkage check failure. | Existing validation path already calls `setPendingTargetedBatchAction(null)` and pops Alert. |
| **No Access** | Missing No Access context. | Existing try/catch in `RECORD_NO_ACCESS` branch must ensure `setPendingTargetedBatchAction(null)` is called on error. |
| **Offline / Local-Storage** | Offline warehouse lookup delays. | Retained spinner remains visible throughout offline warehouse lookup until ready or error. |
| **Navigation Failure** | Router push rejection or error. | `useFocusEffect` / blur cleanup clears `pendingTargetedBatchAction` if navigation fails or returns. |

---

## 12. Manual Test Matrix

| Test ID | Action Tile | Test Scenario | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **TM-01** | **PREMISE** | Tap PREMISE tile on valid row. | Spinner appears immediately inside PREMISE tile, value covered, remains visible until `/premises` mounts. |
| **TM-02** | **AST** | Tap AST tile on linked AST row. | Spinner appears immediately inside AST tile, value covered, remains visible until `/asts` mounts. |
| **TM-03** | **NA** | Tap NA tile on valid row without linked meter. | Spinner appears immediately inside NA tile, value covered, remains visible until `/targeted-batch-no-access` mounts. |
| **TM-04** | **ERF** | Tap ERF tile on valid row. | Spinner appears immediately inside ERF tile, value covered, remains visible until `/erfs` mounts. |
| **TM-05** | **Rapid Taps** | Rapidly tap PREMISE then AST. | Initial tap accepted, spinner shown on PREMISE; subsequent taps ignored until action completes or fails. |
| **TM-06** | **Validation Fail**| Tap AST on unlinked row (no AST). | Spinner appears briefly, validation fails, Alert shown, spinner clears safely. |
| **TM-07** | **Stream Update** | Row stream update occurs during preparation. | If refs change, Alert pops and spinner clears safely without crash or stuck state. |
| **TM-08** | **Offline Mode** | Tap PREMISE while device offline with cached ward. | Spinner paints immediately, offline lookup succeeds, navigates to `/premises`. |

---

## 13. Relationship to the OutOfMemory Crash

The OutOfMemory (OOM) crash in iREPS Mobile is a separate performance workstream caused by cumulative heap growth, un-paginated array caching in RTK Query / `WarehouseContext`, and image buffer allocations. 

**Relationship to Spinner Issue:**
- Heavy re-renders during `updateGeo` and selector re-calculations contribute to CPU spikes and transient memory allocation during action tile taps.
- However, fixing the spinner responsiveness (deferring `updateGeo` via `requestAnimationFrame` and managing `pendingTargetedBatchAction` lifecycle) does **not** alter data models or memory retention structures.
- **Strict Isolation:** The spinner feedback patch must remain isolated from OOM remediation efforts.

---

## 14. Final Recommendation

1. **Keep Assessment Read-Only:** Do not apply any patch during this assessment.
2. **Approved Scope:** When implementing the patch in a subsequent workstream, modify **only** `C:\dev\ireps-mobile\app\(tabs)\admin\operations\my-workorders.js`.
3. **Implementation Plan:** Apply the 4-part minimal safe patch (deferred `updateGeo` via `requestAnimationFrame`, retained loading state during `router.push`, rapid-tap guard, and unmount/focus cleanup).
4. **Validation:** Execute the manual test matrix (TM-01 through TM-08) to verify immediate paint, reliable clearing, and zero regressions across offline, streaming, and validation workflows.
