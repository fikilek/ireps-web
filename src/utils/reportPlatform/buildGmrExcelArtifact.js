import * as XLSX from "xlsx";

export const GMR_NOT_AVAILABLE = "Not Available";

const MASTER_SECTIONS = [
  {
    name: "A. Meter Identity & Sales Reconciliation",
    columns: [
      column("originalProjectMeterNo", "Original / Project Meter Number", "text", "Targeted Batch / Sales", "Immutable project/baseline meter anchor when available."),
      column("fieldFoundMeterNo", "Field-Found Meter Number", "text", "Meter Discovery", "Meter physically found/submitted by the field team."),
      column("iRepsMeterId", "iREPS Meter ID", "text", "Meter Registry", "iREPS meter/AST registry identifier."),
      column("registryVisibility", "Registry Visibility", "text", "Meter Registry", "Visible means field-found meter is linked to Sales; Invisible means it is not."),
      column("fieldFoundMeterInSales", "Field-Found Meter in Sales", "text", "Sales reconciliation", "Whether the field-found meter currently resolves to a Sales record."),
      column("fieldFoundSalesMeterNo", "Field-Found Sales Meter Number", "text", "Sales reconciliation", "Meter number resolved from the field-found meter Sales record."),
      column("salesHistorySourceMeterNo", "Sales History Source Meter Number", "text", "Sales / Targeted Batch", "Meter whose municipal Sales history supplies the longitudinal purchase values."),
      column("salesHistoryAvailable", "Sales History Available", "text", "Sales / Vending", "Whether monthly purchase history is available in the GMR reporting window."),
      column("salesCategory", "Sales Category", "text", "Sales / Vending", "Authoritative Sales leakage category, preserved exactly as supplied (for example Normal or CAT1-CAT8 classifications)."),
      column("targetCategory", "Target Category (1-8)", "text", "GMR derived from Sales Category", "Yes when Sales Category starts with CAT1 through CAT8; No for non-target categories such as Normal; Not Available when category evidence is absent."),
      column("accountNumber", "Municipal Account / Customer Reference", "text", "Sales / Targeted Batch", "Municipal account/customer reference where available."),
      column("customerName", "Customer Name", "text", "Sales / Targeted Batch", "Customer name where available."),
      column("iRepsPremiseId", "iREPS Premise ID", "text", "Meter Registry / Premise Registry", "Linked iREPS premise identifier."),
      column("lm", "LM", "text", "GMR scope", "Local municipality."),
      column("ward", "Ward", "text", "Meter Registry / Premise Registry", "Ward derived from the authoritative ward PCode."),
      column("areaWorkbase", "Area / Workbase", "text", "GMR scope", "Operational workbase/area."),
      column("erf", "ERF", "text", "Meter Registry / Premise Registry", "Linked ERF number."),
      column("streetNumber", "Street Number", "text", "Premises", "Authoritative premise street number."),
      column("streetName", "Street Name", "text", "Premises", "Authoritative premise street name."),
      column("fullAddress", "Full Address", "text", "Premises / Sales", "Best available authoritative address."),
      column("batchAllocationReference", "Batch / Allocation Reference", "text", "Meter Discovery Targeted Batch context", "Targeted Batch and row reference when the discovery originated from a targeted batch."),
      column("team", "Team", "text", "Meter Discovery assignment", "Assigned/creating team where available."),
      column("serviceProvider", "Service Provider", "text", "Meter Discovery", "Service Provider captured on the Meter Discovery."),
      column("investigationStatus", "Investigation Status", "text", "Meter Discovery", "Meter investigation/discovery status."),
      column("investigationDate", "Investigation Date", "date", "Meter Discovery", "Date the field Meter Discovery was created."),
    ],
  },
  {
    name: "B. Property Status",
    columns: [
      column("propertyExists", "Property Exists", "text", "Premise / field capture", "RSTE requested property-existence field; populated only when authoritative data exists."),
      column("propertyOccupiedActive", "Property Occupied / Active", "text", "Premise / field capture", "RSTE requested occupancy/active field; populated only when authoritative data exists."),
      column("propertyAccessible", "Property Accessible", "text", "Meter Discovery access", "Whether field access to the premise was recorded."),
      column("propertyCondition", "Property Condition", "text", "Premise / field capture", "RSTE requested property-condition field; populated only when authoritative data exists."),
      column("propertyStatusFindingNotes", "Property Status / Finding Notes", "text", "Premises", "Available premise-status context without inventing an RSTE classification."),
    ],
  },
  {
    name: "C. Meter Verification",
    columns: [
      column("meterExists", "Meter Exists", "text", "Meter Registry / Meter Discovery", "Whether a field-found meter exists."),
      column("meterNumberVerified", "Meter Number Verified", "text", "Targeted Batch + Meter Discovery", "Correct when original/project and field-found meter numbers match; Incorrect when they differ."),
      column("meterOperational", "Meter Operational", "text", "Meter Discovery", "RSTE requested operational field; populated only when explicitly supported."),
      column("meterAccessible", "Meter Accessible", "text", "Meter Discovery access", "Whether the meter was accessible during discovery."),
      column("meterInstallation", "Meter Installation", "text", "Meter Discovery", "RSTE requested installation assessment; populated only when explicitly supported."),
      column("expectedMeterTypeTechnology", "Expected Meter Type / Technology", "text", "Project/Sales source", "Expected meter technology where authoritative data exists."),
      column("fieldMeterTypeTechnology", "Field Meter Type / Technology", "text", "Meter Discovery", "Captured utility/kind/phase description."),
      column("meterKind", "Meter Kind", "text", "Meter Registry", "Prepaid/conventional classification."),
      column("meterUtilityType", "Meter Utility Type", "text", "Meter Registry", "Electricity/water classification."),
      column("meterConnectionStatus", "Meter Connection Status", "text", "Meter Registry", "Current registry meter lifecycle state."),
      column("meterVerificationNotes", "Meter Verification Notes", "text", "Meter Discovery", "Additional authoritative meter-verification notes."),
    ],
  },
  {
    name: "D. Findings & Anomalies",
    columns: [
      column("tamperingBypassBridgingEvidence", "Tampering / Bypass / Bridging Evidence", "text", "Meter Discovery anomaly", "Derived only from the Meter Discovery anomaly/anomaly detail."),
      column("primaryFinding", "Primary Finding", "text", "Meter Discovery anomaly", "Primary anomaly captured on the Meter Discovery TRN."),
      column("findingDetail", "Finding Detail", "text", "Meter Discovery anomaly", "Detailed anomaly captured on the Meter Discovery TRN."),
      column("illegalConnectionIndicator", "Illegal Connection Indicator", "text", "Meter Discovery anomaly", "Indicator derived from the Meter Discovery anomaly/anomaly detail."),
      column("findingDate", "Finding Date", "date", "Meter Discovery", "Date of the Meter Discovery finding."),
      column("latestRelevantTrnType", "Latest Relevant TRN Type", "text", "Meter Discovery", "TRN type providing the field finding evidence for this section."),
      column("latestRelevantTrnId", "Latest Relevant TRN ID", "text", "Meter Discovery", "TRN ID providing the field finding evidence."),
      column("fieldFindingEvidenceNotes", "Field Finding / Evidence Notes", "text", "Meter Discovery", "Additional field finding/evidence notes when available."),
    ],
  },
  {
    name: "E. Intervention & Recovery",
    columns: [
      column("interventionRequired", "Intervention Required", "text", "Finding + lifecycle TRNs", "Whether the current evidence indicates an intervention is required."),
      column("interventionStatus", "Intervention Status", "text", "Lifecycle TRNs", "Required, Pending, Completed, Not Required, or Not Available."),
      column("interventionCount", "Intervention Count", "integer", "Lifecycle TRNs", "Number of DCN/RCN intervention events linked to the meter."),
      column("firstInterventionDate", "First Intervention Date", "date", "Lifecycle TRNs", "First linked intervention event date."),
      column("latestInterventionDate", "Latest Intervention Date", "date", "Lifecycle TRNs", "Latest linked intervention event date."),
      column("latestInterventionType", "Latest Intervention Type", "text", "Lifecycle TRNs", "Latest intervention TRN type."),
      column("disconnected", "Disconnected", "text", "METER_DISCONNECTION TRNs", "Whether a completed disconnection has been recorded."),
      column("latestDisconnectionDate", "Latest Disconnection Date", "date", "METER_DISCONNECTION TRNs", "Latest completed disconnection date."),
      column("latestDisconnectionReason", "Latest Disconnection Reason", "text", "METER_DISCONNECTION TRNs", "Best available disconnection level/instruction reason."),
      column("latestDisconnectedBy", "Latest Disconnected By", "text", "METER_DISCONNECTION TRNs", "User recorded as completing the latest disconnection."),
      column("reconnected", "Reconnected", "text", "METER_RECONNECTION TRNs", "Whether a completed reconnection has been recorded."),
      column("latestReconnectionDate", "Latest Reconnection Date", "date", "METER_RECONNECTION TRNs", "Latest completed reconnection date."),
      column("latestReconnectedBy", "Latest Reconnected By", "text", "METER_RECONNECTION TRNs", "User recorded as reconnecting the meter."),
      column("fineIssued", "Fine Issued", "text", "Fine/recovery source", "Whether a fine has been issued. External fine source is not yet connected in v0.1."),
      column("latestFineReference", "Latest Fine Reference", "text", "Fine/recovery source", "Latest fine reference when the fine source is connected."),
      column("latestFineIssuedDate", "Latest Fine Issued Date", "date", "Fine/recovery source", "Latest fine-issued date."),
      column("totalFinesIssuedR", "Total Fines Issued (R)", "currency", "Fine/recovery source", "Total fine amount issued; not treated as collected revenue."),
      column("finePaid", "Fine Paid", "text", "Fine/recovery source", "Whether fine payment has been recorded."),
      column("latestFinePaymentDate", "Latest Fine Payment Date", "date", "Fine/recovery source", "Latest fine-payment date."),
      column("totalFinesPaidR", "Total Fines Paid (R)", "currency", "Fine/recovery source", "Total actual fine payments recorded."),
      column("outstandingFineAmountR", "Outstanding Fine Amount (R)", "currency", "Fine/recovery source", "Outstanding fine amount."),
      column("directRecoveryAmountR", "Direct Recovery Amount (R)", "currency", "Fine/recovery source", "Actual direct municipal recovery; kept separate from vending revenue."),
      column("interventionSource", "Intervention Source", "text", "Lifecycle / external intervention sources", "Source that supplied the intervention evidence."),
      column("interventionRecoveryNotes", "Intervention / Recovery Notes", "text", "Intervention/recovery sources", "Additional intervention/recovery context."),
    ],
  },
  {
    name: "F. Monthly Purchase History",
    dynamicMonthly: true,
  },
  {
    name: "G. Consumption, Payment & Revenue Analytics",
    columns: [
      column("purchasesAfterInvestigation", "Purchases After Investigation", "text", "GMR derived", "Whether any positive purchase is observed in available months after investigation."),
      column("purchasingBehaviour", "Purchasing Behaviour", "text", "GMR derived", "Normal/Irregular business rule is not yet defined; remains Not Available in v0.1."),
      column("purchasingMatchEnergy", "Purchasing Match Energy", "text", "RSTE definition required", "RSTE-requested field. Business definition is required before calculation."),
      column("preInvestigation3mAveragePurchase", "Pre-Investigation 3M Average Purchase", "currency", "GMR derived", "Average of the three complete calendar months immediately before the investigation month."),
      column("investigationMonthPurchase", "Investigation Month Purchase", "currency", "Sales / Vending", "Purchase value recorded in the investigation calendar month."),
      column("postInvestigation3mAveragePurchase", "Post-Investigation 3M Average Purchase", "currency", "GMR derived", "Average of the three complete calendar months immediately after the investigation month."),
      column("vendingRevenueMovementR", "Vending Revenue Movement (R)", "currency", "GMR derived", "Post-investigation 3M average minus pre-investigation 3M average."),
      column("vendingRevenueMovementPct", "Vending Revenue Movement (%)", "percentage", "GMR derived", "Observed vending movement divided by the pre-investigation average when denominator is non-zero."),
      column("financialImpactClassification", "Financial Impact Classification", "text", "GMR derived", "Improved, Declined or Unchanged where complete pre/post evidence exists."),
      column("latestAvailablePurchaseValue", "Latest Available Purchase Value", "currency", "Sales / Vending", "Latest available monthly purchase value in the reporting window."),
      column("previousMonthPurchaseValue", "Previous Month Purchase Value", "currency", "Sales / Vending", "Calendar month immediately preceding the latest available month, when available."),
      column("latestMonthMovementR", "Latest Month Movement (R)", "currency", "GMR derived", "Latest month purchase minus previous calendar month purchase."),
      column("latestMonthMovementPct", "Latest Month Movement (%)", "percentage", "GMR derived", "Latest month movement divided by previous month value when denominator is non-zero."),
      column("latestPurchasingStatus", "Latest Purchasing Status", "text", "GMR derived", "Purchasing when latest value is positive; Zero Purchase when latest value is a confirmed zero."),
      column("lastPurchaseMonth", "Last Purchase Month", "period", "GMR derived", "Latest month with a confirmed positive purchase."),
      column("consecutiveZeroPurchaseMonths", "Consecutive Zero-Purchase Months", "integer", "GMR derived", "Consecutive confirmed zero months from the end of the available reporting window; missing months stop the count."),
      column("revenueAssessmentStatus", "Revenue Assessment Status", "text", "GMR derived", "Whether enough complete pre/post history exists for the three-month assessment."),
      column("financialAnalysisNotes", "Financial Analysis Notes", "text", "GMR derived", "Methodology/availability note for the financial analysis."),
    ],
  },
];

