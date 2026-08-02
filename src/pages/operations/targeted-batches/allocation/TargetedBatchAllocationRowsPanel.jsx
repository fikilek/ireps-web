/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import styles from "./targetedBatchAllocationStyles";
import { Badge, Td, Th } from "./TargetedBatchAllocationPrimitives";
import {
  canAllocateRow,
  getAstMatchStatus,
  getProposedTrnType,
  getTargetLabel,
  getTbRowId,
  hasCreatedTrn,
  isBackendAllocation,
} from "./targetedBatchAllocationUtils";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const QUICK_FILTERS = [
  { key: "ALL", label: "All Sales Rows" },
  { key: "UNALLOCATED", label: "Not Allocated" },
  { key: "ALLOCATED", label: "Allocated" },
  { key: "METER_DISCOVERY", label: "Meter Discovery" },
  { key: "METER_INSPECTION", label: "Meter Inspection" },
  { key: "PENDING_ASSESSMENT", label: "Pending Assessment" },
];

export default function TargetedBatchAllocationRowsPanel({
  sourceType,
  allocationRows,
  filteredRows,
  pagedRows,
  pageBounds,
  activeFilter,
  rowSearch,
  pageSize,
  selectedRowSet,
  selectedRows,
  selectedTargetPayload,
  allocationsByRowId,
  statusMessage,
  onSelectQuickFilter,
  onRowSearchChange,
  onPageSizeChange,
  onToggleAllVisibleRows,
  onToggleRow,
  onClearSelectedAllocations,
  onAssignSelectedRows,
  onFirstPage,
  onPreviousPage,
  onNextPage,
  onLastPage,
}) {
  const selectablePagedRows = pagedRows.filter((row) =>
    canAllocateRow(row, sourceType),
  );
  const allVisibleSelected =
    selectablePagedRows.length > 0 &&
    selectablePagedRows.every((row) => selectedRowSet.has(row._rowKey));

  return (
    <section style={{ ...styles.panel, ...styles.stepPanel }}>
      <div style={styles.stepHeader}>
        <span style={styles.stepNumber}>2</span>
        <div>
          <h3 style={styles.panelTitle}>Select sales rows and assign them</h3>
          <p style={styles.panelSubtitle}>
            These are the meters selected from Prepaid Sales. Tick the exact
            rows that must go to the TEAM or Service Provider selected in Step
            1.
          </p>
        </div>
        <Badge tone={allocationRows.length > 0 ? "success" : "neutral"}>
          {allocationRows.length} sales row(s)
        </Badge>
      </div>

      <div style={styles.assignmentBar}>
        <div style={styles.assignmentBarSummary}>
          <span style={styles.fieldLabel}>Selected target</span>
          <strong style={styles.assignmentTargetText}>
            {selectedTargetPayload
              ? getTargetLabel(selectedTargetPayload)
              : "No TEAM or Service Provider selected"}
          </strong>
          <span style={styles.assignmentRowCount}>
            {selectedRows.length} row(s) selected
          </span>
        </div>

        <div style={styles.assignmentActions}>
          <button
            type="button"
            style={{
              ...styles.secondaryButton,
              ...(selectedRows.length === 0 ? styles.disabledButton : null),
            }}
            onClick={onClearSelectedAllocations}
            disabled={selectedRows.length === 0}
          >
            Clear Selected Allocation
          </button>
          <button
            type="button"
            style={{
              ...styles.primaryButton,
              ...(!selectedTargetPayload || selectedRows.length === 0
                ? styles.disabledButton
                : null),
            }}
            onClick={onAssignSelectedRows}
            disabled={!selectedTargetPayload || selectedRows.length === 0}
          >
            Assign Selected Rows
          </button>
        </div>
      </div>

      {!selectedTargetPayload ? (
        <div style={styles.actionWarning}>
          Complete Step 1 first: choose a TEAM or Service Provider before
          assigning rows.
        </div>
      ) : null}

      {statusMessage ? (
        <div style={styles.statusMessage}>{statusMessage}</div>
      ) : null}

      <div style={styles.filterRow}>
        {QUICK_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            style={{
              ...styles.filterButton,
              ...(activeFilter === filter.key ? styles.filterButtonActive : null),
            }}
            onClick={() => onSelectQuickFilter(filter.key)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div style={styles.rowSearchBar}>
        <label style={styles.searchLabel}>
          Search selected sales meters
          <input
            style={styles.searchInput}
            value={rowSearch}
            onChange={(event) => onRowSearchChange(event.target.value)}
            placeholder="Meter, sales-all-meters ID, account, customer or town"
          />
        </label>

        <label style={styles.pageSizeLabel}>
          Rows per page
          <select
            style={styles.select}
            value={pageSize}
            onChange={(event) => onPageSizeChange(event.target.value)}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filteredRows.length === 0 ? (
        <div style={styles.emptyState}>No sales rows match this filter.</div>
      ) : (
        <>
          <div style={styles.tableWrap}>
            <table style={{ ...styles.table, minWidth: 1420 }}>
              <thead>
                <tr>
                  <Th>
                    <input
                      type="checkbox"
                      aria-label="Select all visible allocatable sales rows"
                      checked={allVisibleSelected}
                      onChange={onToggleAllVisibleRows}
                    />
                  </Th>
                  <Th>TB Row Link</Th>
                  <Th>Sales Row</Th>
                  <Th>Meter No</Th>
                  <Th>Account / Customer</Th>
                  <Th>Address</Th>
                  <Th>Town</Th>
                  <Th>AST Match</Th>
                  <Th>Proposed TRN</Th>
                  <Th>Current Allocation</Th>
                  <Th>Allocation Lock</Th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row, index) => {
                  const allocation =
                    allocationsByRowId[row._rowKey] || row._backendAllocation;
                  const proposedTrn = getProposedTrnType(row);
                  const astStatus = getAstMatchStatus(row);
                  const tbRowId = getTbRowId(row);
                  const backendLocked = isBackendAllocation(row);
                  const trnCreated = hasCreatedTrn(row);
                  const selectable = canAllocateRow(row, sourceType);

                  return (
                    <tr key={row._rowKey}>
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Select sales row ${row.rowNo || index + 1}`}
                          checked={selectedRowSet.has(row._rowKey)}
                          onChange={() => onToggleRow(row._rowKey)}
                          disabled={!selectable}
                        />
                      </Td>
                      <Td strong>
                        {tbRowId || "PENDING_BACKEND"}
                        {!tbRowId ? (
                          <div style={styles.rowSourceIdentity}>
                            {row.salesAllMeterId ||
                              row.sourceSalesAllMeterId ||
                              row._rowKey}
                          </div>
                        ) : null}
                      </Td>
                      <Td strong>{row.rowNo || index + 1}</Td>
                      <Td strong>{row.meterNo || "NAv"}</Td>
                      <Td>
                        {[row.accountNumber || row.accountNo, row.customerName]
                          .filter(Boolean)
                          .join(" · ") || "NAv"}
                      </Td>
                      <Td>{row.addressLine1 || row.premiseAddress || "NAv"}</Td>
                      <Td>{row.town || "NAv"}</Td>
                      <Td>
                        <Badge
                          tone={
                            astStatus === "MATCHED"
                              ? "success"
                              : astStatus === "NOT_MATCHED"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {astStatus}
                        </Badge>
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            proposedTrn === "METER_DISCOVERY"
                              ? "info"
                              : proposedTrn === "METER_INSPECTION"
                                ? "success"
                                : "neutral"
                          }
                        >
                          {proposedTrn}
                        </Badge>
                      </Td>
                      <Td>
                        {allocation ? (
                          <div style={styles.allocationCell}>
                            <Badge
                              tone={
                                allocation.source === "BACKEND"
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {allocation.source === "BACKEND"
                                ? "ALLOCATED"
                                : "FRONTEND_PLAN"}
                            </Badge>
                            <span
                              style={{
                                ...styles.allocationTargetPill,
                                ...(allocation.type === "TEAM"
                                  ? styles.allocationTargetPillTeam
                                  : styles.allocationTargetPillSp),
                              }}
                            >
                              {getTargetLabel(allocation)}
                            </span>
                          </div>
                        ) : (
                          <Badge tone="warning">NOT_ALLOCATED</Badge>
                        )}
                      </Td>
                      <Td>
                        <Badge
                          tone={backendLocked || trnCreated ? "danger" : "neutral"}
                        >
                          {trnCreated
                            ? "TRN_CREATED"
                            : backendLocked
                              ? "BACKEND_LOCKED"
                              : "EDITABLE"}
                        </Badge>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={styles.paginationBar}>
            <span>
              Showing {pageBounds.displayStart}–{pageBounds.displayEnd} of{" "}
              {filteredRows.length} sales rows
            </span>
            <div style={styles.paginationControls}>
              <button
                type="button"
                style={styles.paginationButton}
                onClick={onFirstPage}
                disabled={pageBounds.safePageIndex === 0}
              >
                First
              </button>
              <button
                type="button"
                style={styles.paginationButton}
                onClick={onPreviousPage}
                disabled={pageBounds.safePageIndex === 0}
              >
                Previous
              </button>
              <strong>
                Page {pageBounds.safePageIndex + 1} of {pageBounds.pageCount}
              </strong>
              <button
                type="button"
                style={styles.paginationButton}
                onClick={onNextPage}
                disabled={pageBounds.safePageIndex >= pageBounds.pageCount - 1}
              >
                Next
              </button>
              <button
                type="button"
                style={styles.paginationButton}
                onClick={onLastPage}
                disabled={pageBounds.safePageIndex >= pageBounds.pageCount - 1}
              >
                Last
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
