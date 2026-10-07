// A full replacement heals missing and stale links, including moved/deleted visits.
export async function reconcilePremiseNoAccess(db, premiseId, { dryRun = false } = {}) {
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`premises/${premiseId}`);
    const premise = await tx.get(ref);
    if (!premise.exists) return { premiseId, code: "PREMISE_MISSING", changed: false };
    const visits = await tx.get(db.collection("trns").where("accessData.premise.id", "==", premiseId));
    const expected = visits.docs.filter((doc) => doc.data()?.accessData?.access?.hasAccess === "no").map((doc) => doc.id).sort();
    const actual = [...(premise.data().noAccessTrnIds || [])].sort();
    const changed = JSON.stringify(expected) !== JSON.stringify(actual);
    if (changed && !dryRun) tx.update(ref, { noAccessTrnIds: expected });
    return { premiseId, code: "OK", changed, expected, actual };
  });
}

export function isTransientReconciliationError(error) {
  return [4, 8, 10, 13, 14, "deadline-exceeded", "resource-exhausted", "aborted", "internal", "unavailable"].includes(error?.code);
}
