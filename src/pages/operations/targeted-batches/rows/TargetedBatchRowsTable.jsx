/* eslint-disable no-unused-vars -- JSX tags are consumed by React. */
import { useMemo } from "react";
import IrepsTable from "../../../../components/table/IrepsTable";
import { formatCurrencyFromCents } from "../targetedBatchUtils";
import { tbRowsStyles as styles } from "./targetedBatchRowsStyles";
import { rowOutcomeText } from "./targetedBatchRowsModel";
import { TB_ROW_COLUMNS, TB_ROW_COLUMN_GROUPS, TB_ROW_DOWNLOAD_COLUMNS, targetedBatchRowSearchValue } from "./targetedBatchRowsColumns.js";

const DEFAULT_SORT = { key: "rowNo", direction: "asc" };
const BADGE_COLUMNS = new Set(["outcome", "astMatchStatus", "allocationStatus", "fieldAcceptanceStatus", "premiseStatus", "meterDiscoveryStatus", "workStatus"]);

function StatusBadge({ value }) {
  const normalized = String(value || "").toUpperCase().replaceAll(" ", "_");
  const tone = ["ACCEPT", "ACCEPTED", "COMPLETED", "PASSED", "ALLOCATED", "CREATED", "LINKED"].includes(normalized)
    ? styles.statusSuccess
    : ["REJECT", "REJECTED", "FAILED", "CANCELLED", "INTEGRITY_ERROR"].includes(normalized)
      ? styles.statusError
      : ["NOT_APPLICABLE", "NOT_STARTED", "N/A"].includes(normalized)
        ? styles.statusNeutral : styles.statusPending;
  return <span style={{ ...styles.statusBadge, ...tone }}>{value || "NAv"}</span>;
}

export default function TargetedBatchRowsTable({ rows, batch, filters, onFiltersChange, takeOut = null, toolbar = null }) {
  const columns = useMemo(() => [
    ...(takeOut ? [{
      key: "takeOut", label: "Take out", group: "identity", filter: null, export: false,
      render: row => <input type="checkbox"
        checked={takeOut.selectedKeys.includes(row.rowKey)}
        disabled={Boolean(takeOut.blockedReason(row)) || takeOut.busy}
        onChange={() => takeOut.onToggle(row.rowKey)}
        aria-label={`Take meter ${row.meterNo || row.rowNo} out of the batch`}
        title={takeOut.blockedReason(row) || "Take this meter out of the batch"} />,
    }] : []),
    ...TB_ROW_COLUMNS.map(column => ({ ...column, render: row => {
      if (column.key === "meterNo") return <div style={styles.strongCell}>
        {row.meterNo || "NAv"}
        {row.foundMeterNo ? <div style={styles.referenceLine}>Found {row.foundMeterNo}</div> : null}
      </div>;
      if (column.key === "workStatus") return <>
        <StatusBadge value={column.value(row)} />
        {rowOutcomeText(row) ? <div style={styles.referenceLine}>{rowOutcomeText(row)}</div> : null}
      </>;
      if (BADGE_COLUMNS.has(column.key)) return <StatusBadge value={column.value(row)} />;
      if (column.key === "totalSalesC") return row.totalSalesC == null ? "NAv" : formatCurrencyFromCents(row.totalSalesC);
      return column.value(row);
    } })),
  ], [takeOut]);

  return <IrepsTable
    title="TB Rows"
    columns={columns}
    groups={TB_ROW_COLUMN_GROUPS}
    rows={rows}
    rowKey={row => row.rowKey}
    defaultSort={DEFAULT_SORT}
    filters={filters}
    onFiltersChange={onFiltersChange}
    searchValue={targetedBatchRowSearchValue}
    toolbar={toolbar}
    downloads={{ registryName: "TB Rows", fileBaseName: `tb_rows_${batch.id}`, scope: batch.scope || {}, columns: TB_ROW_DOWNLOAD_COLUMNS }}
    emptyText={rows.length ? "No TB rows match the current filters." : "No permanent TB rows were found for this batch."}
  />;
}
