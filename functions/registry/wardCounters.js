// registry/wardCounters.js

const ACTIVE_METER_STATES = ["FIELD", "CONNECTED", "DISCONNECTED"];

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

const readCount = (snap) => snap.data()?.count || 0;

const countQuery = async (query) => {
  const snap = await query.count().get();
  return readCount(snap);
};

const buildAstScopeQuery = ({ db, lmPcode, wardPcode, meterType }) => {
  return db
    .collection("asts")
    .where("accessData.parents.lmPcode", "==", lmPcode)
    .where("accessData.parents.wardPcode", "==", wardPcode)
    .where("meterType", "==", meterType);
};

const loadActiveMeterCount = async ({ db, lmPcode, wardPcode, meterType }) => {
  const baseQuery = buildAstScopeQuery({ db, lmPcode, wardPcode, meterType });

  const countPromises = [];

  for (const state of ACTIVE_METER_STATES) {
    countPromises.push(countQuery(baseQuery.where("status.state", "==", state)));
    countPromises.push(countQuery(baseQuery.where("status", "==", state)));
  }

  const counts = await Promise.all(countPromises);

  return counts.reduce((sum, count) => sum + count, 0);
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

  const trnsQuery = db
    .collection("trns")
    .where("accessData.parents.lmPcode", "==", lmPcode)
    .where("accessData.parents.wardPcode", "==", wardPcode);

  const [
    formalSnap,
    informalSnap,
    premisesSnap,
    electricityMeters,
    waterMeters,
    trnsSnap,
  ] = await Promise.all([
    formalQuery.count().get(),
    informalQuery.count().get(),
    premisesQuery.count().get(),
    loadActiveMeterCount({
      db,
      lmPcode,
      wardPcode,
      meterType: "electricity",
    }),
    loadActiveMeterCount({
      db,
      lmPcode,
      wardPcode,
      meterType: "water",
    }),
    trnsQuery.count().get(),
  ]);

  const formalErfs = readCount(formalSnap);
  const informalErfs = readCount(informalSnap);
  const totalErfs = formalErfs + informalErfs;

  const premises = readCount(premisesSnap);
  const totalMeters = electricityMeters + waterMeters;

  const trns = readCount(trnsSnap);

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
