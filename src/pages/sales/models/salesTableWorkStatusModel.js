import { SALES_STATUSES } from "./salesStatusModel.js";

const FIELD_WORK_STATUSES = new Set([
  SALES_STATUSES.NOT_STARTED,
  SALES_STATUSES.IN_PROGRESS,
  SALES_STATUSES.COMPLETED,
]);

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeLmPcode(value) {
  return cleanText(value).toUpperCase();
}

export function normalizeSalesWorkStatusMeterNo(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();

  if (!normalized || !/^[A-Z0-9]+$/.test(normalized)) return "";
  return normalized;
}

function getSalesMeterNo(row = {}) {
  return normalizeSalesWorkStatusMeterNo(
    row?.meterNoNormalized || row?.meterNo || row?.id,
  );
}

function getRegistryMeterNo(row = {}) {
  return normalizeSalesWorkStatusMeterNo(row?.meterNo);
}

function getAstMeterNo(row = {}) {
  return normalizeSalesWorkStatusMeterNo(
    row?.meterNo ||
      row?.masterId ||
      row?.ast?.astData?.astNo ||
      row?.astData?.astNo ||
      row?.master?.id,
  );
}

function getRegistryAstId(row = {}) {
  return cleanText(row?.meterId || row?.id);
}

function getAstId(row = {}) {
  return cleanText(row?.id);
}

function getRegistryLmPcode(row = {}) {
  return normalizeLmPcode(row?.lmPcode || row?.parents?.lmPcode);
}

function getAstLmPcode(row = {}) {
  return normalizeLmPcode(
    row?.lmPcode || row?.accessData?.parents?.lmPcode,
  );
}

function buildIntegrityException(issues, evidence = {}) {
  return {
    status: SALES_STATUSES.INTEGRITY_EXCEPTION,
    issues: [...new Set((issues || []).filter(Boolean))],
    evidence,
  };
}

function inspectFieldWorkStatus(sales = {}) {
  const integrity = sales?.tbRefsIntegrity;

  if (!integrity || integrity.valid !== true) {
    return buildIntegrityException(
      (integrity?.issues || []).map((issue) => `TB_REFS_${issue}`),
      { tbRefsIntegrity: integrity || null },
    );
  }

  if (!Array.isArray(sales?.tbRefs)) {
    return buildIntegrityException(["TB_REFS_INVALID"]);
  }

  let hasInProgress = false;
  let hasCompleted = false;

  for (const [index, reference] of sales.tbRefs.entries()) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      return buildIntegrityException([`TB_REF_${index}_INVALID`]);
    }

    const fieldWork = reference?.fieldWork;
    if (fieldWork === undefined || fieldWork === null) continue;

    if (typeof fieldWork !== "object" || Array.isArray(fieldWork)) {
      return buildIntegrityException([`TB_REF_${index}_FIELDWORK_INVALID`]);
    }

    if (!Object.hasOwn(fieldWork, "status")) continue;

    if (typeof fieldWork.status !== "string") {
      return buildIntegrityException([`TB_REF_${index}_FIELDWORK_STATUS_INVALID`]);
    }

    const normalizedStatus = fieldWork.status.trim().toUpperCase();

    if (
      fieldWork.status !== normalizedStatus ||
      !FIELD_WORK_STATUSES.has(normalizedStatus)
    ) {
      return buildIntegrityException([`TB_REF_${index}_FIELDWORK_STATUS_INVALID`]);
    }

    if (normalizedStatus === SALES_STATUSES.COMPLETED) hasCompleted = true;
    if (normalizedStatus === SALES_STATUSES.IN_PROGRESS) hasInProgress = true;
  }

  if (hasCompleted) {
    return buildIntegrityException([
      "TB_COMPLETED_WITHOUT_RECONCILED_REGISTRY_AST",
    ]);
  }

  if (hasInProgress) {
    return {
      status: SALES_STATUSES.IN_PROGRESS,
      issues: [],
      evidence: { fieldWorkStatus: SALES_STATUSES.IN_PROGRESS },
    };
  }

  return {
    status: SALES_STATUSES.NOT_STARTED,
    issues: [],
    evidence: { fieldWorkStatus: SALES_STATUSES.NOT_STARTED },
  };
}

