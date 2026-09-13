"""Pure Sales Work Status classifiers used by the read-only audit.

This module deliberately contains no Firebase initialization or write API.
It reproduces the historical audit, the retired browser classifier (including
its API projections), and the final three-state Sales classifier.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
import re


VALID_FIELD_WORK_STATUSES = {"NOT_STARTED", "IN_PROGRESS", "COMPLETED"}

# ECMAScript WhiteSpace + LineTerminator characters matched by JavaScript \s.
JS_WHITESPACE_RE = re.compile(
    "[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff]+"
)
ASCII_METER_ID_RE = re.compile(r"^[A-Z0-9]+$", re.ASCII)


def get_path(value, *keys):
    current = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def js_string(value):
    """Relevant JavaScript String(value) behavior for Firestore scalar fields."""
    if value is None:
        return ""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return ",".join(js_string(item) for item in value)
    if isinstance(value, dict):
        return "[object Object]"
    return str(value)


def js_truthy(value):
    """JavaScript truthiness for values that can occur in Firestore data."""
    if value is None or value is False:
        return False
    if isinstance(value, (int, float)) and value == 0:
        return False
    if isinstance(value, str) and value == "":
        return False
    # Unlike Python, JavaScript arrays and objects are always truthy.
    return True


def js_or(*values):
    for value in values:
        if js_truthy(value):
            return value
    return values[-1] if values else None


def clean_text(value):
    return js_string(value).strip()


def normalize_meter_identity(value):
    """Exact port of normalizeSalesWorkStatusMeterNo's accepted vocabulary."""
    normalized = JS_WHITESPACE_RE.sub("", js_string(value)).upper()
    return normalized if normalized and ASCII_METER_ID_RE.fullmatch(normalized) else ""


def is_plain_object(value):
    return isinstance(value, dict)


def is_nonblank_string(value):
    return isinstance(value, str) and bool(value.strip())


def is_nullable_nonblank_string(value):
    return value is None or is_nonblank_string(value)


def is_timestamp_like(value):
    if isinstance(value, datetime):
        return True
    if not isinstance(value, dict):
        return False
    seconds = value.get("seconds", value.get("_seconds"))
    nanos = value.get("nanoseconds", value.get("_nanoseconds"))
    return (
        isinstance(seconds, int)
        and not isinstance(seconds, bool)
        and isinstance(nanos, int)
        and not isinstance(nanos, bool)
        and 0 <= nanos <= 999_999_999
    )


def _validate_no_access(value, path):
    issues = []
    if not isinstance(value, list):
        return [path]
    for index, entry in enumerate(value):
        entry_path = f"{path}.{index}"
        if not is_plain_object(entry):
            issues.append(entry_path)
            continue
        if not isinstance(entry.get("date"), str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}", entry["date"]
        ):
            issues.append(f"{entry_path}.date")
        if not isinstance(entry.get("time"), str) or not re.fullmatch(
            r"\d{2}:\d{2}:\d{2}", entry["time"]
        ):
            issues.append(f"{entry_path}.time")
        if not is_nonblank_string(entry.get("user")):
            issues.append(f"{entry_path}.user")
    return issues


BATCH_ID_RE = re.compile(r"^TGB_[0-9]{8}_[0-9]{6}_[A-Z0-9]{4}$")
CLASSIFIER_VERSION = "sales-targeted-batch-v4.2-tb9"

def read_tb_ref_id(ref):
    if not isinstance(ref, dict): return None
    value = ref.get("id") if "id" in ref else ref.get("tbId")
    if "id" in ref and "tbId" in ref and ref["id"] != ref["tbId"]: return None
    return value if isinstance(value, str) and BATCH_ID_RE.fullmatch(value) else None

def valid_document_id(value):
    return is_nonblank_string(value) and value == value.strip() and "/" not in value and value not in (".", "..") and all(ord(c) >= 32 and ord(c) != 127 for c in value)

