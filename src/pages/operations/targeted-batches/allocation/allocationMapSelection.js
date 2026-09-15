import { useCallback, useMemo, useSyncExternalStore } from "react";

// Targeted Batch rules TB-R047 (1.3.32): TB Register decides what the Allocation Map draws. The ticks
// are kept per LM in this browser, so they survive the trip to the map and a page refresh.
export const selectionKey = lmPcode => `ireps.allocationMap.${String(lmPcode || "").trim()}`;
const listeners = new Set();
const EMPTY = Object.freeze([]);

function store() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function readSelectionText(lmPcode) {
  if (!String(lmPcode || "").trim()) return "[]";
  try { return store()?.getItem(selectionKey(lmPcode)) || "[]"; } catch { return "[]"; }
}

export function parseSelection(text) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value.map(id => String(id || "").trim()).filter(Boolean) : [];
  } catch { return []; }
}

export function writeSelection(lmPcode, ids) {
  if (!String(lmPcode || "").trim()) return;
  try { store()?.setItem(selectionKey(lmPcode), JSON.stringify([...new Set(ids.map(id => String(id || "").trim()).filter(Boolean))])); } catch { /* the ticks are a convenience */ }
  listeners.forEach(listener => listener());
}

export function toggleTick(ids = [], tbId) {
  const id = String(tbId || "").trim();
  if (!id) return ids;
  return ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id];
}

// The header checkbox ticks every batch currently listed (after the filters), and unticks them when
// they are all ticked already.
export function toggleListed(ids = [], listedIds = []) {
  const listed = listedIds.map(id => String(id || "").trim()).filter(Boolean);
  if (!listed.length) return ids;
  const allTicked = listed.every(id => ids.includes(id));
  return allTicked ? ids.filter(id => !listed.includes(id)) : [...new Set([...ids, ...listed])];
}

export function useAllocationMapSelection(lmPcode) {
  const text = useSyncExternalStore(
    useCallback(listener => {
      listeners.add(listener);
      globalThis.addEventListener?.("storage", listener);
      return () => { listeners.delete(listener); globalThis.removeEventListener?.("storage", listener); };
    }, []),
    useCallback(() => readSelectionText(lmPcode), [lmPcode]),
    () => "[]",
  );
  const selectedIds = useMemo(() => (text === "[]" ? EMPTY : parseSelection(text)), [text]);
  return {
    selectedIds,
    isTicked: useCallback(tbId => selectedIds.includes(String(tbId || "").trim()), [selectedIds]),
    toggle: useCallback(tbId => writeSelection(lmPcode, toggleTick(selectedIds, tbId)), [lmPcode, selectedIds]),
    toggleListed: useCallback(listedIds => writeSelection(lmPcode, toggleListed(selectedIds, listedIds)), [lmPcode, selectedIds]),
    clear: useCallback(() => writeSelection(lmPcode, []), [lmPcode]),
  };
}
