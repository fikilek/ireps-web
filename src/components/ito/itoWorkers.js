// Who the work can go to, and what the office is told about each of them.
// `DR-R001` 3 and 4.
//
// No JSX here on purpose: this is the model, and the model is tested.
//
// WHAT THE OFFICE IS SHOWN IS THE LAST THING THE SERVER WAS TOLD, not where
// the worker is now. That sentence is on the owner's approved card and it is
// the honest reading of `fwr_live_locations`: the phone reports, the server
// keeps the latest report, and between reports nobody knows. So every worker
// carries how long ago he was heard, and **a worker who has gone quiet still
// shows** — hiding him would be iREPS deciding he is not there, which it
// cannot know.
import {
  mainContractorsHolding,
  providerMayWorkMunicipality,
  readId,
} from "../serviceProviders/providerHierarchy.js";

import {
  ON_THE_MAP_RADIUS_M,
  formatDistance,
  isWithinRadius,
  metresBetween,
} from "./geoDistance.js";

const NAV = "NAv";

/**
 * A number, or `null` when there is not one.
 *
 * `Number(null)` and `Number("")` are both **0**, not NaN, so a plain
 * `Number.isFinite(Number(value))` reads a missing speed as standing still and
 * a worker never heard from as heard at the epoch. Absent and zero are
 * different facts; this is where they are kept apart.
 */
function strictNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const asNumber = Number(value);

  return Number.isFinite(asNumber) ? asNumber : null;
}

/**
 * Who may receive an individual transaction. `DR-R001` 4.
 *
 * **A field worker, and nobody else.** One of them, never a team and never a
 * service provider.
 *
 * `SPV` was here and the owner removed it on 10 October 2026: **supervisors
 * and managers do not normally go to the field.** The monitoring screen does
 * watch both, because knowing where a supervisor is is useful; being offered
 * one as the man to send to a meter is not. The two lists answer different
 * questions and must not be the same list.
 */
export const WORK_MAY_GO_TO = Object.freeze(["FWR"]);

const normaliseRole = (value) => String(value || "").trim().toUpperCase();

/**
 * Still, walking or driving, from the speed the phone already sends.
 *
 * The three words are the owner's, from the card he approved. The boundaries
 * between them are not settled anywhere and are set here: under half a metre a
 * second is standing (GPS jitter alone moves a stationary phone), and up to
 * about 8 km/h is walking pace. They are a reading of the number, not a rule —
 * if the owner wants them elsewhere they move here and nowhere else.
 */
export function describeMovement(speedMps) {
  const speed = strictNumber(speedMps);

  if (speed === null) return NAV;

  const mps = Math.max(0, speed);

  if (mps <= 0.5) return "Still";

  const kmh = Math.round(mps * 3.6);

  return `${mps <= 2.2 ? "Walking" : "Driving"}, ${kmh} km/h`;
}

/**
 * How long ago the server last heard from him, in the office's words.
 *
 * `null` for a worker who has never reported — **never "0 seconds ago"**,
 * which would say the opposite of the truth.
 */
export function describeHeard(capturedAtMs, nowMs) {
  const at = strictNumber(capturedAtMs);
  const now = strictNumber(nowMs);

  if (at === null || now === null) return "never heard from";

  const seconds = Math.max(0, Math.round((now - at) / 1000));

  if (seconds < 60) return `heard ${seconds} s ago`;

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `heard ${minutes} min ago`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `heard ${hours} h ${minutes % 60} min ago`;

  const days = Math.floor(hours / 24);

  return `heard ${days} d ago`;
}

/** Whether the last word from him is old enough to say so in the office. */
export function heardIsStale(capturedAtMs, nowMs, staleAfterMs = 15 * 60 * 1000) {
  const at = strictNumber(capturedAtMs);
  const now = strictNumber(nowMs);

  if (at === null || now === null) return true;

  return now - at > staleAfterMs;
}

/**
 * Every field worker the work could go to, with what is known about each.
 *
 * `jobsOpen` is **always `null`**, and that is not an oversight. The owner's
 * card shows how many jobs are open on a worker; nothing in iREPS holds that
 * number. The states exist (`ISSUED`, `REASSIGNED`, `ACCEPTED`, `IN_PROGRESS`)
 * and so does the assignee (`assignedTo`), so it could be counted — but no
 * count is written and no query runs. It therefore draws `NAv`, which under
 * the owner's rule is not a tidy placeholder but a flag: a gap shown rather
 * than hidden behind a plausible number, and a job to fix.
 */