def _validate_reference(ref, index, seen_ids):
    del seen_ids
    path = f"tbRefs.{index}"
    if not isinstance(ref, dict): return [path]
    issues = []
    def bad(key): issues.append(f"{path}.{key}")
    if not read_tb_ref_id(ref): bad("id")
    if not is_timestamp_like(ref.get("date")): bad("date")
    for key in ref.keys() - {"id", "tbId", "date", "rowId", "fieldWork"}: bad(key)
    if "rowId" in ref and (not valid_document_id(ref["rowId"]) or "fieldWork" not in ref): bad("rowId")
    if "fieldWork" not in ref: return issues
    fw = ref["fieldWork"]
    if not isinstance(fw, dict): bad("fieldWork"); return issues
    allowed = {"status", "outcomeCode", "outcomeLabel", "targetedMeterNo", "discoveredMeterNo", "meterMatch", "premiseId", "meterId", "trnId", "submittedAt", "updatedAt", "noAccess"}
    for key in fw.keys() - allowed: bad(f"fieldWork.{key}")
    if fw.get("status") not in ("IN_PROGRESS", "COMPLETED"): bad("fieldWork.status")
    if not valid_document_id(ref.get("rowId")): bad("rowId")
    if not is_timestamp_like(fw.get("updatedAt")): bad("fieldWork.updatedAt")
    for key in ("outcomeCode", "outcomeLabel", "targetedMeterNo", "discoveredMeterNo", "premiseId", "meterId", "trnId"):
        if key in fw and fw[key] is not None and not is_nonblank_string(fw[key]): bad(f"fieldWork.{key}")
    if "meterMatch" in fw and fw["meterMatch"] is not None and type(fw["meterMatch"]) is not bool: bad("fieldWork.meterMatch")
    if "submittedAt" in fw and fw["submittedAt"] is not None and not is_timestamp_like(fw["submittedAt"]): bad("fieldWork.submittedAt")
    if "noAccess" in fw:
        if not isinstance(fw["noAccess"], list): bad("fieldWork.noAccess")
        else:
            for n, visit in enumerate(fw["noAccess"]):
                if not isinstance(visit, dict) or set(visit) != {"date", "time", "user"} or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", str(visit.get("date", ""))) or not re.fullmatch(r"[0-9]{2}:[0-9]{2}:[0-9]{2}", str(visit.get("time", ""))) or not is_nonblank_string(visit.get("user")): bad(f"fieldWork.noAccess.{n}")
    if fw.get("status") == "COMPLETED":
        for key in ("outcomeCode", "outcomeLabel", "premiseId", "meterId", "trnId"):
            if not is_nonblank_string(fw.get(key)): bad(f"fieldWork.{key}")
        if fw.get("outcomeCode") != "METER_DISCOVERED": bad("fieldWork.outcomeCode")
        if type(fw.get("meterMatch")) is not bool: bad("fieldWork.meterMatch")
        if not is_timestamp_like(fw.get("submittedAt")): bad("fieldWork.submittedAt")
    elif fw.get("outcomeCode") == "METER_DISCOVERED": bad("fieldWork.status")
    return issues

def build_correlation_key(reference):
    value = read_tb_ref_id(reference)
    row_id = reference.get("rowId") if isinstance(reference, dict) else ""
    return f"{value}::{row_id if isinstance(row_id, str) else ''}" if value else ""

def build_duplicate_key(reference):
    return read_tb_ref_id(reference) or ""

def inspect_tbrefs(value):
    if not isinstance(value, list):
        return {"valid": False, "issues": ["tbRefs"], "entries": [], "entriesByKey": {}}

    seen_ids = set()
    entries = []
    duplicate_groups = defaultdict(list)
    correlation_groups = defaultdict(list)
    for index, reference in enumerate(value):
        entry_issues = _validate_reference(reference, index, seen_ids)
        correlation_key = build_correlation_key(reference)
        duplicate_key = build_duplicate_key(reference)
        entry = {
            "index": index,
            "correlationKey": correlation_key,
            "duplicateKey": duplicate_key,
            "issues": entry_issues,
            "valid": not entry_issues,
        }
        entries.append(entry)
        if duplicate_key:
            duplicate_groups[duplicate_key].append(index)
        if correlation_key:
            correlation_groups[correlation_key].append(index)

    by_key = {}
    for entry in entries:
        duplicate_size = len(duplicate_groups.get(entry["duplicateKey"], [])) if entry["duplicateKey"] else 0
        correlation_size = len(correlation_groups.get(entry["correlationKey"], [])) if entry["correlationKey"] else 0
        entry.update({
            "duplicateGroupSize": duplicate_size,
            "correlationGroupSize": correlation_size,
            "duplicateLogicalIdentity": duplicate_size > 1,
            "correlationAmbiguous": correlation_size > 1,
            "classifiable": entry["valid"] and duplicate_size == 1 and correlation_size == 1,
        })

    for key, indexes in correlation_groups.items():
        members = [entries[index] for index in indexes]
        by_key[key] = {
            "correlationKey": key,
            "indexes": indexes,
            "issues": [issue for member in members for issue in member["issues"]],
            "valid": len(members) == 1 and members[0]["valid"],
            "classifiable": len(members) == 1 and members[0]["classifiable"],
            "correlationAmbiguous": len(members) > 1,
        }

    issues = [issue for entry in entries for issue in entry["issues"]]
    issues += [f"tbRefs.{entry['index']}.id" for entry in entries if entry["duplicateLogicalIdentity"]]
    return {"valid": not issues, "issues": issues, "entries": entries, "entriesByKey": by_key}


