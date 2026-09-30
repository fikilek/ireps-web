/* eslint-disable no-unused-vars -- JSX tags are consumed by React. */
/* eslint-disable react-refresh/only-export-components -- Standalone development entry mounts its own root. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import TargetedBatchRowsView from "../src/pages/operations/targeted-batches/rows/TargetedBatchRowsView";
import { buildTargetedBatchRows } from "../src/pages/operations/targeted-batches/rows/targetedBatchRowsModel.js";
import { takeOutBlockedReason } from "../src/pages/operations/targeted-batches/rows/takeOutOfBatchModel.js";

const batch = {
  id: "TB_DEV_PREVIEW", createdAt: "2026-09-25T01:41:00+02:00",
  source: { type: "PREPAID_SALES", label: "GPS Sales" }, scope: { lmPcode: "ZA5241", lmName: "Endumeni" },
  selection: { reason: "Selected from GPS Sales Table · batch for geofence Gf W2 Umngeni1" },
  validation: { status: "PASSED" }, creation: { state: "READY" },
  rows: Array.from({ length: 14 }, (_, i) => ({
    rowNo: i + 1, tbRowId: `TB_DEV_ROW_${i + 1}`, meterNo: `0412001${String(i + 1).padStart(4, "0")}`,
    salesAllMeterId: `0412001${String(i + 1).padStart(4, "0")}`, accountNumber: `000${i + 101}`,
    customerName: ["M. Dlamini", "S. Naidoo", "T. Mokoena", "L. Nkosi", "P. Jacobs"][i % 5],
    addressLine1: `${i + 1} Palm Square`, town: i % 2 ? "Glencoe" : "Dundee", sgCode: "NAv",
    astMatchStatus: i % 3 === 2 ? "MATCHED" : "NOT_MATCHED", proposedTrnType: "METER_DISCOVERY",
    allocationStatus: "ALLOCATED", allocationTargetType: "TEAM", allocationTargetId: "TEAM_DEV",
    allocationTargetName: "Preview Team", fieldAcceptanceStatus: "ACCEPTED",
    completionStatus: ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"][i % 3],
    totalSalesC: i === 0 ? 0 : i === 1 ? null : (i + 1) * 12500,
  })),
};
const rows = buildTargetedBatchRows(batch);

function Preview() {
  const [keys, setKeys] = useState([]);
  return <main style={{ padding: 24, minWidth: 0 }}>
    <p style={{ color: "#1d4ed8", fontSize: 12, fontWeight: 800 }}>iREPS · DEVELOPMENT REVIEW</p>
    <h1 style={{ color: "#0f172a" }}>TB Rows</h1>
    <p style={{ color: "#475569", fontSize: 13 }}>Sample data. Changes to filters and selections are local to this preview.</p>
    <TargetedBatchRowsView batch={batch} rows={rows}
      takeOut={{ selectedKeys: keys, onToggle: key => setKeys(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]),
        blockedReason: row => takeOutBlockedReason(row, { rowCount: rows.length }) }}
      toolbar={keys.length ? <span>{keys.length} selected</span> : null} />
  </main>;
}

if (import.meta.env.DEV) createRoot(document.getElementById("root")).render(<Preview />);
