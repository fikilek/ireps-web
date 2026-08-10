#!/usr/bin/env python3
"""Clean and normalize the immutable ireps-test/demo_sales_meters migration snapshot.

READ-ONLY INPUT. NO FIRESTORE ACCESS. NO GIT ACTIONS.

The tool is intentionally migration-specific. It verifies the exact immutable raw
snapshot SHA256 before processing, separates commercial/pipeline input from
operational state, and refuses to mark the run PASSED if any source record is
rejected.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

EXPECTED_RAW_SHA256 = "e8a69bb464b97d8a6866b30b5ceb80ed5ff0c2f41d8e6860e77ec8f30b3769a7"
EXPECTED_DOCUMENT_COUNT = 10_216
EXPECTED_LM_PCODE = "ZA5241"
SOURCE_PROJECT_ID = "ireps-test"
SOURCE_COLLECTION = "demo_sales_meters"
PROGRESS_EVERY = 500

ALLOWED_CATEGORIES = {
    "Normal - No Leakage Flag",
    "CAT1 - Zero Purchaser",
    "CAT2 - Ghost Purchaser (1-3 mo)",
    "CAT3 - Micro Purchaser (<R400)",
    "CAT4 - Long Gap (4+ months)",
    "CAT5 - Stopped Purchasing",
    "CAT6 - Low kWh per Rand",
    "CAT8 - Energy Without Purchase",
}

ALLOWED_RISK_TIERS = {
    "Normal",
    "Low Risk",
    "Medium Risk",
    "High Risk",
    "Critical",
}

MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
TARIFF_RE = re.compile(r"^\d{5}$")

PIPELINE_OUTPUT_FIELDS = [
    "sourceDocumentId",
    "sourceDocumentPath",
    "sourceEndRow",
    "meterNo",
    "meterNoNormalized",
    "lmPcode",
    "accountNumber",
    "accountNumberNormalized",
    "customerNo",
    "customerSurname",
    "addressLine1",
    "addressLine2",
    "town",
    "postalAddress1",
    "postalAddress2",
    "postalAddressTown",
    "standNumber",
    "tariffInstance",
    "installationDate",
    "previousMeterNumber",
    "previousInstallationDate",
    "leakageCategory",
    "riskTier",
    "riskScore",
    "salesPeriodFrom",
    "salesPeriodTo",
    "monthlySalesC",
    "monthlyUnits",
    "totalSalesC",
    "totalUnits",
    "elmAccountMatched",
    "elmSourceRows",
    "erfCandidateCount",
    "erfCandidates",
    "erfNumbers",
    "missingErfNumbers",
    "gpsMatchStatus",
    "hasUsableGps",
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def require_type(value: Any, expected: type, field: str, errors: list[str]) -> bool:
    if not isinstance(value, expected):
        errors.append(f"{field}: expected {expected.__name__}, got {type(value).__name__}")
        return False
    return True


def parse_decimal(value: Any, field: str, errors: list[str]) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    try:
        d = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        errors.append(f"{field}: invalid numeric value {value!r}")
        return None
    if not d.is_finite():
        errors.append(f"{field}: non-finite numeric value {value!r}")
        return None
    if d < 0:
        errors.append(f"{field}: negative value {value!r}")
        return None
    return d


def normalize_sales_map(raw: Any, errors: list[str]) -> tuple[dict[str, int], list[str], int]:
    if not isinstance(raw, dict):
        errors.append("Sales: expected map")
        return {}, [], 0

    out: dict[str, int] = {}
    months = sorted(raw.keys())
    total = 0

    for month in months:
        if not isinstance(month, str) or not MONTH_RE.match(month):
            errors.append(f"Sales: invalid month key {month!r}")
            continue
        d = parse_decimal(raw[month], f"Sales.{month}", errors)
        if d is None:
            continue
        q = d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if abs(d - q) > Decimal("0.000001"):
            errors.append(f"Sales.{month}: more than 2 meaningful decimal places ({d})")
            continue
        cents = int((q * 100).to_integral_value(rounding=ROUND_HALF_UP))
        out[month] = cents
        total += cents

    return out, months, total


def normalize_units_map(raw: Any, errors: list[str]) -> tuple[dict[str, float], list[str], Decimal]:
    if not isinstance(raw, dict):
        errors.append("Units: expected map")
        return {}, [], Decimal("0")

    out: dict[str, float] = {}
    months = sorted(raw.keys())
    total = Decimal("0")

    for month in months:
        if not isinstance(month, str) or not MONTH_RE.match(month):
            errors.append(f"Units: invalid month key {month!r}")
            continue
        d = parse_decimal(raw[month], f"Units.{month}", errors)
        if d is None:
            continue
        q = d.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        if abs(d - q) > Decimal("0.000001"):
            errors.append(f"Units.{month}: more than 1 meaningful decimal place ({d})")
            continue
        out[month] = float(q)
        total += q

    return out, months, total


def validate_string_list(value: Any, field: str, errors: list[str]) -> list[Any]:
    if not isinstance(value, list):
        errors.append(f"{field}: expected array")
        return []
    return value


def clean_record(obj: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None, list[str]]:
    errors: list[str] = []

    if not isinstance(obj, dict):
        return None, None, ["root: expected object"]

    document_id = text(obj.get("documentId"))
    document_path = text(obj.get("documentPath"))
    data = obj.get("data")

    if not document_id:
        errors.append("documentId: blank")
    if not isinstance(data, dict):
        return None, None, errors + ["data: expected object"]

    meter = text(data.get("MeterNumber"))
    if not meter:
        errors.append("MeterNumber: blank")
    if document_id and meter and document_id != meter:
        errors.append(f"identity mismatch: documentId={document_id!r}, MeterNumber={meter!r}")

    expected_path = f"{SOURCE_COLLECTION}/{document_id}" if document_id else ""
    if document_path and expected_path and document_path != expected_path:
        errors.append(f"documentPath mismatch: {document_path!r} != {expected_path!r}")

    lm_pcode = text(data.get("lmPcode"))
    if lm_pcode != EXPECTED_LM_PCODE:
        errors.append(f"lmPcode: expected {EXPECTED_LM_PCODE}, got {lm_pcode!r}")

    category = text(data.get("Leakage_Category"))
    if category not in ALLOWED_CATEGORIES:
        errors.append(f"Leakage_Category: unapproved value {category!r}")

    tariff = text(data.get("TariffInstance"))
    if not tariff or not TARIFF_RE.match(tariff):
        errors.append(f"TariffInstance: expected 5-digit tariff code, got {tariff!r}")

    risk_tier = text(data.get("Risk_Tier"))
    if risk_tier not in ALLOWED_RISK_TIERS:
        errors.append(f"Risk_Tier: unapproved value {risk_tier!r}")

    risk_score = data.get("Risk_Score")
    if isinstance(risk_score, bool) or not isinstance(risk_score, int) or risk_score < 0:
        errors.append(f"Risk_Score: expected non-negative integer, got {risk_score!r}")

    monthly_sales_c, sales_months, total_sales_c = normalize_sales_map(data.get("Sales"), errors)
    monthly_units, unit_months, total_units = normalize_units_map(data.get("Units"), errors)

    if sales_months != unit_months:
        errors.append("Sales/Units month-key sets differ")

    for month in sorted(set(monthly_sales_c) | set(monthly_units)):
        if (month in monthly_sales_c) != (month in monthly_units):
            errors.append(f"Sales/Units populated-month mismatch at {month}")

    erf_candidates = validate_string_list(data.get("ErfCandidates"), "ErfCandidates", errors)
    erf_numbers = validate_string_list(data.get("ErfNumbers"), "ErfNumbers", errors)
    missing_erf_numbers = validate_string_list(data.get("MissingErfNumbers"), "MissingErfNumbers", errors)
    elm_source_rows = validate_string_list(data.get("ElmSourceRows"), "ElmSourceRows", errors)

    erf_candidate_count = data.get("ErfCandidateCount")
    if isinstance(erf_candidate_count, bool) or not isinstance(erf_candidate_count, int) or erf_candidate_count < 0:
        errors.append(f"ErfCandidateCount: expected non-negative integer, got {erf_candidate_count!r}")
    elif erf_candidate_count != len(erf_candidates):
        errors.append(
            f"ErfCandidateCount mismatch: declared={erf_candidate_count}, actual={len(erf_candidates)}"
        )

    elm_account_matched = data.get("ElmAccountMatched")
    if not isinstance(elm_account_matched, bool):
        errors.append(f"ElmAccountMatched: expected boolean, got {elm_account_matched!r}")

    has_usable_gps = data.get("HasUsableGps")
    if not isinstance(has_usable_gps, bool):
        errors.append(f"HasUsableGps: expected boolean, got {has_usable_gps!r}")

    source_end_row = data.get("SourceEndRow")
    if isinstance(source_end_row, bool) or not isinstance(source_end_row, int) or source_end_row <= 0:
        errors.append(f"SourceEndRow: expected positive integer, got {source_end_row!r}")

    if errors:
        operational = extract_operational_state(document_id, data)
        return None, operational, errors

    period_from = sales_months[0] if sales_months else None
    period_to = sales_months[-1] if sales_months else None

    clean = {
        "sourceDocumentId": document_id,
        "sourceDocumentPath": document_path or expected_path,
        "sourceEndRow": source_end_row,
        "meterNo": meter,
        "meterNoNormalized": meter,
        "lmPcode": lm_pcode,
        "accountNumber": text(data.get("AccountNumber")),
        "accountNumberNormalized": text(data.get("AccountNumberNormalized")),
        "customerNo": text(data.get("Customer")),
        "customerSurname": text(data.get("Surname")),
        "addressLine1": text(data.get("AddressLine1")),
        "addressLine2": text(data.get("AddressLine2")),
        "town": text(data.get("Town")),
        "postalAddress1": text(data.get("PostalAddress1")),
        "postalAddress2": text(data.get("PostalAddress2")),
        "postalAddressTown": text(data.get("PostalAddressTown")),
        "standNumber": text(data.get("StandNumber")),
        "tariffInstance": tariff,
        "installationDate": text(data.get("InstallationDate")),
        "previousMeterNumber": text(data.get("PreviousMeterNumber")),
        "previousInstallationDate": text(data.get("PreviousInstallationDate")),
        "leakageCategory": category,
        "riskTier": risk_tier,
        "riskScore": risk_score,
        "salesPeriodFrom": period_from,
        "salesPeriodTo": period_to,
        "monthlySalesC": monthly_sales_c,
        "monthlyUnits": monthly_units,
        "totalSalesC": total_sales_c,
        "totalUnits": float(total_units.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)),
        "elmAccountMatched": elm_account_matched,
        "elmSourceRows": elm_source_rows,
        "erfCandidateCount": erf_candidate_count,
        "erfCandidates": erf_candidates,
        "erfNumbers": erf_numbers,
        "missingErfNumbers": missing_erf_numbers,
        "gpsMatchStatus": text(data.get("GpsMatchStatus")),
        "hasUsableGps": has_usable_gps,
    }

    operational = extract_operational_state(document_id, data)
    return clean, operational, []


def extract_operational_state(document_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """Preserve only operational state that must survive a future cutover.

    Legacy/test-only fields tbRefs, batchFail and trnBatchIds are intentionally
    cleaned out of this migration and are not copied into any downstream
    preservation artifact. The immutable raw snapshot remains the audit record.
    """
    if "geofenceRefs" not in data:
        return None

    return {
        "sourceDocumentId": document_id,
        "meterNo": text(data.get("MeterNumber")),
        "geofenceRefs": data.get("geofenceRefs"),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Path to immutable 01_RAW_MIGRATION_SNAPSHOT.jsonl")
    parser.add_argument(
        "--output-root",
        default=r"docs\reports\demo-sales-migration-cleaning",
        help="Output root. A unique run directory is created below this path.",
    )
    parser.add_argument("--expected-sha256", default=EXPECTED_RAW_SHA256)
    parser.add_argument("--expected-count", type=int, default=EXPECTED_DOCUMENT_COUNT)
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.is_file():
        print(f"[ERROR] Input not found: {input_path}", file=sys.stderr)
        return 2

    actual_hash = sha256_file(input_path)
    expected_hash = args.expected_sha256.strip().lower()
    if actual_hash.lower() != expected_hash:
        print("[ERROR] Immutable raw snapshot SHA256 mismatch.", file=sys.stderr)
        print(f"Expected: {expected_hash}", file=sys.stderr)
        print(f"Actual  : {actual_hash}", file=sys.stderr)
        return 2

    output_root = Path(args.output_root)
    if not output_root.is_absolute():
        output_root = (Path.cwd() / output_root).resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    run_id = "DEMO_SALES_MIGRATION_CLEAN_" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_dir = output_root / run_id
    if run_dir.exists():
        print(f"[ERROR] Run directory already exists: {run_dir}", file=sys.stderr)
        return 2
    run_dir.mkdir(parents=False)

    clean_path = run_dir / "02_CLEAN_PIPELINE_INPUT.jsonl"
    rejected_path = run_dir / "03_REJECTED_CLEANING_RECORDS.jsonl"
    operational_path = run_dir / "04_OPERATIONAL_PRESERVATION.jsonl"
    report_path = run_dir / "05_CLEANING_REPORT.json"

    started = utc_now_iso()
    accepted = 0
    rejected = 0
    operational_count = 0
    input_count = 0
    duplicate_document_ids = 0
    duplicate_meter_ids = 0
    seen_doc_ids: set[str] = set()
    seen_meters: set[str] = set()
    error_codes = Counter()
    category_counts = Counter()
    tariff_counts = Counter()
    risk_tier_counts = Counter()
    gps_status_counts = Counter()
    blank_counts = Counter()
    sales_month_counts = Counter()
    units_month_counts = Counter()
    operational_fields = Counter()
    all_month_keys: set[str] = set()

    print("=" * 68)
    print("iREPS TEST DEMO SALES — CLEAN + VALIDATE + NORMALIZE")
    print("=" * 68)
    print(f"Input       : {input_path}")
    print(f"Input SHA256: {actual_hash}")
    print(f"Output      : {run_dir}")
    print("Firestore access: NONE")
    print("Firestore writes: NONE")
    print("=" * 68)

    try:
        with input_path.open("r", encoding="utf-8") as source, \
             clean_path.open("x", encoding="utf-8", newline="\n") as clean_fh, \
             rejected_path.open("x", encoding="utf-8", newline="\n") as rejected_fh, \
             operational_path.open("x", encoding="utf-8", newline="\n") as operational_fh:

            for line_no, line in enumerate(source, start=1):
                input_count += 1
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError as exc:
                    rejected += 1
                    error_codes["INVALID_JSON"] += 1
                    rejected_fh.write(json.dumps({
                        "lineNumber": line_no,
                        "errors": [f"invalid JSON: {exc}"],
                        "rawLine": line.rstrip("\n"),
                    }, separators=(",", ":")) + "\n")
                    continue

                doc_id = text(obj.get("documentId")) if isinstance(obj, dict) else ""
                if doc_id in seen_doc_ids:
                    duplicate_document_ids += 1
                elif doc_id:
                    seen_doc_ids.add(doc_id)

                clean, operational, errors = clean_record(obj)

                if operational is not None:
                    operational_count += 1
                    for key in operational:
                        if key not in {"sourceDocumentId", "meterNo"}:
                            operational_fields[key] += 1
                    operational_fh.write(json.dumps(operational, separators=(",", ":"), sort_keys=True) + "\n")

                if errors:
                    rejected += 1
                    for err in errors:
                        error_codes[err.split(":", 1)[0]] += 1
                    rejected_fh.write(json.dumps({
                        "lineNumber": line_no,
                        "documentId": doc_id,
                        "errors": errors,
                        "source": obj,
                    }, separators=(",", ":"), sort_keys=True) + "\n")
                else:
                    assert clean is not None
                    meter = clean["meterNo"]
                    if meter in seen_meters:
                        duplicate_meter_ids += 1
                    else:
                        seen_meters.add(meter)

                    accepted += 1
                    category_counts[clean["leakageCategory"]] += 1
                    tariff_counts[clean["tariffInstance"]] += 1
                    risk_tier_counts[clean["riskTier"]] += 1
                    gps_status_counts[clean["gpsMatchStatus"]] += 1
                    for key in (
                        "accountNumber",
                        "customerSurname",
                        "addressLine1",
                        "addressLine2",
                        "town",
                        "standNumber",
                    ):
                        if clean[key] == "":
                            blank_counts[key] += 1
                    for month in clean["monthlySalesC"]:
                        sales_month_counts[month] += 1
                        all_month_keys.add(month)
                    for month in clean["monthlyUnits"]:
                        units_month_counts[month] += 1
                        all_month_keys.add(month)

                    clean_fh.write(json.dumps(clean, separators=(",", ":"), sort_keys=True) + "\n")

                if input_count % PROGRESS_EVERY == 0:
                    print(
                        f"[PROGRESS] read {input_count:,} | accepted {accepted:,} | "
                        f"rejected {rejected:,} | operational {operational_count:,}"
                    )

    except Exception as exc:
        print(f"[ERROR] Cleaning failed: {exc}", file=sys.stderr)
        return 3

    count_matches = input_count == args.expected_count
    duplicate_free = duplicate_document_ids == 0 and duplicate_meter_ids == 0
    passed = rejected == 0 and count_matches and duplicate_free and accepted == input_count

    report = {
        "status": "PASSED" if passed else "REVIEW_REQUIRED",
        "readOnlyInput": True,
        "firestoreAccess": False,
        "firestoreWriteOperations": 0,
        "source": {
            "projectId": SOURCE_PROJECT_ID,
            "collection": SOURCE_COLLECTION,
            "inputFile": str(input_path),
            "sha256": actual_hash,
            "expectedSha256": expected_hash,
            "expectedDocumentCount": args.expected_count,
        },
        "runId": run_id,
        "startedAtUtc": started,
        "finishedAtUtc": utc_now_iso(),
        "counts": {
            "inputRecords": input_count,
            "acceptedRecords": accepted,
            "rejectedRecords": rejected,
            "operationalPreservationRecords": operational_count,
            "uniqueDocumentIds": len(seen_doc_ids),
            "uniqueMeterIds": len(seen_meters),
            "duplicateDocumentIds": duplicate_document_ids,
            "duplicateMeterIds": duplicate_meter_ids,
        },
        "validation": {
            "inputCountMatchesExpected": count_matches,
            "allRecordsAccepted": rejected == 0 and accepted == input_count,
            "duplicateFree": duplicate_free,
            "errorCounts": dict(sorted(error_codes.items())),
        },
        "pipelineOutputFields": PIPELINE_OUTPUT_FIELDS,
        "removedFromCommercialInput": [
            "loadedAt",
            "batchFail",
            "tbRefs",
            "geofenceRefs",
            "trnBatchIds",
        ],
        "cleanedLegacyRuntimeFields": [
            "tbRefs",
            "batchFail",
            "trnBatchIds",
        ],
        "operationalPreservation": {
            "fieldsObserved": dict(sorted(operational_fields.items())),
            "note": (
                "Only geofenceRefs is eligible for separate operational preservation. "
                "tbRefs, batchFail and trnBatchIds are intentionally cleaned out of the migration; "
                "the immutable raw snapshot remains their audit record."
            ),
        },
        "distributions": {
            "leakageCategory": dict(category_counts.most_common()),
            "tariffInstance": dict(tariff_counts.most_common()),
            "riskTier": dict(risk_tier_counts.most_common()),
            "gpsMatchStatus": dict(gps_status_counts.most_common()),
            "blankCommercialFields": dict(sorted(blank_counts.items())),
        },
        "monthly": {
            "allObservedMonthKeys": sorted(all_month_keys),
            "firstMonth": min(all_month_keys) if all_month_keys else None,
            "lastMonth": max(all_month_keys) if all_month_keys else None,
            "salesPopulatedRecordCountByMonth": dict(sorted(sales_month_counts.items())),
            "unitsPopulatedRecordCountByMonth": dict(sorted(units_month_counts.items())),
        },
        "outputs": {
            "cleanPipelineInput": clean_path.name,
            "rejectedRecords": rejected_path.name,
            "operationalPreservation": operational_path.name,
            "cleanPipelineInputSha256": sha256_file(clean_path),
            "rejectedRecordsSha256": sha256_file(rejected_path),
            "operationalPreservationSha256": sha256_file(operational_path),
        },
        "nextStep": (
            "Use 02_CLEAN_PIPELINE_INPUT.jsonl as the input contract for the monthly-source adapter. "
            "tbRefs, batchFail and trnBatchIds are cleaned out and must not be reintroduced. "
            "Do not feed 04_OPERATIONAL_PRESERVATION.jsonl into the commercial monthly pipeline."
        ),
    }
    write_json(report_path, report)

    print("=" * 68)
    print("CLEANING COMPLETE")
    print("=" * 68)
    print(f"Status                : {report['status']}")
    print(f"Input records         : {input_count:,}")
    print(f"Accepted              : {accepted:,}")
    print(f"Rejected              : {rejected:,}")
    print(f"Operational preserved : {operational_count:,}")
    print(f"Duplicate doc IDs     : {duplicate_document_ids:,}")
    print(f"Duplicate meter IDs   : {duplicate_meter_ids:,}")
    print(f"Clean SHA256          : {report['outputs']['cleanPipelineInputSha256']}")
    print(f"Output folder         : {run_dir}")
    print("Firestore writes      : 0")
    print("=" * 68)

    return 0 if passed else 4


if __name__ == "__main__":
    raise SystemExit(main())
