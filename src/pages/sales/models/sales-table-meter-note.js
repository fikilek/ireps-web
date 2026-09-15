// The small note under a meter number on the GPS Sales Table.
// Non-GPS meters are always marked "Non-GPS Sales" (they are batched from the
// Non-GPS Sales Table). A reason another column already shows gets no note:
// current batch membership (TB IDs column) and In Progress / Completed (Work
// Status column). Other reasons a meter cannot be ticked stay visible. The
// Non-GPS street list leaves out the same reasons under its addresses.
export const NON_GPS_SALES_NOTE = "Non-GPS Sales";
export const REASONS_SHOWN_IN_COLUMNS = new Set([
  "CURRENT_TARGETED_BATCH",
  "SALES_STATUS_IN_PROGRESS",
  "SALES_STATUS_COMPLETED",
]);

export function salesTableMeterNote({ isNonGpsSales = false, batchability = null } = {}) {
  if (isNonGpsSales) return NON_GPS_SALES_NOTE;
  if (!batchability || batchability.batchable) return null;
  if (REASONS_SHOWN_IN_COLUMNS.has(batchability.code)) return null;
  return batchability.reason || null;
}
