# Targeted Batch Streaming Assessment and Patch Report

## 1. Executive verdict

**TARGETED BATCH STREAMING POLICY FULLY IMPLEMENTED**

All active Targeted Batch UI reads found in the web and mobile repositories now use Firestore real-time listeners. Four non-streaming paths were found and patched. Mutation callables remain controlled write mechanisms only.

## 2. Repository baseline

| Repository | Branch | Initial HEAD | Initial status |
|---|---|---|---|
| `C:\dev\ireps-web` | `main` | `418bf43c81bd6312764a761e91ea5b5a9e637935` | Ahead 19; pre-existing modified Targeted Batch backend/index scripts and untracked reports/tests/tools (preserved) |
| `C:\dev\ireps-mobile` | `main` | `ea2e598f76558bb3577186509cf1210f487d2f30` | Ahead 13; pre-existing modifications to My Workorders and Targeted Batch actions/tests plus untracked `skills.md` (preserved) |

## 3. Complete active API inventory

| Repository / path | Endpoint, helper, or consumer | Source | Type / mechanism before | Streams after | Lifecycle, cleanup, pagination, correction |
|---|---|---|---|---|---|
| web `src/pages/operations/TargetedBatchesPage.jsx` | Targeted Batch Register effect | `tb_uploads`, LM query | read / `getDocs` | Yes | `onSnapshot`; returned unsubscribe on effect cleanup/sign-out-driven unmount; all authorised rows streamed; local filters; patched |
| web `src/pages/operations/TargetedBatchDetailsPage.jsx` | Details/TB Rows effect | `tb_uploads/{tbId}` + `tb_rows` | read / `getDoc` + `getDocs` | Yes | two listeners, readiness joined in UI, both unsubscribed on route/unmount; local table pagination; patched |
| web `src/pages/operations/TargetedBatchAllocationPage.jsx` | allocation batch/rows effect | `tb_uploads/{tbId}` + `tb_rows` | read / `getDoc` + `getDocs` | Yes | two listeners; allocation/parent and rows update immediately; both unsubscribed; no server page cap; patched |
| web `src/pages/operations/targeted-batches/dashboard/useTargetedBatchDashboardData.js` | dashboard hook | `tb_uploads` + `tb_rows`, by TB or LM | read / `onSnapshot` | Yes | pre-existing dual subscriptions; cleanup returns both unsubscribes; no server pagination; unchanged |
| mobile `src/redux/targetedBatchApi.js` | `getTargetedBatchBuckets` / `useGetTargetedBatchBucketsQuery` | `tb_uploads` | read / `onSnapshot` | Yes | RTK `onCacheEntryAdded`; waits for cache, updates cache per snapshot, unsubscribes after `cacheEntryRemoved`; pre-existing 200 bucket presentation query limit; unchanged |
| mobile `src/redux/targetedBatchApi.js` | `getTargetedBatchRows` / `useGetTargetedBatchRowsQuery` | `tb_rows` + `demo_sales_meters` | read / callable cached page; retired listener unreachable | Yes | RTK cache lifecycle; one row query plus dynamic Sales document listeners; every listener removed at cache removal; callable pagination removed; patched |
| mobile `app/(tabs)/admin/operations/my-workorders.js` | TB buckets/rows UI | the two RTK endpoints above | cached query, cursor/reload/manual refresh controls | Yes | consumes live cache; cursor, reload key, load-more, targeted mutation refetch, and row pull-to-refresh correctness paths removed; local rendering of complete streamed row set; patched |
| mobile `src/features/targetedBatches/targetedBatchActions.js` | premise/AST/NA action-state selector | normalized streamed row | derived read | Yes (via input stream) | locked rule preserved: NA disabled only when Sales `fieldWork.meterId` is non-empty; unchanged by this patch |
| web/mobile callable mutation consumers | create, allocate, accept/reject, delete, premise link, No Access, discovery/link | callable backend writes | mutation / `httpsCallable` | N/A | preserved; authoritative writes flow back through listeners; no optimistic correctness state added |

Inactive backup files (`*.before-*`), development reset/read-only tools, backend implementation helpers, and tests are not UI data APIs.

## 4. Non-streaming APIs found and root causes

Four active paths were non-streaming: web Register, Details, Allocation, and mobile `getTargetedBatchRows`. The web pages performed one-time reads inside mount effects. Mobile used `getTargetedBatchRowsCallable`, cached its page, deliberately returned before the old listener code, and relied on cursor/reload/refetch behavior. That caused authoritative premise, execution, AST, and Sales fieldwork updates to remain invisible until refresh.

