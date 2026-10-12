// The ITO monitoring screen, per worker. `DR-R001` 9.1.
//
// WHAT THIS IS WATCHING. Not the work - the record of it. `DR-R001` 9: "What
// the office sees is the last thing the server was told, not what the worker
// is doing. A worker can be standing at the meter with the job finished
// while the office still reads ACCEPTED." So every row carries when the
// worker was last heard from, and nothing here implies more than it knows.
//
// ONLY THE OFFICE CHANNEL. Field work is on the device until it is submitted
// and arrives finished; there is no in-between state to watch, so it never
// appears here. It is read in the TRN Registry.
//
// NO INVENTED NUMBER. A job issued before `workflow.issuedAt` was written has
// no age, and reads `NAv` - not `0`, not a dash, and never the record's
// creation time standing in for it (`UI-R008`).

import { describeHeard } from "../../../components/ito/itoWorkers.js";
import {
  ITO_ACCEPTED_STATES,
  ITO_CREATED_STATES,
  ITO_ISSUED_STATES,
  ITO_TRN_TYPES,
  NAV,
  countRefusals,
  readOriginChannel,
  readTrnType,
  readWorkflowState,
} from "../dashboard/operationsSummary.js";

export { ITO_TRN_TYPES };

/** The states a job can be in on this screen. `DR-R001` 5. */
/**
 * `DELETED` is a state this screen knows about, and it is the only screen
 * that does. It has no column in the per-worker table - nobody holds a job
 * in the bin - and its own view instead (`DR-R001` 5.5, 9.2).
 */
export const ITO_DELETED_STATE = "DELETED";

export const ITO_STATES = Object.freeze([
  { key: "CREATED", label: "Created" },
  { key: "ISSUED", label: "Issued" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "COMPLETED", label: "Completed" },
]);

/** The short letters the office knows each transaction by. `DR-R001` 3.2. */
export const ITO_TRN_LETTERS = Object.freeze({
  METER_DISCONNECTION: "DCN",
  METER_RECONNECTION: "RCN",
  METER_INSPECTION: "INSP",
  METER_REMOVAL: "REM",
  METER_READING: "MREAD",
});

const text = (value) => String(value ?? "").trim();
const upper = (value) => text(value).toUpperCase();

/** Which of the four columns a job sits in, or null when it sits in none. */
export function columnFor(state) {
  const value = upper(state);

  if (ITO_ISSUED_STATES.includes(value)) return "issued";
  if (ITO_ACCEPTED_STATES.includes(value)) return "accepted";
  if (value === "COMPLETED") return "completed";

  return null;
}

/**
 * Is this job waiting in the pool with nobody on it?
 *
 * `CREATED` has no column on the per-worker table on purpose: a job nobody
 * holds is nobody's, so it does not belong on a table about workers. It is
 * read in the Created view instead (`DR-R001` 9.2).
 */
export function isWaitingToBeGivenOut(trn) {
  return ITO_CREATED_STATES.includes(readWorkflowState(trn));
}

/**
 * The one worker a job is sitting with, or null.
 *
 * THREE SHAPES REACH THIS SCREEN and it must read all of them. The raw
 * document keeps `assignment.targets`; `normalizeTrnDoc` flattens the first
 * target to `target` / `targetType` / `targetId` / `targetName`; and the
 * meter's own marker carries `assignedTo`. Reading one of the three put
 * every job in Ward 6 under "Not with a worker" on the first build.
 *
 * `valueOrNav` turns a missing value into the literal string "NAv", so that
 * is an absence here, not an id.
 */
