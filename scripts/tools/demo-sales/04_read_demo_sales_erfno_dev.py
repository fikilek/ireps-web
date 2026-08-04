#!/usr/bin/env python3
"""
04_read_demo_sales_erfno_dev.py

Governed read-only assessment of Endumeni DEV demo_sales_meters.

Purpose:
- Read every document from ireps2/demo_sales_meters.
- Inventory the existing SG Code source fields.
- Inventory existing ERF-number fields.
- Produce manifests needed for the later Consolidated Roll exact SG Code join.

This script performs zero Firestore writes.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

EXPECTED_PROJECT = "ireps2"
COLLECTION = "demo_sales_meters"
EXPECTED_DOCUMENT_COUNT = 10_216
PROGRESS_INTERVAL = 1_000

SG_CODE_FIELDS = ("sgCode", "SGCode", "StandNumber", "standNumber")
ROOT_ERF_NO_FIELDS = ("erfNo", "ErfNo", "erfNumber", "ErfNumber")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only demo_sales_meters SG Code and ERF-number assessment."
    )
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--confirm-project", required=True)
    parser.add_argument("--service-account", required=True, type=Path)
    parser.add_argument("--report-dir", required=True, type=Path)
    parser.add_argument(
        "--expected-document-count",
        type=int,
        default=EXPECTED_DOCUMENT_COUNT,
    )
    return parser.parse_args()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def run_id() -> str:
    return datetime.now(timezone.utc).strftime("DEMO_SALES_ERFNO_READ_%Y%m%dT%H%M%SZ")


def text(value: Any) -> str:
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


def init_firestore(service_account_path: Path):
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError as exc:
        raise SystemExit(
            "firebase-admin is required. Install with: pip install firebase-admin"
        ) from exc

    if not firebase_admin._apps:
        firebase_admin.initialize_app(
            credentials.Certificate(str(service_account_path)),
            {"projectId": EXPECTED_PROJECT},
        )

    return firestore.client()


def first_nonblank_field(
    data: dict[str, Any],
    candidates: tuple[str, ...],
) -> tuple[str | None, str]:
    for field in candidates:
        value = text(data.get(field))
        if value:
            return field, value
    return None, ""


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    result: list[str] = []
    seen: set[str] = set()

    for item in value:
        normalized = text(item)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)

    return result


def candidate_values(data: dict[str, Any]) -> tuple[list[str], list[str]]:
    erf_ids: list[str] = []
    erf_numbers: list[str] = []
    seen_ids: set[str] = set()
    seen_numbers: set[str] = set()

    candidates = data.get("ErfCandidates")
    if not isinstance(candidates, list):
        candidates = data.get("erfCandidates")
    if not isinstance(candidates, list):
        candidates = []

    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue

        erf_id = text(candidate.get("ErfId") or candidate.get("erfId"))
        erf_number = text(
            candidate.get("ErfNumber")
            or candidate.get("erfNumber")
            or candidate.get("ErfNo")
            or candidate.get("erfNo")
        )

        if erf_id and erf_id not in seen_ids:
            seen_ids.add(erf_id)
            erf_ids.append(erf_id)

        if erf_number and erf_number not in seen_numbers:
            seen_numbers.add(erf_number)
            erf_numbers.append(erf_number)

    return erf_ids, erf_numbers


def main() -> None:
    args = parse_args()

    service_account_path = args.service_account.expanduser().resolve()
    report_parent = args.report_dir.expanduser().resolve()

    if args.project_id != EXPECTED_PROJECT:
        raise SystemExit(f"Blocked: project must be exactly {EXPECTED_PROJECT}")

    if args.confirm_project != args.project_id:
        raise SystemExit("--confirm-project must exactly match --project-id")

    if not service_account_path.is_file():
        raise SystemExit(f"Service account not found: {service_account_path}")

    service_account = json.loads(
        service_account_path.read_text(encoding="utf-8")
    )

    credential_project = service_account.get("project_id")
    if credential_project != EXPECTED_PROJECT:
        raise SystemExit(
            f"Blocked: service account project is {credential_project!r}; "
            f"expected {EXPECTED_PROJECT!r}"
        )

    current_run_id = run_id()
    report_root = report_parent / current_run_id
    report_root.mkdir(parents=True, exist_ok=False)

    print("")
    print("==============================================")
    print("DEMO SALES SG CODE / ERF NO READ")
    print("==============================================")
    print(f"Run ID:      {current_run_id}")
    print(f"Project:     {EXPECTED_PROJECT}")
    print(f"Collection:  {COLLECTION}")
    print(f"Mode:        READ ONLY")
    print(f"Report root: {report_root}")
    print("Firestore writes performed: NO")
    print("")

    db = init_firestore(service_account_path)

    records: list[dict[str, Any]] = []
    root_field_counts: Counter[str] = Counter()
    sg_source_field_counts: Counter[str] = Counter()
    root_erf_source_field_counts: Counter[str] = Counter()

    print("Reading Firestore demo_sales_meters...")

    for snapshot in db.collection(COLLECTION).stream():
        data = snapshot.to_dict() or {}
        doc_id = text(snapshot.id)

        for field in data:
            root_field_counts[str(field)] += 1

        sg_field, sg_code = first_nonblank_field(data, SG_CODE_FIELDS)
        root_erf_field, root_erf_no = first_nonblank_field(
            data, ROOT_ERF_NO_FIELDS
        )

        if sg_field:
            sg_source_field_counts[sg_field] += 1

        if root_erf_field:
            root_erf_source_field_counts[root_erf_field] += 1

        root_erf_numbers = string_list(
            data.get("ErfNumbers")
            if data.get("ErfNumbers") is not None
            else data.get("erfNumbers")
        )

        candidate_erf_ids, candidate_erf_numbers = candidate_values(data)

        records.append(
            {
                "docId": doc_id,
                "meterNumber": text(
                    data.get("MeterNumber")
                    or data.get("meterNumber")
                    or data.get("meterNo")
                    or doc_id
                ),
                "sgCodeSourceField": sg_field,
                "sgCode": sg_code or None,
                "rootErfNoSourceField": root_erf_field,
                "rootErfNo": root_erf_no or None,
                "erfNumbers": root_erf_numbers,
                "candidateErfIds": candidate_erf_ids,
                "candidateErfNumbers": candidate_erf_numbers,
                "erfCandidateCountStored": data.get("ErfCandidateCount"),
                "standNumberRaw": data.get("StandNumber"),
            }
        )

        if len(records) % PROGRESS_INTERVAL == 0:
            print(f"Firestore documents read: {len(records):,}")

    records.sort(key=lambda item: item["docId"])

    print(f"Firestore documents read: {len(records):,} COMPLETE")

    docs_with_sg = sum(1 for item in records if item["sgCode"])
    docs_without_sg = len(records) - docs_with_sg
    docs_with_root_erf_no = sum(1 for item in records if item["rootErfNo"])
    docs_with_erf_numbers = sum(1 for item in records if item["erfNumbers"])
    docs_with_candidate_erf_number = sum(
        1 for item in records if item["candidateErfNumbers"]
    )
    docs_with_single_candidate_erf_number = sum(
        1 for item in records if len(item["candidateErfNumbers"]) == 1
    )
    docs_with_multiple_candidate_erf_numbers = sum(
        1 for item in records if len(item["candidateErfNumbers"]) > 1
    )

    sg_to_docs: dict[str, list[str]] = {}
    for item in records:
        sg_code = item["sgCode"]
        if not sg_code:
            continue
        sg_to_docs.setdefault(sg_code, []).append(item["docId"])

    duplicate_sg_groups = [
        {
            "sgCode": sg_code,
            "documentCount": len(document_ids),
            "documentIds": document_ids,
        }
        for sg_code, document_ids in sorted(sg_to_docs.items())
        if len(document_ids) > 1
    ]

    count_errors: list[str] = []
    if len(records) != args.expected_document_count:
        count_errors.append(
            f"Expected {args.expected_document_count:,} documents "
            f"but read {len(records):,}."
        )

    summary = {
        "status": "PASSED" if not count_errors else "FAILED",
        "runId": current_run_id,
        "generatedAt": now_iso(),
        "mode": "READ_ONLY",
        "projectId": EXPECTED_PROJECT,
        "collection": COLLECTION,
        "expectedDocumentCount": args.expected_document_count,
        "documentsRead": len(records),
        "documentsWithSgCode": docs_with_sg,
        "documentsWithoutSgCode": docs_without_sg,
        "uniqueNonblankSgCodes": len(sg_to_docs),
        "duplicateSgCodeGroups": len(duplicate_sg_groups),
        "documentsWithRootErfNo": docs_with_root_erf_no,
        "documentsWithErfNumbersArray": docs_with_erf_numbers,
        "documentsWithCandidateErfNumber": docs_with_candidate_erf_number,
        "documentsWithSingleCandidateErfNumber":
            docs_with_single_candidate_erf_number,
        "documentsWithMultipleCandidateErfNumbers":
            docs_with_multiple_candidate_erf_numbers,
        "sgCodeSourceFieldDistribution":
            dict(sorted(sg_source_field_counts.items())),
        "rootErfNoSourceFieldDistribution":
            dict(sorted(root_erf_source_field_counts.items())),
        "countErrors": count_errors,
        "firestoreWritesAttempted": 0,
        "firestoreWritesPerformed": False,
    }

    write_json(report_root / "01_read_summary.json", summary)
    write_json(
        report_root / "02_root_field_inventory.json",
        {
            "documentsRead": len(records),
            "fields": [
                {
                    "field": field,
                    "documentsWithField": count,
                    "documentsMissingField": len(records) - count,
                }
                for field, count in sorted(root_field_counts.items())
            ],
        },
    )
    write_jsonl(
        report_root / "manifest_demo_sales_sg_erf.jsonl",
        records,
    )
    write_jsonl(
        report_root / "manifest_missing_sg_code.jsonl",
        (item for item in records if not item["sgCode"]),
    )
    write_jsonl(
        report_root / "manifest_duplicate_sg_code_groups.jsonl",
        duplicate_sg_groups,
    )
    write_jsonl(
        report_root / "manifest_multiple_candidate_erf_numbers.jsonl",
        (
            item
            for item in records
            if len(item["candidateErfNumbers"]) > 1
        ),
    )

    print("")
    print("==============================================")
    print("DEMO SALES READ SUMMARY")
    print("==============================================")
    print(f"Status:                              {summary['status']}")
    print(f"Documents read:                      {len(records):,}")
    print(f"Documents with SG Code:              {docs_with_sg:,}")
    print(f"Documents without SG Code:           {docs_without_sg:,}")
    print(f"Unique nonblank SG Codes:            {len(sg_to_docs):,}")
    print(f"Duplicate SG Code groups:            {len(duplicate_sg_groups):,}")
    print(f"Documents with root erfNo:           {docs_with_root_erf_no:,}")
    print(f"Documents with ErfNumbers array:     {docs_with_erf_numbers:,}")
    print(
        "Documents with candidate ErfNumber: "
        f"{docs_with_candidate_erf_number:,}"
    )
    print(
        "Multiple candidate ErfNumber docs:  "
        f"{docs_with_multiple_candidate_erf_numbers:,}"
    )
    print(f"Report folder:                       {report_root}")
    print("Firestore writes performed:          NO")

    for error in count_errors:
        print(f"COUNT ERROR: {error}")

    if count_errors:
        raise SystemExit("Read completed, but expected document count FAILED.")


if __name__ == "__main__":
    main()
