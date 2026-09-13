// The small note under a meter number on the GPS Sales Table.
// Non-GPS meters are always marked "Non-GPS Sales" (they are batched from the
// Non-GPS Sales Table). Current batch membership gets no note: the TB IDs
// column already shows it. Other reasons a meter cannot be ticked stay visible.
export const NON_GPS_SALES_NOTE = "Non-GPS Sales";

export function salesTableMeterNote({ isNonGpsSales = false, batchability = null } = {}) {
  if (isNonGpsSales) return NON_GPS_SALES_NOTE;
  if (!batchability || batchability.batchable) return null;
  if (batchability.code === "CURRENT_TARGETED_BATCH") return null;
  return batchability.reason || null;
}