function groupByMeterNo(rows, getMeterNo) {
  const grouped = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const meterNo = getMeterNo(row);
    if (!meterNo) return;

    const existing = grouped.get(meterNo) || [];
    existing.push(row);
    grouped.set(meterNo, existing);
  });

  return grouped;
}

export function classifySalesTableWorkStatus({
  sales = {},
  registryMatches = [],
  astMatches = [],
  expectedLmPcode = "",
} = {}) {
  const meterNo = getSalesMeterNo(sales);

  if (!meterNo) {
    return buildIntegrityException(["SALES_METER_ID_INVALID"], {
      registryMatches: registryMatches.length,
      astMatches: astMatches.length,
    });
  }

  const expectedLm = normalizeLmPcode(expectedLmPcode || sales?.lmPcode);
  const salesLm = normalizeLmPcode(sales?.lmPcode);

  if (expectedLm && salesLm && salesLm !== expectedLm) {
    return buildIntegrityException(["SALES_LM_SCOPE_MISMATCH"], {
      meterNo,
      expectedLm,
      salesLm,
    });
  }

  if (registryMatches.length > 1 || astMatches.length > 1) {
    const issues = [];
    if (registryMatches.length > 1) {
      issues.push("MULTIPLE_METER_REGISTRY_MATCHES");
    }
    if (astMatches.length > 1) issues.push("MULTIPLE_AST_MATCHES");

    return buildIntegrityException(issues, {
      meterNo,
      registryMatches: registryMatches.length,
      astMatches: astMatches.length,
    });
  }

  if (registryMatches.length === 1 && astMatches.length === 1) {
    const registry = registryMatches[0];
    const ast = astMatches[0];
    const registryAstId = getRegistryAstId(registry);
    const astId = getAstId(ast);
    const registryLm = getRegistryLmPcode(registry);
    const astLm = getAstLmPcode(ast);
    const issues = [];

    if (!registryAstId || !astId || registryAstId !== astId) {
      issues.push("REGISTRY_AST_ID_MISMATCH");
    }

    if (expectedLm && registryLm && registryLm !== expectedLm) {
      issues.push("METER_REGISTRY_LM_SCOPE_MISMATCH");
    }

    if (expectedLm && astLm && astLm !== expectedLm) {
      issues.push("AST_LM_SCOPE_MISMATCH");
    }

    if (issues.length > 0) {
      return buildIntegrityException(issues, {
        meterNo,
        registryAstId: registryAstId || null,
        astId: astId || null,
        registryLm: registryLm || null,
        astLm: astLm || null,
      });
    }

    return {
      status: SALES_STATUSES.COMPLETED,
      issues: [],
      evidence: {
        meterNo,
        registryAstId,
        astId,
        registryMatches: 1,
        astMatches: 1,
      },
    };
  }

  if (registryMatches.length === 1 && astMatches.length === 0) {
    return buildIntegrityException(["METER_REGISTRY_WITHOUT_AST"], {
      meterNo,
      registryAstId: getRegistryAstId(registryMatches[0]) || null,
    });
  }

  if (registryMatches.length === 0 && astMatches.length === 1) {
    return buildIntegrityException(["AST_WITHOUT_METER_REGISTRY"], {
      meterNo,
      astId: getAstId(astMatches[0]) || null,
    });
  }

  return inspectFieldWorkStatus(sales);
}

export function buildSalesTableWorkStatusRows({
  salesRows = [],
  registryRows = [],
  astRows = [],
  lmPcode = "",
} = {}) {
  const registryByMeterNo = groupByMeterNo(registryRows, getRegistryMeterNo);
  const astByMeterNo = groupByMeterNo(astRows, getAstMeterNo);

  return (Array.isArray(salesRows) ? salesRows : []).map((sales) => {
    const meterNo = getSalesMeterNo(sales);
    const registryMatches = meterNo
      ? registryByMeterNo.get(meterNo) || []
      : [];
    const astMatches = meterNo ? astByMeterNo.get(meterNo) || [] : [];

    const classification = classifySalesTableWorkStatus({
      sales,
      registryMatches,
      astMatches,
      expectedLmPcode: lmPcode,
    });

    return {
      ...sales,
      salesWorkStatus: classification.status,
      salesWorkStatusIssues: classification.issues,
      salesWorkStatusEvidence: classification.evidence,
    };
  });
}
