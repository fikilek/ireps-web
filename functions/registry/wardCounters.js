// registry/wardCounters.js

/**
 * Compute operational status
 */
export const computeWardOperationalStatus = ({
  totalErfs = 0,
  premises = 0,
  totalMeters = 0,
  trns = 0,
}) => {
  return totalErfs > 0 || premises > 0 || totalMeters > 0 || trns > 0;
};

/**
 * Load ward counts directly from Firestore aggregate queries
 */
export const loadWardCounts = async ({ db, lmPcode, wardPcode }) => {
  const formalQuery = db
    .collection("ireps_erfs")
    .where("admin.localMunicipality.pcode", "==", lmPcode)
    .where("admin.ward.pcode", "==", wardPcode)
    .where("erf.type", "==", "FORMAL");

  const informalQuery = db
    .collection("ireps_erfs")
    .where("admin.localMunicipality.pcode", "==", lmPcode)
    .where("admin.ward.pcode", "==", wardPcode)
    .where("erf.type", "==", "INFORMAL");

  const premisesQuery = db
    .collection("premises")
    .where("parents.lmPcode", "==", lmPcode)
    .where("parents.wardPcode", "==", wardPcode);

  const electricityMetersQuery = db
    .collection("asts")
    .where("accessData.parents.lmPcode", "==", lmPcode)
    .where("accessData.parents.wardPcode", "==", wardPcode)
    .where("meterType", "==", "electricity");

  const waterMetersQuery = db
    .collection("asts")
    .where("accessData.parents.lmPcode", "==", lmPcode)
    .where("accessData.parents.wardPcode", "==", wardPcode)
    .where("meterType", "==", "water");

  const trnsQuery = db
    .collection("trns")
    .where("accessData.parents.lmPcode", "==", lmPcode)
    .where("accessData.parents.wardPcode", "==", wardPcode);

  const [
    formalSnap,
    informalSnap,
    premisesSnap,
    electricityMetersSnap,
    waterMetersSnap,
    trnsSnap,
  ] = await Promise.all([
    formalQuery.count().get(),
    informalQuery.count().get(),
    premisesQuery.count().get(),
    electricityMetersQuery.count().get(),
    waterMetersQuery.count().get(),
    trnsQuery.count().get(),
  ]);

  const formalErfs = formalSnap.data()?.count || 0;
  const informalErfs = informalSnap.data()?.count || 0;
  const totalErfs = formalErfs + informalErfs;

  const premises = premisesSnap.data()?.count || 0;

  const electricityMeters = electricityMetersSnap.data()?.count || 0;
  const waterMeters = waterMetersSnap.data()?.count || 0;
  const totalMeters = electricityMeters + waterMeters;

  const trns = trnsSnap.data()?.count || 0;

  return {
    formalErfs,
    informalErfs,
    totalErfs,
    premises,
    electricityMeters,
    waterMeters,
    totalMeters,
    trns,
  };
};
