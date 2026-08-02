/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import styles from "./targetedBatchAllocationStyles";
import { Badge, CodeText, Td, Th } from "./TargetedBatchAllocationPrimitives";
import { getTargetLabel } from "./targetedBatchAllocationUtils";

function RowReferenceList({ references = [] }) {
  if (references.length === 0) return "NAv";

  return (
    <div style={styles.rowReferenceList}>
      {references.map((reference) => (
        <div key={reference.rowKey} style={styles.rowReferenceItem}>
          <CodeText>{reference.label}</CodeText>
          <span>
            Row {reference.rowNo} · Meter {reference.meterNo}
          </span>
          {!reference.tbRowId ? (
            <small>Source identity: {reference.sourceId || reference.rowKey}</small>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function TargetedBatchAllocationReview({
  rows,
  acceptedRowCount,
  allocatedRowCount,
  unallocatedRowCount,
}) {
  return (
    <>
      <section style={styles.panel}>
        <div style={styles.panelHeader}>
          <div>
            <h3 style={styles.panelTitle}>Allocation Review</h3>
            <p style={styles.panelSubtitle}>
              Review the TEAM/SP allocation plan created from the selected Prepaid Sales rows before backend persistence is introduced.
            </p>
          </div>

          <Badge tone={rows.length > 0 ? "success" : "neutral"}>
            {rows.length} target group(s)
          </Badge>
        </div>

        {rows.length === 0 ? (
          <div style={styles.emptyState}>
            No sales allocation groups are available yet. Complete Steps 1 and 2 above.
          </div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={{ ...styles.table, minWidth: 1120 }}>
              <thead>
                <tr>
                  <Th>Target</Th>
                  <Th>Rows</Th>
                  <Th>MD</Th>
                  <Th>Inspection</Th>
                  <Th>Pending Assessment</Th>
                  <Th>Exact TB Row Links</Th>
                  <Th>Pending Backend IDs</Th>
                  <Th>Status</Th>
                  <Th>Candidate Row References</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <Td strong>{getTargetLabel(row.target)}</Td>
                    <Td>{row.totalRows}</Td>
                    <Td>{row.discoveryRows}</Td>
                    <Td>{row.inspectionRows}</Td>
                    <Td>{row.pendingAssessmentRows}</Td>
                    <Td>{row.exactTbRowLinks}</Td>
                    <Td>{row.pendingBackendRowLinks}</Td>
                    <Td>
                      <Badge
                        tone={
                          row.status === "READY_FOR_BACKEND"
                            ? "success"
                            : "warning"
                        }
                      >
                        {row.status}
                      </Badge>
                    </Td>
                    <Td>
                      <RowReferenceList references={row.rowReferences} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={styles.createPanel}>
        <div>
          <h3 style={styles.panelTitle}>Backend Allocation Persistence</h3>
          <p style={styles.panelSubtitle}>
            Package 5 keeps this Prepaid Sales allocation plan in the current Redux session.
            No Firestore document, TB Row update, child TRN, premise, meter or
            AST is created here.
          </p>
          <div style={styles.createMetrics}>
            <span>{acceptedRowCount} accepted row(s)</span>
            <span>{allocatedRowCount} allocated row(s)</span>
            <span>{unallocatedRowCount} waiting row(s)</span>
          </div>
        </div>

        <button
          type="button"
          style={{ ...styles.createButton, ...styles.disabledButton }}
          disabled
          title="Backend Targeted Batch allocation persistence is not connected yet."
        >
          Persist Allocation Plan (BACKEND PACKAGE)
        </button>
      </section>
    </>
  );
}