function column(key, header, type, source, definition) {
  return { key, header, type, source, definition };
}

function monthHeader(monthKey) {
  const [year, month] = String(monthKey).split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  const label = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `Purchase Value ${label}-${year}`;
}

function monthlyColumn(monthKey) {
  return column(
    `monthlyPurchases.${monthKey}`,
    monthHeader(monthKey),
    "currency",
    "Municipal Sales / Vending",
    `Monthly vending/purchase amount for ${monthKey}. Missing source evidence is Not Available; confirmed zero remains numeric zero.`,
  );
}

function getPath(row, key) {
  return String(key)
    .split(".")
    .reduce((value, part) => (value === null || value === undefined ? undefined : value[part]), row);
}

function toExcelDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeCell(value, type = "text") {
  if (value === null || value === undefined || value === "") return GMR_NOT_AVAILABLE;
  if (type === "date") return toExcelDate(value) || GMR_NOT_AVAILABLE;
  if (type === "currency" || type === "percentage" || type === "integer") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : GMR_NOT_AVAILABLE;
  }
  if (Array.isArray(value)) return value.length ? value.join(", ") : GMR_NOT_AVAILABLE;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function sheetName(value) {
  return String(value || "GMR").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "GMR";
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return Uint8Array.from(value || []);
}

function setColumnWidths(worksheet, columns) {
  worksheet["!cols"] = columns.map((item) => {
    const base = Math.max(String(item.header || "").length + 2, 12);
    const wide = /Notes|Address|Finding Detail|Reason|Definition/i.test(item.header || "");
    return { wch: Math.min(wide ? Math.max(base, 28) : base, wide ? 42 : 24) };
  });
}