export function holderOf(trn) {
  const present = (value) => {
    const v = text(value);

    return v && upper(v) !== "NAV" ? v : "";
  };

  const named = (id, name) => (id ? { id, name: present(name) || NAV } : null);

  const targets = Array.isArray(trn?.assignment?.targets) ? trn.assignment.targets : [];
  const user = targets.find((target) => upper(target?.type) === "USER");

  if (user) {
    const found = named(present(user.id) || present(user.uid), user.name);

    if (found) return found;
  }

  // normalizeTrnDoc's flattened first target.
  if (upper(trn?.targetType || trn?.target?.type) === "USER") {
    const found = named(
      present(trn?.targetId) || present(trn?.target?.id) || present(trn?.target?.uid),
      trn?.targetName || trn?.target?.name,
    );

    if (found) return found;
  }

  const assigned = trn?.assignedTo || trn?.trnActiveLifecycle?.assignedTo;

  return named(present(assigned?.id) || present(assigned?.uid), assigned?.name);
}

function issuedAtMs(trn) {
  const raw = trn?.issuedAt ?? trn?.workflow?.issuedAt;

  if (!raw) return null;

  const ms = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));

  return Number.isFinite(ms) ? ms : null;
}

/**
 * Office-issued individual work, narrowed to what the office asked to see.
 *
 * An empty tick list means every one of them, which is what the filter bar
 * shows when nothing is ticked — not nothing at all.
 */
export function selectItoWork(
  trns,
  { trnTypes = [], states = [], deleted = "exclude" } = {},
) {
  const wantedTypes = trnTypes.length ? trnTypes.map(upper) : null;
  const wantedStates = states.length ? states.map(upper) : null;

  return (Array.isArray(trns) ? trns : []).filter((trn) => {
    if (readOriginChannel(trn) !== "OFFICE") return false;

    // EVERY READER EXCLUDES DELETED (`DR-R001` 5.5), and the one screen that
    // must see the bin asks for it BY NAME here rather than re-filtering the
    // raw transactions itself. Raw re-filtering would lose the three things
    // this function also does - the office-channel narrowing, the ITO-type
    // narrowing, and nothing-ticked-means-everything - and the two copies
    // would drift.
    //
    //   "exclude" - the default, and what every other view wants
    //   "only"    - the Deleted view, which is the only way to restore
    const isDeleted = readWorkflowState(trn) === "DELETED";

    if (deleted === "only") {
      if (!isDeleted) return false;
    } else if (isDeleted) {
      return false;
    }

    const type = readTrnType(trn);

    if (!ITO_TRN_TYPES.includes(type)) return false;
    if (wantedTypes && !wantedTypes.includes(type)) return false;

    if (wantedStates) {
      const state = readWorkflowState(trn);
      const named = ITO_CREATED_STATES.includes(state)
        ? "CREATED"
        : (columnFor(state) || "").toUpperCase();

      if (!named || !wantedStates.includes(named)) return false;
    }

    return true;
  });
}

// What a worker holds, or held. A refusal is not among them: it is
// something he did, counted apart and shown outside his total.
const emptyCounts = () => ({ issued: 0, accepted: 0, completed: 0 });

/**
 * A row per worker: what he holds, how it is spread across the four states,
 * the oldest job still waiting on him, and when he was last heard from.
 *
 * A job whose holder is not in the user directory still makes a row. Work is
 * not dropped because a person record is missing — that is how a job nobody
 * is watching becomes a job nobody knows about.
 */