def select_raw_tbrefs(data):
    return data.get("tbRefs") if "tbRefs" in data else data.get("TbRefs")


def select_old_normalized_tbrefs(data):
    return js_or(data.get("tbRefs"), data.get("TbRefs"), [])


def _normalize_tbrefs(value):
    if not isinstance(value, list):
        return []
    seen = set()
    normalized = []
    for reference in value:
        source = reference if isinstance(reference, dict) else {}
        reference_id = clean_text(js_or(source.get("id"), source.get("tbId"), ""))
        row_id = clean_text(js_or(source.get("rowId"), source.get("tbRowId"), ""))
        if not reference_id:
            continue
        key = f"{reference_id}::{row_id}"
        if key in seen:
            continue
        seen.add(key)
        normalized.append({
            **source,
            "id": reference_id,
            "rowId": row_id or None,
            "fieldWork": source.get("fieldWork") if isinstance(source.get("fieldWork"), dict) else None,
        })
    return normalized


def normalize_old_sales_row(snapshot_id, data):
    return {
        "id": snapshot_id,
        "meterNo": js_string(js_or(data.get("meterNo"), data.get("meterNoNormalized"), data.get("MeterNumber"), snapshot_id, "NAv")),
        "meterNoNormalized": js_string(js_or(data.get("meterNoNormalized"), data.get("meterNo"), data.get("MeterNumber"), snapshot_id, "NAv")),
        "lmPcode": js_string(js_or(data.get("lmPcode"), "")),
        "tbRefs": _normalize_tbrefs(select_old_normalized_tbrefs(data)),
        "tbRefsIntegrity": inspect_tbrefs(select_raw_tbrefs(data)),
    }


def normalize_registry_row(snapshot_id, data):
    return {
        "id": snapshot_id,
        "meterId": js_or(data.get("meterId"), data.get("id"), snapshot_id),
        "meterNo": js_or(data.get("meterNo"), "NAv"),
        "lmPcode": js_or(get_path(data, "parents", "lmPcode"), "NAv"),
    }


def normalize_sales_work_status_ast_row(snapshot_id, data):
    return {
        "id": snapshot_id,
        "meterNo": js_or(
            get_path(data, "ast", "astData", "astNo"),
            get_path(data, "astData", "astNo"),
            get_path(data, "master", "id"),
            "",
        ),
        "masterId": js_or(get_path(data, "master", "id"), ""),
        "lmPcode": js_or(get_path(data, "accessData", "parents", "lmPcode"), ""),
    }


def derive_old_audit_status(data):
    visibility = clean_text(get_path(data, "master", "visibility")).upper()
    if visibility == "VISIBLE":
        return "COMPLETED"
    for reference in data.get("tbRefs") if isinstance(data.get("tbRefs"), list) else []:
        if isinstance(reference, dict) and isinstance(reference.get("fieldWork"), dict):
            if clean_text(reference["fieldWork"].get("status")).upper() == "IN_PROGRESS":
                return "IN_PROGRESS"
    return "NOT_STARTED"


def _normalized_lm(value):
    return clean_text(value).upper()


