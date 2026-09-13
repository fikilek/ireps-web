/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { useMemo, useState } from "react";
import TargetedBatchDraftFilters from "./TargetedBatchDraftFilters";
import { draftReviewStyles as styles, draftButtonStyle } from "./targetedBatchDraftReviewStyles";
const columns = [ { key: "meterNo", label: "Meter Number" }, { key: "address", label: "Address" }, { key: "coordinates", label: "GPS Coordinates" }, { key: "erfId", label: "ERF ID" } ];
export default function TargetedBatchDraftTable({ rows = [], onRemove, disabled = false, topActions, highlightedId, onHighlight }) {
  const [filters, setFilters] = useState({}), [sort, setSort] = useState({ key: "meterNo", direction: 1 });
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(5);
  const filtered = useMemo(() => rows.map(row => ({ ...row, coordinates: row.point ? `${row.point.latitude.toFixed(6)}, ${row.point.longitude.toFixed(6)}` : "" }))
    .filter(row => columns.every(({key}) => String((key === "erfId" ? row.erfNo : row[key]) || "").toLowerCase().includes((filters[key] || "").toLowerCase())))
    .sort((a,b) => String((sort.key === "erfId" ? a.erfNo : a[sort.key]) || "").localeCompare(String((sort.key === "erfId" ? b.erfNo : b[sort.key]) || ""), undefined, { numeric: true, sensitivity: "base" }) * sort.direction), [rows, filters, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), current = Math.min(page, pages);
  const start = (current - 1) * pageSize, shown = filtered.slice(start, start + pageSize);
  const controls = top => <div style={styles.paginationBar}>
    {top && topActions}
    <span>Showing {filtered.length ? start + 1 : 0}–{Math.min(start + pageSize, filtered.length)} of {filtered.length} rows</span>
    <div style={styles.paginationControls}>
      <button type="button" style={draftButtonStyle()} onClick={() => { setFilters({}); setPage(1); }}>Clear All Filters</button>
      <label>Rows per page <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{[5,10,25,50,100].map(size => <option key={size}>{size}</option>)}</select></label>
      <button type="button" style={draftButtonStyle(current === 1)} disabled={current === 1} onClick={() => setPage(1)}>First</button>
      <button type="button" style={draftButtonStyle(current === 1)} disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button>
      <span>Page {current} of {pages}</span>
      <button type="button" style={draftButtonStyle(current === pages)} disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button>
      <button type="button" style={draftButtonStyle(current === pages)} disabled={current === pages} onClick={() => setPage(pages)}>Last</button>
    </div>
  </div>;
  return <div style={styles.pane}>{controls(true)}<div style={styles.tableWrap}>
    <table style={styles.draftTable}><thead><tr>{columns.map(column => <th key={column.key} scope="col" style={styles.headerCell} aria-sort={sort.key === column.key ? sort.direction === 1 ? "ascending" : "descending" : "none"}>
      <button type="button" style={draftButtonStyle()} onClick={() => setSort({ key: column.key, direction: sort.key === column.key ? -sort.direction : 1 })}>{column.label} {sort.key === column.key ? sort.direction === 1 ? "↑" : "↓" : "↕"}</button>
    </th>)}</tr><TargetedBatchDraftFilters columns={columns} filters={filters} onChange={(key,value) => { setFilters(current => ({...current,[key]:value})); setPage(1); }}/></thead>
    <tbody>{shown.map(row => <tr key={row.salesId} data-sales-id={row.salesId} onMouseEnter={() => onHighlight?.(row.salesId)} onMouseLeave={() => onHighlight?.(null)} style={{ background: highlightedId === row.salesId ? "#dbeafe" : undefined, outline: highlightedId === row.salesId ? "2px solid #2563eb" : undefined }}>
      <td style={styles.bodyCell}><strong>{row.meterNo}</strong><br/><button type="button" style={draftButtonStyle(disabled)} disabled={disabled} onClick={() => onRemove(row.salesId)} aria-label={`Remove meter ${row.meterNo}`}>Remove</button>
        {!row.ready && <span style={styles.inlineReason}>{row.reason}</span>}</td>
      <td style={styles.bodyCell}>{row.address || "Unavailable"}{row.scope && <small style={styles.inlineReason}>{row.scope.wardName} · {row.scope.wardPcode}</small>}</td>
      <td style={styles.bodyCell}>{row.coordinates || "Unavailable"}{row.pointSource === "GEOCODED" && <small style={styles.inlineReason}>Position from address</small>}</td>
      <td style={styles.bodyCell} title={row.erfId || ""}>{row.erfNo || "Unavailable"}</td>
    </tr>)}{!shown.length && <tr><td colSpan={4} style={styles.noRowsCell}>No retained meters match these filters.</td></tr>}</tbody></table>
  </div>{controls(false)}</div>;
}
