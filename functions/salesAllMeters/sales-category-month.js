import { FieldPath } from "firebase-admin/firestore";
import { SALES_CATEGORY_LABELS } from "./sales-batch-policy.js";

// Targeted Batch rules TB-R046 (1.3.28): the LM's newest category month, found without reading all
// of the LM's meters. From this month back a year, the first month in which any of the LM's meters
// has a known category. Two equality filters, so no composite index is needed. Remembered for ten
// minutes; when the next month's categories arrive they take over within that time.
const MONTHS_BACK = 12;
const REMEMBER_MS = 10 * 60 * 1000;
const remembered = new Map();
const monthOf = date => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit" }).format(date).slice(0, 7);
const previousMonth = month => {
  const [year, number] = month.split("-").map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`;
};

export async function latestSalesCategoryMonth(db, lmPcode, { now = new Date() } = {}) {
  const key = `${db.projectId}:${lmPcode}`, known = remembered.get(key);
  if (known && Date.now() - known.at < REMEMBER_MS) return known.month;
  let month = monthOf(now), found = null;
  for (let step = 0; step <= MONTHS_BACK && !found; step += 1, month = previousMonth(month)) {
    const snapshot = await db.collection("sales-all-meters").where("lmPcode", "==", lmPcode)
      .where(new FieldPath("monthlyCategories", month, "leakageCategory"), "in", [...SALES_CATEGORY_LABELS]).limit(1).get();
    if (!snapshot.empty) found = month;
  }
  remembered.set(key, { month: found, at: Date.now() });
  return found;
}

export function forgetSalesCategoryMonths() {
  remembered.clear();
}
