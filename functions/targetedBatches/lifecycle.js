export const TARGETED_BATCH_ROW_STATUSES = Object.freeze({
  created: "CREATED",
  allocated: "ALLOCATED",
  accepted: "ACCEPTED",
  rejected: "REJECTED",
  completed: "COMPLETED",
});

export const TARGETED_BATCH_DERIVED_STATES = Object.freeze({
  ...TARGETED_BATCH_ROW_STATUSES,
  inconsistent: "INCONSISTENT",
});

const CANONICAL_ROW_STATUS_SET = new Set(
  Object.values(TARGETED_BATCH_ROW_STATUSES),
);

function cleanText(value) {
  return String(value ?? "").trim();
}

function asPositiveInteger(value) {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) return null;
  return numberValue;
}

function pushDiagnostic(diagnostics, code, extra = {}) {
  diagnostics.push({ code, ...extra });
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length;
}

function normalizeExpectedIdentity(identity = {}) {
  return {
    id: cleanText(identity?.id),
    rowNo: asPositiveInteger(identity?.rowNo),
    salesAllMeterId: cleanText(identity?.salesAllMeterId),
  };
}

function normalizeActualIdentity(row = {}) {
  return {
    id: cleanText(row?.id),
    tbId: cleanText(row?.tbId),
    rowNo: asPositiveInteger(row?.rowNo),
    salesAllMeterId: cleanText(row?.salesAllMeterId),
    status: row?.status,
  };
}

export function isCanonicalTargetedBatchRowStatus(value) {
  return CANONICAL_ROW_STATUS_SET.has(value);
}

