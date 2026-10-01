// DR-R001 3.1: nothing is issued for a meter iREPS cannot account for.
//
// The office finds a meter in the Meter Registry and presses Disconnect or
// Reconnect. Finding a row is not proof. Before the work is issued — and again
// when it is issued — the meter and the registration that created it must both
// be there and point at each other.
//
// A meter carries the id of the Meter Discovery or Meter Installation that
// created it, so every check here is an exact read. No name matching, no
// guessing. The meter registry is not read: it is a copy, reconciled on its
// own, and it retires with reg01.

import { normalizeUpper } from "./helpers.js";

const REGISTRATION_ID_PREFIXES = ["TRN_MDIS_", "TRN_MINST_"];
const REGISTRATION_TRN_TYPES = ["METER_DISCOVERY", "METER_INSTALLATION"];

export const REGISTRATION_GUARD_CHECKS = Object.freeze([
  "METER_RECORD",
  "REGISTRATION_TRN",
  "REGISTRATION_KIND",
  "REGISTRATION_NAMES_METER",
  "REGISTRATION_HAD_ACCESS",
  "METER_MASTER",
  "PREMISE_LINK",
]);

export function normalizeMeterNo(value) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();

  return /^[A-Z0-9]+$/.test(normalized) ? normalized : "";
}

function check(key, ok, detail = "") {
  return { key, ok, detail };
}

function result(checks, code = "", message = "") {
  return {
    ok: checks.every((item) => item.ok),
    checks,
    code,
    message,
  };
}

// The premise keeps its meters under services.electricityMeters /
// services.waterMeters, and each item names its meter under `trnId` — correct,
// because a meter's id IS the id of the transaction that created it.
export function premiseHoldsMeter(premiseData = {}, astId = "") {
  const services = premiseData?.services || {};

  return ["electricityMeters", "waterMeters"].some((bucket) => {
    const list = Array.isArray(services?.[bucket]) ? services[bucket] : [];

    return list.some(
      (item) => String(item?.trnId || item?.astId || "").trim() === astId,
    );
  });
}

export async function checkMeterRegistration({ db, astId }) {
  const meterId = String(astId || "").trim();

  if (!meterId) {
    return result(
      [check("METER_RECORD", false, "No meter was named")],
      "INVALID_AST_ID",
      "No meter was named",
    );
  }

  const astSnap = await db.collection("asts").doc(meterId).get();

  if (!astSnap.exists) {
    return result(
      [check("METER_RECORD", false, meterId)],
      "METER_NOT_FOUND",
      "iREPS has no record of this meter",
    );
  }

  const astDoc = astSnap.data() || {};
  const checks = [check("METER_RECORD", true, meterId)];

  const registrationSnap = await db.collection("trns").doc(meterId).get();

  if (!registrationSnap.exists) {
    checks.push(check("REGISTRATION_TRN", false, meterId));

    return result(
      checks,
      "REGISTRATION_NOT_FOUND",
      "The registration that created this meter cannot be found",
    );
  }

  const registration = registrationSnap.data() || {};
  checks.push(check("REGISTRATION_TRN", true, meterId));

  const registrationType = normalizeUpper(
    registration?.accessData?.trnType || registration?.trnType || "",
  );

  const looksLikeRegistration =
    REGISTRATION_ID_PREFIXES.some((prefix) => meterId.startsWith(prefix)) &&
    REGISTRATION_TRN_TYPES.includes(registrationType);

  checks.push(
    check("REGISTRATION_KIND", looksLikeRegistration, registrationType || "NAv"),
  );

  if (!looksLikeRegistration) {
    return result(
      checks,
      "NOT_A_REGISTRATION",
      "The transaction that created this meter is not a Meter Discovery or a Meter Installation",
    );
  }

  const registrationAstId = String(
    registration?.ast?.astData?.astId || "",
  ).trim();

  const namesThisMeter = registrationAstId === meterId;
  checks.push(
    check("REGISTRATION_NAMES_METER", namesThisMeter, registrationAstId || "NAv"),
  );

  if (!namesThisMeter) {
    return result(
      checks,
      "REGISTRATION_METER_MISMATCH",
      "The registration names a different meter",
    );
  }

  const hadAccess =
    String(registration?.accessData?.access?.hasAccess || "")
      .trim()
      .toLowerCase() === "yes";

  checks.push(check("REGISTRATION_HAD_ACCESS", hadAccess));

  if (!hadAccess) {
    return result(
      checks,
      "REGISTRATION_WITHOUT_ACCESS",
      "The registration records that nobody reached this meter, so the meter should not exist",
    );
  }

  const meterNo = normalizeMeterNo(astDoc?.ast?.astData?.astNo);

  if (!meterNo) {
    checks.push(check("METER_MASTER", false, "The meter number is not usable"));

    return result(
      checks,
      "METER_NUMBER_UNUSABLE",
      "This meter's number cannot be read, so its identity cannot be confirmed",
    );
  }

  const masterSnap = await db.collection("meter_master").doc(meterNo).get();
  const masterAstId = String(masterSnap.data()?.refs?.asts?.id || "").trim();
  const masterAgrees = masterSnap.exists && masterAstId === meterId;

  checks.push(check("METER_MASTER", masterAgrees, meterNo));

  if (!masterAgrees) {
    return result(
      checks,
      "METER_MASTER_MISMATCH",
      masterSnap.exists
        ? "Meter master holds this number against a different meter"
        : "This meter's number is not registered in meter master",
    );
  }

  const premiseId = String(astDoc?.accessData?.premise?.id || "").trim();

  if (!premiseId) {
    checks.push(check("PREMISE_LINK", false, "NAv"));

    return result(
      checks,
      "PREMISE_NOT_NAMED",
      "This meter names no premise, so there is no address to send a worker to",
    );
  }

  const premiseSnap = await db.collection("premises").doc(premiseId).get();

  if (!premiseSnap.exists) {
    checks.push(check("PREMISE_LINK", false, premiseId));

    return result(
      checks,
      "PREMISE_NOT_FOUND",
      "The premise this meter belongs to cannot be found",
    );
  }

  const premiseLists = premiseHoldsMeter(premiseSnap.data() || {}, meterId);
  checks.push(check("PREMISE_LINK", premiseLists, premiseId));

  if (!premiseLists) {
    return result(
      checks,
      "PREMISE_DOES_NOT_LIST_METER",
      "The premise does not list this meter, so the two records disagree",
    );
  }

  return result(checks);
}
