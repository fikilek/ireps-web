import { TB_ROW_WORK_STATUS_LABELS, rowOutcomeText } from "./targetedBatchRowsModel.js";

const shown = value => String(value ?? "").trim() || "NAv";
const field = (key, label, group, filter = "text") => ({ key, label, group, filter, value: row => shown(row[key]) });

export const TB_ROW_COLUMN_GROUPS = [
  { key: "identity", label: "Row Details" },
  { key: "location", label: "Location" },
  { key: "assessment", label: "Assessment" },
  { key: "work", label: "Allocation & Field Work" },
  { key: "sales", label: "Sales" },
];

export const TB_ROW_COLUMNS = [
  { ...field("rowNo", "Row", "identity"), sortValue: row => Number(row.rowNo) || 0 },
  { ...field("meterNo", "Meter No", "identity"),
    value: row => [row.meterNo, row.foundMeterNo].filter(Boolean).join(" ") || "NAv",
    sortValue: row => row.meterNo || "", exportValue: row => shown(row.meterNo) },
  field("accountNumber", "Account", "identity"),
  field("customerName", "Customer", "identity"),
  field("tbRowId", "TB Row ID", "identity"),
  field("address", "Address", "location"),
  field("town", "Town", "location", "select"),
  field("sgCode", "SG Code", "location"),
  field("outcome", "Row Decision", "assessment", "select"),
  field("rejectionReason", "Rejection Reason", "assessment"),
  field("astMatchStatus", "AST Match", "assessment", "select"),
  field("proposedTrnType", "Proposed TRN", "assessment", "select"),
  field("allocationStatus", "Allocation", "work", "select"),
  { key: "allocatedTo", label: "Allocated To", group: "work", filter: "select", value: row => row.allocationTarget?.label || "Unallocated" },
  field("fieldAcceptanceStatus", "Field Acceptance", "work", "select"),
  field("premiseStatus", "Premise", "work", "select"),
  field("meterDiscoveryStatus", "Meter Discovery", "work", "select"),
  { key: "workStatus", label: "Status", group: "work", filter: "select", value: row => TB_ROW_WORK_STATUS_LABELS[row.workStatus] || "Not Started" },
  { key: "totalSalesC", label: "Total Sales", group: "sales", filter: "salesRange", align: "right",
    value: row => row.totalSalesC, sortValue: row => row.totalSalesC ?? -Infinity,
    exportValue: row => row.totalSalesC == null ? null : row.totalSalesC / 100 },
];

export function targetedBatchRowSearchValue(row) {
  return [
    ...TB_ROW_COLUMNS.map(column => column.value(row)),
    row.actionReason, row.sourceReference, row.premiseId,
    row.meterDiscoveryTrnId, row.astId, row.foundMeterNo, rowOutcomeText(row),
  ].filter(value => value != null).join(" ");
}

export const TB_ROW_DOWNLOAD_COLUMNS = [
  ...TB_ROW_COLUMNS.map(column => ({ key: column.key, header: column.label, value: column.exportValue || column.value })),
  { header: "Found Meter No", value: row => row.foundMeterNo },
  { header: "Field Result", value: rowOutcomeText },
  { header: "Execution Outcome", value: row => row.executionOutcome },
  { header: "Recorded Completion Status", value: row => row.completionStatus },
  { header: "Premise ID", value: row => row.premiseId },
  { header: "Meter Discovery TRN ID", value: row => row.meterDiscoveryTrnId },
  { header: "AST ID", value: row => row.astId },
];
