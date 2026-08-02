/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import styles from "./targetedBatchAllocationStyles";
import { Badge } from "./TargetedBatchAllocationPrimitives";
import {
  asArray,
  getTargetLabel,
  getTargetOptionMicroText,
  getTargetOptionSubtitle,
  getUserDisplayName,
  getUserRoleLabel,
} from "./targetedBatchAllocationUtils";

function SelectedTargetMembers({ target, maxItems = 6 }) {
  const members = asArray(target?.members);

  if (members.length === 0) {
    return (
      <div style={styles.memberEmpty}>
        No members were resolved for this target. The allocation still remains
        at TEAM/SP level.
      </div>
    );
  }

  const visibleMembers = members.slice(0, maxItems);
  const hiddenCount = Math.max(members.length - visibleMembers.length, 0);

  return (
    <div style={styles.memberList}>
      {visibleMembers.map((member) => (
        <span
          key={member.id || member.uid || getUserDisplayName(member)}
          style={{
            ...styles.memberChip,
            ...(member.missing ? styles.memberChipWarning : null),
          }}
          title={getUserRoleLabel(member)}
        >
          <strong>{getUserDisplayName(member)}</strong>
          <small>{getUserRoleLabel(member)}</small>
        </span>
      ))}

      {hiddenCount > 0 ? (
        <span style={styles.memberMore}>+{hiddenCount} more</span>
      ) : null}
    </div>
  );
}

export default function TargetedBatchAllocationTargetPanel({
  targetType,
  targetId,
  targetOptions,
  selectedTarget,
  onTargetTypeChange,
  onSelectTarget,
}) {
  return (
    <section style={{ ...styles.panel, ...styles.stepPanel }}>
      <div style={styles.stepHeader}>
        <span style={styles.stepNumber}>1</span>
        <div>
          <h3 style={styles.panelTitle}>Choose who receives the sales rows</h3>
          <p style={styles.panelSubtitle}>
            Select a TEAM or Service Provider. The members are shown only for
            context. You are not allocating directly to an individual FWR.
          </p>
        </div>
        <Badge tone={targetOptions.length > 0 ? "success" : "warning"}>
          {targetOptions.length} available {targetType}(s)
        </Badge>
      </div>

      <div style={styles.targetChoiceGrid}>
        <div style={styles.targetChoiceColumn}>
          <span style={styles.fieldLabel}>Allocation target type</span>
          <div style={styles.targetToggleRow}>
            <button
              type="button"
              style={{
                ...styles.targetToggleButton,
                ...(targetType === "TEAM" ? styles.targetToggleActive : null),
              }}
              onClick={() => onTargetTypeChange("TEAM")}
            >
              TEAM
            </button>

            <button
              type="button"
              style={{
                ...styles.targetToggleButton,
                ...(targetType === "SP" ? styles.targetToggleActive : null),
              }}
              onClick={() => onTargetTypeChange("SP")}
            >
              Service Provider
            </button>
          </div>
        </div>

        <label style={styles.targetChoiceColumn}>
          <span style={styles.fieldLabel}>
            Select {targetType === "TEAM" ? "TEAM" : "Service Provider"}
          </span>
          <select
            style={styles.targetSelect}
            value={targetId}
            onChange={(event) => {
              const selected = targetOptions.find(
                (target) => target.id === event.target.value,
              );
              onSelectTarget(selected || null);
            }}
          >
            <option value="">
              {targetOptions.length === 0
                ? `No active ${targetType === "TEAM" ? "TEAMs" : "Service Providers"} available`
                : `Choose ${targetType === "TEAM" ? "a TEAM" : "a Service Provider"}`}
            </option>
            {targetOptions.map((target) => (
              <option key={`${target.type}_${target.id}`} value={target.id}>
                {target.name} ({target.memberCount || 0} member(s))
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedTarget ? (
        <div style={styles.selectedTargetCard}>
          <div style={styles.selectedTargetHeader}>
            <div>
              <span style={styles.fieldLabel}>Selected target</span>
              <strong style={styles.selectedTargetName}>
                {getTargetLabel(selectedTarget)}
              </strong>
              <p style={styles.targetSub}>
                {getTargetOptionSubtitle(selectedTarget)}
              </p>
            </div>
            <Badge tone="success">READY FOR ROW SELECTION</Badge>
          </div>
          <SelectedTargetMembers target={selectedTarget} />
          <span style={styles.targetMicro}>
            {getTargetOptionMicroText(selectedTarget)}
          </span>
        </div>
      ) : (
        <div style={styles.targetInstruction}>
          Choose a TEAM or Service Provider above. After that, continue to Step
          2 and select the sales rows to assign.
        </div>
      )}
    </section>
  );
}
