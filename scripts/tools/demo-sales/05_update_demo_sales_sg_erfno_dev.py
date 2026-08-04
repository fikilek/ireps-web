#!/usr/bin/env python3
"""
05_update_demo_sales_sg_erfno_dev.py

Guarded DEV enrichment for ireps2/demo_sales_meters.

Default mode is DRY RUN:
- validates the approved 8,034-record manifest;
- confirms every target Firestore document exists;
- checks identity and existing root sgCode / erfNo values;
- produces reports;
- performs zero writes.

Apply mode:
- requires --apply and --confirm-write-count 8034;
- updates only root fields sgCode and erfNo;
- performs full read-back verification.

No other document fields are changed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

EXPECTED_PROJECT = "ireps2"
COLLECTION = "demo_sales_meters"
EXPECTED_MANIFEST_COUNT = 8_034
READ_CHUNK_SIZE = 300
DEFAULT_WRITE_BATCH_SIZE = 400


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Dry-run or apply the approved demo_sales_meters "
            "SG Code and Erf No enrichment."
        )
    )
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--confirm-project", required=True)
    parser.add_argument("--service-account", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--report-dir", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-write-count", type=int)
    parser.add_argument(
        "--write-batch-size",
        type=int,
        default=DEFAULT_WRITE_BATCH_SIZE,
    )
    return parser.parse_args()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def new_run_id(apply_mode: bool) -> str:
    mode = "APPLY" if apply_mode else "DRYRUN"
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"DEMO_SALES_SG_ERFNO_{mode}_{timestamp}"


def clean(value: Any) -> str:
    return "" if value is None else str(value).replace("\u00a0", " ").strip()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False, default=str) + "\n",
        encoding="utf-8",
    )


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        for row in rows:
            output.write(
                json.dumps(row, ensure_ascii=False, default=str) + "\n"
            )


def chunks(values: list[Any], size: int) -> Iterable[list[Any]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def load_manifest(path: Path) -> tuple[list[dict[str, Any]], str]:
    raw_bytes = path.read_bytes()
    sha256 = hashlib.sha256(raw_bytes).hexdigest()

    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as source:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue

            value = json.loads(line)
            doc_id = clean(value.get("docId"))
            meter_number = clean(value.get("meterNumber"))
            account_number = clean(value.get("accountNumber"))
            sg_code = clean(value.get("sgCode"))
            erf_no = clean(value.get("erfNo"))
            resolution_method = clean(value.get("resolutionMethod"))
            preflight_status = clean(value.get("preflightStatus"))

            errors: list[str] = []
            if not doc_id:
                errors.append("docId missing")
            if meter_number and meter_number != doc_id:
                errors.append("meterNumber does not equal docId")
            if not sg_code:
                errors.append("sgCode missing")
            if not erf_no:
                errors.append("erfNo missing")

            rows.append(
                {
                    "lineNumber": line_number,
                    "docId": doc_id,
                    "meterNumber": meter_number or doc_id,
                    "accountNumber": account_number,
                    "sgCode": sg_code,
                    "erfNo": erf_no,
                    "resolutionMethod": resolution_method,
                    "preflightStatus": preflight_status,
                    "manifestErrors": errors,
                }
            )

    duplicate_doc_ids = [
        doc_id
        for doc_id, count in Counter(
            row["docId"] for row in rows
        ).items()
        if doc_id and count > 1
    ]

    manifest_errors = [
        row
        for row in rows
        if row["manifestErrors"]
    ]

    if len(rows) != EXPECTED_MANIFEST_COUNT:
        raise SystemExit(
            f"Blocked: manifest contains {len(rows):,} rows; "
            f"expected {EXPECTED_MANIFEST_COUNT:,}."
        )

    if duplicate_doc_ids:
        raise SystemExit(
            f"Blocked: manifest has {len(duplicate_doc_ids):,} "
            "duplicate document IDs."
        )

    if manifest_errors:
        raise SystemExit(
            f"Blocked: {len(manifest_errors):,} manifest rows are invalid."
        )

    return rows, sha256


def initialise_firestore(service_account_path: Path):
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError as exc:
        raise SystemExit(
            "firebase-admin is required. Install it with: "
            "python -m pip install firebase-admin"
        ) from exc

    service_account = json.loads(
        service_account_path.read_text(encoding="utf-8")
    )

    credential_project = service_account.get("project_id")
    if credential_project != EXPECTED_PROJECT:
        raise SystemExit(
            f"Blocked: service account project is {credential_project!r}; "
            f"expected {EXPECTED_PROJECT!r}."
        )

    if not firebase_admin._apps:
        firebase_admin.initialize_app(
            credentials.Certificate(str(service_account_path)),
            {"projectId": EXPECTED_PROJECT},
        )

    return firestore.client()


def read_target_documents(
    db,
    manifest_rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    assessed: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []
    processed = 0

    for group in chunks(manifest_rows, READ_CHUNK_SIZE):
        references = [
            db.collection(COLLECTION).document(row["docId"])
            for row in group
        ]
        manifest_by_id = {
            row["docId"]: row
            for row in group
        }

        for snapshot in db.get_all(references):
            doc_id = snapshot.id
            manifest_row = manifest_by_id[doc_id]

            if not snapshot.exists:
                missing.append(
                    {
                        **manifest_row,
                        "reason": "FIRESTORE_DOCUMENT_MISSING",
                    }
                )
                continue

            data = snapshot.to_dict() or {}
            firestore_meter_number = clean(
                data.get("MeterNumber")
                or data.get("meterNumber")
                or doc_id
            )
            firestore_account_number = clean(
                data.get("AccountNumberNormalized")
                or data.get("AccountNumber")
            )
            existing_sg_code = clean(data.get("sgCode"))
            existing_erf_no = clean(data.get("erfNo"))

            identity_errors: list[str] = []
            if firestore_meter_number != doc_id:
                identity_errors.append(
                    "Firestore MeterNumber does not equal document ID"
                )
            if (
                manifest_row["accountNumber"]
                and firestore_account_number
                and manifest_row["accountNumber"] != firestore_account_number
            ):
                identity_errors.append(
                    "Manifest AccountNumber differs from Firestore"
                )

            sg_conflict = bool(
                existing_sg_code
                and existing_sg_code != manifest_row["sgCode"]
            )
            erf_conflict = bool(
                existing_erf_no
                and existing_erf_no != manifest_row["erfNo"]
            )

            if identity_errors:
                state = "IDENTITY_CONFLICT"
            elif sg_conflict or erf_conflict:
                state = "EXISTING_VALUE_CONFLICT"
            elif (
                existing_sg_code == manifest_row["sgCode"]
                and existing_erf_no == manifest_row["erfNo"]
            ):
                state = "ALREADY_MATCHING"
            else:
                state = "READY_TO_UPDATE"

            assessed.append(
                {
                    **manifest_row,
                    "firestoreMeterNumber": firestore_meter_number,
                    "firestoreAccountNumber": firestore_account_number,
                    "existingSgCode": existing_sg_code or None,
                    "existingErfNo": existing_erf_no or None,
                    "assessmentState": state,
                    "identityErrors": identity_errors,
                    "sgCodeConflict": sg_conflict,
                    "erfNoConflict": erf_conflict,
                }
            )

        processed += len(group)
        print(
            f"Preflight documents checked: "
            f"{processed:,}/{len(manifest_rows):,}"
        )

    assessed.sort(key=lambda row: row["docId"])
    missing.sort(key=lambda row: row["docId"])
    return assessed, missing


def apply_updates(
    db,
    rows_to_update: list[dict[str, Any]],
    batch_size: int,
) -> int:
    if batch_size < 1 or batch_size > 500:
        raise SystemExit("--write-batch-size must be between 1 and 500.")

    written = 0
    total = len(rows_to_update)

    for batch_number, group in enumerate(
        chunks(rows_to_update, batch_size),
        start=1,
    ):
        batch = db.batch()

        for row in group:
            reference = db.collection(COLLECTION).document(row["docId"])
            batch.update(
                reference,
                {
                    "sgCode": row["sgCode"],
                    "erfNo": row["erfNo"],
                },
            )

        batch.commit()
        written += len(group)
        print(
            f"Write batch {batch_number}: "
            f"{written:,}/{total:,} documents updated"
        )

    return written


def verify_updates(
    db,
    manifest_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    failures: list[dict[str, Any]] = []
    processed = 0

    for group in chunks(manifest_rows, READ_CHUNK_SIZE):
        references = [
            db.collection(COLLECTION).document(row["docId"])
            for row in group
        ]
        manifest_by_id = {
            row["docId"]: row
            for row in group
        }

        for snapshot in db.get_all(references):
            row = manifest_by_id[snapshot.id]

            if not snapshot.exists:
                failures.append(
                    {
                        **row,
                        "reason": "DOCUMENT_MISSING_DURING_VERIFICATION",
                    }
                )
                continue

            data = snapshot.to_dict() or {}
            actual_sg_code = clean(data.get("sgCode"))
            actual_erf_no = clean(data.get("erfNo"))

            if (
                actual_sg_code != row["sgCode"]
                or actual_erf_no != row["erfNo"]
            ):
                failures.append(
                    {
                        **row,
                        "reason": "READ_BACK_VALUE_MISMATCH",
                        "actualSgCode": actual_sg_code or None,
                        "actualErfNo": actual_erf_no or None,
                    }
                )

        processed += len(group)
        print(
            f"Verification documents checked: "
            f"{processed:,}/{len(manifest_rows):,}"
        )

    return failures


def main() -> None:
    args = parse_args()

    if args.project_id != EXPECTED_PROJECT:
        raise SystemExit(
            f"Blocked: --project-id must be exactly {EXPECTED_PROJECT}."
        )

    if args.confirm_project != args.project_id:
        raise SystemExit(
            "Blocked: --confirm-project must exactly match --project-id."
        )

    if args.apply and args.confirm_write_count != EXPECTED_MANIFEST_COUNT:
        raise SystemExit(
            "Blocked: apply mode requires "
            f"--confirm-write-count {EXPECTED_MANIFEST_COUNT}."
        )

    if not args.apply and args.confirm_write_count is not None:
        raise SystemExit(
            "--confirm-write-count is only valid together with --apply."
        )

    service_account_path = args.service_account.expanduser().resolve()
    manifest_path = args.manifest.expanduser().resolve()
    report_parent = args.report_dir.expanduser().resolve()

    if not service_account_path.is_file():
        raise SystemExit(
            f"Service account not found: {service_account_path}"
        )

    if not manifest_path.is_file():
        raise SystemExit(f"Manifest not found: {manifest_path}")

    manifest_rows, manifest_sha256 = load_manifest(manifest_path)

    run_id = new_run_id(args.apply)
    report_root = report_parent / run_id
    report_root.mkdir(parents=True, exist_ok=False)

    print("")
    print("==============================================")
    print("DEMO SALES SG CODE / ERF NO UPDATE")
    print("==============================================")
    print(f"Run ID:          {run_id}")
    print(f"Project:         {EXPECTED_PROJECT}")
    print(f"Collection:      {COLLECTION}")
    print(f"Mode:            {'APPLY' if args.apply else 'DRY RUN'}")
    print(f"Manifest rows:   {len(manifest_rows):,}")
    print(f"Manifest SHA256: {manifest_sha256}")
    print(f"Report folder:   {report_root}")
    print("")

    db = initialise_firestore(service_account_path)

    assessed, missing = read_target_documents(db, manifest_rows)

    state_counts = Counter(
        row["assessmentState"]
        for row in assessed
    )
    identity_conflicts = [
        row for row in assessed
        if row["assessmentState"] == "IDENTITY_CONFLICT"
    ]
    value_conflicts = [
        row for row in assessed
        if row["assessmentState"] == "EXISTING_VALUE_CONFLICT"
    ]
    ready_to_update = [
        row for row in assessed
        if row["assessmentState"] == "READY_TO_UPDATE"
    ]
    already_matching = [
        row for row in assessed
        if row["assessmentState"] == "ALREADY_MATCHING"
    ]

    blockers = (
        len(missing)
        + len(identity_conflicts)
        + len(value_conflicts)
    )

    preflight_summary = {
        "status": "PASSED" if blockers == 0 else "BLOCKED",
        "runId": run_id,
        "generatedAt": now_iso(),
        "mode": "APPLY" if args.apply else "DRY_RUN",
        "projectId": EXPECTED_PROJECT,
        "collection": COLLECTION,
        "manifestPath": str(manifest_path),
        "manifestSha256": manifest_sha256,
        "manifestRows": len(manifest_rows),
        "documentsAssessed": len(assessed),
        "missingDocuments": len(missing),
        "assessmentStateCounts": dict(sorted(state_counts.items())),
        "identityConflicts": len(identity_conflicts),
        "existingValueConflicts": len(value_conflicts),
        "readyToUpdate": len(ready_to_update),
        "alreadyMatching": len(already_matching),
        "blockers": blockers,
        "firestoreWritesPerformed": 0,
    }

    write_json(
        report_root / "01_preflight_summary.json",
        preflight_summary,
    )
    write_jsonl(
        report_root / "02_assessed_manifest.jsonl",
        assessed,
    )
    write_jsonl(
        report_root / "03_missing_documents.jsonl",
        missing,
    )
    write_jsonl(
        report_root / "04_identity_conflicts.jsonl",
        identity_conflicts,
    )
    write_jsonl(
        report_root / "05_existing_value_conflicts.jsonl",
        value_conflicts,
    )
    write_jsonl(
        report_root / "06_ready_to_update.jsonl",
        ready_to_update,
    )
    write_jsonl(
        report_root / "07_already_matching.jsonl",
        already_matching,
    )

    print("")
    print("==============================================")
    print("PREFLIGHT SUMMARY")
    print("==============================================")
    print(f"Status:                    {preflight_summary['status']}")
    print(f"Documents assessed:        {len(assessed):,}")
    print(f"Missing documents:         {len(missing):,}")
    print(f"Identity conflicts:        {len(identity_conflicts):,}")
    print(f"Existing-value conflicts:  {len(value_conflicts):,}")
    print(f"Ready to update:           {len(ready_to_update):,}")
    print(f"Already matching:          {len(already_matching):,}")
    print(f"Blockers:                  {blockers:,}")

    if blockers:
        print("Firestore writes performed: NO")
        raise SystemExit(
            "Blocked: preflight found missing documents or conflicts."
        )

    if not args.apply:
        print("Firestore writes performed: NO")
        print("")
        print("DRY RUN PASSED.")
        return

    written = apply_updates(
        db,
        ready_to_update,
        args.write_batch_size,
    )

    verification_failures = verify_updates(db, manifest_rows)
    write_jsonl(
        report_root / "08_verification_failures.jsonl",
        verification_failures,
    )

    final_summary = {
        **preflight_summary,
        "status": (
            "PASSED"
            if not verification_failures
            else "FAILED_VERIFICATION"
        ),
        "firestoreWritesPerformed": written,
        "documentsUpdated": written,
        "documentsAlreadyMatching": len(already_matching),
        "documentsVerified": len(manifest_rows),
        "verificationFailures": len(verification_failures),
        "completedAt": now_iso(),
    }
    write_json(
        report_root / "09_final_summary.json",
        final_summary,
    )

    print("")
    print("==============================================")
    print("APPLY AND VERIFICATION SUMMARY")
    print("==============================================")
    print(f"Documents updated:         {written:,}")
    print(f"Already matching:          {len(already_matching):,}")
    print(f"Documents verified:        {len(manifest_rows):,}")
    print(f"Verification failures:     {len(verification_failures):,}")
    print(f"Final status:              {final_summary['status']}")
    print(f"Report folder:             {report_root}")

    if verification_failures:
        raise SystemExit(
            "Writes completed, but read-back verification FAILED."
        )


if __name__ == "__main__":
    main()
