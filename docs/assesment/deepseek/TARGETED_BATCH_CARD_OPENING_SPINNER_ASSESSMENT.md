# Targeted Batch Card Opening Spinner Assessment

**Agent:** deepseek
**Date:** 2025-07-14
**Verified Mobile Commit:** `27ba5d2` Improve Targeted Batch workorder action feedback
**Primary Screen:** `app\(tabs)\admin\operations\my-workorders.js`

---

## 1. Executive Summary

The Level 2 → Level 3 transition (Targeted Batch card → VIEW ROWS → Batch Rows view) currently happens **immediately and synchronously** via a single `setSelectedBucket(bucket)` call. There is no intermediate visual feedback on the Level 2 card while Level 3 is preparing. This assessment traces the exact code flow, identifies every relevant state variable and component, and recommends the smallest safe patch to introduce a card-level opening spinner before Level 3 takes over.

**Key finding:** The proposed fix is technically sound, requires modification to exactly one source file, and all the infrastructure (states, refs, loading patterns, clear paths) already exists and can be extended with minimal risk.

---

## 2. Files Inspected

| File | Purpose |
|---|---|
| `app\(tabs)\admin\operations\my-workorders.js` | Primary screen: 6,007 lines, contains the full WMS flow including `WorkorderManagementSystem`, `TargetedBatchBucketLanding`, `TargetedBatchCard`, `TargetedBatchRowsWorklist`, `TargetedBatchRowCard`, all state, queries, and handlers |
| `src\features\targetedBatches\TargetedBatchActionTile.js` | Level 3 action tile component (PREMISE / AST / NA / ERF). Confirmed: existing `opening` prop already drives per-tile spinners |
| `src\features\targetedBatches\targetedBatchActions.js` | Action state derivation for Level 3 tiles |
| `src\redux\targetedBatchApi.js` | RTK Query API: `getTargetedBatchBuckets`, `getTargetedBatchRows`, `acceptRejectTargetedBatch` — all Firestore-streaming |

---

## 3. Confirmed Three-Level Flow

### Level 1 — Bucket Cards

- **Component:** `BucketTypeLanding` (line ~2829)
- **Rendered when:** `!selectedBucket && !selectedBucketCategory`
- **Bucket cards:** `BucketTypeCard` with title "Targeted Batches", `onPress={() => onOpen("TBB")}`
- **Handler:** `openBucketCategory("TBB")` (line ~1842)
  - Sets `selectedBucketCategory = "TBB"`, `selectedBucket = null`, `selectedGroup = null`, `stateFilter = "ALL"`
- **Loading feedback:** `targetedReady`, `targetedLoading`, `targetedError` props drive status badge states. **Already working. No change required.**

### Level 2 — Targeted Batches (Individual Batch Cards)

- **Component:** `TargetedBatchBucketLanding` (line 2970)
- **Rendered when:** `!selectedBucket && selectedBucketCategory === "TBB"`
- **List mechanism:** `ScrollView` + `{buckets.map((bucket) => (...))}` — NOT FlashList
- **Individual card:** `TargetedBatchCard` (line 3120)
- **Props received:** `onOpenBucket={openBucket}`, `onAcceptTargetedBatch={handleAcceptTargetedBatch}`, `onRejectTargetedBatch={setRejectItem}`, `deciding={actionBusy}`, `processingTargetedBatchAction`, `fieldWorkorderActor`
- **This is the subject of the assessment.**

### Level 3 — Batch Rows

- **Component:** `TargetedBatchRowsWorklist` (line 3719)
- **Rendered when:** `showTargetedBatchRows === true` → `selectedBucket?.bucketType === "TBB"`
- **Rows list:** `FlashList` with `extraData={openingAction}` (drives per-row action-tile spinners)
- **Rows rendered by:** `TargetedBatchRowCard` (line ~3815)
- **Loading state:** `isLoading ? <detailPreparingCard> "Loading Targeted Batch rows..."` — **Already working. No change required.**
- **Action tiles:** `TargetedBatchActionTile` with `opening={openingIntent === ...}` prop — per-tile spinners already working.

---

## 4. Current Level 2 Card Rendering

### `TargetedBatchBucketLanding` (line 2970–3041)

```jsx
function TargetedBatchBucketLanding({
  isLoading, error, buckets = [], deciding,
  processingTargetedBatchAction, fieldWorkorderActor,
  onBack, onOpenBucket, onAcceptTargetedBatch, onRejectTargetedBatch,
}) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      {/* Back pill, section title, loading/error/empty states */}
      {buckets.map((bucket) => (
        <TargetedBatchCard
          key={bucket.id}
          bucket={bucket}
          deciding={deciding}
          processingTargetedBatchAction={processingTargetedBatchAction}
          fieldWorkorderActor={fieldWorkorderActor}
          onOpenBucket={onOpenBucket}
          onAcceptTargetedBatch={onAcceptTargetedBatch}
          onRejectTargetedBatch={onRejectTargetedBatch}
        />
      ))}
    </ScrollView>
  );
}
```

**Key observation:** Uses `ScrollView` + `.map()`. No `extraData` needed. React re-renders are driven purely by prop changes.

### `TargetedBatchCard` — VIEW ROWS Button (line 3120–3309)

The VIEW ROWS button is rendered at approximately line 3260–3275:

```jsx
{canView ? (
  <Pressable
    style={[styles.actionBtn, styles.executeBtn]}
    onPress={() => onOpenBucket(bucket)}
    disabled={deciding}             // ← only blocked when actionBusy (ACCEPT/REJECT in-flight)
  >
    <Text style={styles.executeBtnText}>VIEW ROWS</Text>
  </Pressable>
) : null}
```

