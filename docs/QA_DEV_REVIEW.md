# First office QA milestone

Owner go: 13 October 2026. Governed by QA-R001 and the transaction QA schema in
the rules/schema repositories. The workspace release ledger records the deployed
GitHub main revision and served artifact after deployment.

## Owner review on hosted DEV

1. Sign in as an active MNG or MNC SPV with the required workbase. Open TRN Registry
   and use its last column, QA. ADM/SPU can inspect but cannot decide QA.
2. Filter Draft and inspect both older and new submitted transactions, including
   No Access. Unsubmitted ITO work is not available for QA.
3. Open evidence/history or choose QA Pass/Fail. Inspect the submitted details and
   the protected evidence before confirming.
4. Fail requires a listed reason and explanation, including the illegal-connection
   photo reason. Pass permits an optional comment and displays a final-lock warning.
5. After saving, check the decision, reviewer, SAST time and preserved version in
   history. A second reviewer with an old window must refresh. A Pass cannot reopen.
6. Confirm ITO still follows Created → Issued → Accepted → Completed. Completed
   submits the record to QA Draft; the concluded ITO state remains Completed.

This delivery supports review and immutable history. The agreed correction,
takeover, notifications and continuing-note operations are later milestones.
Fail remains Fail until correction is implemented; no edit/reset shortcut is exposed.

## Verification

- Web: `node --experimental-vm-modules --test` over `test` and `src` test files,
  excluding the two emulator-only suites: 684 passed.
- Backend: `node --test` over `functions/test`: 1,074 passed, four existing skips.
- Firestore and Storage emulators: 29 passed, including role/lineage/workbase,
  no self-review, forged metadata/authority, exact versions, competing saves,
  idempotent retry, immutable copied evidence, original-file overwrite, Pass locks,
  delayed backend writes, history read boundaries and generated-report ownership.
  The hosted check found and corrected omitted ward/district/town read permissions;
  regression checks cover both the web boundary query and mobile geography reads.
  Current nested phone/office evidence paths and account-data uploads are covered.
- Changed-file ESLint: no errors, two existing unused-helper warnings.
- DEV environment verified; Vite build passed. Browser fixture exercised Fail's
  required fields, Pass with optional comment, final-lock feedback and modal layout.
- No real transaction was passed or failed by these automated tests.

## Security boundary and deployment dependencies

Firestore denies direct transaction, QA and history writes. QA callables reread
trusted authority in the decision transaction. Source snapshots and history are
permanent. Storage rules use permanent filename locks and server-owned,
generation-specific evidence copies. Storage's service agent requires the Firebase
Rules Firestore service-agent role for cross-service evidence locks.

Existing general registry/directory reads remain available to the currently permitted
active roles; the separate complete governance/read-scope redesign is not finished.
The QA callable's read and write scopes are enforced now. Existing onboarding UI
flags confer no authority. See `auth/firestore-security-rules.md` for the audited matrix.

Deploy the changed callable/trigger names, Firestore rules and Storage rules before
exposing the web controls. Build/deploy only the fetched GitHub main tree. Verify the
served JavaScript hash, Firebase project and deployed function revisions. No TEST or
LIVE promotion is included in this go.

## Historical data readiness

The read-only DEV census found 567 eligible submitted TRNs and 38 unfinished records.
Mandy's existing active RSTE SPV profile can review 482; her own submissions and other
contractors' work are excluded. Nineteen submissions lack provider ownership and
need evidence-based correction before a reviewer can be authorised. No Thando MNC
SPV account was independently established by the census; no role was changed.
Unknown historical capture times remain unknown. There is no age cutoff or bulk
backfill inventing capture facts.