export function buildWorkerRows({ trns, usersById = {}, liveByUid = {}, nowMs } = {}) {
  const byWorker = new Map();
  const refusalsByUid = new Map();

  const bucketFor = (uid, name) => {
    if (!byWorker.has(uid)) {
      byWorker.set(uid, {
        uid,
        name,
        counts: emptyCounts(),
        total: 0,
        types: new Map(),
        unaccounted: [],
        oldestIssuedMs: null,
      });
    }

    const found = byWorker.get(uid);

    if (!found.name || found.name === NAV) found.name = name;

    return found;
  };

  const unheld = {
    uid: "",
    name: "Not with a worker",
    counts: emptyCounts(),
    total: 0,
    types: new Map(),
    unaccounted: [],
    oldestIssuedMs: null,
    unheld: true,
  };

  let unheldUsed = false;

  for (const trn of Array.isArray(trns) ? trns : []) {
    // A refusal is something a worker DID, not work he holds. It is counted
    // against him wherever the job has since gone - and a refused job has
    // gone to CREATED with nobody on it (`DR-R001` 5.1), so counting it from
    // the job's holder would count nothing at all.
    for (const refusal of refusalsOn(trn)) {
      const uid = text(refusal?.uid);

      if (!uid) continue;

      const held = refusalsByUid.get(uid) || { count: 0, name: text(refusal?.name) || NAV, jobs: [] };

      held.count += 1;

      if (held.jobs.length < 25) {
        held.jobs.push({
          trnId: text(trn?.trnId || trn?.id) || NAV,
          meterNo: text(trn?.astNo) || NAV,
          erfNo: text(trn?.erfNo) || NAV,
          letter: ITO_TRN_LETTERS[readTrnType(trn)] || NAV,
          reason: text(refusal?.reason) || NAV,
        });
      }

      refusalsByUid.set(uid, held);
    }

    // A job waiting in the pool is nobody's, so it is on nobody's row. It is
    // read in the Created view instead (`DR-R001` 9.2).
    if (isWaitingToBeGivenOut(trn)) continue;

    const column = columnFor(readWorkflowState(trn));
    const type = readTrnType(trn);
    const holder = holderOf(trn);

    const target = holder ? bucketFor(holder.id, holder.name) : unheld;

    if (!holder) unheldUsed = true;

    target.types.set(type, (target.types.get(type) || 0) + 1);

    // The Total is the sum of the columns beside it, by construction - owner,
    // 11 October 2026. A row that does not add up is the fault found on his
    // phone that morning, so it cannot be built that way here.
    if (column) {
      target.counts[column] += 1;
      target.total += 1;
    } else {
      target.unaccounted.push(readWorkflowState(trn) || "(no state)");
    }

    // Only work still waiting on him has an age worth showing. A completed
    // job has stopped waiting.
    if (column === "issued" || column === "accepted") {
      const ms = issuedAtMs(trn);

      if (ms !== null && (target.oldestIssuedMs === null || ms < target.oldestIssuedMs)) {
        target.oldestIssuedMs = ms;
      }
    }
  }

  // A worker who holds nothing but has refused something still gets a row.
  // Dropping him would hide the refusal with him.
  for (const uid of refusalsByUid.keys()) {
    bucketFor(uid, refusalsByUid.get(uid).name);
  }

  const now = Number.isFinite(nowMs) ? nowMs : null;

  const toRow = (worker) => {
    const user = usersById?.[worker.uid] || null;
    const live = liveByUid?.[worker.uid] || null;
    const capturedAt = live?.capturedAtMs ?? live?.capturedAt ?? null;
    const refused = refusalsByUid.get(worker.uid) || { count: 0, jobs: [] };

    return {
      uid: worker.uid,
      name: text(user?.name) || worker.name || NAV,
      role: text(user?.role) || NAV,
      // The board says "Subcontractor" here. Nothing records which provider
      // is the main contractor, so his provider's NAME is shown instead of a
      // classification that would have to be guessed.
      provider: text(user?.serviceProviderName) || "",
      transactions: lettersFor(worker.types),
      ...worker.counts,
      total: worker.total,
      refused: refused.count,
      refusedJobs: refused.jobs,
      unaccounted: worker.unaccounted,
      oldestWaiting: describeAge(worker.oldestIssuedMs, now),
      oldestWaitingMs: worker.oldestIssuedMs,
      lastHeard: describeHeard(toMs(capturedAt), now ?? Date.now()),
      unheld: Boolean(worker.unheld),
    };
  };

  const rows = Array.from(byWorker.values()).map(toRow);

  // Work with no holder is its own row, never dropped - the same reason the
  // per-area view gives "not in a geofence" a row: drop it and the rows stop
  // adding up to the figures above them, and the gap becomes invisible.
  if (unheldUsed) rows.push(toRow(unheld));

  return rows.sort(byMostWaiting);
}

