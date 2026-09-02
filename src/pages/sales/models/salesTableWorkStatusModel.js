import { SALES_STATUSES } from "./salesStatusModel.js";
import { buildSalesTbRefCorrelationKey } from "./salesTbRefsIntegrityModel.js";

function hasGenuineInProgressFieldWork(row = {}) {
  if (!Array.isArray(row?.tbRefs)) return false;

  const entriesByKey = row?.tbRefsIntegrity?.entriesByKey;
  if (!entriesByKey || typeof entriesByKey !== "object") return false;

  return row.tbRefs.some((reference) => {
    if (reference?.fieldWork?.status !== SALES_STATUSES.IN_PROGRESS) {
      return false;
    }

    const correlationKey = buildSalesTbRefCorrelationKey(reference);
    return entriesByKey[correlationKey]?.classifiable === true;
  });
}

export function classifySalesTableWorkStatus(row = {}) {
  if (row?.masterVisibility === "VISIBLE") {
    return SALES_STATUSES.COMPLETED;
  }

  if (hasGenuineInProgressFieldWork(row)) {
    return SALES_STATUSES.IN_PROGRESS;
  }

  return SALES_STATUSES.NOT_STARTED;
}

export function buildSalesTableWorkStatusRows({ salesRows = [] } = {}) {
  return (Array.isArray(salesRows) ? salesRows : []).map((row) => ({
    ...row,
    salesWorkStatus: classifySalesTableWorkStatus(row),
  }));
}
