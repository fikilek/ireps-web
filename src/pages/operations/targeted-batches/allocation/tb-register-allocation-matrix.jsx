/* eslint-disable no-unused-vars -- JSX tags are used by React. */
// Targeted Batch rules TB-R045 (1.3.51): the Allocation Matrix on TB Register. Closed when TB Register
// opens, and nothing is read until it is opened, because the matrix reads every transaction of the
// municipality. Hiding it unmounts the table; its reads end within about a minute. The Show / Hide
// button is in TB Register's row of buttons (1.3.53); the matrix opens under the summary cards.
import { AllocationMatrixTeamSpTable } from "./allocation-matrix-table.jsx";
import { useAllocationMatrix } from "./use-allocation-matrix.js";

function OpenAllocationMatrix({ lmPcode }) {
  const matrix = useAllocationMatrix(lmPcode);
  return (
    <div style={styles.body}>
      {!matrix.actorMncServiceProviderId ? (
        <div style={styles.warningNotice}>
          The current user has no MNC Service Provider context. Current eligible
          allocation targets cannot be resolved.
        </div>
      ) : null}
      <div>
        <AllocationMatrixTeamSpTable matrix={matrix} />
      </div>
    </div>
  );
}

export default function TbRegisterAllocationMatrix({ lmPcode, open }) {
  if (!open || !lmPcode) return null;
  return (
    <section style={styles.panel} aria-label="Allocation Matrix">
      <h3 style={styles.title}>Allocation Matrix</h3>
      <p style={styles.subtitle}>
        How the meters are shared out between TEAMs and SPs, how far each is
        with them, and their work outside batches.
      </p>
      <OpenAllocationMatrix lmPcode={lmPcode} />
    </section>
  );
}

// As TB Register's own panels.
const styles = {
  panel: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
  },
  title: { margin: 0, fontSize: 18, color: "#0f172a" },
  subtitle: { margin: "6px 0 0", color: "#64748b", fontSize: 13 },
  // One column that may be narrower than the table, so the table scrolls inside the panel.
  body: { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12, marginTop: 14 },
  warningNotice: {
    border: "1px solid #fde68a",
    background: "#fffbeb",
    color: "#92400e",
    borderRadius: 14,
    padding: 14,
  },
};