def derive_old_frontend_status(sales, registry_matches, ast_matches, expected_lm):
    meter_no = normalize_meter_identity(js_or(sales.get("meterNoNormalized"), sales.get("meterNo"), sales.get("id")))
    if not meter_no:
        return "INTEGRITY_EXCEPTION"
    expected = _normalized_lm(js_or(expected_lm, sales.get("lmPcode")))
    sales_lm = _normalized_lm(sales.get("lmPcode"))
    if expected and sales_lm and sales_lm != expected:
        return "INTEGRITY_EXCEPTION"
    if len(registry_matches) > 1 or len(ast_matches) > 1:
        return "INTEGRITY_EXCEPTION"
    if len(registry_matches) == 1 and len(ast_matches) == 1:
        registry = registry_matches[0]
        ast = ast_matches[0]
        registry_ast_id = clean_text(js_or(registry.get("meterId"), registry.get("id")))
        ast_id = clean_text(ast.get("id"))
        registry_lm = _normalized_lm(js_or(registry.get("lmPcode"), get_path(registry, "parents", "lmPcode")))
        ast_lm = _normalized_lm(js_or(ast.get("lmPcode"), get_path(ast, "accessData", "parents", "lmPcode")))
        if not registry_ast_id or not ast_id or registry_ast_id != ast_id:
            return "INTEGRITY_EXCEPTION"
        if expected and registry_lm and registry_lm != expected:
            return "INTEGRITY_EXCEPTION"
        if expected and ast_lm and ast_lm != expected:
            return "INTEGRITY_EXCEPTION"
        return "COMPLETED"
    if registry_matches or ast_matches:
        return "INTEGRITY_EXCEPTION"

    integrity = sales.get("tbRefsIntegrity")
    if not isinstance(integrity, dict) or integrity.get("valid") is not True:
        return "INTEGRITY_EXCEPTION"
    references = sales.get("tbRefs")
    if not isinstance(references, list):
        return "INTEGRITY_EXCEPTION"
    has_in_progress = False
    has_completed = False
    for reference in references:
        if not isinstance(reference, dict):
            return "INTEGRITY_EXCEPTION"
        field_work = reference.get("fieldWork")
        if field_work is None:
            continue
        if not isinstance(field_work, dict):
            return "INTEGRITY_EXCEPTION"
        if "status" not in field_work:
            continue
        raw_status = field_work.get("status")
        if not isinstance(raw_status, str):
            return "INTEGRITY_EXCEPTION"
        status = raw_status.strip().upper()
        if raw_status != status or status not in VALID_FIELD_WORK_STATUSES:
            return "INTEGRITY_EXCEPTION"
        has_completed = has_completed or status == "COMPLETED"
        has_in_progress = has_in_progress or status == "IN_PROGRESS"
    if has_completed:
        return "INTEGRITY_EXCEPTION"
    return "IN_PROGRESS" if has_in_progress else "NOT_STARTED"


def normalize_new_sales_row(snapshot_id, data):
    raw = data.get("tbRefs", [])
    return {**data, "id": snapshot_id, "masterVisibility": get_path(data, "master", "visibility"), "tbRefs": raw, "tbRefsIntegrity": inspect_tbrefs(raw)}

def derive_new_sales_status(row):
    visibility = get_path(row, "master", "visibility")
    if "master" not in row: visibility = row.get("masterVisibility")
    if visibility == "VISIBLE": return "COMPLETED"
    raw = row.get("tbRefs", [])
    integrity = inspect_tbrefs(raw)
    if any(entry["classifiable"] and get_path(raw[entry["index"]], "fieldWork", "status") == "IN_PROGRESS" for entry in integrity["entries"]): return "IN_PROGRESS"
    return "NOT_STARTED"

def resolve_current_membership(data):
    if data.get("targetedBatchIdInvalid") is True: return "UNRESOLVED"
    if "targetedBatchId" in data:
        value = data["targetedBatchId"]
        if value is None: return "NONE"
        return "MEMBER" if isinstance(value, str) and BATCH_ID_RE.fullmatch(value) else "UNRESOLVED"
    refs = data.get("tbRefs", [])
    if not inspect_tbrefs(refs)["valid"] or get_path(data, "tbRefsIntegrity", "valid") is False: return "UNRESOLVED"
    return "NONE" if not refs else "MEMBER" if len(refs) == 1 else "UNRESOLVED"