/*
 * WHO MAY BE OFFERED THIS JOB. `DR-R001` 4.
 *
 * The hierarchy itself is NOT worked out here - it lives in
 * `components/serviceProviders/providerHierarchy.js`, the web's one well, which
 * mirrors the server's recursive `resolveServiceProviderMnc`. A first version of
 * this filter carried its own one-hop copy; it is gone, because a second reading
 * of the same fact is how the two come to disagree.
 *
 * THE QUESTION IS ABOUT THE METER, NOT THE OFFICE. The job is at a meter, in a
 * municipality, and whoever holds that municipality may work it. An earlier
 * version asked it of the signed-in user instead - and for the owner's own
 * account that returned NOBODY: he is SPU at Smars, which is the platform
 * operator and not a service provider at all, so no worker could ever match it.
 * The office user is not the authority on who may work a meter; the contract
 * recorded against the municipality is.
 */
export function buildWorkerChoices({
  users = [],
  liveLocations = [],
  meterPoint = null,
  nowMs = 0,
  lmPcode = null,
  serviceProviders = [],
} = {}) {
  const positionByUid = new Map();

  for (const row of liveLocations) {
    const uid = String(row?.uid || row?.id || "").trim();

    if (uid) positionByUid.set(uid, row);
  }

  const mainContractors = mainContractorsHolding(lmPcode, serviceProviders);

  const workers = users
    .filter((user) => WORK_MAY_GO_TO.includes(normaliseRole(user?.role)))
    // The municipality's main contractor and its subcontractors, at any depth,
    // and nobody else. A worker of another company is not available for this
    // meter - on TEST, Nki and Lwazi were being offered an Endumeni meter their
    // companies hold no contract for.
    //
    // `null` means the question could not be answered - no municipality on the
    // record, no provider on the worker, or no main contractor recorded for the
    // municipality. The worker then STAYS VISIBLE: the office can see him and
    // the gap is a job to fix, where hiding him would read as "he is not
    // available" when the truth is that iREPS does not know (`UI-R008`).
    .filter((user) => {
      const allowed = providerMayWorkMunicipality({
        providerId: user?.serviceProviderId || user?.serviceProvider?.id,
        lmPcode,
        providers: serviceProviders,
      });

      return allowed !== false;
    })
    .map((user) => {
      const uid = String(user?.uid || user?.id || "").trim();
      const live = positionByUid.get(uid) || null;
      const point = live?.location || null;
      const metres = metresBetween(point, meterPoint);
      // THROUGH THE WELL, not String().trim(). `usersApi` writes the literal
      // word `NAv` when a person's company is not recorded, so a bare read
      // keeps a GAP as a truthy id - it is in no main contractor's set, and
      // the flag below then told the office this man works for a
      // subcontractor on the strength of nothing at all. On LIVE, where the
      // main contractor has no subcontractors, that label cannot be true of
      // anybody.
      const providerId = readId(user?.serviceProviderId || user?.serviceProvider?.id);

      return {
        uid,
        name: String(user?.displayName || user?.name || user?.email || NAV).trim() || NAV,
        role: normaliseRole(user?.role),
        // A subcontractor's worker is named as one, because the office is
        // choosing a man, not a company, and should know which it is. Read from
        // the chain rather than from the office user's own provider: the office
        // may be neither the main contractor nor a subcontractor, and on LIVE
        // the main contractor has no subcontractors at all.
        subcontractor: Boolean(
          providerId && !mainContractors.has(providerId) && mainContractors.size,
        ),
        point: point && strictNumber(point.latitude) !== null ? point : null,
        metres,
        distance: formatDistance(metres),
        movement: describeMovement(live?.location?.speedMps),
        heard: describeHeard(live?.capturedAtMs, nowMs),
        heardIsStale: heardIsStale(live?.capturedAtMs, nowMs),
        // Nothing holds this. See the note above.
        jobsOpen: null,
        onTheMap: isWithinRadius(metres),
      };
    });

  // Nearest first, and a worker with no position sorts last rather than first.
  // Null is not zero: a phone that has never reported must never be offered as
  // the man standing closest to the meter.
  workers.sort((a, b) => {
    if (a.metres === null && b.metres === null) return a.name.localeCompare(b.name);
    if (a.metres === null) return 1;
    if (b.metres === null) return -1;

    return a.metres - b.metres;
  });

  const onTheMap = workers.filter((worker) => worker.onTheMap);

  return {
    // iREPS suggests the nearest. The screen says it is a suggestion, and the
    // office may pick anyone below it (DR-R001 3).
    suggested: workers.find((worker) => worker.metres !== null) || null,
    onTheMap,
    all: workers,
    radiusM: ON_THE_MAP_RADIUS_M,
  };
}
