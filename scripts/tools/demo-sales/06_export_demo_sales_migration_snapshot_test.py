#!/usr/bin/env python3
"""
Read-only export of ireps-test/demo_sales_meters for the Demo Sales -> Sales All migration.

This tool performs Firestore READS ONLY. It never creates, updates, or deletes Firestore data.

Outputs a unique run folder under:
  docs/reports/demo-sales-migration-export/

Primary artifact:
  01_RAW_MIGRATION_SNAPSHOT.jsonl

Each JSONL line is an envelope:
  {
    "documentId": "...",
    "documentPath": "demo_sales_meters/...",
    "data": { ...exact document fields serialized to JSON-safe values... }
  }

Firestore-native values that JSON cannot represent directly are tagged so that the raw
snapshot does not silently lose their type (for example Timestamp, GeoPoint, bytes, and
DocumentReference).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
    from google.cloud.firestore_v1.document import DocumentReference
    from google.cloud.firestore_v1._helpers import GeoPoint
except ImportError as exc:  # pragma: no cover - environment guard
    print(
        "[ERROR] Required Firebase/Firestore Python packages are not installed.\n"
        "        Install the repository's existing dependencies before running this tool.\n"
        f"        Import error: {exc}",
        file=sys.stderr,
    )
    raise SystemExit(2) from exc


LOCKED_PROJECT_ID = "ireps-test"
LOCKED_COLLECTION = "demo_sales_meters"
DEFAULT_PAGE_SIZE = 500
REPORT_ROOT_RELATIVE = Path("docs") / "reports" / "demo-sales-migration-export"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "READ-ONLY export of ireps-test/demo_sales_meters into an immutable raw JSONL "
            "migration snapshot plus verification reports."
        )
    )
    parser.add_argument(
        "--service-account",
        required=True,
        help="Path to the ireps-test Firebase service-account JSON file.",
    )
    parser.add_argument(
        "--project-id",
        default=LOCKED_PROJECT_ID,
        help=f"Firestore project ID. Locked to {LOCKED_PROJECT_ID!r}.",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=DEFAULT_PAGE_SIZE,
        help=f"Documents per Firestore page (default: {DEFAULT_PAGE_SIZE}).",
    )
    parser.add_argument(
        "--output-root",
        default=None,
        help=(
            "Optional output root. Default: "
            "<ireps-web>/docs/reports/demo-sales-migration-export"
        ),
    )
    return parser.parse_args()


def fail(message: str, exit_code: int = 2) -> "NoReturn":
    print(f"[ERROR] {message}", file=sys.stderr)
    raise SystemExit(exit_code)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_stamp() -> str:
    return utc_now().strftime("%Y%m%dT%H%M%SZ")


def read_service_account_project_id(path: Path) -> str:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"Service-account file not found: {path}")
    except json.JSONDecodeError as exc:
        fail(f"Service-account file is not valid JSON: {path}: {exc}")

    project_id = str(payload.get("project_id") or "").strip()
    if not project_id:
        fail(f"Service-account JSON does not contain project_id: {path}")
    return project_id


def repo_root_from_script() -> Path:
    # scripts/tools/demo-sales/<this file> -> repository root is parents[3]
    return Path(__file__).resolve().parents[3]


def ensure_locked_environment(args: argparse.Namespace) -> Tuple[Path, Path]:
    project_id = str(args.project_id or "").strip()
    if project_id != LOCKED_PROJECT_ID:
        fail(
            f"Refusing to run against project {project_id!r}. "
            f"This migration export tool is locked to {LOCKED_PROJECT_ID!r}."
        )

    if args.page_size < 1 or args.page_size > 1000:
        fail("--page-size must be between 1 and 1000.")

    service_account = Path(args.service_account).expanduser().resolve()
    service_project_id = read_service_account_project_id(service_account)
    if service_project_id != LOCKED_PROJECT_ID:
        fail(
            "Service-account project mismatch. "
            f"Expected {LOCKED_PROJECT_ID!r}, found {service_project_id!r}."
        )

    repo_root = repo_root_from_script()
    output_root = (
        Path(args.output_root).expanduser().resolve()
        if args.output_root
        else (repo_root / REPORT_ROOT_RELATIVE)
    )

    return service_account, output_root


def init_firestore(service_account: Path):
    app_name = f"demo-sales-migration-export-{os.getpid()}"
    cred = credentials.Certificate(str(service_account))
    app = firebase_admin.initialize_app(
        cred,
        {"projectId": LOCKED_PROJECT_ID},
        name=app_name,
    )
    db = firestore.client(app=app)

    client_project = str(getattr(db, "project", "") or "").strip()
    if client_project and client_project != LOCKED_PROJECT_ID:
        fail(
            f"Connected Firestore client reports project {client_project!r}; "
            f"expected {LOCKED_PROJECT_ID!r}."
        )
    return app, db


def value_type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) and not isinstance(value, bool):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, datetime):
        return "firestore_timestamp"
    if isinstance(value, date):
        return "date"
    if isinstance(value, GeoPoint):
        return "firestore_geopoint"
    if isinstance(value, DocumentReference):
        return "firestore_document_reference"
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "bytes"
    if isinstance(value, Mapping):
        return "map"
    if isinstance(value, (list, tuple)):
        return "array"
    return f"python:{type(value).__module__}.{type(value).__name__}"


def json_safe(value: Any) -> Any:
    """Serialize Firestore values without silently discarding non-JSON native types."""
    if value is None or isinstance(value, (bool, int, str)):
        return value

    if isinstance(value, float):
        if math.isnan(value):
            return {"__firestoreType": "Number", "value": "NaN"}
        if math.isinf(value):
            return {
                "__firestoreType": "Number",
                "value": "Infinity" if value > 0 else "-Infinity",
            }
        return value

    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt_utc = dt.astimezone(timezone.utc)
        return {
            "__firestoreType": "Timestamp",
            "isoUtc": dt_utc.isoformat().replace("+00:00", "Z"),
        }

    if isinstance(value, date):
        return {"__firestoreType": "Date", "iso": value.isoformat()}

    if isinstance(value, GeoPoint):
        return {
            "__firestoreType": "GeoPoint",
            "latitude": value.latitude,
            "longitude": value.longitude,
        }

    if isinstance(value, DocumentReference):
        return {
            "__firestoreType": "DocumentReference",
            "path": value.path,
        }

    if isinstance(value, (bytes, bytearray, memoryview)):
        return {
            "__firestoreType": "Bytes",
            "base64": base64.b64encode(bytes(value)).decode("ascii"),
        }

    if isinstance(value, Mapping):
        return {str(k): json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]

    # Do not silently stringify unknown Firestore/Python values. Preserve an explicit tag.
    return {
        "__firestoreType": "UnknownPythonValue",
        "pythonType": f"{type(value).__module__}.{type(value).__name__}",
        "repr": repr(value),
    }


def write_json(path: Path, payload: Any) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def paged_snapshots(collection_ref, page_size: int) -> Iterable[List[Any]]:
    last_snapshot = None
    while True:
        query = collection_ref.order_by("__name__").limit(page_size)
        if last_snapshot is not None:
            query = query.start_after(last_snapshot)

        page = list(query.stream())
        if not page:
            break

        yield page
        last_snapshot = page[-1]

        if len(page) < page_size:
            break


def verify_local_snapshot(path: Path) -> Dict[str, Any]:
    line_count = 0
    doc_ids = set()
    duplicate_doc_ids: List[str] = []
    invalid_lines: List[Dict[str, Any]] = []

    with path.open("r", encoding="utf-8") as handle:
        for line_no, raw in enumerate(handle, start=1):
            raw = raw.rstrip("\n")
            if not raw:
                invalid_lines.append({"line": line_no, "reason": "EMPTY_LINE"})
                continue
            try:
                row = json.loads(raw)
            except json.JSONDecodeError as exc:
                invalid_lines.append(
                    {"line": line_no, "reason": "INVALID_JSON", "detail": str(exc)}
                )
                continue

            line_count += 1
            doc_id = row.get("documentId")
            if not isinstance(doc_id, str) or not doc_id:
                invalid_lines.append(
                    {"line": line_no, "reason": "MISSING_DOCUMENT_ID"}
                )
                continue
            if doc_id in doc_ids:
                duplicate_doc_ids.append(doc_id)
            doc_ids.add(doc_id)

            if row.get("documentPath") != f"{LOCKED_COLLECTION}/{doc_id}":
                invalid_lines.append(
                    {"line": line_no, "reason": "DOCUMENT_PATH_MISMATCH", "documentId": doc_id}
                )
            if not isinstance(row.get("data"), dict):
                invalid_lines.append(
                    {"line": line_no, "reason": "DATA_NOT_OBJECT", "documentId": doc_id}
                )

    return {
        "lineCount": line_count,
        "uniqueDocumentIds": len(doc_ids),
        "duplicateDocumentIds": duplicate_doc_ids,
        "invalidLineCount": len(invalid_lines),
        "invalidLines": invalid_lines[:100],
        "invalidLinesTruncated": len(invalid_lines) > 100,
        "passed": len(duplicate_doc_ids) == 0 and len(invalid_lines) == 0,
    }


def main() -> int:
    args = parse_args()
    service_account, output_root = ensure_locked_environment(args)

    run_id = f"DEMO_SALES_MIGRATION_EXPORT_{utc_stamp()}"
    run_dir = output_root / run_id
    if run_dir.exists():
        fail(f"Run directory already exists; refusing to overwrite: {run_dir}")
    run_dir.mkdir(parents=True, exist_ok=False)

    snapshot_partial = run_dir / "01_RAW_MIGRATION_SNAPSHOT.jsonl.partial"
    snapshot_final = run_dir / "01_RAW_MIGRATION_SNAPSHOT.jsonl"
    root_inventory_path = run_dir / "02_ROOT_FIELD_INVENTORY.json"
    verification_path = run_dir / "03_LOCAL_SNAPSHOT_VERIFICATION.json"
    summary_path = run_dir / "04_EXPORT_SUMMARY.json"

    started_at = utc_now()

    print("============================================================")
    print("iREPS TEST DEMO SALES — READ-ONLY MIGRATION EXPORT")
    print("============================================================")
    print(f"Project     : {LOCKED_PROJECT_ID}")
    print(f"Collection  : {LOCKED_COLLECTION}")
    print(f"Page size   : {args.page_size}")
    print(f"Output      : {run_dir}")
    print("Firestore writes: NONE")
    print("============================================================")

    app = None
    exported_count = 0
    page_count = 0
    field_presence: Counter[str] = Counter()
    field_types: MutableMapping[str, Counter[str]] = defaultdict(Counter)
    unknown_value_count = 0

    try:
        app, db = init_firestore(service_account)
        collection_ref = db.collection(LOCKED_COLLECTION)

        with snapshot_partial.open("x", encoding="utf-8", newline="\n") as out:
            for page_count, page in enumerate(
                paged_snapshots(collection_ref, args.page_size), start=1
            ):
                for snapshot in page:
                    data = snapshot.to_dict() or {}
                    if not isinstance(data, dict):
                        fail(
                            f"Document {snapshot.id!r} did not deserialize to an object/map."
                        )

                    for field_name, field_value in data.items():
                        field_presence[str(field_name)] += 1
                        field_types[str(field_name)][value_type_name(field_value)] += 1

                    safe_data = json_safe(data)

                    # Count unknown serialized values at any depth without changing the raw data.
                    serialized_probe = json.dumps(safe_data, ensure_ascii=False)
                    unknown_value_count += serialized_probe.count(
                        '"__firestoreType": "UnknownPythonValue"'
                    )

                    envelope = {
                        "documentId": snapshot.id,
                        "documentPath": snapshot.reference.path,
                        "data": safe_data,
                    }
                    out.write(
                        json.dumps(
                            envelope,
                            ensure_ascii=False,
                            sort_keys=True,
                            separators=(",", ":"),
                        )
                    )
                    out.write("\n")
                    exported_count += 1

                out.flush()
                os.fsync(out.fileno())
                print(
                    f"[PAGE {page_count}] exported {len(page):,} docs "
                    f"(total {exported_count:,})"
                )

        if exported_count == 0:
            fail(
                f"Collection {LOCKED_COLLECTION!r} returned zero documents. "
                "Raw snapshot was not finalized."
            )

        # Finalize only after Firestore paging completed successfully.
        snapshot_partial.replace(snapshot_final)

        inventory_rows = []
        for field_name in sorted(field_presence):
            inventory_rows.append(
                {
                    "field": field_name,
                    "documentsPresent": field_presence[field_name],
                    "documentsMissing": exported_count - field_presence[field_name],
                    "presencePercent": round(
                        (field_presence[field_name] / exported_count) * 100.0, 4
                    ),
                    "rootValueTypes": dict(sorted(field_types[field_name].items())),
                }
            )

        root_inventory = {
            "projectId": LOCKED_PROJECT_ID,
            "collection": LOCKED_COLLECTION,
            "documentCount": exported_count,
            "rootFieldCount": len(inventory_rows),
            "fields": inventory_rows,
        }
        write_json(root_inventory_path, root_inventory)

        verification = verify_local_snapshot(snapshot_final)
        verification.update(
            {
                "expectedExportedDocuments": exported_count,
                "countMatchesExport": verification["lineCount"] == exported_count,
            }
        )
        verification["passed"] = bool(
            verification["passed"] and verification["countMatchesExport"]
        )
        write_json(verification_path, verification)

        finished_at = utc_now()
        snapshot_bytes = snapshot_final.stat().st_size
        snapshot_sha256 = sha256_file(snapshot_final)

        summary = {
            "runId": run_id,
            "status": "PASSED" if verification["passed"] else "FAILED",
            "readOnly": True,
            "firestoreWriteOperations": 0,
            "projectId": LOCKED_PROJECT_ID,
            "collection": LOCKED_COLLECTION,
            "startedAtUtc": started_at.isoformat().replace("+00:00", "Z"),
            "finishedAtUtc": finished_at.isoformat().replace("+00:00", "Z"),
            "pageSize": args.page_size,
            "pagesRead": page_count,
            "documentsExported": exported_count,
            "rootFieldCount": len(inventory_rows),
            "unknownPythonValueCount": unknown_value_count,
            "snapshot": {
                "file": snapshot_final.name,
                "bytes": snapshot_bytes,
                "sha256": snapshot_sha256,
            },
            "verification": {
                "lineCount": verification["lineCount"],
                "uniqueDocumentIds": verification["uniqueDocumentIds"],
                "duplicateDocumentIds": len(verification["duplicateDocumentIds"]),
                "invalidLineCount": verification["invalidLineCount"],
                "countMatchesExport": verification["countMatchesExport"],
                "passed": verification["passed"],
            },
            "nextStep": (
                "Inspect the raw snapshot and root-field inventory. Define cleaning rules. "
                "Do not edit 01_RAW_MIGRATION_SNAPSHOT.jsonl."
            ),
        }
        write_json(summary_path, summary)

        print("============================================================")
        print("EXPORT COMPLETE")
        print("============================================================")
        print(f"Status              : {summary['status']}")
        print(f"Documents exported  : {exported_count:,}")
        print(f"Pages read           : {page_count:,}")
        print(f"Root fields observed : {len(inventory_rows):,}")
        print(f"Snapshot bytes       : {snapshot_bytes:,}")
        print(f"Snapshot SHA256      : {snapshot_sha256}")
        print(f"Unknown value tags   : {unknown_value_count:,}")
        print(f"Firestore writes     : 0")
        print(f"Run folder           : {run_dir}")
        print("============================================================")

        if not verification["passed"]:
            print(
                "[ERROR] Local snapshot verification failed. "
                f"Inspect {verification_path}",
                file=sys.stderr,
            )
            return 1

        return 0

    except KeyboardInterrupt:
        print("\n[ABORTED] Export interrupted by user. No Firestore writes were performed.")
        return 130
    except Exception as exc:
        print(f"[ERROR] Export failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        print("[INFO] No Firestore writes were performed.", file=sys.stderr)
        return 1
    finally:
        if app is not None:
            try:
                firebase_admin.delete_app(app)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