/** Every refusal written on a job. `DR-R001` 5.7. */
export function refusalsOn(trn) {
  const written = trn?.workflow?.rejections ?? trn?.rejections;

  if (Array.isArray(written)) return written;

  // Records rejected before 11 October 2026 carry one reason and no list.
  if (countRefusals(trn) === 0) return [];

  return [
    {
      uid: text(trn?.acceptedRejectedUid ?? trn?.assignment?.acceptedRejectedUid),
      name: text(trn?.acceptedRejectedUser ?? trn?.assignment?.acceptedRejectedUser) || NAV,
      reason: text(trn?.rejectReason ?? trn?.assignment?.rejectReason) || NAV,
    },
  ];
}

function byMostWaiting(a, b) {
  const waiting = b.issued + b.accepted - (a.issued + a.accepted);

  if (waiting !== 0) return waiting;

  return String(a.name).localeCompare(String(b.name));
}

function toMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));

  return Number.isFinite(ms) ? ms : null;
}

export function lettersFor(counts) {
  // The board writes them with their counts - "DCN 6 · RCN 2" - so the
  // office reads what he is carrying, not merely which kinds.
  const entries = counts instanceof Map ? Array.from(counts.entries()) : Object.entries(counts || {});

  const parts = entries
    .map(([type, n]) => [ITO_TRN_LETTERS[upper(type)], Number(n) || 0])
    .filter(([letter]) => letter)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([letter, n]) => `${letter} ${n}`);

  return parts.length ? parts.join(" · ") : NAV;
}

/**
 * How long the oldest job has been waiting, in the office's own plain words.
 *
 * `NAv` when it cannot be known — a job issued before the stamp was written
 * has no age, and the record's creation time is not a substitute for one.
 */
