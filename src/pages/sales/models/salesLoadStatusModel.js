// Web Data Copy rules WD-R001.6 and .7 (1.2.0): while Sales records are being read, the page says
// what it is reading and how long it has been running; it never invents a percentage, because the
// browser is given no count while the read runs. It stops only when the computer is offline, or
// after 10 minutes.

// After this long, a first load is slow enough to be worth explaining the background-tab slowdown.
export const SALES_LOAD_SLOW_AFTER_MS = 90_000;

export function salesLoadElapsedText(elapsedMs = 0) {
  const seconds = Math.max(0, Math.floor(Number(elapsedMs) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

// `place` is the municipality's name ("Endumeni"), so the line names what is being read.
export function salesLoadStatus({ elapsedMs = 0, place = "" } = {}) {
  const where = String(place || "").trim();
  return {
    title: "Loading the Sales records",
    line: `Reading ${where ? `all ${where} Sales records` : "all Sales records"} — ${salesLoadElapsedText(elapsedMs)} so far.`,
    note: "The full download happens once per site each time you sign in. After that the page opens in seconds.",
    slowHint: elapsedMs >= SALES_LOAD_SLOW_AFTER_MS
      ? "Keep this tab in front while it loads: the browser slows down a tab left in the background."
      : "",
  };
}
