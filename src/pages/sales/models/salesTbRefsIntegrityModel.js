import { SALES_OPERATIONAL_STATUSES } from "./salesStatusModel.js";

const VALID_FIELD_WORK_STATUSES = new Set(SALES_OPERATIONAL_STATUSES);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonblankString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableNonblankString(value) {
  return value === null || isNonblankString(value);
}

function isFirestoreTimestampLike(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  if (typeof value.toMillis === "function") {
    try {
      return Number.isFinite(value.toMillis());
    } catch {
      return false;
    }
  }

  const seconds = value.seconds ?? value._seconds;
  const nanoseconds = value.nanoseconds ?? value._nanoseconds;

  return (
    Number.isInteger(seconds) &&
    Number.isInteger(nanoseconds) &&
    nanoseconds >= 0 &&
    nanoseconds <= 999_999_999
  );
}

function validateNoAccessEntries(value, path, issues) {
  if (!Array.isArray(value)) {
    issues.push(path);
    return;
  }

  value.forEach((entry, index) => {
    const entryPath = `${path}.${index}`;

    if (!isPlainObject(entry)) {
      issues.push(entryPath);
      return;
    }

    if (
      typeof entry.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    ) {
      issues.push(`${entryPath}.date`);
    }

    if (
      typeof entry.time !== "string" ||
      !/^\d{2}:\d{2}:\d{2}$/.test(entry.time)
    ) {
      issues.push(`${entryPath}.time`);
    }

    if (!isNonblankString(entry.user)) issues.push(`${entryPath}.user`);
  });
}

export function inspectSalesTbRefsIntegrity(value) {
  if (value === undefined || value === null) {
    return { valid: true, issues: [] };
  }

  if (!Array.isArray(value)) {
    return { valid: false, issues: ["tbRefs"] };
  }

  const issues = [];
  const seenIds = new Set();

  value.forEach((reference, index) => {
    const path = `tbRefs.${index}`;

    if (!isPlainObject(reference)) {
      issues.push(path);
      return;
    }

    if (!isNonblankString(reference.id)) {
      issues.push(`${path}.id`);
    } else {
      const logicalId = reference.id.trim().toUpperCase();
      if (seenIds.has(logicalId)) issues.push(`${path}.id`);
      seenIds.add(logicalId);
    }

    if (!isFirestoreTimestampLike(reference.date)) {
      issues.push(`${path}.date`);
    }

    if (
      Object.hasOwn(reference, "rowId") &&
      !isNonblankString(reference.rowId)
    ) {
      issues.push(`${path}.rowId`);
    }

    if (!Object.hasOwn(reference, "fieldWork")) return;

    if (!isPlainObject(reference.fieldWork)) {
      issues.push(`${path}.fieldWork`);
      return;
    }

    const fieldWork = reference.fieldWork;
    const fieldWorkPath = `${path}.fieldWork`;
    const status = Object.hasOwn(fieldWork, "status")
      ? String(fieldWork.status || "").trim().toUpperCase()
      : "";

    if (
      Object.hasOwn(fieldWork, "status") &&
      (typeof fieldWork.status !== "string" ||
        fieldWork.status !== status ||
        !VALID_FIELD_WORK_STATUSES.has(status))
    ) {
      issues.push(`${fieldWorkPath}.status`);
    }

    for (const field of [
      "outcomeCode",
      "outcomeLabel",
      "targetedMeterNo",
      "discoveredMeterNo",
      "premiseId",
      "meterId",
      "trnId",
    ]) {
      if (
        Object.hasOwn(fieldWork, field) &&
        !isNullableNonblankString(fieldWork[field])
      ) {
        issues.push(`${fieldWorkPath}.${field}`);
      }
    }

    if (
      Object.hasOwn(fieldWork, "meterMatch") &&
      fieldWork.meterMatch !== null &&
      typeof fieldWork.meterMatch !== "boolean"
    ) {
      issues.push(`${fieldWorkPath}.meterMatch`);
    }

    for (const field of ["submittedAt", "updatedAt"]) {
      if (
        Object.hasOwn(fieldWork, field) &&
        fieldWork[field] !== null &&
        !isFirestoreTimestampLike(fieldWork[field])
      ) {
        issues.push(`${fieldWorkPath}.${field}`);
      }
    }

    if (Object.hasOwn(fieldWork, "noAccess")) {
      validateNoAccessEntries(
        fieldWork.noAccess,
        `${fieldWorkPath}.noAccess`,
        issues,
      );
    }

    const outcomeCode = String(fieldWork.outcomeCode || "")
      .trim()
      .toUpperCase();

    if (status === "COMPLETED" && outcomeCode !== "METER_DISCOVERED") {
      issues.push(`${fieldWorkPath}.outcomeCode`);
    }
    if (outcomeCode === "METER_DISCOVERED" && status !== "COMPLETED") {
      issues.push(`${fieldWorkPath}.status`);
    }

    if (status === "IN_PROGRESS") {
      if (!isNonblankString(reference.rowId)) issues.push(`${path}.rowId`);
      if (!isFirestoreTimestampLike(fieldWork.updatedAt)) {
        issues.push(`${fieldWorkPath}.updatedAt`);
      }
    }

    if (status === "COMPLETED") {
      if (!isNonblankString(reference.rowId)) issues.push(`${path}.rowId`);

      for (const field of [
        "outcomeCode",
        "outcomeLabel",
        "premiseId",
        "meterId",
        "trnId",
      ]) {
        if (!isNonblankString(fieldWork[field])) {
          issues.push(`${fieldWorkPath}.${field}`);
        }
      }

      if (typeof fieldWork.meterMatch !== "boolean") {
        issues.push(`${fieldWorkPath}.meterMatch`);
      }
      if (!isFirestoreTimestampLike(fieldWork.submittedAt)) {
        issues.push(`${fieldWorkPath}.submittedAt`);
      }
      if (!isFirestoreTimestampLike(fieldWork.updatedAt)) {
        issues.push(`${fieldWorkPath}.updatedAt`);
      }
    }
  });

  return { valid: issues.length === 0, issues };
}