function applyColumnFormats(worksheet, columns, startRow, rowCount) {
  columns.forEach((item, columnIndex) => {
    for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
      const address = XLSX.utils.encode_cell({ r: startRow + rowOffset, c: columnIndex });
      const cell = worksheet[address];
      if (!cell || cell.v === GMR_NOT_AVAILABLE) continue;
      if (item.type === "currency" && typeof cell.v === "number") {
        cell.z = 'R #,##0.00;[Red]-R #,##0.00';
      } else if (item.type === "percentage" && typeof cell.v === "number") {
        cell.z = "0.0%";
      } else if (item.type === "integer" && typeof cell.v === "number") {
        cell.z = "0";
      } else if (item.type === "date" && cell.v instanceof Date) {
        cell.z = "yyyy-mm-dd";
      }
    }
  });
}

function buildMasterColumns(monthKeys) {
  return MASTER_SECTIONS.map((section) => ({
    ...section,
    columns: section.dynamicMonthly
      ? monthKeys.map(monthlyColumn)
      : section.columns,
  }));
}

export function getGmrMasterColumnDefinitions(monthKeys = []) {
  return buildMasterColumns(monthKeys).flatMap((section) =>
    section.columns.map((item) => ({ ...item, section: section.name })),
  );
}

function buildMasterSheet(rows, monthKeys) {
  const sections = buildMasterColumns(monthKeys).filter((section) => section.columns.length > 0);
  const columns = sections.flatMap((section) => section.columns);
  const sectionHeader = [];
  const merges = [];
  let cursor = 0;

  sections.forEach((section) => {
    const start = cursor;
    const end = cursor + section.columns.length - 1;
    sectionHeader[start] = section.name;
    for (let index = start + 1; index <= end; index += 1) sectionHeader[index] = "";
    if (end > start) merges.push({ s: { r: 0, c: start }, e: { r: 0, c: end } });
    cursor = end + 1;
  });

  const values = rows.map((row) =>
    columns.map((item) => normalizeCell(getPath(row, item.key), item.type)),
  );
  const worksheet = XLSX.utils.aoa_to_sheet(
    [sectionHeader, columns.map((item) => item.header), ...values],
    { cellDates: true },
  );
  worksheet["!merges"] = merges;
  if (columns.length) {
    worksheet["!autofilter"] = {
      ref: `A2:${XLSX.utils.encode_col(columns.length - 1)}${rows.length + 2}`,
    };
  }
  setColumnWidths(worksheet, columns);
  applyColumnFormats(worksheet, columns, 2, rows.length);
  return worksheet;
}

