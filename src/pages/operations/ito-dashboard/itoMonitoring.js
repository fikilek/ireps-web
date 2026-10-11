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
  ITO_ISSUED_STATES,
  ITO_TRN_TYPES,
  NAV,
  readOriginChannel,
  readTrnType,
  readWorkflowState,
} from "../dashboard/operationsSummary.js";

export { ITO_TRN_TYPES };

/** The states the office can filter by — the request's own words. */
export const ITO_STATES = Object.freeze([
  { key: "ISSUED", label: "Issued" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "REJECTED", label: "Rejected" },
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
  if (value === "REJECTED") return "rejected";
  if (value === "COMPLETED") return "completed";

  return null;
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
export function selectItoWork(trns, { trnTypes = [], states = [] } = {}) {
  const wantedTypes = trnTypes.length ? trnTypes.map(upper) : null;
  const wantedStates = states.length ? states.map(upper) : null;

  return (Array.isArray(trns) ? trns : []).filter((trn) => {
    if (readOriginChannel(trn) !== "OFFICE") return false;

    const type = readTrnType(trn);

    if (!ITO_TRN_TYPES.includes(type)) return false;
    if (wantedTypes && !wantedTypes.includes(type)) return false;

    if (wantedStates) {
      const column = columnFor(readWorkflowState(trn));

      if (!column || !wantedStates.includes(column.toUpperCase())) return false;
    }

    return true;
  });
}

const emptyCounts = () => ({ issued: 0, accepted: 0, rejected: 0, completed: 0 });

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
  const unheld = { counts: emptyCounts(), total: 0, types: new Set(), oldestIssuedMs: null };

  for (const trn of Array.isArray(trns) ? trns : []) {
    const column = columnFor(readWorkflowState(trn));
    const type = readTrnType(trn);
    const holder = holderOf(trn);
    const bucket = holder ? byWorker : null;

    const target = holder
      ? bucket.get(holder.id) || {
          uid: holder.id,
          name: holder.name,
          counts: emptyCounts(),
          total: 0,
          types: new Set(),
          oldestIssuedMs: null,
        }
      : unheld;

    target.total += 1;
    target.types.add(type);

    if (column) target.counts[column] += 1;

    // Only work still waiting on him has an age worth showing. A completed
    // or rejected job has stopped waiting.
    if (column === "issued" || column === "accepted") {
      const ms = issuedAtMs(trn);

      if (ms !== null && (target.oldestIssuedMs === null || ms < target.oldestIssuedMs)) {
        target.oldestIssuedMs = ms;
      }
    }

    if (holder) byWorker.set(holder.id, target);
  }

  const now = Number.isFinite(nowMs) ? nowMs : null;

  const rows = Array.from(byWorker.values()).map((worker) => {
    const user = usersById?.[worker.uid] || null;
    const live = liveByUid?.[worker.uid] || null;
    const capturedAt = live?.capturedAtMs ?? live?.capturedAt ?? null;

    return {
      uid: worker.uid,
      name: text(user?.name) || worker.name || NAV,
      role: text(user?.role) || NAV,
      transactions: lettersFor(worker.types),
      ...worker.counts,
      total: worker.total,
      oldestWaiting: describeAge(worker.oldestIssuedMs, now),
      oldestWaitingMs: worker.oldestIssuedMs,
      lastHeard: describeHeard(toMs(capturedAt), now ?? Date.now()),
    };
  });

  // Work with no holder is its own row, never dropped. The same reason the
  // per-area view gives "not in a geofence" a row: drop it and the rows stop
  // adding up to the total above them, and the gap becomes invisible.
  if (unheld.total > 0) {
    rows.push({
      uid: "",
      name: "Not with a worker",
      role: NAV,
      transactions: lettersFor(unheld.types),
      ...unheld.counts,
      total: unheld.total,
      oldestWaiting: describeAge(unheld.oldestIssuedMs, now),
      oldestWaitingMs: unheld.oldestIssuedMs,
      lastHeard: NAV,
      unheld: true,
    });
  }

  return rows.sort(byMostWaiting);
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

export function lettersFor(types) {
  const list = Array.from(types || [])
    .map((type) => ITO_TRN_LETTERS[upper(type)])
    .filter(Boolean);

  return list.length ? Array.from(new Set(list)).join(" ") : NAV;
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

/** The four figures above the table, and the oldest job anywhere in them. */
export function summariseWorkers(rows) {
  const totals = { ...emptyCounts(), workers: 0, oldestWaitingMs: null };

  for (const row of Array.isArray(rows) ? rows : []) {
    totals.issued += row.issued || 0;
    totals.accepted += row.accepted || 0;
    totals.rejected += row.rejected || 0;
    totals.completed += row.completed || 0;

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
