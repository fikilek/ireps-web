import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export const EMPTY_DATETIME_FILTER = {
  mode: "ALL",
  startDate: "",
  endDate: "",
};

export function buildDatetimeFilter(mode) {
  return {
    mode,
    startDate: "",
    endDate: "",
  };
}

export function getDatetimeFilterLabel(filter = EMPTY_DATETIME_FILTER) {
  const mode = filter?.mode || "ALL";

  if (mode === "TODAY") return "Today";
  if (mode === "YESTERDAY") return "Yesterday";
  if (mode === "PAST_3_DAYS") return "Past 3 days";
  if (mode === "THIS_WEEK") return "This week";
  if (mode === "THIS_MONTH") return "This month";

  if (mode === "CUSTOM") {
    const startLabel = filter?.startDate || "Date 1";
    const endLabel = filter?.endDate || "Date 2";
    return `${startLabel} → ${endLabel}`;
  }

  return "All dates";
}

export function DatetimeFilterButton({ filter, onClick }) {
  return (
    <button
      type="button"
      style={styles.filterButton}
      onClick={onClick}
      title="Filter updatedAt"
    >
      {getDatetimeFilterLabel(filter)}
    </button>
  );
}

export function DatetimeFilterModal({
  filter = EMPTY_DATETIME_FILTER,
  onApply,
  onClear,
  onClose,
}) {
  const [customStartDate, setCustomStartDate] = useState(
    filter?.mode === "CUSTOM" ? filter?.startDate || "" : "",
  );
  const [customEndDate, setCustomEndDate] = useState(
    filter?.mode === "CUSTOM" ? filter?.endDate || "" : "",
  );

  const modalRoot = useMemo(() => {
    if (typeof document === "undefined") return null;
    return document.body;
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const applyPreset = (mode) => {
    onApply?.(buildDatetimeFilter(mode));
  };

  const applyCustom = () => {
    onApply?.({
      mode: "CUSTOM",
      startDate: customStartDate,
      endDate: customEndDate,
    });
  };

  if (!modalRoot) return null;

  return createPortal(
    <div
      style={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        style={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="datetime-filter-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Date / Time Filter</p>
            <h2 id="datetime-filter-title" style={styles.title}>
              Filter updatedAt
            </h2>
            <p style={styles.subtitle}>
              Choose the time period for rows to show.
            </p>
          </div>

          <button type="button" style={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={styles.body}>
          <div style={styles.presetGrid}>
            <button type="button" style={styles.presetButton} onClick={() => applyPreset("TODAY")}>
              Today
            </button>
            <button type="button" style={styles.presetButton} onClick={() => applyPreset("YESTERDAY")}>
              Yesterday
            </button>
            <button type="button" style={styles.presetButton} onClick={() => applyPreset("PAST_3_DAYS")}>
              Past 3 days
            </button>
            <button type="button" style={styles.presetButton} onClick={() => applyPreset("THIS_WEEK")}>
              This calendar week
            </button>
            <button type="button" style={styles.presetButton} onClick={() => applyPreset("THIS_MONTH")}>
              This calendar month
            </button>
          </div>

          <div style={styles.customBox}>
            <strong>Custom date range</strong>
            <div style={styles.customGrid}>
              <label style={styles.dateLabel}>
                Date 1
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(event) => setCustomStartDate(event.target.value)}
                  style={styles.dateInput}
                />
              </label>

              <label style={styles.dateLabel}>
                Date 2
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(event) => setCustomEndDate(event.target.value)}
                  style={styles.dateInput}
                />
              </label>
            </div>

            <button type="button" style={styles.applyButton} onClick={applyCustom}>
              Apply custom
            </button>
          </div>
        </div>

        <div style={styles.footer}>
          <button type="button" style={styles.clearButton} onClick={onClear}>
            Clear filter
          </button>
          <button type="button" style={styles.doneButton} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>,
    modalRoot,
  );
}

const styles = {
  filterButton: {
    width: "100%",
    marginTop: "0.4rem",
    border: "1px solid #2563eb",
    borderRadius: "0.45rem",
    padding: "0.38rem 0.45rem",
    fontSize: "0.72rem",
    fontWeight: 800,
    color: "#1d4ed8",
    background: "#eff6ff",
    cursor: "pointer",
    textAlign: "left",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 10000,
    minHeight: "100vh",
    width: "100vw",
    background: "rgba(15, 23, 42, 0.48)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
  },
  card: {
    width: "min(94vw, 34rem)",
    maxHeight: "90vh",
    overflowY: "auto",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 25px 80px rgba(15, 23, 42, 0.32)",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "1rem",
    padding: "1rem 1.1rem",
    borderBottom: "1px solid #e2e8f0",
  },
  eyebrow: {
    margin: 0,
    fontSize: "0.72rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#2563eb",
  },
  title: {
    margin: "0.2rem 0 0",
    fontSize: "1.1rem",
    color: "#0f172a",
  },
  subtitle: {
    margin: "0.25rem 0 0",
    color: "#64748b",
    fontSize: "0.88rem",
  },
  closeButton: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    borderRadius: "999px",
    width: "2rem",
    height: "2rem",
    cursor: "pointer",
    fontWeight: 900,
  },
  body: {
    padding: "1rem 1.1rem",
  },
  presetGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))",
    gap: "0.6rem",
  },
  presetButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.75rem",
    background: "#f8fafc",
    color: "#0f172a",
    padding: "0.7rem",
    fontWeight: 800,
    cursor: "pointer",
    textAlign: "left",
  },
  customBox: {
    marginTop: "1rem",
    border: "1px solid #e2e8f0",
    borderRadius: "0.85rem",
    padding: "0.9rem",
    background: "#ffffff",
  },
  customGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))",
    gap: "0.75rem",
    marginTop: "0.75rem",
  },
  dateLabel: {
    display: "grid",
    gap: "0.35rem",
    color: "#334155",
    fontWeight: 800,
    fontSize: "0.82rem",
  },
  dateInput: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.6rem",
    padding: "0.55rem",
    fontSize: "0.9rem",
  },
  applyButton: {
    marginTop: "0.75rem",
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#ffffff",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.8rem",
    fontWeight: 900,
    cursor: "pointer",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.6rem",
    padding: "0.9rem 1.1rem",
    borderTop: "1px solid #e2e8f0",
  },
  clearButton: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.8rem",
    fontWeight: 800,
    cursor: "pointer",
  },
  doneButton: {
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "#ffffff",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.8rem",
    fontWeight: 900,
    cursor: "pointer",
  },
};