**Key observations:**
- `canView = bucket?.permissions?.canViewRows === true`
- Only disabled when `deciding` (`actionBusy`) is true — which guards ACCEPT/REJECT processing
- No opening-state spinner or text change currently exists
- No duplicate-tap guard (nothing prevents rapidly calling `onOpenBucket` twice)

---

## 5. Current VIEW ROWS Action Flow

### Step-by-step trace

1. **User taps VIEW ROWS** on a `TargetedBatchCard`
2. **Handler invoked:** `onOpenBucket(bucket)` → calls `openBucket(bucket)` in `WorkorderManagementSystem` (line ~1902)
3. **`openBucket` for `bucketType === "TBB"`** (line ~1902–1911):

```js
if (bucket?.bucketType === "TBB") {
  if (bucket?.permissions?.canViewRows !== true) {
    Alert.alert("Targeted Batch Locked", "...");
    return;                                                    // ← Early exit: no state change
  }

  setPreparingBgoDetail(false);
  setSelectedBucket(bucket);                                   // ← THE KEY TRANSITION
  setSelectedGroup(null);
  setStateFilter("ALL");
}
```

4. **`selectedTargetedBatchId`** is a derived value (line ~1019–1022):

```js
const selectedTargetedBatchId =
  selectedBucket?.bucketType === "TBB"
    ? selectedBucket?.id || null
    : null;
```

5. **Level 2 → Level 3 switch** happens through the render cascade (line ~2690–2732):
   - Level 2 condition: `!selectedBucket && selectedBucketCategory === "TBB"` → becomes **FALSE** (selectedBucket is now set)
   - Level 3 condition: `showTargetedBatchRows` = `selectedBucket?.bucketType === "TBB"` → becomes **TRUE**
   - Level 2 `TargetedBatchBucketLanding` unmounts; Level 3 `TargetedBatchRowsWorklist` mounts

6. **Targeted Batch rows query activates** (line ~1152–1168):

```js
const targetedBatchRowsQuerySkipped =
  !fieldWorkorderActor ||
  !selectedTargetedBatchId ||                                   // ← now has a value
  selectedBucket?.permissions?.canViewRows !== true;

const { data: targetedBatchRowsData, isLoading: isLoadingTargetedBatchRows, error: targetedBatchRowsError } =
  useGetTargetedBatchRowsQuery({ tbId: selectedTargetedBatchId }, { skip: targetedBatchRowsQuerySkipped });
```

7. **`clearPendingTargetedBatchAction()`** fires (useEffect line ~1225–1226):

```js
useEffect(() => {
  clearPendingTargetedBatchAction();
}, [selectedTargetedBatchId, clearPendingTargetedBatchAction]);
```

### Critical finding: No intermediate state exists

The `setSelectedBucket(bucket)` call is the **only state change** between Level 2 and Level 3. React batches all three `setState` calls (`setPreparingBgoDetail`, `setSelectedBucket`, `setSelectedGroup`, `setStateFilter`) into a single render. There is **no paint opportunity** between "user taps VIEW ROWS" and "Level 2 disappears."

---

## 6. Existing Level 3 Loading Behaviour

`TargetedBatchRowsWorklist` (line 3719–3813) renders three states:

| State | Condition | Display |
|---|---|---|
| **Loading** | `isLoading && !targetedBatchRowsData` | `ActivityIndicator` + "Loading Targeted Batch rows..." + description |
| **Error** | `error` is truthy | Error icon + "Targeted Batch rows failed" + message |
| **Ready** | Neither loading nor error | `FlashList` of `TargetedBatchRowCard` components |

The loading state provides a natural visual continuation after the proposed Level 2 card spinner. When rows are already cached (RTK Query cache hit), the loading state is skipped entirely and rows render immediately.

---

## 7. Confirmed Findings

### 7.1 — Question 1: Exact Level 2 card component

**`TargetedBatchCard`** (line 3120), rendered inside `TargetedBatchBucketLanding` (line 2970).

### 7.2 — Question 2: Exact VIEW ROWS button

A `Pressable` inside `TargetedBatchCard` at approximately line 3260:

```jsx
<Pressable
  style={[styles.actionBtn, styles.executeBtn]}
  onPress={() => onOpenBucket(bucket)}
  disabled={deciding}
>
  <Text style={styles.executeBtnText}>VIEW ROWS</Text>
</Pressable>
```

### 7.3 — Question 3: Complete code flow

```
VIEW ROWS tap
  → onOpenBucket(bucket)
    → openBucket(bucket)              [line ~1902, WorkorderManagementSystem]
      → canViewRows check             [guard: shows alert if false, returns early]
      → setPreparingBgoDetail(false)  [line ~1908]
      → setSelectedBucket(bucket)     [line ~1909 — KEY TRANSITION]
      → setSelectedGroup(null)        [line ~1910]
      → setStateFilter("ALL")         [line ~1911]
  → React re-render
    → selectedTargetedBatchId derived [line ~1019]
    → showTargetedBatchRows === true  [line ~2614]
    → !selectedBucket && selectedBucketCategory === "TBB" === false  [Level 2 un-mounts]
    → TargetedBatchRowsWorklist mounts [Level 3 renders]
    → useGetTargetedBatchRowsQuery activates [tbId = selectedTargetedBatchId]
    → clearPendingTargetedBatchAction() fires [useEffect, line ~1225]
```

### 7.4 — Question 4: Exact handler

