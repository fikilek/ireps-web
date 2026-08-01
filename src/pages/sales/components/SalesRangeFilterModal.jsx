/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  EMPTY_SALES_RANGE_FILTER,
  SALES_RANGE_IDS,
  SALES_RANGE_OPTIONS,
  normalizeSalesRangeFilter,
} from "../salesUtils";

function getValidationMessage(filter) {
  const customSelected = filter.selectedRangeIds.includes(SALES_RANGE_IDS.CUSTOM);
  if (!customSelected) return "";

  const minimumText = String(filter.customMinR || "").trim();
  const maximumText = String(filter.customMaxR || "").trim();

  if (!minimumText && !maximumText) {
    return "Enter a custom minimum, maximum, or both.";
  }

  const minimumValue = minimumText ? Number(minimumText) : null;
  const maximumValue = maximumText ? Number(maximumText) : null;

  if (minimumText && (!Number.isFinite(minimumValue) || minimumValue < 0)) {
    return "Custom minimum must be zero or a positive rand value.";
  }

  if (maximumText && (!Number.isFinite(maximumValue) || maximumValue < 0)) {
    return "Custom maximum must be zero or a positive rand value.";
  }

  if (
    minimumValue !== null &&
    maximumValue !== null &&
    minimumValue > maximumValue
  ) {
    return "Custom minimum cannot be greater than custom maximum.";
  }

  return "";
}