function distribution(rows, key) {
  const counts = new Map();
  rows.forEach((row) => {
    const raw = getPath(row, key);
    const label = raw === null || raw === undefined || raw === "" ? GMR_NOT_AVAILABLE : String(raw);
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
}

function appendDistributionRows(target, title, rows, key, total) {
  target.push([title, "Count", "% of Population"]);
  distribution(rows, key).forEach((item) => {
    target.push([item.value, item.count, total ? item.count / total : 0]);
  });
  target.push([]);
}

function buildDashboardSheet(dataset) {
  const summary = dataset.summary || {};
  const rows = dataset.rows || [];
  const aoa = [
    ["General Monthly Report — Builder v0.1"],
    ["Municipality", dataset?.municipality?.lmName || GMR_NOT_AVAILABLE],
    ["LM PCode", dataset?.municipality?.lmPcode || GMR_NOT_AVAILABLE],
    ["Generation Mode", dataset?.generationMode || GMR_NOT_AVAILABLE],
    ["Reporting Month", dataset?.reportingPeriodLabel || dataset?.reportMonth || GMR_NOT_AVAILABLE],
    ["Generated At", toExcelDate(dataset?.generatedAt) || GMR_NOT_AVAILABLE],
    ["Activity Scope", dataset?.activityScope || GMR_NOT_AVAILABLE],
    [],
    ["Full Meter Population Metric", "Value"],
    ["Total Meters", summary.selectedTotal ?? rows.length],
    ["Visible", summary.visibleSelected ?? GMR_NOT_AVAILABLE],
    ["Invisible", summary.invisibleSelected ?? GMR_NOT_AVAILABLE],
    ["Target Categories 1-8", summary.targetCategorySelected ?? GMR_NOT_AVAILABLE],
    ["Normal Category", summary.normalCategorySelected ?? GMR_NOT_AVAILABLE],
    ["Category Not Available", summary.categoryNotAvailableSelected ?? GMR_NOT_AVAILABLE],
    ["Field-Found Sales Matched", summary.fieldFoundSalesMatchedSelected ?? GMR_NOT_AVAILABLE],
    ["Sales History Available", summary.salesHistoryAvailableSelected ?? GMR_NOT_AVAILABLE],
    ["Premises Linked", summary.premiseLinkedSelected ?? GMR_NOT_AVAILABLE],
    [],
    ["Selected-Month Activity Metric", "Value"],
    ["Meter Discovery Records", summary.monthlyDiscoveryCount ?? 0],
    ["Completed DCN / RCN Events", summary.monthlyInterventionEventCount ?? 0],
    ["Meters With Monthly Interventions", summary.metersWithInterventions ?? 0],
    ["Reconciliation / Data Gap Rows", summary.exceptionCount ?? GMR_NOT_AVAILABLE],
    [],
  ];

  appendDistributionRows(aoa, "Sales Category — Full Population", rows, "salesCategory", rows.length);
  appendDistributionRows(aoa, "Ward — Full Population", rows, "ward", rows.length);
  appendDistributionRows(aoa, "Primary Finding — Selected Month", dataset.fieldRows || [], "primaryFinding", (dataset.fieldRows || []).length);
  appendDistributionRows(aoa, "Latest Purchasing Status — Full Population", rows, "latestPurchasingStatus", rows.length);

  const worksheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  worksheet["!cols"] = [{ wch: 40 }, { wch: 28 }, { wch: 18 }];

  for (let row = 0; row < aoa.length; row += 1) {
    const percentCell = worksheet[XLSX.utils.encode_cell({ r: row, c: 2 })];
    if (percentCell && typeof percentCell.v === "number") percentCell.z = "0.0%";
  }
  const generatedAtCell = worksheet.B6;
  if (generatedAtCell && generatedAtCell.v instanceof Date) {
    generatedAtCell.z = "yyyy-mm-dd hh:mm";
  }
  return worksheet;
}

function buildAnalysisSheet(rows, definitions) {
  const aoa = [["Dimension", "Value", "Count", "% of Population"]];
  definitions.forEach(({ label, key }) => {
    distribution(rows, key).forEach((item) => {
      aoa.push([label, item.value, item.count, rows.length ? item.count / rows.length : 0]);
    });
  });
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!autofilter"] = { ref: `A1:D${aoa.length}` };
  worksheet["!cols"] = [{ wch: 32 }, { wch: 34 }, { wch: 14 }, { wch: 16 }];
  for (let row = 1; row < aoa.length; row += 1) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: 3 })];
    if (cell && typeof cell.v === "number") cell.z = "0.0%";
  }
  return worksheet;
}