**`openBucket(bucket)`** defined at line ~1859 inside `WorkorderManagementSystem`. Passed to `TargetedBatchBucketLanding` as `onOpenBucket`, then to `TargetedBatchCard` as `onOpenBucket`.

### 7.5 — Question 5: Does `setSelectedBucket(bucket)` immediately replace Level 2?

**YES.** Confirmed. The render condition at line ~2690 is:

```jsx
{!selectedBucket && selectedBucketCategory === "TBB" ? (
  <TargetedBatchBucketLanding ... />
) : ... }
```

When `setSelectedBucket(bucket)` is called, `selectedBucket` becomes non-null, the condition evaluates to `false`, and `TargetedBatchBucketLanding` unmounts in the **same React render cycle**. There is no intermediate frame.

### 7.6 — Question 6: When does the row query activate?

**When `selectedTargetedBatchId` changes** from `null` to a value. This is a derived value from `selectedBucket`:

```js
const selectedTargetedBatchId =
  selectedBucket?.bucketType === "TBB"
    ? selectedBucket?.id || null
    : null;
```

The query skip condition is:
```js
const targetedBatchRowsQuerySkipped =
  !fieldWorkorderActor ||
  !selectedTargetedBatchId ||
  selectedBucket?.permissions?.canViewRows !== true;
```

So the sequence is: `setSelectedBucket(bucket)` → `selectedTargetedBatchId` becomes `bucket.id` → `targetedBatchRowsQuerySkipped` becomes `false` → `useGetTargetedBatchRowsQuery` starts the Firestore `onSnapshot` stream.

### 7.7 — Question 7: Existing states

| State | Source | Purpose |
|---|---|---|
| `selectedBucket` | `useState(null)` | Currently selected bucket (all types). Drives `selectedTargetedBatchId`, `showTargetedBatchRows`, `showTrnDetail`, `showBmdErfWorklist`, `showIndividualGroups` |
| `selectedBucketCategory` | `useState(null)` | Current bucket category: `null`, `"INDVG"`, `"TBB"`, `"BGOB"` |
| `selectedTargetedBatchId` | Derived from `selectedBucket` | The TBB id used as `tbId` query arg |
| `isLoadingTargetedBatchRows` | RTK Query `useGetTargetedBatchRowsQuery` | `true` during first load; `false` once data or error arrives |
| `targetedBatchRowsData` | RTK Query cache | `{ rows, summary, pagination, diagnostics }` — streamed live |
| `targetedBatchRowsError` | RTK Query error | Non-null when Firestore stream fails |
| `targetedBatchRows` | `useMemo` (line 1264) | Enriched rows with warehouse ERF data merged |
| `processingTargetedBatchAction` | `useState(null)` | ACCEPT/REJECT in-flight: `{ bucketId, action }` |
| `pendingTargetedBatchAction` | `useState(null)` | Level 3 action tile preparation: `{ requestKey, bucketId, rowId, intent, ... }` |
| `targetedBatchRequestSequence` | `useRef(0)` | Monotonic counter for Level 3 action request ordering |
| `targetedBatchRequestKeyRef` | `useRef(null)` | Request key for Level 3 action deduplication |
| `targetedBatchPaintFrameRef` | `useRef(null)` | `requestAnimationFrame` handle for Level 3 action tile spinner paint |
| `targetedBatchPreparationFrameRef` | `useRef(null)` | Second `requestAnimationFrame` handle for Level 3 action preparation |
| `targetedBatchScreenMountedRef` | `useRef(true)` | Guard against state updates after unmount |

### 7.8 — Question 8: Level 3 loading spinner

**YES.** Confirmed. `TargetedBatchRowsWorklist` (line 3777–3788):

```jsx
{isLoading ? (
  <View style={styles.detailPreparingCard}>
    <ActivityIndicator size="small" color="#2563eb" />
    <Text style={styles.detailPreparingTitle}>
      Loading Targeted Batch rows...
    </Text>
    <Text style={styles.detailPreparingText}>
      Preparing the accepted ERF worklist for premise discovery.
    </Text>
  </View>
) : error ? (...) : (
  <FlashList ... />
)}
```

### 7.9 — Question 9: Does a Level 2 opening state exist?

**NO.** There is no state variable tracking an "opening" intent for the Level 2 → Level 3 transition. The existing refs (`targetedBatchPaintFrameRef`, `targetedBatchPreparationFrameRef`) are exclusively used by `prepareTargetedBatchAction` for Level 3 action-tile spinners (PREMISE / AST / NA / ERF).

### 7.10 — Question 10: Is `processingTargetedBatchAction` restricted to ACCEPT/REJECT?

**YES.** `processingTargetedBatchAction` is set **only** in `submitTargetedBatchDecision` (line 2042–2046):

```js
setProcessingTargetedBatchAction({
  bucketId: bucket.id,
  action: normalizeUpper(action),   // "ACCEPT" or "REJECT"
});
```

It is cleared in the `finally` block (line 2127–2129):

```js
finally {
  setProcessingTargetedBatchAction((current) =>
    current?.bucketId === bucket.id ? null : current,
  );
}
```

It drives:
- The "ACCEPTING..." / "REJECTING..." text and spinner on the ACCEPT/REJECT buttons in `TargetedBatchCard`
- The `processingThisBatch` boolean (`processingTargetedBatchAction?.bucketId === bucket?.id`)
- The `disabled` prop on all card buttons

**Reusing `processingTargetedBatchAction` for VIEW ROWS would mix unrelated business actions** — VIEW ROWS is not a mutation, has no `finally` block, and would interfere with the ACCEPT/REJECT spinner visibility on the same card.