export function validateCompleteTargetedBatchRowSet({
  tbId,
  expectedRowCount,
  expectedRows,
  rows,
} = {}) {
  const diagnostics = [];
  const normalizedTbId = cleanText(tbId);
  const normalizedExpectedRowCount = asPositiveInteger(expectedRowCount);
  const actualRows = Array.isArray(rows) ? rows : [];
  const expectedIdentities = Array.isArray(expectedRows)
    ? expectedRows.map(normalizeExpectedIdentity)
    : [];
  const actualIdentities = actualRows.map(normalizeActualIdentity);

  if (!normalizedTbId) {
    pushDiagnostic(diagnostics, "TB_ID_REQUIRED");
  }

  if (normalizedExpectedRowCount === null) {
    pushDiagnostic(diagnostics, "EXPECTED_ROW_COUNT_INVALID", {
      expectedRowCount,
    });
  }

  if (!Array.isArray(expectedRows)) {
    pushDiagnostic(diagnostics, "EXPECTED_ROW_IDENTITIES_REQUIRED");
  } else if (
    normalizedExpectedRowCount !== null &&
    expectedIdentities.length !== normalizedExpectedRowCount
  ) {
    pushDiagnostic(diagnostics, "EXPECTED_IDENTITY_COUNT_MISMATCH", {
      expectedRowCount: normalizedExpectedRowCount,
      identityCount: expectedIdentities.length,
    });
  }

  if (!Array.isArray(rows)) {
    pushDiagnostic(diagnostics, "ROWS_REQUIRED");
  } else if (
    normalizedExpectedRowCount !== null &&
    actualRows.length !== normalizedExpectedRowCount
  ) {
    pushDiagnostic(diagnostics, "ROW_COUNT_MISMATCH", {
      expectedRowCount: normalizedExpectedRowCount,
      actualRowCount: actualRows.length,
    });
  }

  const expectedIds = expectedIdentities.map((identity) => identity.id);
  const expectedRowNos = expectedIdentities.map((identity) => identity.rowNo);
  const expectedSalesIds = expectedIdentities.map(
    (identity) => identity.salesAllMeterId,
  );

  expectedIdentities.forEach((identity, index) => {
    if (!identity.id) {
      pushDiagnostic(diagnostics, "EXPECTED_ROW_ID_MISSING", { index });
    }
    if (identity.rowNo === null) {
      pushDiagnostic(diagnostics, "EXPECTED_ROW_NO_INVALID", { index });
    }
    if (!identity.salesAllMeterId) {
      pushDiagnostic(diagnostics, "EXPECTED_SALES_ID_MISSING", { index });
    }
  });

  if (expectedIds.some(Boolean) && hasDuplicates(expectedIds.filter(Boolean))) {
    pushDiagnostic(diagnostics, "DUPLICATE_EXPECTED_ROW_ID");
  }
  if (
    expectedRowNos.some((value) => value !== null) &&
    hasDuplicates(expectedRowNos.filter((value) => value !== null))
  ) {
    pushDiagnostic(diagnostics, "DUPLICATE_EXPECTED_ROW_NO");
  }
  if (
    expectedSalesIds.some(Boolean) &&
    hasDuplicates(expectedSalesIds.filter(Boolean))
  ) {
    pushDiagnostic(diagnostics, "DUPLICATE_EXPECTED_SALES_ID");
  }

  if (
    normalizedExpectedRowCount !== null &&
    expectedRowNos.length === normalizedExpectedRowCount &&
    expectedRowNos.every((value) => value !== null)
  ) {
    const sortedExpectedRowNos = [...expectedRowNos].sort((a, b) => a - b);
    const expectedSequence = Array.from(
      { length: normalizedExpectedRowCount },
      (_, index) => index + 1,
    );

    if (
      sortedExpectedRowNos.some(
        (value, index) => value !== expectedSequence[index],
      )
    ) {
      pushDiagnostic(diagnostics, "EXPECTED_ROW_NO_SEQUENCE_INVALID");
    }
  }

  const actualIds = actualIdentities.map((identity) => identity.id);
  const actualRowNos = actualIdentities.map((identity) => identity.rowNo);
  const actualSalesIds = actualIdentities.map(
    (identity) => identity.salesAllMeterId,
  );

  actualIdentities.forEach((identity, index) => {
    if (!identity.id) {
      pushDiagnostic(diagnostics, "ROW_ID_MISSING", { index });
    }
    if (!identity.tbId || identity.tbId !== normalizedTbId) {
      pushDiagnostic(diagnostics, "ROW_TB_ID_MISMATCH", {
        index,
        rowId: identity.id || null,
        rowTbId: identity.tbId || null,
      });
    }
    if (identity.rowNo === null) {
      pushDiagnostic(diagnostics, "ROW_NO_INVALID", {
        index,
        rowId: identity.id || null,
      });
    }
    if (!identity.salesAllMeterId) {
      pushDiagnostic(diagnostics, "SALES_ID_MISSING", {
        index,
        rowId: identity.id || null,
      });
    }
    if (!isCanonicalTargetedBatchRowStatus(identity.status)) {
      pushDiagnostic(diagnostics, "ROW_STATUS_INVALID", {
        index,
        rowId: identity.id || null,
        status: identity.status ?? null,
      });
    }
  });

  if (actualIds.some(Boolean) && hasDuplicates(actualIds.filter(Boolean))) {
    pushDiagnostic(diagnostics, "DUPLICATE_ROW_ID");
  }
  if (
    actualRowNos.some((value) => value !== null) &&
    hasDuplicates(actualRowNos.filter((value) => value !== null))
  ) {
    pushDiagnostic(diagnostics, "DUPLICATE_ROW_NO");
  }
  if (
    actualSalesIds.some(Boolean) &&
    hasDuplicates(actualSalesIds.filter(Boolean))
  ) {
    pushDiagnostic(diagnostics, "DUPLICATE_SALES_ID");
  }

  if (expectedIdentities.length > 0 && actualIdentities.length > 0) {
    const expectedById = new Map(
      expectedIdentities
        .filter((identity) => identity.id)
        .map((identity) => [identity.id, identity]),
    );
    const actualById = new Map(
      actualIdentities
        .filter((identity) => identity.id)
        .map((identity) => [identity.id, identity]),
    );

    for (const expectedIdentity of expectedIdentities) {
      if (!expectedIdentity.id) continue;

      const actualIdentity = actualById.get(expectedIdentity.id);
      if (!actualIdentity) {
        pushDiagnostic(diagnostics, "EXPECTED_ROW_MISSING", {
          rowId: expectedIdentity.id,
        });
        continue;
      }

      if (actualIdentity.rowNo !== expectedIdentity.rowNo) {
        pushDiagnostic(diagnostics, "ROW_IDENTITY_ROW_NO_MISMATCH", {
          rowId: expectedIdentity.id,
          expectedRowNo: expectedIdentity.rowNo,
          actualRowNo: actualIdentity.rowNo,
        });
      }

      if (
        actualIdentity.salesAllMeterId !== expectedIdentity.salesAllMeterId
      ) {
        pushDiagnostic(diagnostics, "ROW_IDENTITY_SALES_ID_MISMATCH", {
          rowId: expectedIdentity.id,
          expectedSalesAllMeterId: expectedIdentity.salesAllMeterId,
          actualSalesAllMeterId: actualIdentity.salesAllMeterId,
        });
      }
    }

    for (const actualIdentity of actualIdentities) {
      if (!actualIdentity.id) continue;
      if (!expectedById.has(actualIdentity.id)) {
        pushDiagnostic(diagnostics, "UNEXPECTED_ROW_ID", {
          rowId: actualIdentity.id,
        });
      }
    }
  }

  return {
    complete: diagnostics.length === 0,
    diagnostics,
    expectedRowCount: normalizedExpectedRowCount,
    actualRowCount: actualRows.length,
  };
}