function buildInterventionSheet(events = []) {
  const columns = [
    column("gmrMeterKey", "GMR Meter Key", "text", "GMR", "Meter/AST key."),
    column("originalProjectMeterNo", "Original / Project Meter Number", "text", "GMR", "Original/project meter number."),
    column("fieldFoundMeterNo", "Field-Found Meter Number", "text", "GMR", "Field-found meter number."),
    column("accountNumber", "Municipal Account / Customer Reference", "text", "Sales", "Municipal account/customer reference."),
    column("customerName", "Customer Name", "text", "Sales", "Customer name."),
    column("physicalAddress", "Physical Address", "text", "Premise/Sales", "Best available physical address."),
    column("eventId", "Event ID", "text", "Intervention source", "Unique intervention event/TRN identifier."),
    column("eventType", "Event Type", "text", "Intervention source", "Disconnection/reconnection or future normalized intervention event type."),
    column("eventDate", "Event Date", "date", "Intervention source", "Event/completion date."),
    column("performedBy", "Performed By", "text", "Intervention source", "Actor recorded as completing the event."),
    column("reason", "Reason", "text", "Intervention source", "Disconnection/reconnection reason/instruction when available."),
    column("tamperFineClassification", "Tamper / Fine Classification", "text", "Fine source", "Fine/tamper classification when the external recovery source is connected."),
    column("fineReference", "Fine Reference", "text", "Fine source", "Fine reference."),
    column("fineAmountIssuedR", "Fine Amount Issued (R)", "currency", "Fine source", "Fine amount issued."),
    column("paymentMade", "Payment Made", "text", "Fine/payment source", "Fine payment status."),
    column("amountPaidR", "Amount Paid (R)", "currency", "Fine/payment source", "Amount actually paid."),
    column("amountOutstandingR", "Amount Outstanding (R)", "currency", "Fine/payment source", "Outstanding fine amount."),
    column("paymentDate", "Payment Date", "date", "Fine/payment source", "Fine payment date."),
    column("reconnectionDate", "Reconnection Date", "date", "METER_RECONNECTION", "Completed reconnection date."),
    column("reconnectedBy", "Reconnected By", "text", "METER_RECONNECTION", "User recorded as reconnecting the meter."),
    column("eventStatus", "Event Status", "text", "Lifecycle TRN", "Workflow state for the intervention event."),
    column("source", "Source", "text", "GMR", "Normalized source system."),
    column("sourceReference", "Source Reference", "text", "GMR", "Source document/TRN reference."),
    column("notes", "Notes", "text", "Intervention source", "Additional intervention notes."),
  ];
  const aoa = [
    columns.map((item) => item.header),
    ...events.map((event) => columns.map((item) => normalizeCell(getPath(event, item.key), item.type))),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}${Math.max(1, aoa.length)}` };
  setColumnWidths(worksheet, columns);
  applyColumnFormats(worksheet, columns, 1, events.length);
  return { worksheet, columns };
}

function getFinancialColumns() {
  return [
    column("originalProjectMeterNo", "Original / Project Meter Number", "text", "GMR", ""),
    column("fieldFoundMeterNo", "Field-Found Meter Number", "text", "GMR", ""),
    column("registryVisibility", "Registry Visibility", "text", "Meter Registry", ""),
    column("salesCategory", "Sales Category", "text", "Sales / Vending", ""),
    column("targetCategory", "Target Category (1-8)", "text", "GMR derived", ""),
    column("salesHistorySourceMeterNo", "Sales History Source Meter Number", "text", "Sales", ""),
    column("primaryFinding", "Primary Finding", "text", "Meter Discovery", ""),
    column("latestInterventionType", "Latest Intervention Type", "text", "Lifecycle TRNs", ""),
    column("totalFinesPaidR", "Direct Fine Recovery (R)", "currency", "Fine/payment source", ""),
    column("preInvestigation3mAveragePurchase", "Pre-Investigation 3M Average (R)", "currency", "GMR derived", ""),
    column("postInvestigation3mAveragePurchase", "Post-Investigation 3M Average (R)", "currency", "GMR derived", ""),
    column("vendingRevenueMovementR", "Observed Vending Movement (R)", "currency", "GMR derived", ""),
    column("vendingRevenueMovementPct", "Observed Vending Movement (%)", "percentage", "GMR derived", ""),
    column("latestAvailablePurchaseValue", "Latest Available Purchase (R)", "currency", "Sales", ""),
    column("latestPurchasingStatus", "Latest Purchasing Status", "text", "GMR derived", ""),
    column("lastPurchaseMonth", "Last Purchase Month", "period", "GMR derived", ""),
    column("revenueAssessmentStatus", "Revenue Assessment Status", "text", "GMR derived", ""),
  ];
}

function buildFinancialSheet(rows = []) {
  const columns = getFinancialColumns();
  const aoa = [columns.map((item) => item.header), ...rows.map((row) =>
    columns.map((item) => normalizeCell(getPath(row, item.key), item.type)),
  )];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}${aoa.length}` };
  setColumnWidths(worksheet, columns);
  applyColumnFormats(worksheet, columns, 1, rows.length);
  return worksheet;
}

const GMR_FIELD_DATA_PHOTO_COLUMN_COUNT = 6;
const GMR_METER_STATUS_ORDER = [
  "ILLEGALLY CONNECTED",
  "METER DAMAGED",
  "METER FAULTY",
  "METER OK",
];

