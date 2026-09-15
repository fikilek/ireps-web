import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { NGP_SELECTION_MAX } from "../models/nonGpsBatchPlanningModel";

const PRESET_COUNTS = [5, 10, 20, 30];
const OTHER = "OTHER";
const MENU_WIDTH = 250;
const MENU_HEIGHT_ESTIMATE = 330;

function parseOtherCount(text, max) {
  const trimmed = String(text || "").trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= max ? value : null;
}

// Below the trigger, or above it when the table header sits low on screen.
function menuPositionFor(trigger) {
  const rect = trigger.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8));
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  if (spaceBelow < MENU_HEIGHT_ESTIMATE && rect.top > spaceBelow) {
    return { left, bottom: window.innerHeight - rect.top + 4 };
  }
  return { left, top: rect.bottom + 4 };
}

export default function NonGpsQuickSelect({
  onApply,
  disabled = false,
  max = NGP_SELECTION_MAX,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const [otherText, setOtherText] = useState("");
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const otherInputRef = useRef(null);
  const titleId = useId();
  const groupName = useId();

  const presets = PRESET_COUNTS.filter((value) => value <= max);
  const otherCount = parseOtherCount(otherText, max);
  const count = choice === OTHER ? otherCount : Number(choice) || null;
  const otherInvalid = choice === OTHER && otherText.trim() !== "" && otherCount === null;

  useEffect(() => {
    if (!isOpen) return undefined;

    function reposition() {
      if (triggerRef.current) setPosition(menuPositionFor(triggerRef.current));
    }

    function handlePointerDown(event) {
      if (
        triggerRef.current?.contains(event.target) ||
        menuRef.current?.contains(event.target)
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

    const focusTimer = window.setTimeout(() => {
      const menu = menuRef.current;
      (menu?.querySelector("input[type='radio']:checked") ||
        menu?.querySelector("input[type='radio']"))?.focus();
    }, 0);

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [isOpen]);

  function toggleMenu() {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    setPosition(menuPositionFor(triggerRef.current));
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function apply(event) {
    event.preventDefault();
    if (!count) return;
    close();
    onApply?.(count);
  }

  const menu =
    isOpen && position && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-labelledby={titleId}
            style={{ ...styles.menu, ...position }}
          >
            <form onSubmit={apply}>
              <div id={titleId} style={styles.menuTitle}>
                Quick select
              </div>

              <div role="radiogroup" aria-labelledby={titleId} style={styles.options}>
                {presets.map((value) => (
                  <label key={value} style={styles.option}>
                    <input
                      type="radio"
                      name={groupName}
                      value={String(value)}
                      checked={choice === String(value)}
                      onChange={() => setChoice(String(value))}
                    />
                    <span>First {value}</span>
                  </label>
                ))}

                <div style={styles.option}>
                  <label style={styles.otherLabel}>
                    <input
                      type="radio"
                      name={groupName}
                      value={OTHER}
                      checked={choice === OTHER}
                      onChange={() => {
                        setChoice(OTHER);
                        otherInputRef.current?.focus();
                      }}
                    />
                    <span>Other</span>
                  </label>
                  <input
                    ref={otherInputRef}
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={otherText}
                    onFocus={() => setChoice(OTHER)}
                    onChange={(event) => {
                      setOtherText(event.target.value);
                      setChoice(OTHER);
                    }}
                    aria-label={`Number of meters, 1 to ${max}`}
                    aria-invalid={otherInvalid}
                    style={{
                      ...styles.otherInput,
                      ...(otherInvalid ? styles.otherInputInvalid : null),
                    }}
                  />
                  <span style={styles.range}>1–{max}</span>
                </div>
                {otherInvalid ? (
                  <div role="alert" style={styles.error}>
                    Enter a number from 1 to {max}.
                  </div>
                ) : null}
              </div>

              <p style={styles.help}>
                Sorts the list by address and ticks from the top. Replaces this
                street's ticks.
              </p>

              <div style={styles.menuFooter}>
                <button type="button" style={styles.cancelButton} onClick={close}>
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    ...styles.okButton,
                    ...(count ? null : styles.okButtonDisabled),
                  }}
                  disabled={!count}
                >
                  OK
                </button>
              </div>
            </form>
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
        disabled={disabled}
        title={
          disabled
            ? "No meters on this street can be ticked"
            : `Tick the first meters in address order, up to ${max}`
        }
        style={{ ...styles.trigger, ...(disabled ? styles.triggerDisabled : null) }}
        onClick={toggleMenu}
      >
        <span>Quick select</span>
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
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.48rem",
    padding: "0.42rem 0.5rem",
    background: "#ffffff",
    color: "#0f172a",
    cursor: "pointer",
    fontSize: "0.74rem",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  triggerDisabled: { color: "#94a3b8", cursor: "not-allowed" },
  chevron: { color: "#475569", fontSize: "0.7rem" },
  menu: {
    position: "fixed",
    zIndex: 10000,
    width: `${MENU_WIDTH}px`,
    border: "1px solid #cbd5e1",
    borderRadius: "0.7rem",
    background: "#ffffff",
    boxShadow: "0 18px 38px rgba(15, 23, 42, 0.2)",
    boxSizing: "border-box",
    overflow: "hidden",
  },
  menuTitle: {
    padding: "0.65rem 0.75rem 0.5rem",
    borderBottom: "1px solid #e2e8f0",
    color: "#334155",
    fontSize: "0.76rem",
    fontWeight: 900,
  },
  options: { display: "grid", gap: "0.1rem", padding: "0.35rem" },
  option: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.4rem 0.5rem",
    borderRadius: "0.45rem",
    color: "#0f172a",
    cursor: "pointer",
    fontSize: "0.8rem",
  },
  otherLabel: { display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" },
  otherInput: {
    width: "3.2rem",
    border: "1px solid #cbd5e1",
    borderRadius: "0.4rem",
    padding: "0.28rem 0.4rem",
    font: "inherit",
    fontSize: "0.8rem",
  },
  otherInputInvalid: { borderColor: "#dc2626" },
  range: { color: "#64748b", fontSize: "0.74rem" },
  error: { padding: "0 0.5rem 0.3rem", color: "#b91c1c", fontSize: "0.74rem", fontWeight: 700 },
  help: {
    margin: 0,
    padding: "0.1rem 0.85rem 0.6rem",
    color: "#64748b",
    fontSize: "0.72rem",
    lineHeight: 1.4,
  },
  menuFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "0.45rem",
    padding: "0.55rem",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  cancelButton: {
    border: "1px solid #cbd5e1",
    borderRadius: "0.5rem",
    padding: "0.38rem 0.65rem",
    background: "#ffffff",
    color: "#334155",
    cursor: "pointer",
    fontSize: "0.75rem",
    fontWeight: 800,
  },
  okButton: {
    border: "1px solid #2563eb",
    borderRadius: "0.5rem",
    padding: "0.38rem 0.9rem",
    background: "#2563eb",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "0.75rem",
    fontWeight: 850,
  },
  okButtonDisabled: { opacity: 0.45, cursor: "not-allowed" },
};
