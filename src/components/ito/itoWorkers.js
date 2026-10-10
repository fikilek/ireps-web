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
export function buildWorkerChoices({
  users = [],
  liveLocations = [],
  meterPoint = null,
  nowMs = 0,
  mainContractorId = null,
} = {}) {
  const positionByUid = new Map();

  for (const row of liveLocations) {
    const uid = String(row?.uid || row?.id || "").trim();

    if (uid) positionByUid.set(uid, row);
  }

  const workers = users
    .filter((user) => WORK_MAY_GO_TO.includes(normaliseRole(user?.role)))
    .map((user) => {
      const uid = String(user?.uid || user?.id || "").trim();
      const live = positionByUid.get(uid) || null;
      const point = live?.location || null;
      const metres = metresBetween(point, meterPoint);
      const providerId = String(
        user?.serviceProviderId || user?.serviceProvider?.id || "",
      ).trim();

      return {
        uid,
        name: String(user?.displayName || user?.name || user?.email || NAV).trim() || NAV,
        role: normaliseRole(user?.role),
        // A subcontractor's worker is named as one, because the office is
        // choosing a man, not a company, and should know which it is.
        subcontractor: Boolean(
          mainContractorId && providerId && providerId !== String(mainContractorId),
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