### 7.11 — Question 11: Level 2 list mechanism

**`ScrollView` + `{buckets.map(...)}`** — confirmed at line 3024:

```jsx
{buckets.map((bucket) => (
  <TargetedBatchCard key={bucket.id} ... />
))}
```

No `FlashList`, no `FlatList`. Pure React reconciliation driven by `key` and prop changes.

### 7.12 — Question 12: Is `extraData` required for Level 2?

**NO.** `extraData` is a `FlashList`-specific prop. The Level 2 list uses `ScrollView` + `.map()`. React's normal re-render mechanism (prop changes) will propagate the opening state to the correct `TargetedBatchCard`.

### 7.13 — Question 13: Is the proposed sequence technically sound?

**YES.** The sequence:
```
setOpeningTargetedBatchId(bucket.id)
  → allow one visible paint opportunity
  → setSelectedBucket(bucket)
  → Level 3 takes over
  → existing Level 3 loading state continues where necessary
```

is technically sound. However, React batches `setState` calls within the same synchronous event handler, so the paint opportunity must be explicitly created using `requestAnimationFrame`.

### 7.14 — Question 14: Frame count

**One `requestAnimationFrame` is sufficient.** Here is the rationale:

- React event handlers batch state updates synchronously
- `requestAnimationFrame` fires **after** React has committed the current batch to the DOM and before the next paint
- The first `requestAnimationFrame` callback runs after the opening-state render is committed and visible
- A second frame (as used in `prepareTargetedBatchAction` for Level 3 tiles) is **not necessary** here because:
  - Level 3 tile preparation involves async GeoContext updates and warehouse sync checks
  - Level 2 → Level 3 is purely synchronous: just setting `selectedBucket`
  - The Level 3 component mounts and shows its own loading state, providing a clean visual handover

**Recommendation:** One `requestAnimationFrame`. If testing reveals visual flicker (Level 3 loading state flashes for <1 frame), add a second frame — but start with one.

### 7.15 — Question 15: Loading identity shape

**Recommendation:** A flat string/number — **`openingTargetedBatchId`** (the `bucket.id`).

Rationale:
- The Level 2 → Level 3 transition is synchronous and non-competitive
- No async validation, no warehouse sync, no row-level identity needed
- The existing `targetedBatchRequestSequence` / `targetedBatchRequestKeyRef` pattern exists purely for Level 3 action-tile preparation where:
  - Multiple actions can race (PREMISE vs AST vs NA vs ERF)
  - Warehouse sync can arrive out of order
  - GeoContext updates are async
- A full request object `{ requestKey, targetedBatchId, openingIntent }` would be **overengineered** for this single-action, synchronous case
- A simple `bucketId` guard is sufficient for duplicate-tap prevention

Consistency note: If the team prefers uniformity with `processingTargetedBatchAction`'s shape (`{ bucketId, action }`), the shape `{ bucketId: bucket.id, action: "VIEW_ROWS" }` could be used — but this adds complexity without benefit.

### 7.16 — Question 16: Selectivity of the spinner

**Only the selected card** should show the spinner. The `openingTargetedBatchId` (or equivalent) is compared against `bucket.id` inside `TargetedBatchCard`. Cards where `openingTargetedBatchId !== bucket.id` render normally. All other Level 2 batch cards remain interactive.

The VIEW ROWS button's `disabled` prop should be extended from `disabled={deciding}` to `disabled={deciding || openingTargetedBatchId !== null}` — this blocks **all** VIEW ROWS buttons while **any** card is opening. The alternative (block only the specific card) is also viable and arguably better UX, but requires careful consideration of the rapid-tap case (see 7.17).

### 7.17 — Question 17: Rapid-tap behaviour

#### Same VIEW ROWS button tapped repeatedly

- **Current behaviour (no guard):** Each tap calls `openBucket(bucket)` which calls `setSelectedBucket(bucket)`. React batches multiple `setState` calls with the same value — only one render occurs. However, multiple `setSelectedBucket` calls within the same synchronous event are harmless because React deduplicates.
- **Proposed behaviour:** The `openingTargetedBatchId` guard in `openBucket` prevents the second call from proceeding. The first call sets `openingTargetedBatchId`, and subsequent calls see it's already set and return early.

#### Batch A then Batch B (rapidly)

- **Proposed behaviour:** If `openingTargetedBatchId` is already set to Batch A's id when Batch B is tapped, the guard blocks Batch B. This **preserves the user's first intent**. Once `requestAnimationFrame` fires and `setSelectedBucket` runs, Level 2 unmounts, making further taps on any card impossible. This is the correct behaviour.
- **Alternative:** Allow Batch B to "cancel" Batch A's opening. This requires clearing `openingTargetedBatchId` and the animation frame. More complex, but provides a "last tap wins" UX. **Not recommended for the first patch** — start with "first tap wins."

#### VIEW ROWS while ACCEPT/REJECT is active

- **Current behaviour (already guarded):** `disabled={deciding}` on the VIEW ROWS `Pressable`. `deciding` is derived from `actionBusy` which is `true` when any ACCEPT/REJECT mutation is in flight. The button is already non-interactive during processing. **No change required.**

### 7.18 — Question 18: Opening-state clear paths

