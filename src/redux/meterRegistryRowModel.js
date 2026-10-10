// How a registry_meters document becomes a row the Meter Registry can draw.
//
// This map names every field it keeps, ONE AT A TIME. A field written to the
// meter and copied onto the registry row is still invisible on the page until
// it is named here. On 7 October 2026 that cost us the three Credit control
// numbers: 49 meters carried counts, all 49 of their rows carried the same
// numbers, and the page showed 0 for every one of them, because `counts` was
// not in this list. Nothing failed, because a missing count and a count of
// zero rendered identically.
//
// It lives apart from the api module so it can be tested without Firebase.
// The rules it serves: collection-shape-rules/asts.md 10.1 (ireps-rules) and
// DR-SCH-009 (ireps-schemas).

import { savedRegistryUnits } from "../utils/registryTrnUnits.js";

export function serializeRegistryDateValue(value) {
  if (!value || value === "NAv") return "NAv";

  if (typeof value === "string") return value;

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
  }

  if (typeof value?.toMillis === "function") {
    const date = new Date(value.toMillis());
    return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
  }

  if (typeof value?.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "NAv" : date.toISOString();
}

export function normalizeMeterRegistryRow(id, data) {
  const units = savedRegistryUnits({ unitName: data?.premiseUnitName, unitNo: data?.premiseUnitNo });
  return {
    id,

    meterId: data?.meterId || data?.id || id,
    meterNo: data?.meterNo || "NAv",
    meterType: data?.meterType || "NAv",
    meterKind: data?.meterKind || "NAv",
    meterPhase: data?.meterPhase || "NAv",
    visibility: data?.visibility || "NAv",
    status: data?.status || data?.statusState || "NAv",
    statusState: data?.statusState || data?.status || "NAv",
    statusDetail: data?.statusDetail || "NAv",

    erfId: data?.erfId || "NAv",
    erfNo: data?.erfNo || "NAv",

    premiseId: data?.premiseId || "NAv",
    premiseAddress: data?.premiseAddress || "NAv",
    premisePropertyType: data?.premisePropertyType || "NAv",
    premiseUnitName: units.unitName,
    premiseUnitNo: units.unitNo,

    lmPcode: data?.parents?.lmPcode || "NAv",
    wardPcode: data?.parents?.wardPcode || "NAv",

    createdByUser: data?.metadata?.createdByUser || "NAv",
    updatedByUser:
      data?.metadata?.updatedByUser || data?.metadata?.createdByUser || "NAv",
    updatedAt: serializeRegistryDateValue(
      data?.metadata?.updatedAt || data?.metadata?.createdAt,
    ),

    // What has happened to this meter: how many disconnections, how many
    // reconnections, and how many visits nobody could complete because they
    // could not reach it. The rules are in asts.md 10.1 and DR-SCH-009.
    //
    // This map names every field it keeps, one at a time, so a field added to
    // the meter and copied onto the registry row is still invisible until it
    // is named HERE. That is exactly what happened on 7 October: 49 meters and
    // all 49 of their rows held the right numbers while the Meter Registry
    // showed 0 for every one of them, because this line did not exist.
    counts: data?.counts || null,

    // The job already out on this meter (DR-R001 5). Named here for the same
    // reason `counts` is: a field the row carries and the mapper forgets is
    // written correctly and drawn nowhere.
    openJob: data?.openJob || null,
  };
}