function deriveStateFromValidatedRows(rows) {
  const statuses = rows.map((row) => row.status);
  const uniqueStatuses = new Set(statuses);

  if (
    uniqueStatuses.size === 1 &&
    uniqueStatuses.has(TARGETED_BATCH_ROW_STATUSES.created)
  ) {
    return TARGETED_BATCH_DERIVED_STATES.created;
  }

  if (
    uniqueStatuses.size === 1 &&
    uniqueStatuses.has(TARGETED_BATCH_ROW_STATUSES.allocated)
  ) {
    return TARGETED_BATCH_DERIVED_STATES.allocated;
  }

  if (
    uniqueStatuses.size === 1 &&
    uniqueStatuses.has(TARGETED_BATCH_ROW_STATUSES.accepted)
  ) {
    return TARGETED_BATCH_DERIVED_STATES.accepted;
  }

  if (
    uniqueStatuses.size === 1 &&
    uniqueStatuses.has(TARGETED_BATCH_ROW_STATUSES.rejected)
  ) {
    return TARGETED_BATCH_DERIVED_STATES.rejected;
  }

  if (
    uniqueStatuses.size === 1 &&
    uniqueStatuses.has(TARGETED_BATCH_ROW_STATUSES.completed)
  ) {
    return TARGETED_BATCH_DERIVED_STATES.completed;
  }

  if (
    uniqueStatuses.size === 2 &&
    uniqueStatuses.has(TARGETED_BATCH_ROW_STATUSES.accepted) &&
    uniqueStatuses.has(TARGETED_BATCH_ROW_STATUSES.completed)
  ) {
    return TARGETED_BATCH_DERIVED_STATES.accepted;
  }

  return TARGETED_BATCH_DERIVED_STATES.inconsistent;
}

export function deriveTargetedBatchState(input = {}) {
  const validation = validateCompleteTargetedBatchRowSet(input);

  if (!validation.complete) {
    return {
      status: TARGETED_BATCH_DERIVED_STATES.inconsistent,
      completeRowSet: false,
      diagnostics: validation.diagnostics,
      expectedRowCount: validation.expectedRowCount,
      actualRowCount: validation.actualRowCount,
    };
  }

  return {
    status: deriveStateFromValidatedRows(input.rows),
    completeRowSet: true,
    diagnostics: [],
    expectedRowCount: validation.expectedRowCount,
    actualRowCount: validation.actualRowCount,
  };
}