function getZamoReportColumns() {
  const photoColumns = Array.from({ length: GMR_FIELD_DATA_PHOTO_COLUMN_COUNT }, (_, index) =>
    column(`photoUrls.${index}`, `Photo ${index + 1}`, "photo", "Meter Discovery media", ""),
  );

  return [
    column("captureDate", "Capture Date", "date", "Meter Discovery metadata", ""),
    column("fieldWorkerName", "Field Worker Name", "text", "Meter Discovery metadata", ""),
    column("batchId", "Batch ID", "text", "Meter Discovery targeted batch context", ""),
    column("streetNo", "Street No", "text", "Premises address.strNo", ""),
    column("streetName", "Street Name", "text", "Premises address.strName", ""),
    column("streetType", "Street Type", "text", "Premises address.strType", ""),
    column("suburbName", "SuburbName", "text", "Premises address.suburbName", ""),
    column("gpsCoordinates", "GPS Coordinates", "text", "Meter Discovery", ""),
    column("ward", "Ward", "text", "Meter Registry / Premises", ""),
    column("propertyType", "Property Type", "text", "Premises propertyType.type", ""),
    column("propertyName", "Property Name", "text", "Premises propertyType.name", ""),
    column("propertyUnitNo", "Unit No", "text", "Premises propertyType.unitNo", ""),
    column("meterMode", "Meter Mode", "text", "Meter Registry / Meter Discovery", ""),
    column("meterPhase", "Meter Phase", "text", "Meter Registry / Meter Discovery", ""),
    column("originalProjectMeterNo", "Original / Project Meter Number", "text", "GMR", ""),
    column("fieldFoundMeterNo", "Field-Found Meter Number", "text", "GMR", ""),
    column("sameDifferent", "Same/Different", "text", "GMR meter reconciliation", ""),
    column("primaryFinding", "Primary Finding", "text", "Meter Discovery anomaly", ""),
    column("findingDetail", "Finding Explanation", "text", "Meter Discovery anomaly detail", ""),
    column("normalisation", "Normalisation", "text", "Meter Discovery normalisation", ""),
    column("sealNo", "Seal No", "text", "Meter Discovery meter seal", ""),
    column("fieldComment", "Comment", "text", "Meter Discovery General Comment", ""),
    ...photoColumns,
  ];
}

function normalizeZamoFieldDataCell(row, item) {
  if (item.type === "photo") {
    const url = getPath(row, item.key);
    return url ? item.header : "";
  }

  const value = getPath(row, item.key);
  if (item.key === "batchId") {
    return value === null || value === undefined || value === "" ? "AD HOC" : value;
  }
  const normalized = normalizeCell(value, item.type);
  return normalized === GMR_NOT_AVAILABLE ? "NAv" : normalized;
}

function buildZamoReportData(rows = []) {
  const columns = getZamoReportColumns();
  const values = rows.map((row) => columns.map((item) =>
    normalizeZamoFieldDataCell(row, item),
  ));

  const records = values.map((rowValues) => Object.fromEntries(
    columns.map((item, index) => [item.header, rowValues[index]]),
  ));

  return { columns, values, records };
}

function buildZamoReportSheet(rows = []) {
  const data = buildZamoReportData(rows);
  const aoa = [data.columns.map((item) => item.header), ...data.values];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  worksheet["!autofilter"] = {
    ref: `A1:${XLSX.utils.encode_col(data.columns.length - 1)}${Math.max(1, aoa.length)}`,
  };
  setColumnWidths(worksheet, data.columns);
  applyColumnFormats(worksheet, data.columns, 1, rows.length);

  const photoColumns = data.columns.filter((item) => item.type === "photo");
  photoColumns.forEach((item) => {
    const columnIndex = data.columns.findIndex((columnItem) => columnItem.key === item.key);
    rows.forEach((row, rowIndex) => {
      const url = getPath(row, item.key);
      if (!url) return;
      const address = XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex });
      const cell = worksheet[address];
      if (!cell) return;
      cell.l = {
        Target: String(url),
        Tooltip: `Open ${item.header}`,
      };
    });
  });

  return { worksheet, data };
}

function zamoStatsLabel(value) {
  const text = String(value || "").trim();
  return text && text !== GMR_NOT_AVAILABLE ? text.toUpperCase() : GMR_NOT_AVAILABLE.toUpperCase();
}

function zamoMeterStatusLabel(row = {}) {
  const primary = zamoStatsLabel(row?.primaryFinding);
  if (primary !== GMR_NOT_AVAILABLE.toUpperCase()) return primary;
  return zamoStatsLabel(row?.findingDetail);
}

function orderedZamoMeterStatuses(rows = []) {
  const observed = new Set(rows.map((row) => zamoMeterStatusLabel(row)));
  const additional = [...observed]
    .filter((label) => !GMR_METER_STATUS_ORDER.includes(label))
    .sort((left, right) => left.localeCompare(right));
  return [...GMR_METER_STATUS_ORDER, ...additional];
}

function zamoNormalisationLabel(value) {
  return zamoStatsLabel(value);
}