## 5. Files modified by this task

- `src/pages/operations/TargetedBatchesPage.jsx`
- `src/pages/operations/TargetedBatchDetailsPage.jsx`
- `src/pages/operations/TargetedBatchAllocationPage.jsx`
- `docs/assesment/codex/CODEX_TARGETED_BATCH_STREAMING_ASSESSMENT_AND_PATCH_REPORT.md`
- mobile `src/redux/targetedBatchApi.js`
- mobile `app/(tabs)/admin/operations/my-workorders.js`
- mobile `src/redux/targetedBatchApi.streaming.test.mjs`

## 6. Before and after architecture

Before: Firestore writes -> callable or one-time page read -> cached UI -> manual refresh. After: `tb_uploads`/`tb_rows` snapshots and matching Sales document snapshots -> RTK/local subscribed state -> immediate render.

For mobile rows, each `tb_rows` snapshot replaces the authoritative row set. Its distinct non-empty `salesAllMeterId` values are reconciled against a listener map. Added IDs receive exactly one `demo_sales_meters/{id}` listener; removed IDs are immediately unsubscribed and discarded. Each row is enriched with the matching `tbRefs` entry by exact `tbId`, `fieldWork.noAccess.length`, and `fieldWork.meterId`. Missing documents/references produce explicit source statuses and safe values. A cache-removal guard prevents stale callbacks, and cleanup removes the row listener and every Sales listener.

## 7. Collections streamed

- `tb_uploads`
- `tb_rows`
- `demo_sales_meters` (only documents currently referenced by subscribed TB rows)

Parent allocation, acceptance, execution status/counts, row premise/execution/AST refs, and Sales-derived No Access/meter state therefore reach subscribed screens without invalidation or refresh.

## 8. Pagination

Previously, mobile rows were callable-paged at 100 by default and 200 maximum, merged by cursor, and could hide later active rows until Load More. The patched endpoint streams the complete authorised TB row query without a silent limit; sorting and presentation are local. Web Details already paginates only the in-memory streamed set. The mobile bucket query retains its pre-existing 200-item ordered listener limit; this is a live query and was not implicated in row loss.

## 9. Authentication, errors, and cleanup

Firestore SDK listeners use the active authenticated Firebase session. Route/component unmount and RTK `cacheEntryRemoved` terminate listeners, including sign-out-driven subscriber teardown. Listener setup/snapshot errors are logged or shown through existing page error state. Dynamic Sales listeners cannot duplicate because their document IDs key a map, and stale callbacks are ignored after cache removal.

## 10. Tests and commands

- `npx.cmd eslint` on the three modified web pages: passed.
- `npm.cmd run build:dev`: passed (184 modules; existing large-chunk warning only). Initial sandbox attempt could not create Vite's temp file; approved rerun passed.
- `node --check src/redux/targetedBatchApi.js`: passed.
- Focused mobile `node --test` across streaming architecture, Targeted Batch actions, No Access, and premise context: 22/22 passed. Node emitted only existing module-type warnings.
- Focused backend mutation/read tests: 31/35 passed. Four failures are in pre-existing user-modified callable/No Access behavior (expected NA enrichment/count/integrity values and two No Access rejection expectations); this patch did not modify those backend files. The passing set includes premise linkage and the locked Sales-fieldwork meter rule.
- `git diff --check` in both repositories: passed (line-ending notices only for pre-existing/working files).

Coverage verifies listener presence, removal of callable/limit behavior, dynamic Sales listener add/remove/deduplication and cleanup, Sales No Access/meter derivation, premise/action state, exact references, and existing domain rules. Snapshot behavior is additionally exercised structurally because the repository has no configured Firestore listener-mocking test harness.

## 11. Remaining risks

- Firestore security rules must permit the already-authorised mobile actor to listen directly to the allocated `tb_rows` query and referenced Sales documents. No runtime Firebase access was performed, per instruction.
- Very large accepted batches now intentionally stream all authorised rows; this satisfies correctness but increases client listener/read and memory cost.
- The existing mobile bucket stream retains a 200-document live query cap. No evidence showed an active actor can have more than 200 assigned buckets, but this should be monitored separately if that cardinality becomes possible.

## 12. Remaining non-streaming Targeted Batch APIs

None among active UI data read paths inspected. `getTargetedBatchRowsCallable` remains deployed/exported backend code for compatibility but has no active Targeted Batch UI consumer. Mutation callables remain intentionally non-streaming writes whose results are delivered through the live reads.

No deployment, Firebase write, Git staging, commit, push, reset, cleanup, or runtime test-data operation was performed.