| Clear Path | Current Mechanism | Proposed Addition |
|---|---|---|
| Validation failure (canViewRows check) | Early `return` in `openBucket` before `setSelectedBucket` | Clear `openingTargetedBatchId` in the early-return path |
| Selected batch disappears from live stream | `useEffect` (line ~1670) syncs `selectedBucket` with fresh `bucketCards` | If `selectedBucket` falls back to a fresh bucket from the stream and `openingTargetedBatchId` matches the old one, clear it |
| Batch becomes ineligible (canViewRows → false) | The `.find()` in bucket sync effect would not find the bucket | Same as above |
| User presses Back | `backToBuckets()` (line ~1927) calls `clearPendingTargetedBatchAction()` | Clear `openingTargetedBatchId` in `backToBuckets()` |
| User changes bucket category | `backToBucketCategories()` (line ~1920) clears `selectedBucketCategory` | Since Level 2 unmounts, this is a natural clear — but add explicit clear for safety |
| Screen loses focus | `useFocusEffect` cleanup (line ~1036) calls `clearPendingTargetedBatchAction()` | Add `setOpeningTargetedBatchId(null)` to same cleanup |
| Screen unmounts | Mount effect cleanup sets `targetedBatchScreenMountedRef.current = false` | Add `setOpeningTargetedBatchId(null)` |
| Newer batch-opening request replaces previous | Natural React state update | Keep the "first tap wins" guard — newer requests are blocked |
| Level 3 successfully takes ownership | `setSelectedBucket` triggers Level 2 unmount | Opening state naturally becomes invisible; explicit clear in `openBucket`'s `requestAnimationFrame` callback |

### 7.19 — Question 19: Safest moment to clear

In the `requestAnimationFrame` callback **after** `setSelectedBucket(bucket)` runs. This ensures:
- The opening state was visible for at least one frame
- Level 2 has unmounted (so the state is no longer displayed)
- The state is cleaned up before any potential re-entry to Level 2

Additionally, clear in all defensive paths: `backToBuckets()`, `backToBucketCategories()`, `useFocusEffect` cleanup, and mount-unmount cleanup.

### 7.20 — Question 20: Is clearing needed when Level 2 unmounts?

**Technically no, but pragmatically yes.** Since `openingTargetedBatchId` is held in `WorkorderManagementSystem` (the parent), it persists even when `TargetedBatchBucketLanding` is unmounted. When the user presses Back from Level 3 to Level 2, the stale opening state would still be set — this would incorrectly block the VIEW ROWS button on re-entry. Explicit clearing prevents this stale-state bug.

### 7.21 — Question 21: Visual handover

The proposed sequence produces a clean continuous loading experience:

1. **Level 2 card:** VIEW ROWS button shows `ActivityIndicator` + "OPENING..."
2. **~16ms later:** `requestAnimationFrame` fires, `setSelectedBucket(bucket)` runs
3. **Level 2 unmounts, Level 3 mounts** in the same render
4. **Level 3, case A (rows not cached):** Shows "Loading Targeted Batch rows..." with its own spinner → continuous loading feel
5. **Level 3, case B (rows cached):** Shows the `FlashList` of rows immediately → minimal flicker

The handover is:
```
[L2 card: "OPENING..." spinner] → [L3: "Loading Targeted Batch rows..." spinner] → [L3: rows list]
```

This is consistent with the existing BGO bucket pattern where `isPreparingBgoDetail` provides a similar "Preparing BGO TRNs..." intermediate state.

### 7.22 — Question 22: VIEW TRANSACTIONS unchanged?

**YES. Confirmed.** The VIEW TRANSACTIONS button appears only inside the `Alert.alert` callback in `submitTargetedBatchDecision` (line ~2106–2112) after a successful ACCEPT. It calls:

```js
onPress: () => {
  setPreparingBgoDetail(false);
  setSelectedBucket(acceptedBucket);
  setSelectedGroup(null);
  setStateFilter("ALL");
}
```

This is a post-ACCEPT flow where `acceptedBucket` has `canViewRows: true` forced. It uses the same `setSelectedBucket` path but is called from an Alert callback, not from the card button. The proposed change to `openBucket` does not affect this path.

### 7.23 — Question 23: Recommended smallest safe implementation

See **Section 10** below.

### 7.24 — Question 24: Files that would change

Exactly one file:
- `app\(tabs)\admin\operations\my-workorders.js`

### 7.25 — Separation of concerns

See **Section 8** for confirmed facts vs hypotheses vs optional improvements.

---

## 8. Opening-State Lifecycle Assessment

### Confirmed facts from code

| # | Fact | Evidence |
|---|---|---|
| F1 | `setSelectedBucket(bucket)` is the sole trigger for the Level 2 → Level 3 transition | `openBucket` function, line ~1902–1911 |
| F2 | React batches all four state calls into one render — no paint opportunity between the tap and the view switch | `setPreparingBgoDetail`, `setSelectedBucket`, `setSelectedGroup`, `setStateFilter` called synchronously |
| F3 | The Level 2 condition `!selectedBucket && selectedBucketCategory === "TBB"` becomes `false` immediately | Render cascade, line ~2690 |
| F4 | The rows query (`useGetTargetedBatchRowsQuery`) activates when `selectedTargetedBatchId` becomes non-null | Derived value at line ~1019; query skip at line ~1152 |
| F5 | `clearPendingTargetedBatchAction` fires when `selectedTargetedBatchId` changes | useEffect at line ~1225 |
| F6 | `TargetedBatchRowsWorklist` renders its own loading spinner when `isLoading && !targetedBatchRowsData` | Component at line ~3777 |
| F7 | Level 2 cards use `ScrollView` + `.map()`, not FlashList | `TargetedBatchBucketLanding` at line ~3024 |
| F8 | The VIEW ROWS button is only `disabled={deciding}` — no opening guard exists | `TargetedBatchCard` at line ~3260 |
| F9 | `processingTargetedBatchAction` is exclusively for ACCEPT/REJECT mutations | `submitTargetedBatchDecision` at line ~2042 |
| F10 | `targetedBatchPaintFrameRef` and `targetedBatchPreparationFrameRef` are used only for Level 3 action-tile spinners | `prepareTargetedBatchAction` at line ~2550 |
| F11 | `backToBuckets()` and `backToBucketCategories()` already call `clearPendingTargetedBatchAction()` | Lines ~1920, ~1927 |
| F12 | `useFocusEffect` cleanup already calls `clearPendingTargetedBatchAction()` on screen blur | Line ~1036–1041 |
| F13 | The existing two-`requestAnimationFrame` pattern in `prepareTargetedBatchAction` is battle-tested | Lines ~2575–2608 |

