import { useCallback, useMemo, useSyncExternalStore } from "react";

export const mdBgoSelectionKey = lmPcode => `ireps.mdBgoAllocation.${String(lmPcode || "").trim()}`;
const listeners = new Set();
function read(lmPcode) {
  try { return globalThis.localStorage?.getItem(mdBgoSelectionKey(lmPcode)) || "[]"; } catch { return "[]"; }
}
function parse(value) {
  try { const ids = JSON.parse(value); return Array.isArray(ids) ? [...new Set(ids.map(id => String(id || "").trim()).filter(Boolean))] : []; } catch { return []; }
}
export function writeMdBgoSelection(lmPcode, ids) {
  if (!String(lmPcode || "").trim()) return;
  try { globalThis.localStorage?.setItem(mdBgoSelectionKey(lmPcode), JSON.stringify([...new Set(ids.map(id => String(id || "").trim()).filter(Boolean))])); } catch { /* selection convenience only */ }
  listeners.forEach(listener => listener());
}
export function toggleMdBgoTick(ids = [], id) {
  const value = String(id || "").trim();
  return !value ? ids : ids.includes(value) ? ids.filter(item => item !== value) : [...ids, value];
}
export function toggleListedMdBgoTicks(ids = [], listed = []) {
  const values = listed.map(id => String(id || "").trim()).filter(Boolean);
  return values.every(id => ids.includes(id)) ? ids.filter(id => !values.includes(id)) : [...new Set([...ids, ...values])];
}
export function useMdBgoAllocationSelection(lmPcode) {
  const value = useSyncExternalStore(useCallback(listener => {
    listeners.add(listener); globalThis.addEventListener?.("storage", listener);
    return () => { listeners.delete(listener); globalThis.removeEventListener?.("storage", listener); };
  }, []), useCallback(() => read(lmPcode), [lmPcode]), () => "[]");
  const selectedIds = useMemo(() => parse(value), [value]);
  return { selectedIds, isTicked: useCallback(id => selectedIds.includes(String(id || "").trim()), [selectedIds]),
    toggle: useCallback(id => writeMdBgoSelection(lmPcode, toggleMdBgoTick(selectedIds, id)), [lmPcode, selectedIds]),
    toggleListed: useCallback(ids => writeMdBgoSelection(lmPcode, toggleListedMdBgoTicks(selectedIds, ids)), [lmPcode, selectedIds]),
    clear: useCallback(() => writeMdBgoSelection(lmPcode, []), [lmPcode]) };
}
