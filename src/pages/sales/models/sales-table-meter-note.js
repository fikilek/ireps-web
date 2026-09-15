// The small note under a meter number on the GPS Sales Table.
// Non-GPS meters are always marked "Non-GPS Sales" (they are batched from the
// Non-GPS Sales Table). A reason another column already shows gets no note:
// current batch membership (TB IDs column), In Progress / Completed (Work
// Status column) and a Normal or missing category (Sales Category column,
// Targeted Batch rules TB-R046). Other reasons a meter cannot be ticked stay
// visible. The Non-GPS street list leaves out the same reasons under its
// addresses; it marks the category with a "Normal" / "No cat" tag instead.
export const NON_GPS_SALES_NOTE = "Non-GPS Sales";
export const REASONS_SHOWN_IN_COLUMNS = new Set([
  "CURRENT_TARGETED_BATCH",
  "SALES_STATUS_IN_PROGRESS",
  "SALES_STATUS_COMPLETED",
  "SALES_CATEGORY_NORMAL",
  "SALES_CATEGORY_NONE",
]);

export function salesTableMeterNote({ isNonGpsSales = false, batchability = null } = {}) {
  if (isNonGpsSales) return NON_GPS_SALES_NOTE;
  if (!batchability || batchability.batchable) return null;
  if (REASONS_SHOWN_IN_COLUMNS.has(batchability.code)) return null;
  return batchability.reason || null;
}