### Likely causes (high confidence)

| # | Cause | Basis |
|---|---|---|
| L1 | The immediate view switch was intentional to keep the UI responsive — no one noticed the missing feedback because rows usually stream in quickly | The code structure suggests optimization for speed, not perceived performance |
| L2 | The two-frame pattern in `prepareTargetedBatchAction` was developed after the initial Level 2→3 flow was already built; the Level 2→3 transition was never revisited | The frame refs exist only in the Level 3 action context |

### Unverified hypotheses

| # | Hypothesis | How to verify |
|---|---|---|
| H1 | Firestore row streams typically deliver data within 200–500ms, making the loading spinner blink briefly | Test with network throttling |
| H2 | RTK Query cache hits (returning to a previously opened batch) make Level 3 render rows with zero loading time | Open a batch, go back, open again — observe no loading spinner |
| H3 | On low-end Android devices, the synchronous state changes may cause a visible "flash" of the Level 3 loading state before rows appear | Test on entry-level Android device |

### Optional improvements (NOT for the first patch)

| # | Improvement | Rationale for deferral |
|---|---|---|
| O1 | Add a minimum display time (e.g., 300ms) for the Level 2 card spinner | Prevents "blink and you miss it" on fast connections. Adds complexity with timers that must be cleaned up. |
| O2 | Add a skeleton/shimmer placeholder on the Level 3 rows list | Would require a new component. Out of scope. |
| O3 | Prefetch rows on card hover/press-in | Requires API changes; violates locked scope. |
| O4 | Animate the card collapsing into the rows view | Requires `LayoutAnimation` or `Reanimated`; new dependency risk. |

---

## 9. Rapid-Tap and Stream Race Assessment

### 9.1 Same VIEW ROWS button double-tap

**Current:** Two synchronous `setSelectedBucket(bucket)` calls. React deduplicates — only one render. Harmless but noisy.

**Proposed:** The `openingTargetedBatchId` guard in `openBucket` blocks the second call:

```js
if (bucket?.bucketType === "TBB") {
  if (bucket?.permissions?.canViewRows !== true) { ... return; }
  if (openingTargetedBatchId) return;  // ← guard

  setOpeningTargetedBatchId(bucket.id);
  requestAnimationFrame(() => {
    setSelectedBucket(bucket);
    setOpeningTargetedBatchId(null);
  });
  // ... rest of state updates
}
```

**Guarantee:** Only one `requestAnimationFrame` callback can be pending at a time (the guard prevents scheduling a second one).

### 9.2 Batch A then Batch B

**Proposed:** First-tap-wins. Batch B is blocked by `if (openingTargetedBatchId) return`. This is the safest behaviour and avoids the edge case where Batch B's `requestAnimationFrame` fires before Batch A's, creating a race.

### 9.3 VIEW ROWS during ACCEPT/REJECT processing

**Already prevented** by the `disabled={deciding}` prop on the VIEW ROWS `Pressable`. `deciding` is derived from `actionBusy` which is `true` when any `useMutation` is in its `isLoading` state. No additional guard needed.

### 9.4 Stream race: rows arrive before the card spinner paints

This is an edge case: if the RTK Query cache already has rows for this `tbId`, `isLoadingTargetedBatchRows` will be `false` immediately, and `TargetedBatchRowsWorklist` will render the `FlashList` on its first mount. In this case:

1. Level 2 card spinner shows "OPENING..." for one frame (~16ms)
2. `requestAnimationFrame` fires → Level 3 mounts → rows are already available → FlashList renders

The card spinner will be visible for exactly one frame. This is acceptable UX — the user perceives an instantaneous response. No additional minimum display time is needed for the first patch.

### 9.5 Stream race: batch disappears from Firestore during opening

If the batch document is deleted from Firestore between the tap and the rows query activation:

1. `selectedBucket` is set to the now-deleted batch
2. Level 3 mounts
3. The rows query starts — Firestore `onSnapshot` detects no matching rows
4. The `FlashList` shows the `ListEmptyComponent`: "No Targeted Batch rows"
5. The existing bucket sync `useEffect` (line ~1670) detects the stale `selectedBucket` and may update it

This is an existing edge case, not introduced by the proposed change. The opening state is safely cleared when `selectedTargetedBatchId` changes.

### 9.6 Stream race: row query returns an error

1. Level 3 mounts
2. Firestore `onSnapshot` error fires
3. `targetedBatchRowsError` becomes non-null
4. `TargetedBatchRowsWorklist` shows the error state: "Targeted Batch rows failed"

The Level 2 card spinner is already gone at this point (Level 3 took over). This is correct.

---

## 10. Minimal Safe Patch Recommendation

