/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import styles from "./targetedBatchAllocationStyles";
import { Badge } from "./TargetedBatchAllocationPrimitives";
import { getTargetLabel } from "./targetedBatchAllocationUtils";

export default function TargetedBatchAllocationGroupPanel({
  groups,
  onClearTarget,
}) {
  return (
    <section style={{ ...styles.panel, ...styles.stepPanel }}>
      <div style={styles.stepHeader}>
        <span style={styles.stepNumber}>3</span>
        <div>
          <h3 style={styles.panelTitle}>Review the grouped allocation plan</h3>
          <p style={styles.panelSubtitle}>
            This section is the result of Steps 1 and 2. It groups the exact
            sales rows by the TEAM or Service Provider that will receive them.
          </p>
        </div>

        <Badge tone={groups.length > 0 ? "success" : "neutral"}>
          {groups.length} target group(s)
        </Badge>
      </div>

      {groups.length === 0 ? (
        <div style={styles.emptyState}>
          No allocation has been created yet. Choose a TEAM or Service Provider
          in Step 1, select sales rows in Step 2, and click Assign Selected Rows.
        </div>
      ) : (
        <div style={styles.groupList}>
          {groups.map((group) => (
            <article
              key={group.id}
              style={{ ...styles.groupCard, ...styles.groupCardAllocated }}
            >
              <div style={styles.groupHeaderRow}>
                <div>
                  <strong style={styles.groupName}>
                    {getTargetLabel(group.target)}
                  </strong>
                  <p style={styles.groupMeta}>
                    {group.totalRows} sales row(s) · {group.exactTbRowLinks}{" "}
                    exact TB Row link(s) · {group.pendingBackendRowLinks} pending
                    backend row ID(s)
                  </p>
                </div>

                <Badge
                  tone={
                    group.status === "READY_FOR_BACKEND" ? "success" : "warning"
                  }
                >
                  {group.status}
                </Badge>
              </div>

              <div style={styles.groupMetricRow}>
                <span>Meter Discovery: {group.discoveryRows}</span>
                <span>Meter Inspection: {group.inspectionRows}</span>
                <span>Pending Assessment: {group.pendingAssessmentRows}</span>
              </div>

              <div style={styles.groupActions}>
                <button
                  type="button"
                  style={styles.clearAssignmentButton}
                  onClick={() => onClearTarget(group)}
                >
                  Clear This Target Group
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
