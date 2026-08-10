/* eslint-disable no-unused-vars -- JSX component tags are reported as unused by this project ESLint config. */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

function normalizeValues(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function haveSameValues(left = [], right = []) {
  const normalizedLeft = normalizeValues(left).sort();
  const normalizedRight = normalizeValues(right).sort();

  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function getTriggerLabel({
  allLabel,
  options,
  selectedCountLabel,
  values,
}) {
  if (values.length === 0) return allLabel;

  if (values.length === 1) {
    const selectedOption = options.find(
      (option) => option.value === values[0],
    );

    return selectedOption?.label || values[0];
  }

  return `${values.length} ${selectedCountLabel}`;
}

export default function MultiSelectFilter({
  allLabel,
  ariaLabel,
  exclusiveValues = [],
  menuMinWidth = 220,
  onChange,
  options = [],
  selectedCountLabel = "selected",
  style,
  value = [],
}) {
  const normalizedValue = useMemo(() => normalizeValues(value), [value]);
  const [isOpen, setIsOpen] = useState(false);
  const [draftValues, setDraftValues] = useState(normalizedValue);
  const [menuPosition, setMenuPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const labelId = useId();

  const normalizedExclusiveValues = useMemo(
    () => new Set(normalizeValues(exclusiveValues)),
    [exclusiveValues],
  );

  const normalizedOptions = useMemo(() => {
    const seen = new Set();

    return (Array.isArray(options) ? options : [])
      .map((option) => ({
        value: String(option?.value || "").trim(),
        label: String(option?.label || option?.value || "").trim(),
      }))
      .filter((option) => {
        if (!option.value || seen.has(option.value)) return false;
        seen.add(option.value);
        return true;
      });
  }, [options]);

  const triggerLabel = getTriggerLabel({
    allLabel,
    options: normalizedOptions,
    selectedCountLabel,
    values: normalizedValue,
  });

  useEffect(() => {
    if (isOpen) return;
    setDraftValues(normalizedValue);
  }, [isOpen, normalizedValue]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function updateMenuPosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const menuWidth = Math.min(
        Math.max(rect.width, menuMinWidth),
        Math.max(220, viewportWidth - 16),
      );
      const availableBelow = viewportHeight - rect.bottom - 12;
      const availableAbove = rect.top - 12;
      const preferAbove = availableBelow < 190 && availableAbove > availableBelow;
      const maxHeight = Math.max(
        160,
        Math.min(340, preferAbove ? availableAbove : availableBelow),
      );
      const left = Math.max(
        8,
        Math.min(rect.left, viewportWidth - menuWidth - 8),
      );
      const top = preferAbove
        ? Math.max(8, rect.top - maxHeight - 4)
        : Math.min(viewportHeight - 8, rect.bottom + 4);

      setMenuPosition({
        left,
        maxHeight,
        top,
        width: menuWidth,
      });
    }

    function handlePointerDown(event) {
      const target = event.target;

      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }

      setIsOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    }

    updateMenuPosition();

    const focusTimer = window.setTimeout(() => {
      menuRef.current?.querySelector("input[type='checkbox']")?.focus();
    }, 0);

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, menuMinWidth]);

  function openMenu() {
    setDraftValues(normalizedValue);
    setIsOpen(true);
  }

  function toggleMenu() {
    if (isOpen) setIsOpen(false);
    else openMenu();
  }

  function toggleDraftValue(optionValue) {
    setDraftValues((current) => {
      const next = new Set(normalizeValues(current));

      if (next.has(optionValue)) {
        next.delete(optionValue);
        return Array.from(next);
      }

      if (normalizedExclusiveValues.has(optionValue)) {
        return [optionValue];
      }

      normalizedExclusiveValues.forEach((exclusiveValue) => {
        next.delete(exclusiveValue);
      });
      next.add(optionValue);

      return Array.from(next);
    });
  }

  function applySelection() {
    const validOptionValues = new Set(
      normalizedOptions.map((option) => option.value),
    );
    const nextValues = normalizeValues(draftValues).filter((optionValue) =>
      validOptionValues.has(optionValue),
    );

    if (!haveSameValues(nextValues, normalizedValue)) {
      onChange(nextValues);
    }

    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function clearSelection() {
    if (normalizedValue.length > 0) onChange([]);
    setDraftValues([]);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  const menu =
    isOpen && menuPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-labelledby={labelId}
            style={{
              ...styles.menu,
              left: `${menuPosition.left}px`,
              maxHeight: `${menuPosition.maxHeight}px`,
              top: `${menuPosition.top}px`,
              width: `${menuPosition.width}px`,
            }}
          >
            <div id={labelId} style={styles.menuTitle}>
              {ariaLabel}
            </div>

            <div style={styles.optionsList}>
              <label style={styles.optionLabel}>
                <input
                  type="checkbox"
                  checked={draftValues.length === 0}
                  onChange={() => setDraftValues([])}
                />
                <span>{allLabel}</span>
              </label>

              {normalizedOptions.map((option) => (
                <label key={option.value} style={styles.optionLabel}>
                  <input
                    type="checkbox"
                    checked={draftValues.includes(option.value)}
                    onChange={() => toggleDraftValue(option.value)}
                  />
                  <span style={styles.optionText} title={option.label}>
                    {option.label}
                  </span>
                </label>
              ))}
            </div>

            <div style={styles.menuFooter}>
              <button
                type="button"
                style={styles.clearButton}
                onClick={clearSelection}
              >
                Clear
              </button>
              <button
                type="button"
                style={styles.applyButton}
                onClick={applySelection}
              >
                Apply
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        title={triggerLabel}
        style={{ ...styles.trigger, ...style }}
        onClick={toggleMenu}
      >
        <span style={styles.triggerLabel}>{triggerLabel}</span>
        <span aria-hidden="true" style={styles.chevron}>
          {isOpen ? "▴" : "▾"}
        </span>
      </button>
      {menu}
    </>
  );
}

const styles = {
  trigger: {
    width: "100%",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.35rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.45rem",
    padding: "0.36rem 0.45rem",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    boxSizing: "border-box",
    fontSize: "0.72rem",
    textAlign: "left",
  },
  triggerLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chevron: {
    flex: "0 0 auto",
    color: "#475569",
    fontSize: "0.7rem",
  },
  menu: {
    position: "fixed",
    zIndex: 10000,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    border: "1px solid #cbd5e1",
    borderRadius: "0.7rem",
    background: "#ffffff",
    boxShadow: "0 18px 38px rgba(15, 23, 42, 0.2)",
    boxSizing: "border-box",
  },
  menuTitle: {
    padding: "0.65rem 0.75rem 0.5rem",
    borderBottom: "1px solid #e2e8f0",
    color: "#334155",
    fontSize: "0.76rem",
    fontWeight: 900,
  },
  optionsList: {
    minHeight: 0,
    display: "grid",
    gap: "0.15rem",
    padding: "0.35rem",
    overflowY: "auto",
  },
  optionLabel: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    padding: "0.45rem 0.5rem",
    borderRadius: "0.45rem",
    color: "#0f172a",
    cursor: "pointer",
    fontSize: "0.78rem",
    lineHeight: 1.35,
  },
  optionText: {
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  menuFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.45rem",
    padding: "0.55rem",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  clearButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.5rem",
    padding: "0.38rem 0.65rem",
    background: "#ffffff",
    color: "#334155",
    cursor: "pointer",
    fontSize: "0.75rem",
    fontWeight: 800,
  },
  applyButton: {
    border: "1px solid #2563eb",
    borderRadius: "0.5rem",
    padding: "0.38rem 0.7rem",
    background: "#2563eb",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "0.75rem",
    fontWeight: 850,
  },
};