export function describeAge(sinceMs, nowMs) {
  if (sinceMs === null || sinceMs === undefined) return NAV;
  if (!Number.isFinite(nowMs)) return NAV;

  const minutes = Math.floor((nowMs - sinceMs) / 60000);

  if (minutes < 0) return NAV;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${hours} h`;

  return `${Math.floor(hours / 24)} d`;
}

/**
 * What is counted but has no column, said in words beneath the table.
 *
 * Cancelled jobs, and any state nobody gave a column. The alternative is the
 * fault of 11 October: counted in one place, drawn in none, with nothing
 * saying why the numbers would not add up.
 */
export function monitoringAside(rows) {
  const list = Array.isArray(rows) ? rows : [];

  const refusals = list.reduce((n, row) => n + (Number(row?.refused) || 0), 0);
  const unplaced = Array.from(new Set(list.flatMap((row) => row?.unaccounted || [])));

  const notes = [];

  // A refusal is not a place work sits, so it has no column and is said in
  // words instead of being dropped (`DR-R001` 5.1).
  if (refusals > 0) notes.push(`${refusals} ${refusals === 1 ? "refusal" : "refusals"} in this ward`);
  if (unplaced.length) notes.push(`not in any column: ${unplaced.join(", ")}`);

  return notes;
}

export function summariseWorkers(rows) {
  const totals = { ...emptyCounts(), workers: 0, total: 0, refused: 0, oldestWaitingMs: null };

  for (const row of Array.isArray(rows) ? rows : []) {
    totals.issued += row.issued || 0;
    totals.accepted += row.accepted || 0;
    totals.completed += row.completed || 0;
    totals.refused += row.refused || 0;
    totals.total += row.total || 0;

    if (!row.unheld) totals.workers += 1;

    if (
      row.oldestWaitingMs !== null &&
      row.oldestWaitingMs !== undefined &&
      (totals.oldestWaitingMs === null || row.oldestWaitingMs < totals.oldestWaitingMs)
    ) {
      totals.oldestWaitingMs = row.oldestWaitingMs;
    }
  }

  return totals;
}

/**
 * What the ticked transactions say, in the office's own words.
 *
 * Used for the Clear button's count and for the line beside it, so the two
 * can never name different things.
 */
export function describeTicks(trnTypes) {
  const letters = (Array.isArray(trnTypes) ? trnTypes : [])
    .map((type) => ITO_TRN_LETTERS[upper(type)])
    .filter(Boolean);

  if (!letters.length) return { count: 0, words: "", showing: "Nothing ticked shows every transaction." };

  // "DCN", "DCN and RCN", "DCN, RCN and INSP" - read aloud the way the
  // office would say it, not joined with commas to the end.
  const words =
    letters.length === 1
      ? letters[0]
      : `${letters.slice(0, -1).join(", ")} and ${letters[letters.length - 1]}`;

  return { count: letters.length, words, showing: `Showing ${words}.` };
}

/**
 * HOW LONG IT HAS BEEN WAITING. `DR-R001` 9.2.
 *
 * From when it came BACK to the pool, which is what `workflow.
 * returnedToCreatedAt` records - written by every move that lands in
 * `Created`. It is not `issuedAt`: that is when the job was last given OUT,
 * so a job cancelled after three days would read as having waited three days
 * when it came back a minute ago. A plausible number covering a fact nobody
 * held is what `UI-R008` refuses.
 *
 * A job made at the button and never allocated has neither stamp. It has
 * been waiting since it was made, and `metadata.createdAt` is the right
 * answer for that one - it is not a substitute for anything, it IS when the
 * waiting began.
 */
export function waitingSinceMs(trn) {
  const candidates = [
    trn?.returnedToCreatedAt,
    trn?.workflow?.returnedToCreatedAt,
    // Never allocated: the record's own birth is when the waiting started.
    trn?.createdAt,
    trn?.metadata?.createdAt,
  ];

  for (const candidate of candidates) {
    const ms = Date.parse(String(candidate ?? ""));

    if (Number.isFinite(ms)) return ms;
  }

  return null;
}

/** One row per job waiting to be given out. `DR-R001` 9.2. */
export function buildWaitingRows(work, nowMs) {
  return (Array.isArray(work) ? work : [])
    .filter(isWaitingToBeGivenOut)
    .map((trn) => {
      const refusals = refusalsOn(trn);
      const last = refusals[refusals.length - 1] || null;

      return {
        id: String(trn?.trnId || trn?.id || ""),
        letter: ITO_TRN_LETTERS[readTrnType(trn)] || NAV,
        meterNo: String(trn?.astNo || NAV),
        erfNo: String(trn?.erfNo || NAV),
        address: String(trn?.address || NAV),
        refusals,
        // Why it is here rather than with somebody. A job made and never
        // allocated has nothing to say, and says NAv rather than inventing
        // a reason it came back.
        why: last ? `Refused by ${last.name}: ${last.reason}` : NAV,
        waitingSince: describeAge(waitingSinceMs(trn), nowMs),
        waitingSinceMs: waitingSinceMs(trn),
      };
    })
    .sort((a, b) => String(a.meterNo).localeCompare(String(b.meterNo)));
}

/** One row per job in the bin, and what it would take to bring it back. */
export function buildDeletedRows(work, nowMs) {
  return (Array.isArray(work) ? work : [])
    .map((trn) => ({
      id: String(trn?.trnId || trn?.id || ""),
      letter: ITO_TRN_LETTERS[readTrnType(trn)] || NAV,
      meterNo: String(trn?.astNo || NAV),
      erfNo: String(trn?.erfNo || NAV),
      address: String(trn?.address || NAV),
      why: text(trn?.deleteReason ?? trn?.workflow?.deleteReason) || NAV,
      by: text(trn?.deletedByUser ?? trn?.workflow?.deletedByUser) || NAV,
      binnedFor: describeAge(
        Date.parse(String(trn?.deletedAt ?? trn?.workflow?.deletedAt ?? "")) || null,
        nowMs,
      ),
    }))
    .sort((a, b) => String(a.meterNo).localeCompare(String(b.meterNo)));
}