function zamoStatsPeriodLabel(reportMonth) {
  const match = String(reportMonth || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return "GMR";
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  if (Number.isNaN(parsed.getTime())) return "GMR";
  return parsed.toLocaleString("en-ZA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).toUpperCase();
}

function buildZamoStatsSheet(rows = [], reportMonth) {
  const workers = [...new Set(rows.map((row) => {
    const value = String(row?.fieldWorkerName || "").trim();
    return value || GMR_NOT_AVAILABLE;
  }))].sort((left, right) => left.localeCompare(right));
  const teams = [...new Set(rows.map((row) => {
    const value = String(row?.fieldStatsTeam || "").trim();
    return value || "Unassigned";
  }))].sort((left, right) => left.localeCompare(right));
  const statuses = orderedZamoMeterStatuses(rows);

  const workerCounts = new Map(workers.map((worker) => [worker, 0]));
  const workerFindingCounts = new Map(
    statuses.map((status) => [status, new Map(workers.map((worker) => [worker, 0]))]),
  );
  const teamCounts = new Map(teams.map((team) => [team, 0]));
  const teamFindingCounts = new Map(
    statuses.map((status) => [status, new Map(teams.map((team) => [team, 0]))]),
  );

  rows.forEach((row) => {
    const worker = String(row?.fieldWorkerName || "").trim() || GMR_NOT_AVAILABLE;
    const team = String(row?.fieldStatsTeam || "").trim() || "Unassigned";
    const finding = zamoMeterStatusLabel(row);

    workerCounts.set(worker, (workerCounts.get(worker) || 0) + 1);
    teamCounts.set(team, (teamCounts.get(team) || 0) + 1);

    if (!workerFindingCounts.has(finding)) {
      workerFindingCounts.set(finding, new Map(workers.map((item) => [item, 0])));
    }
    if (!teamFindingCounts.has(finding)) {
      teamFindingCounts.set(finding, new Map(teams.map((item) => [item, 0])));
    }
    const workerStatusCounts = workerFindingCounts.get(finding);
    const teamStatusCounts = teamFindingCounts.get(finding);
    workerStatusCounts.set(worker, (workerStatusCounts.get(worker) || 0) + 1);
    teamStatusCounts.set(team, (teamStatusCounts.get(team) || 0) + 1);
  });

  const period = zamoStatsPeriodLabel(reportMonth);
  const maxGroupColumns = Math.max(workers.length, teams.length);
  const lastColumnIndex = maxGroupColumns + 2;
  const lastColumnLetter = XLSX.utils.encode_col(workers.length + 2);
  const aoa = [];
  const merges = [];

  aoa.push([`${period} - METER AUDIT`]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: lastColumnIndex } });
  aoa.push(["ITEM", "METER STATUS", ...workers, "TOTAL"]);

  statuses.forEach((finding, index) => {
    const counts = workerFindingCounts.get(finding) || new Map();
    const values = workers.map((worker) => counts.get(worker) || 0);
    aoa.push([index + 1, finding, ...values, values.reduce((sum, value) => sum + value, 0)]);
  });

  aoa.push([
    "",
    "TOTAL: METER DISCOVERY RECORDS",
    ...workers.map((worker) => workerCounts.get(worker) || 0),
    rows.length,
  ]);
  const auditEndRow = aoa.length;
  aoa.push([]);

  const normalisationTitleRow = aoa.length;
  aoa.push([`${period} - NORMALISATION`]);
  merges.push({ s: { r: normalisationTitleRow, c: 0 }, e: { r: normalisationTitleRow, c: lastColumnIndex } });

  const actionCounts = new Map();
  rows.forEach((row) => {
    const worker = String(row?.fieldWorkerName || "").trim() || GMR_NOT_AVAILABLE;
    const label = zamoNormalisationLabel(row?.normalisation);
    if (!actionCounts.has(label)) {
      actionCounts.set(label, new Map(workers.map((item) => [item, 0])));
    }
    const counts = actionCounts.get(label);
    counts.set(worker, (counts.get(worker) || 0) + 1);
  });

  [...actionCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([action, counts], index) => {
      const values = workers.map((worker) => counts.get(worker) || 0);
      aoa.push([index + 1, action, ...values, values.reduce((sum, value) => sum + value, 0)]);
    });

  const workerNormalisationTotals = workers.map((worker) => workerCounts.get(worker) || 0);
  aoa.push([
    "",
    "TOTAL: NORMALISATION",
    ...workerNormalisationTotals,
    rows.length,
  ]);

  aoa.push([]);
  aoa.push([]);
  aoa.push(["Teams", "METER STATUS", ...teams, "TOTAL"]);
  statuses.forEach((finding, index) => {
    const counts = teamFindingCounts.get(finding) || new Map();
    const values = teams.map((team) => counts.get(team) || 0);
    aoa.push([index + 1, finding, ...values, values.reduce((sum, value) => sum + value, 0)]);
  });
  aoa.push([
    "",
    "TOTAL: METER DISCOVERY RECORDS",
    ...teams.map((team) => teamCounts.get(team) || 0),
    rows.length,
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!merges"] = merges;
  worksheet["!cols"] = [
    { wch: 8 },
    { wch: 42 },
    ...Array.from({ length: maxGroupColumns }, () => ({ wch: 18 })),
    { wch: 12 },
  ];
  worksheet["!freeze"] = { xSplit: 2, ySplit: 2, topLeftCell: "C3", activePane: "bottomRight", state: "frozen" };
  worksheet["!autofilter"] = { ref: `A2:${lastColumnLetter}${Math.max(2, auditEndRow)}` };

  return worksheet;
}

function buildExceptionsSheet(exceptions = []) {
  const columns = [
    column("meterKey", "Meter Key", "text", "GMR", ""),
    column("fieldFoundMeterNo", "Field-Found Meter Number", "text", "GMR", ""),
    column("registryVisibility", "Registry Visibility", "text", "Meter Registry", ""),
    column("exceptionType", "Exception Type", "text", "GMR", ""),
    column("sourceJoin", "Source / Join", "text", "GMR", ""),
    column("severity", "Severity", "text", "GMR", ""),
    column("details", "Details", "text", "GMR", ""),
    column("resolutionStatus", "Resolution Status", "text", "GMR", ""),
    column("resolutionNotes", "Resolution Notes", "text", "GMR", ""),
  ];
  const aoa = [columns.map((item) => item.header), ...exceptions.map((row) =>
    columns.map((item) => normalizeCell(getPath(row, item.key), item.type)),
  )];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  worksheet["!autofilter"] = { ref: `A1:I${Math.max(1, aoa.length)}` };
  setColumnWidths(worksheet, columns);
  return worksheet;
}

function buildDictionarySheet(masterColumns, interventionColumns, dataset) {
  const headers = [
    "Dataset",
    "Section",
    "Column #",
    "Excel Column",
    "Field Name",
    "Data Type",
    "Source Domain",
    "Missing Value Rule",
    "Purpose / Definition",
  ];
  const rows = [
    [
      "GMR Reporting Period",
      "Reporting Month",
      1,
      "N/A",
      "Reporting Month",
      "period",
      "GMR request",
      "Required before generation.",
      `Selected reporting period: ${dataset?.reportingPeriodLabel || dataset?.reportMonth || GMR_NOT_AVAILABLE}. Field Data and Field Stats contain registry-linked Meter Discovery submissions whose server metadata.createdAt falls in this Johannesburg calendar month.`,
    ],
    [
      "GMR Reporting Period",
      "Interventions",
      2,
      "N/A",
      "Monthly Intervention Date",
      "date",
      "METER_DISCONNECTION / METER_RECONNECTION workflow",
      "Completed lifecycle TRNs without a valid workflow.completedAt are not allocated to a reporting month and are surfaced as reconciliation exceptions.",
      "Intervention & Recovery Detail contains completed Meter Disconnection and Meter Reconnection work whose workflow.completedAt falls in the selected Johannesburg reporting month. Office issue/update timestamps do not allocate work to a month.",
    ],
    [
      "GMR Reporting Period",
      "Supporting Context",
      3,
      "N/A",
      "Full Meter / Sales Context",
      "rule",
      "Meter Registry / Premises / Sales",
      "Existing source missing-value rules remain unchanged.",
      "The full current meter population and all available Sales/purchase history remain supporting context. The selected reporting month filters TRN-driven activity, not the meter population or purchase-history horizon.",
    ],
    [
      "GMR Reporting Period",
      "Submission Semantics",
      4,
      "N/A",
      "Meter Discovery Submission Date",
      "date",
      "METER_DISCOVERY metadata.createdAt",
      "Discovery records without a valid metadata.createdAt cannot be allocated to a reporting month.",
      "For this GMR version, Meter Discovery belongs to the month in which the submitted transaction was created on the server. Offline field capture completed earlier but submitted later belongs to the server-submission month.",
    ],
  ];

  masterColumns.forEach((item, index) => {
    rows.push([
      "GMR Master Meter",
      item.section,
      index + 1,
      XLSX.utils.encode_col(index),
      item.header,
      item.type,
      item.source,
      "Not Available when authoritative data is absent. Numeric zero is retained only when confirmed by the source.",
      item.definition,
    ]);
  });

  interventionColumns.forEach((item, index) => {
    rows.push([
      "Intervention & Recovery Detail",
      "Event Detail",
      index + 1,
      XLSX.utils.encode_col(index),
      item.header,
      item.type,
      item.source,
      "Not Available when the connected intervention/recovery source does not provide the value.",
      item.definition,
    ]);
  });

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!autofilter"] = { ref: `A1:I${rows.length + 1}` };
  worksheet["!cols"] = [
    { wch: 28 }, { wch: 42 }, { wch: 12 }, { wch: 12 }, { wch: 40 },
    { wch: 18 }, { wch: 38 }, { wch: 54 }, { wch: 72 },
  ];
  return worksheet;
}

export function buildGmrExcelArtifact({ dataset, fileName }) {
  if (!dataset || typeof dataset !== "object") {
    throw new TypeError("A canonical GMR dataset is required.");
  }
  if (!Array.isArray(dataset.rows) || dataset.rows.length === 0) {
    throw new RangeError("GMR Excel generation requires at least one meter row.");
  }
  if (!Array.isArray(dataset.fieldRows)) {
    throw new TypeError("GMR dataset fieldRows are required.");
  }
  if (!Array.isArray(dataset.monthKeys)) {
    throw new TypeError("GMR dataset monthKeys are required.");
  }
  if (typeof fileName !== "string" || !fileName.endsWith(".xlsx")) {
    throw new TypeError("GMR Excel fileName must end with .xlsx.");
  }

  const workbook = XLSX.utils.book_new();
  const masterColumns = getGmrMasterColumnDefinitions(dataset.monthKeys);
  const intervention = buildInterventionSheet(dataset.interventionEvents || []);
  const fieldRows = dataset.fieldRows;

  XLSX.utils.book_append_sheet(workbook, buildDashboardSheet(dataset), sheetName("GMR Dashboard"));
  XLSX.utils.book_append_sheet(workbook, buildMasterSheet(dataset.rows, dataset.monthKeys), sheetName("GMR Master Meter"));
  XLSX.utils.book_append_sheet(
    workbook,
    buildAnalysisSheet(dataset.rows, [
      { label: "Property Exists", key: "propertyExists" },
      { label: "Property Occupied / Active", key: "propertyOccupiedActive" },
      { label: "Property Accessible", key: "propertyAccessible" },
      { label: "Property Condition", key: "propertyCondition" },
      { label: "Ward", key: "ward" },
    ]),
    sheetName("Property Analysis"),
  );
  XLSX.utils.book_append_sheet(
    workbook,
    buildAnalysisSheet(dataset.rows, [
      { label: "Registry Visibility", key: "registryVisibility" },
      { label: "Meter Number Verified", key: "meterNumberVerified" },
      { label: "Meter Kind", key: "meterKind" },
      { label: "Meter Utility Type", key: "meterUtilityType" },
      { label: "Meter Connection Status", key: "meterConnectionStatus" },
      { label: "Primary Finding", key: "primaryFinding" },
      { label: "Finding Detail", key: "findingDetail" },
    ]),
    sheetName("Meter Verification"),
  );
  XLSX.utils.book_append_sheet(workbook, intervention.worksheet, sheetName("Intervention & Recovery Detail"));
  XLSX.utils.book_append_sheet(workbook, buildFinancialSheet(dataset.rows), sheetName("Financial Analysis"));
  const zamoReport = buildZamoReportSheet(fieldRows);
  XLSX.utils.book_append_sheet(workbook, zamoReport.worksheet, sheetName("Field Data"));
  XLSX.utils.book_append_sheet(
    workbook,
    buildZamoStatsSheet(fieldRows, dataset.reportMonth),
    sheetName("Field Stats"),
  );
  XLSX.utils.book_append_sheet(workbook, buildExceptionsSheet(dataset.exceptions || []), sheetName("Reconciliation Exceptions"));
  XLSX.utils.book_append_sheet(
    workbook,
    buildDictionarySheet(masterColumns, intervention.columns, dataset),
    sheetName("Data Dictionary"),
  );

  const bytes = toUint8Array(
    XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
      cellDates: true,
    }),
  );

  return {
    format: "XLSX",
    fileName,
    bytes,
  };
}