export default function SalesRangeFilterModal({
  columnLabel,
  filter = EMPTY_SALES_RANGE_FILTER,
  onApply,
  onClear,
  onClose,
}) {
  const [draftFilter, setDraftFilter] = useState(() =>
    normalizeSalesRangeFilter(filter),
  );

  useEffect(() => {
    setDraftFilter(normalizeSalesRangeFilter(filter));
  }, [filter, columnLabel]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const modalRoot = useMemo(() => {
    if (typeof document === "undefined") return null;
    return document.body;
  }, []);

  const validationMessage = getValidationMessage(draftFilter);
  const canApply =
    draftFilter.selectedRangeIds.length > 0 && !validationMessage;
  const customSelected = draftFilter.selectedRangeIds.includes(
    SALES_RANGE_IDS.CUSTOM,
  );

  function toggleRange(rangeId) {
    setDraftFilter((current) => {
      const selected = current.selectedRangeIds.includes(rangeId);

      return {
        ...current,
        selectedRangeIds: selected
          ? current.selectedRangeIds.filter((item) => item !== rangeId)
          : [...current.selectedRangeIds, rangeId],
      };
    });
  }

  function handleApply() {
    if (!canApply) return;
    onApply?.(normalizeSalesRangeFilter(draftFilter));
  }

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
        aria-labelledby="sales-range-filter-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={styles.header}>
          <div>
            <p style={styles.eyebrow}>Sales Range Filter</p>
            <h2 id="sales-range-filter-title" style={styles.title}>
              Filter: {columnLabel}
            </h2>
            <p style={styles.subtitle}>Select one or more ranges.</p>
          </div>

          <button
            type="button"
            style={styles.closeButton}
            onClick={onClose}
            aria-label="Close sales range filter"
          >
            ✕
          </button>
        </div>

        <div style={styles.body}>
          <div style={styles.rangeList}>
            {SALES_RANGE_OPTIONS.map((option) => {
              const checked = draftFilter.selectedRangeIds.includes(option.id);

              return (
                <label key={option.id} style={styles.rangeOption}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRange(option.id)}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>

          <div
            style={{
              ...styles.customPanel,
              ...(customSelected ? styles.customPanelActive : null),
            }}
          >
            <div style={styles.customHeading}>Custom range in rands</div>

            <div style={styles.customGrid}>
              <label style={styles.inputLabel}>
                Minimum R
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draftFilter.customMinR}
                  onChange={(event) =>
                    setDraftFilter((current) => ({
                      ...current,
                      customMinR: event.target.value,
                    }))
                  }
                  disabled={!customSelected}
                  placeholder="No minimum"
                  style={styles.input}
                />
              </label>

              <label style={styles.inputLabel}>
                Maximum R
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draftFilter.customMaxR}
                  onChange={(event) =>
                    setDraftFilter((current) => ({
                      ...current,
                      customMaxR: event.target.value,
                    }))
                  }
                  disabled={!customSelected}
                  placeholder="No maximum"
                  style={styles.input}
                />
              </label>
            </div>

            <p style={styles.customHelp}>
              One value may be left blank to create an open-ended range.
            </p>
          </div>

          {validationMessage ? (
            <div style={styles.validationBox}>{validationMessage}</div>
          ) : null}
        </div>

        <div style={styles.footer}>
          <button type="button" style={styles.clearButton} onClick={onClear}>
            Clear
          </button>

          <div style={styles.footerActions}>
            <button type="button" style={styles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              style={{
                ...styles.applyButton,
                ...(!canApply ? styles.applyButtonDisabled : null),
              }}
              onClick={handleApply}
              disabled={!canApply}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    modalRoot,
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 3000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
    background: "rgba(15, 23, 42, 0.56)",
    backdropFilter: "blur(2px)",
  },
  card: {
    width: "min(520px, 100%)",
    maxHeight: "calc(100vh - 2rem)",
    overflowY: "auto",
    borderRadius: "1rem",
    background: "#ffffff",
    boxShadow: "0 24px 70px rgba(15, 23, 42, 0.28)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    padding: "1.15rem 1.2rem 0.95rem",
    borderBottom: "1px solid #e2e8f0",
  },
  eyebrow: {
    margin: 0,
    color: "#2563eb",
    fontSize: "0.7rem",
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: "0.22rem 0 0",
    color: "#0f172a",
    fontSize: "1.15rem",
  },
  subtitle: {
    margin: "0.3rem 0 0",
    color: "#64748b",
    fontSize: "0.86rem",
  },
  closeButton: {
    border: 0,
    background: "transparent",
    color: "#64748b",
    cursor: "pointer",
    fontSize: "1rem",
    fontWeight: 900,
  },
  body: {
    padding: "1rem 1.2rem",
  },
  rangeList: {
    display: "grid",
    gap: "0.55rem",
  },
  rangeOption: {
    display: "flex",
    alignItems: "center",
    gap: "0.65rem",
    minHeight: "2.55rem",
    padding: "0.6rem 0.75rem",
    border: "1px solid #e2e8f0",
    borderRadius: "0.7rem",
    color: "#334155",
    fontSize: "0.9rem",
    fontWeight: 750,
    cursor: "pointer",
  },
  customPanel: {
    marginTop: "0.9rem",
    padding: "0.85rem",
    border: "1px solid #e2e8f0",
    borderRadius: "0.8rem",
    background: "#f8fafc",
    opacity: 0.65,
  },
  customPanelActive: {
    borderColor: "rgba(37, 99, 235, 0.4)",
    background: "#eff6ff",
    opacity: 1,
  },
  customHeading: {
    color: "#0f172a",
    fontSize: "0.86rem",
    fontWeight: 850,
  },
  customGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "0.75rem",
    marginTop: "0.7rem",
  },
  inputLabel: {
    display: "grid",
    gap: "0.35rem",
    color: "#475569",
    fontSize: "0.76rem",
    fontWeight: 800,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #cbd5e1",
    borderRadius: "0.55rem",
    padding: "0.55rem 0.6rem",
    background: "#ffffff",
    fontSize: "0.86rem",
  },
  customHelp: {
    margin: "0.55rem 0 0",
    color: "#64748b",
    fontSize: "0.74rem",
  },
  validationBox: {
    marginTop: "0.8rem",
    padding: "0.7rem 0.8rem",
    border: "1px solid #fecaca",
    borderRadius: "0.65rem",
    background: "#fef2f2",
    color: "#b91c1c",
    fontSize: "0.8rem",
    fontWeight: 750,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    padding: "0.9rem 1.2rem 1.1rem",
    borderTop: "1px solid #e2e8f0",
  },
  footerActions: {
    display: "flex",
    gap: "0.55rem",
  },
  clearButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.8rem",
    background: "#ffffff",
    color: "#475569",
    fontWeight: 850,
    cursor: "pointer",
  },
  cancelButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.8rem",
    background: "#ffffff",
    color: "#334155",
    fontWeight: 850,
    cursor: "pointer",
  },
  applyButton: {
    border: "1px solid #2563eb",
    borderRadius: "0.65rem",
    padding: "0.55rem 0.9rem",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 900,
    cursor: "pointer",
  },
  applyButtonDisabled: {
    borderColor: "#94a3b8",
    background: "#94a3b8",
    cursor: "not-allowed",
  },
};
