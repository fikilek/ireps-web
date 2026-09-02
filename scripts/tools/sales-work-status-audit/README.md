# Sales Work Status Integrity Audit v1

Read-only forensic audit of LIVE Endumeni data.

**Hard scope**
- Project: `ireps-5c3e9`
- Environment: `LIVE`
- LM: `ZA5241` / Endumeni
- Firestore writes: **none**

**Reads**
- `sales-all-meters`
- `asts`
- `registry_meters`

**Classification**

- exact `master.visibility == "VISIBLE"` => `COMPLETED`
- otherwise, an individually classifiable canonical reference whose exact
  `fieldWork.status == "IN_PROGRESS"` => `IN_PROGRESS`
- otherwise => `NOT_STARTED`

The raw reference source is selected by field presence: canonical `tbRefs`
wins whenever it is present; only an absent canonical field falls back to
legacy `TbRefs`. Reference validity, duplicate logical identity, and exact
correlation-key ambiguity are evaluated per raw entry. Aggregate `valid` and
`issues` remain available as separate diagnostics.

The audit reconstructs the old Sales, Meter Registry, and Sales-specific AST
API projections before reproducing the retired browser classifier. Meter
identity normalization exactly follows JavaScript: remove ECMAScript
whitespace, uppercase, then accept ASCII `[A-Z0-9]+` only.

VISIBLE rows that do not reconcile to AST + Registry are exported as integrity exceptions.
Additional external diagnostics include
`SALES_EXACT_METER_DISCOVERED_BUT_INVISIBLE`,
`SALES_METER_MATCH_INCONSISTENT`,
`SALES_TBREFS_CANONICAL_NULL_WITH_LEGACY`, and
`SALES_TBREF_LEGACY_IDENTITY_ONLY`. None introduces a fourth public status.

The run emits old-audit-to-new and old-frontend-to-new transition matrices,
row-level transition reasons, preflight gate evidence, and a manifest with
`firestoreWritesPerformed: false`.

Run pure parity tests without credentials:

```powershell
python -m unittest discover -s .\scripts\tools\sales-work-status-audit -p "test_*.py" -v
```

Run from `C:\dev\ireps-web`:

```powershell
python .\scripts\tools\sales-work-status-audit\01_audit_sales_work_status_readonly.py `
  --project-id ireps-5c3e9 `
  --confirm-project ireps-5c3e9 `
  --environment LIVE `
  --lm-pcode ZA5241 `
  --lm-name Endumeni `
  --service-account "<PATH_TO_LIVE_SERVICE_ACCOUNT_JSON>" `
  --report-dir ".\docs\reports\sales-work-status-audit"
```
