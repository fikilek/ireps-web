// Targeted Batch rules TB-R060 (1.3.62): taking a meter out of a batch, from TB Rows.
// A supervisor (SPV) or a manager (MNG) may do it. The row leaves the batch, and the meter is free again:
// anybody may work on it and it may be batched again. Completed work is never released, and a batch is
// emptied through Delete Batch, never by taking its last meter out.
// This module holds the wording and the enabling rules only, so they can be tested on their own. The server
// decides in the end (takeOutOfBatch.js): the buttons here are a hint, exactly as TB Register's are.

export const TAKE_OUT_ROLES = Object.freeze(["SPV", "MNG"]);
export const TAKE_OUT_REASON_MAX = 500;

const text = value => String(value ?? "").trim();
const upper = value => text(value).toUpperCase();
export const metersText = count => `${count} meter${count === 1 ? "" : "s"}`;

// The owner's three statuses are the only status words that go on a screen. A row carrying anything else
// shows no status at all, rather than a fourth word nobody uses.
const THREE_STATUSES = Object.freeze({ NOT_STARTED: "Not Started", IN_PROGRESS: "In Progress", COMPLETED: "Completed" });
export const takeOutStatusWords = row => THREE_STATUSES[upper(row?.completionStatus)] || "";

// The one line under a meter in the confirmation window: where the meter is, and how far its work has got.
export function takeOutMeterLine(row) {
  return ["Row " + (text(row?.rowNo) || "NAv"), text(row?.address) || "NAv", text(row?.town) || "NAv", takeOutStatusWords(row)]
    .filter(Boolean).join(" · ");
}

// Only a supervisor or a manager sees the action at all.
export const canSeeTakeOutOfBatch = role => TAKE_OUT_ROLES.includes(upper(role));

// The meter number the server works with: the canonical Sales meter number of the row.
export const takeOutMeterNo = row => text(row?.salesAllMeterId) || text(row?.meterNoNormalized);

// Why this row may not be taken out, in the words the person reads. null means it may.
export function takeOutBlockedReason(row, { rowCount = 0 } = {}) {
  const status = upper(row?.completionStatus);
  if (status === "COMPLETED") return "This meter is completed. Completed work is never released.";
  if (status === "INTEGRITY_ERROR") return "This row does not read properly. The office must look at it before it can be taken out.";
  if (!takeOutMeterNo(row)) return "This row has no Sales meter number, so it cannot be taken out.";
  if (Number(rowCount) <= 1) return "This is the last meter in the batch. Use Delete Batch to empty a batch.";
  return null;
}
export const canTakeRowOutOfBatch = (row, context) => takeOutBlockedReason(row, context) === null;

// What the ticked rows come to: the rows that may go, and the meter numbers the server is sent.
export function takeOutSelection(rows = [], selectedKeys = [], context = {}) {
  const wanted = new Set(selectedKeys);
  const items = rows.filter(row => wanted.has(row.rowKey) && canTakeRowOutOfBatch(row, context));
  return { items, meterNos: items.map(takeOutMeterNo), count: items.length };
}

export const takeOutButtonLabel = count => (count ? `Take ${metersText(count)} out of batch` : "Take out of batch");

// The confirmation window: it names the meter(s) and the batch, and asks for the reason in the person's own words.
export function takeOutConfirmWindow({ batch, items = [], reasonText = "" }) {
  const tbId = text(batch?.id) || "this batch";
  const meters = items.map(item => takeOutMeterNo(item) || text(item?.meterNo)).filter(Boolean);
  const trimmed = text(reasonText);
  return {
    kind: "confirm",
    title: meters.length === 1 ? `Take meter ${meters[0]} out of batch ${tbId}?` : `Take ${metersText(meters.length)} out of batch ${tbId}?`,
    meters,
    // One entry per ticked meter, in the words the window prints: no internal code reaches the screen.
    rows: items.map(item => ({ key: text(item?.rowKey) || takeOutMeterNo(item), meterNo: takeOutMeterNo(item) || text(item?.meterNo) || "NAv", line: takeOutMeterLine(item) })),
    lines: [
      `${meters.length === 1 ? "This meter" : "These meters"} will leave batch ${tbId}. ${meters.length === 1 ? "It" : "They"} will be free again: anybody may work on ${meters.length === 1 ? "it" : "them"}, and ${meters.length === 1 ? "it" : "they"} may be batched again.`,
      "A meter that is already completed, or found on site, is never released, and the batch's last meter cannot go: use Delete Batch to empty a batch.",
      "Each meter is settled on its own, so one that is refused does not stop the others.",
    ],
    canConfirm: Boolean(meters.length) && Boolean(trimmed) && trimmed.length <= TAKE_OUT_REASON_MAX,
    reasonText: trimmed,
    reasonHint: !trimmed ? "Say in your own words why the meter must come out of the batch."
      : trimmed.length > TAKE_OUT_REASON_MAX ? `The reason is longer than ${TAKE_OUT_REASON_MAX} characters. Please shorten it.` : "",
  };
}

// While it runs: visible progress, never silence.
export function takeOutProgressWindow({ batch, items = [] }) {
  const tbId = text(batch?.id) || "this batch";
  return { kind: "working", working: true, title: `Taking ${metersText(items.length)} out of batch ${tbId}…`,
    lines: ["Please wait. Each meter is settled on its own.", "Do not close this window."] };
}

// The result window: how many went, and every meter that was refused, with the reason in plain words.
export function takeOutResultWindow({ batch, items = [], result }) {
  const tbId = text(batch?.id) || "this batch";
  const takenOut = Array.isArray(result?.takenOut) ? result.takenOut : [];
  const refused = Array.isArray(result?.refused) ? result.refused : [];
  const asked = items.length || takenOut.length + refused.length;
  const title = !takenOut.length ? `Nothing was taken out of batch ${tbId}`
    : refused.length ? `${metersText(takenOut.length)} of ${asked} taken out of batch ${tbId}`
      : `${metersText(takenOut.length)} taken out of batch ${tbId}`;
  const lines = [];
  if (takenOut.length) {
    lines.push(`${takenOut.map(item => text(item.meterNo)).filter(Boolean).join(", ")} left batch ${tbId}. ${takenOut.length === 1 ? "It is" : "They are"} free again: anybody may work on ${takenOut.length === 1 ? "it" : "them"}, and ${takenOut.length === 1 ? "it" : "they"} may be batched again.`);
  }
  for (const item of refused) lines.push(`${text(item.meterNo) || "A meter"} stayed in the batch. ${text(item.message) || "It could not be taken out."}`);
  if (!takenOut.length && !refused.length) lines.push("No meter was taken out and none was refused. Check the rows and try again.");
  return { kind: "result", title, tone: !takenOut.length ? "error" : refused.length ? "warning" : "info", lines, takenOut, refused };
}

// The whole request failed: say so plainly, and say what is safe to do next.
export function takeOutFailureWindow({ batch, items = [], failure }) {
  const tbId = text(batch?.id) || "this batch";
  if (failure?.uncertain) {
    return { kind: "result", title: "The result was not confirmed", tone: "error",
      lines: ["The connection dropped before iREPS confirmed the result.",
        `Check the rows of batch ${tbId}: a meter that has gone is out. Pressing Take out of batch again is safe.`] };
  }
  return { kind: "result", title: `Nothing was taken out of batch ${tbId}`, tone: "error",
    lines: [text(failure?.error) || text(failure?.message) || "iREPS could not take the meters out of the batch.",
      `${metersText(items.length)} ${items.length === 1 ? "stays" : "stay"} in the batch. Nothing was changed.`] };
}