### State addition

Add one state variable to `WorkorderManagementSystem` (after the existing `processingTargetedBatchAction` state block, around line ~960):

```js
const [openingTargetedBatchId, setOpeningTargetedBatchId] = useState(null);
```

### Modify `openBucket` function (line ~1902–1911)

Change the TBB branch from:

```js
if (bucket?.bucketType === "TBB") {
  if (bucket?.permissions?.canViewRows !== true) {
    Alert.alert("Targeted Batch Locked", "...");
    return;
  }

  setPreparingBgoDetail(false);
  setSelectedBucket(bucket);
  setSelectedGroup(null);
  setStateFilter("ALL");
}
```

To:

```js
if (bucket?.bucketType === "TBB") {
  if (bucket?.permissions?.canViewRows !== true) {
    Alert.alert("Targeted Batch Locked", "...");
    return;
  }

  if (openingTargetedBatchId) return;  // prevent duplicate taps

  setOpeningTargetedBatchId(bucket.id);
  setPreparingBgoDetail(false);

  requestAnimationFrame(() => {
    // Guard against unmount or cancelled request during the frame
    if (!targetedBatchScreenMountedRef.current) {
      setOpeningTargetedBatchId(null);
      return;
    }

    setSelectedBucket(bucket);
    setOpeningTargetedBatchId(null);
    setSelectedGroup(null);
    setStateFilter("ALL");
  });
}
```

**Note:** `setSelectedGroup(null)` and `setStateFilter("ALL")` are moved inside the `requestAnimationFrame` callback so they execute together with `setSelectedBucket`. This avoids an intermediate render where Level 2 is still visible but group/stateFilter have already changed.

### Add clear paths

1. **In `backToBuckets`** (line ~1927): Add `setOpeningTargetedBatchId(null);`
2. **In `backToBucketCategories`** (line ~1920): Add `setOpeningTargetedBatchId(null);`
3. **In `useFocusEffect` cleanup** (line ~1036): Add `setOpeningTargetedBatchId(null);`
4. **In mount/unmount effect cleanup** (line ~1027): Add `setOpeningTargetedBatchId(null);` (inside the returned cleanup function)

### Pass `openingTargetedBatchId` to Level 2 components

1. Add prop to `TargetedBatchBucketLanding` call (line ~2696):
   ```jsx
   <TargetedBatchBucketLanding
     ...
     openingTargetedBatchId={openingTargetedBatchId}
   />
   ```

2. Add parameter to `TargetedBatchBucketLanding` function signature (line 2970):
   ```jsx
   function TargetedBatchBucketLanding({
     ...
     openingTargetedBatchId,
   })
   ```

3. Pass to each `TargetedBatchCard` (line ~3025):
   ```jsx
   <TargetedBatchCard
     ...
     openingTargetedBatchId={openingTargetedBatchId}
   />
   ```

### Modify `TargetedBatchCard` (line ~3120)

1. Add `openingTargetedBatchId` to the destructured props
2. Add a derived boolean:
   ```js
   const isOpeningThisBatch = openingTargetedBatchId === bucket?.id;
   ```
3. Modify the VIEW ROWS button (line ~3260) from:
   ```jsx
   {canView ? (
     <Pressable
       style={[styles.actionBtn, styles.executeBtn]}
       onPress={() => onOpenBucket(bucket)}
       disabled={deciding}
     >
       <Text style={styles.executeBtnText}>VIEW ROWS</Text>
     </Pressable>
   ) : null}
   ```
   To:
   ```jsx
   {canView ? (
     <Pressable
       style={[styles.actionBtn, styles.executeBtn]}
       onPress={() => onOpenBucket(bucket)}
       disabled={deciding || isOpeningThisBatch}
     >
       {isOpeningThisBatch ? (
         <ActivityIndicator size="small" color="#ffffff" />
       ) : null}
       <Text style={styles.executeBtnText}>
         {isOpeningThisBatch ? "OPENING..." : "VIEW ROWS"}
       </Text>
     </Pressable>
   ) : null}
   ```

### Summary of changes

| Change | Location | Type |
|---|---|---|
| Add `openingTargetedBatchId` state | `WorkorderManagementSystem`, near line 960 | New state |
| Guard + `requestAnimationFrame` in `openBucket` | `openBucket`, TBB branch, line ~1902 | Modify |
| Clear in `backToBuckets` | Line ~1927 | Add line |
| Clear in `backToBucketCategories` | Line ~1920 | Add line |
| Clear in `useFocusEffect` cleanup | Line ~1036 | Add line |
| Clear in mount effect cleanup | Line ~1027 | Add line |
| Pass prop to `TargetedBatchBucketLanding` | Line ~2696 | Add prop |
| Accept prop in `TargetedBatchBucketLanding` | Line 2970 | Add param |
| Pass prop to `TargetedBatchCard` | Line ~3025 | Add prop |
| Accept prop, derive `isOpeningThisBatch`, modify VIEW ROWS button | `TargetedBatchCard`, line ~3120 | Modify |

---

## 11. Files That Would Change

| File | Lines Changed | Risk |
|---|---|---|
| `app\(tabs)\admin\operations\my-workorders.js` | ~30 lines added/modified | Low — all changes are additive or narrowly scoped to one branch of one function |

No other files change. No API changes. No Firestore changes. No dependency changes.

---

## 12. Risks and Regression Concerns