def build_grouped_old_inputs(registry_rows, ast_rows):
    registry_by_meter = defaultdict(list)
    ast_by_meter = defaultdict(list)
    for row in registry_rows:
        meter = normalize_meter_identity(row.get("meterNo"))
        if meter:
            registry_by_meter[meter].append(row)
    for row in ast_rows:
        meter = normalize_meter_identity(js_or(row.get("meterNo"), row.get("masterId")))
        if meter:
            ast_by_meter[meter].append(row)
    return registry_by_meter, ast_by_meter


def inspect_preflight(data):
    canonical_present = "tbRefs" in data
    canonical = data.get("tbRefs")
    legacy = data.get("TbRefs")
    legacy_nonempty = isinstance(legacy, list) and bool(legacy)
    raw_visibility = get_path(data, "master", "visibility")
    result = {
        "canonicalMalformedWithLegacy": canonical_present and not isinstance(canonical, list) and legacy_nonempty,
        "legacySourceFallback": not canonical_present and legacy_nonempty,
        "rawVisibilityValid": isinstance(raw_visibility, str) and raw_visibility in {"VISIBLE", "INVISIBLE"},
        "legacyAliasPresent": 0,
        "legacyAliasReliance": 0,
        "legacyAliasConflict": 0,
        "canonicalIdLegacyRowReliance": 0,
    }
    arrays = []
    if isinstance(canonical, list):
        arrays.append(canonical)
    if isinstance(legacy, list) and legacy is not canonical:
        arrays.append(legacy)
    for references in arrays:
        for reference in references:
            if not isinstance(reference, dict):
                continue
            canonical_id = clean_text(reference.get("id"))
            legacy_id = clean_text(reference.get("tbId"))
            canonical_row = clean_text(reference.get("rowId"))
            legacy_row = clean_text(reference.get("tbRowId"))
            if "tbId" in reference or "tbRowId" in reference:
                result["legacyAliasPresent"] += 1
            if legacy_id and not canonical_id:
                result["legacyAliasReliance"] += 1
            if legacy_row and not canonical_row:
                result["legacyAliasReliance"] += 1
                if canonical_id:
                    result["canonicalIdLegacyRowReliance"] += 1
            if canonical_id and legacy_id and canonical_id != legacy_id:
                result["legacyAliasConflict"] += 1
            if canonical_row and legacy_row and canonical_row != legacy_row:
                result["legacyAliasConflict"] += 1
    return result


def audit_reference_diagnostics(data, canonical_sales_identity):
    diagnostics = Counter()
    raw = select_raw_tbrefs(data)
    for reference in raw if isinstance(raw, list) else []:
        if not isinstance(reference, dict) or not isinstance(reference.get("fieldWork"), dict):
            continue
        field_work = reference["fieldWork"]
        targeted = normalize_meter_identity(field_work.get("targetedMeterNo"))
        discovered = normalize_meter_identity(field_work.get("discoveredMeterNo"))
        meter_match = field_work.get("meterMatch")
        if type(meter_match) is bool and targeted and discovered and meter_match != (targeted == discovered):
            diagnostics["SALES_METER_MATCH_INCONSISTENT"] += 1
        if (
            field_work.get("status") == "COMPLETED"
            and clean_text(field_work.get("outcomeCode")).upper() == "METER_DISCOVERED"
            and meter_match is True
            and targeted
            and discovered
            and canonical_sales_identity
            and targeted == discovered == canonical_sales_identity
            and get_path(data, "master", "visibility") != "VISIBLE"
        ):
            diagnostics["SALES_EXACT_METER_DISCOVERED_BUT_INVISIBLE"] += 1
    return diagnostics


def transition_reasons(old_audit, old_frontend, new_status, data, new_row):
    reasons = []
    raw_visibility = get_path(data, "master", "visibility")
    if clean_text(raw_visibility).upper() == "VISIBLE" and raw_visibility != "VISIBLE":
        reasons.append("STRICT_VISIBILITY_CHANGE")
    if "tbRefs" not in data and isinstance(data.get("TbRefs"), list) and data.get("TbRefs"):
        reasons.append("LEGACY_SOURCE_FALLBACK")
    if "tbRefs" in data and not isinstance(data.get("tbRefs"), list) and isinstance(data.get("TbRefs"), list) and data.get("TbRefs"):
        reasons.append("CANONICAL_MALFORMED_SOURCE_WINS")
    integrity = new_row.get("tbRefsIntegrity") or {}
    if any(entry.get("duplicateLogicalIdentity") for entry in integrity.get("entries", [])):
        reasons.append("DUPLICATE_SUPPRESSION")
    if any(entry.get("correlationAmbiguous") for entry in integrity.get("entries", [])):
        reasons.append("CORRELATION_COLLISION_SUPPRESSION")
    if old_audit == "IN_PROGRESS" and new_status != "IN_PROGRESS" and not reasons:
        reasons.append("MALFORMED_REFERENCE_REJECTION")
    if old_frontend == "INTEGRITY_EXCEPTION" and new_status == "IN_PROGRESS":
        reasons.append("PER_REFERENCE_RECOVERY")
    if old_frontend != new_status and old_frontend in {"COMPLETED", "INTEGRITY_EXCEPTION"}:
        reasons.append("AST_REGISTRY_RECONCILIATION_REMOVED")
    if old_audit == new_status and old_frontend == new_status and not reasons:
        reasons.append("NO_CHANGE")
    if not reasons:
        reasons.append("STRICT_STATUS_CHANGE")
    return list(dict.fromkeys(reasons))


def has_usable_sales_gps(data):
    if data.get("HasUsableGps") is True or data.get("hasUsableGps") is True: return True
    def valid(value, bound):
        if value is None or isinstance(value, bool) or (isinstance(value, str) and not value.strip()): return False
        try: return abs(float(value)) <= bound
        except (TypeError, ValueError): return False
    candidates = data.get("erfCandidates", [])
    return isinstance(candidates, list) and any(isinstance(c, dict) and valid(c.get("Latitude", c.get("latitude")),90) and valid(c.get("Longitude", c.get("longitude")),180) for c in candidates)

def classify_non_gps_sales_row(data, new_row, sales_work_status):
    result = {"isNoGps": not has_usable_sales_gps(data), "classification": None, "exceptionReasons": [], "selectable": False}
    if not result["isNoGps"]: return result
    if sales_work_status == "COMPLETED": result["classification"] = "DISCOVERED"; return result
    membership = resolve_current_membership(data)
    if sales_work_status == "IN_PROGRESS" or membership == "MEMBER": result["classification"] = "ALREADY_BATCHED"; return result
    def meaningful(value): return is_nonblank_string(value) and value.strip().upper() not in {"NAV", "N/A", "NA", "NULL"}
    reasons = []
    for label, value in [("Town",data.get("town")),("Street number",get_path(data,"adr","strNo")),("Street name",get_path(data,"adr","strName"))]:
        if not meaningful(value): reasons.append(f"{label} is missing")
    if not inspect_tbrefs(data.get("tbRefs", []))["valid"]: reasons.append("Targeted Batch reference data is invalid")
    if membership == "UNRESOLVED": reasons.append("Current membership is unresolved")
    if get_path(data,"master","id") != new_row.get("id") or data.get("meterNoNormalized") != new_row.get("id"): reasons.append("Sales identity is invalid")
    if get_path(data,"master","visibility") not in ("VISIBLE","INVISIBLE"): reasons.append("Sales visibility is invalid")
    if not re.fullmatch(r"ZA[0-9]+",str(data.get("lmPcode",""))): reasons.append("Sales LM is invalid")
    result["classification"] = "EXCEPTION" if reasons else "OUTSTANDING"
    result["exceptionReasons"] = reasons
    result["selectable"] = not reasons
    lookup = data.get("erfLookup")
    address = ", ".join(filter(None,[" ".join(str(get_path(data,"adr",key) or "").strip() for key in ("strNo","strName","strType")).strip(),str(data.get("town") or "").strip(),str(data.get("lmPcode") or "").strip(),"South Africa"]))
    if isinstance(lookup,dict) and lookup.get("address") == address:
        result["selectable"] = False; result["exceptionReasons"].append(f"Needs manual ERFing — {lookup.get('outcome')}")
    return result