| Risk | Likelihood | Mitigation |
|---|---|---|
| **One frame too short** — spinner not visible on fast devices | Low-Medium | Test on device; if invisible, add second `requestAnimationFrame` (trivial change) |
| **Stale `openingTargetedBatchId`** after re-entering Level 2 | Medium | Mitigated by clearing in all back/focus/unmount paths (see Section 10) |
| **ACCEPT/REJECT spinner conflict** — if user accepts then immediately taps VIEW ROWS | Very Low | The `disabled={deciding}` guard already blocks VIEW ROWS during any mutation. Additionally, ACCEPT changes `canViewRows` from `false` to `true` dynamically, so the "VIEW TRANSACTIONS" alert callback is the expected path, not the VIEW ROWS button |
| **`requestAnimationFrame` not firing** — if the component unmounts within the frame | Low | The `targetedBatchScreenMountedRef.current` guard inside the callback prevents state updates after unmount. Same pattern as `prepareTargetedBatchAction` |
| **`openingTargetedBatchId` visible after Back** — if the user rapidly taps Back while opening | Low | `backToBuckets()` clears `openingTargetedBatchId` synchronously. The `requestAnimationFrame` callback checks `targetedBatchScreenMountedRef` |
| **Interaction with `selectedBucket` sync effect** — the effect at line ~1670 replaces `selectedBucket` when stream data changes | Low | This effect only replaces when `selectedBucket` references a stale bucket. The opening flow uses `bucket` (the live object), not a stale reference. If the bucket disappears during the frame, the sync effect will naturally correct after Level 3 mounts |

---

## 13. Manual Test Matrix

| # | Test | Expected Behaviour | Priority |
|---|---|---|---|
| 1 | **Tap VIEW ROWS on Batch A** | VIEW ROWS button shows spinner + "OPENING...", Level 3 appears with loading or rows | P0 |
| 2 | **Rapidly double-tap VIEW ROWS on Batch A** | Only one transition occurs; second tap is ignored | P0 |
| 3 | **Tap Batch A VIEW ROWS, then immediately tap Batch B VIEW ROWS** | Batch B tap is blocked; Batch A opens | P1 |
| 4 | **Open a batch whose rows are already cached** | Card spinner shows briefly, Level 3 renders rows immediately (no "Loading..." state) | P0 |
| 5 | **Open a batch whose rows still need to load/stream** | Card spinner → Level 3 "Loading Targeted Batch rows..." → rows appear | P0 |
| 6 | **Selected batch disappears from Firestore during opening** | Level 3 shows "No Targeted Batch rows" or bucket sync corrects | P2 |
| 7 | **Selected batch becomes ineligible (canViewRows → false) during opening** | Level 3 handles gracefully; bucket sync effect may navigate back | P2 |
| 8 | **Row query returns a Firestore error** | Level 3 shows "Targeted Batch rows failed" error state | P1 |
| 9 | **Press Back during the opening frame** | `backToBuckets()` clears opening state; Level 2 renders without stale spinner | P1 |
| 10 | **Screen loses focus during opening (e.g., app switcher)** | `useFocusEffect` cleanup clears opening state; returning to screen shows consistent state | P2 |
| 11 | **Return from Level 3 to Level 2 (press Back in Level 3)** | Level 2 renders fresh; no stale spinner on any card | P0 |
| 12 | **ACCEPT processing remains unchanged** | ACCEPT button shows "ACCEPTING..." with spinner; ACCEPT/REJECT flow unchanged | P0 |
| 13 | **REJECT processing remains unchanged** | Reject modal opens; REJECT flow unchanged | P0 |
| 14 | **VIEW TRANSACTIONS (post-ACCEPT alert button) remains unchanged** | Opens rows directly; no card spinner involved | P1 |
| 15 | **Level 1 bucket-card spinners remain unchanged** | "Targeted Batches" card still shows READY/LOADING/FAILED status | P1 |
| 16 | **Level 3 PREMISE / AST / NA / ERF spinners remain unchanged** | Tapping any action tile shows per-tile spinner via existing `openingAction` mechanism | P0 |

---

## 14. Final Recommendation

### Patch is safe to implement

The proposed change is the **smallest possible patch** that addresses the missing feedback. It:

- Adds **exactly one state variable** (`openingTargetedBatchId`)
- Modifies **one branch** of one function (`openBucket` for `bucketType === "TBB"`)
- Passes the state through **existing component prop chains** (no restructuring)
- Reuses the **existing `requestAnimationFrame` pattern** from `prepareTargetedBatchAction`
- Clears state in **already-existing clear paths** (`backToBuckets`, `backToBucketCategories`, `useFocusEffect`, mount cleanup)
- Leaves all other flows **completely untouched**

### Implementation order

1. Add `openingTargetedBatchId` state
2. Modify `openBucket` TBB branch with guard + `requestAnimationFrame`
3. Add clear calls to `backToBuckets`, `backToBucketCategories`, `useFocusEffect`, mount cleanup
4. Thread `openingTargetedBatchId` prop through `TargetedBatchBucketLanding` → `TargetedBatchCard`
5. Modify VIEW ROWS button in `TargetedBatchCard` to show spinner + "OPENING..."
6. Run the manual test matrix (Section 13)
7. Verify no regressions on ACCEPT/REJECT, VIEW TRANSACTIONS, Level 1, and Level 3 action tiles

### Deferred for future patches

- Minimum display time for the card spinner (prevents "blink" on cached rows)
- Skeleton/shimmer placeholder on Level 3 row list
- Prefetch optimization
- Opening animation

---

*Assessment completed. No mobile source files were modified. No Git actions were performed. No API or Firestore changes were evaluated. The report is based exclusively on the exact current local source at commit `27ba5d2`.*
