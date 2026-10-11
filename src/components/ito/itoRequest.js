// The job the office sends. `DR-R001` 3.4, 3.5 and 4.
//
// No JSX: this builds the request, and the request is tested. The window that
// shows it going is a separate thing.
//
// THE ID IS THE PHONE'S ID. `ireps-mobile` settled the shape in
// `src/features/trns/trnId.js` and the owner settled the rule on 3 October
// 2026: one shape for every transaction, so a record can be placed from its id
// alone.
//
//   TRN_{work}_{milliseconds}_{meterType}_{wardPcode}_{erfNo}
//   TRN_MDCN_1791538506000_ELC_ZA5241006_5213
//
// The two repositories cannot share a module, so this mirrors that one. **The
// prefixes below must never drift from it** — an office disconnection and a
// field disconnection carrying different prefixes would split one kind of work
// into two in every report that reads an id. The tests pin them.
//
// AN ID CAN NEVER BE REWRITTEN, so what goes in it is permanent.

import { itoReasonProblem } from "./itoReasons.js";

/** Mirrors `TRN_PREFIX_BY_TYPE` in `ireps-mobile/src/features/trns/trnId.js`. */
export const TRN_PREFIX_BY_TYPE = Object.freeze({
  METER_DISCOVERY: "TRN_MDIS",
  METER_INSTALLATION: "TRN_MINST",
  METER_INSPECTION: "TRN_MINSP",
  METER_DISCONNECTION: "TRN_MDCN",
  METER_RECONNECTION: "TRN_MRCN",
  METER_REMOVAL: "TRN_MREM",
  METER_READING: "TRN_MREAD",
  METER_COMMISSIONING: "TRN_MCOM",
});

/** Which transaction each ITO button originates. `DR-R001` 3.2. */
export const TRN_TYPE_BY_WORK = Object.freeze({
  disconnect: "METER_DISCONNECTION",
  reconnect: "METER_RECONNECTION",
  inspect: "METER_INSPECTION",
  remove: "METER_REMOVAL",
  read: "METER_READING",
});

export function meterTypeCode(meterType) {
  const type = String(meterType || "").trim().toLowerCase();

  if (type === "water") return "WTR";
  if (type === "electricity") return "ELC";

  return "NAv";
}

/** Letters and digits survive, everything else goes. NAv where nothing is left. */
function idPart(value, fallback = "NAv") {
  const cleaned = String(value ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 12);

  return cleaned || fallback;
}

export function buildItoTrnId({ trnType, meterType, wardPcode, erfNo, atMs }) {
  const prefix = TRN_PREFIX_BY_TYPE[String(trnType || "").trim().toUpperCase()];

  if (!prefix) throw new Error(`No transaction prefix for ${trnType}`);

  return [
    prefix,
    Number(atMs),
    meterTypeCode(meterType),
    idPart(wardPcode),
    idPart(erfNo),
  ].join("_");
}

/**
 * What stops this being sent, in the office's own words - or `null`.
 *
 * ONE WELL, and the reason it has to be one: **the form must refuse exactly
 * what the server refuses** (owner, 10 October 2026). A form that lets
 * something through knowing the back will send it straight back wastes the
 * user's time and teaches him the form lies. The back is the safeguard, not
 * the first thing that tells you.
 *
 * So the Submit button and the request builder ask this same question. If
 * they asked separately they would drift, and the drift would show up as a
 * refusal nobody could have avoided.
 *
 * It mirrors `validateAssignment` in `functions/meterLifecycle/helpers.js`:
 * words, an image, or both - and a meter reading needs neither, because the
 * reading is the instruction.
 */
export function itoSendProblem({ work, reason, explanation, worker } = {}) {
  const reasonProblem = itoReasonProblem({ work, code: reason?.code, explanation });

  if (reasonProblem) return reasonProblem;

  if (!worker?.uid) return "Choose the field worker this goes to.";

  // The instruction is OPTIONAL. The reason above carries why the work is
  // being sent; words and an image elaborate it and neither is demanded.
  return null;
}

/**
 * The allocate the ITO page sends. `DR-R001` 3.4, 5.
 *
 * The transaction already exists - the button made it - so this carries only
 * what the page decided: who it goes to, why, in what words, and whatever is
 * attached. It goes to `onManageLifecycleInstructionCallable`, the office's
 * own callable, which validates it through the same well the create uses.
 */
export function buildItoAllocation({
  trnId,
  work,
  worker,
  reason,
  instructionWords,
  media = [],
  hasImage = false,
} = {}) {
  const trnType = TRN_TYPE_BY_WORK[String(work || "").toLowerCase()];

  if (!trnType) return { ok: false, message: "That is not a transaction iREPS sends." };

  const id = String(trnId || "").trim();

  if (!id) {
    return {
      ok: false,
      message:
        "This page does not know which transaction it is allocating, so nothing can be sent. Open it again from the meter's row.",
    };
  }

  const workerUid = String(worker?.uid || "").trim();

  const problem = itoSendProblem({
    work,
    reason,
    explanation: reason?.explanation,
    instructionWords,
    hasImage,
    worker: { uid: workerUid },
  });

  if (problem) return { ok: false, message: problem };

  const said = String(instructionWords ?? "").trim();

  return {
    ok: true,
    id,
    request: {
      action: "ALLOCATE",
      trnId: id,
      targets: [
        {
          type: "USER",
          id: workerUid,
          uid: workerUid,
          name: text(worker?.name),
        },
      ],
      instruction: {
        code: trnType,
        reason: {
          code: reason.code,
          words: text(reason.words),
          explanation: text(reason.explanation),
        },
        text: said || "NAv",
        mediaRequired: false,
      },
      media,
    },
  };
}

const text = (value) => {
  const said = String(value ?? "").trim();

  return said || "NAv";
};

/**
 * Everything `onCreateMeterLifecycleInstructionCallable` needs to write the
 * job, or the reason it cannot be built.
 *
 * It refuses rather than sending half a request: the server would refuse it
 * anyway, and a refusal the office can read beats `INVALID_PREMISE_ID`.
 */
/**
 * NAv IS NOT A VALUE. Owner, 30 September 2026: it marks a gap, so a reader
 * must never pass it on as if it were the thing it stands for. A registry row
 * writes "NAv" where a meter has no premise or no ward, and handing that
 * through would create a job whose premise is the word NAv - which exists and
 * cannot be found.
 */
export function notNav(value) {
  const said = String(value ?? "").trim();

  return said && said.toUpperCase() !== "NAV" ? said : "";
}

/**
 * The registry row, in the shape the ITO request builder reads.
 *
 * The row already holds everything the create needs - the meter, its premise,
 * its ERF, its municipality and its ward - so no second read is made for it.
 * The server builds the job's own access block from the ASSET (`DR-R001` 3.4,
 * `TR-R001`), so this is what the office is looking at, used to make the
 * number and to refuse early where a fact is missing.
 */
export function meterFromRegistryRow(row) {
  const astId = notNav(row?.meterId) || String(row?.id || "");

  return {
    id: astId,
    meterType: row?.meterType,
    ast: { astData: { astId } },
    accessData: {
      erfId: notNav(row?.erfId),
      erfNo: notNav(row?.erfNo),
      premise: {
        id: notNav(row?.premiseId),
        address: notNav(row?.premiseAddress),
      },
      parents: {
        lmPcode: notNav(row?.lmPcode),
        wardPcode: notNav(row?.wardPcode),
      },
    },
  };
}

/**
 * Everything the create callable needs to write the job, or the reason it
 * cannot be built.
 *
 * TWO SHAPES, ONE BUILDER. `DR-R001` 5, owner 11 October 2026: the button on
 * the meter's row CREATES the work, and the ITO page ALLOCATES it. The button
 * knows two facts - this meter, this kind of work - and nothing else, so with
 * `allocating: false` this builds a transaction with nobody on it and no
 * reason yet. The meter's own checks, the id and the access block are the
 * same either way, which is why they are not written twice.
 *
 * It refuses rather than sending half a request: the server would refuse it
 * anyway, and a refusal the office can read beats `INVALID_PREMISE_ID`.
 */
export function buildItoRequest({
  meter,
  work,
  worker,
  reason,
  instructionWords,
  media = [],
  hasImage = false,
  atMs,
  allocating = true,
} = {}) {
  const trnType = TRN_TYPE_BY_WORK[String(work || "").toLowerCase()];

  if (!trnType) return { ok: false, message: "That is not a transaction iREPS sends." };

  const astId = String(meter?.ast?.astData?.astId || meter?.id || "").trim();
  const premiseId = String(meter?.accessData?.premise?.id || "").trim();
  const parents = meter?.accessData?.parents || {};
  const workerUid = String(worker?.uid || "").trim();

  if (!astId) return { ok: false, message: "This meter has no id, so nothing can be sent." };

  // DR-R001 3: the work acts on a meter at a premise. A meter with no premise
  // is a defective record and becomes a job to fix, not a job to send.
  if (!premiseId) {
    return {
      ok: false,
      message:
        "This meter is not linked to a premise, so the worker would have nowhere to go. It has to be fixed before work can be sent here.",
    };
  }

  // Owner, 3 October 2026: every document iREPS writes carries its
  // municipality and its ward. Without them the job exists and cannot be
  // found - not in the registry, not in the report, not in any count.
  if (!parents.lmPcode || !parents.wardPcode) {
    return {
      ok: false,
      message:
        "This meter carries no workbase or no ward, so the job could not be found again once sent. The meter has to be fixed first.",
    };
  }

  // The worker and the reason are the ITO page's to supply. Demanding them
  // at the button would refuse the owner's own flow.
  const problem = allocating
    ? itoSendProblem({
        work,
        reason,
        explanation: reason?.explanation,
        instructionWords,
        hasImage,
        worker: { uid: workerUid },
      })
    : null;

  if (problem) return { ok: false, message: problem };

  const said = String(instructionWords ?? "").trim();

  const id = buildItoTrnId({
    trnType,
    meterType: meter?.meterType,
    wardPcode: parents.wardPcode,
    erfNo: meter?.accessData?.erfNo,
    atMs,
  });

  return {
    ok: true,
    id,
    request: {
      id,
      trnType,
      astId,
      premiseId,
      ast: meter?.ast || { astData: { astId } },
      accessData: {
        ...(meter?.accessData || {}),
        trnType,
        // NOBODY HAS BEEN THERE YET. The meter's own block carries the access
        // recorded when it was discovered - a worker really did reach it that
        // day - and copying it wholesale made an ISSUED job state as fact
        // something that has not happened. Found in the owner's first office
        // job, 10 October 2026: hasAccess "yes" on work nobody had done.
        //
        // Access is settled at the service point by the worker and nowhere
        // else. Until he settles it there is nothing to write, and where
        // there is nothing to write iREPS writes NAv.
        access: { hasAccess: "NAv", reason: "NAv" },
      },
      assignment: {
        // An individual request goes to exactly one field worker, never to a
        // team and never to a service provider (DR-R001 4) - and to NOBODY
        // while it is only created. A name here would make the job somebody's
        // before the office had chosen him.
        targets: allocating
          ? [
              {
                type: "USER",
                id: workerUid,
                uid: workerUid,
                name: text(worker?.name),
              },
            ]
          : [],
        instruction: {
          // The server requires this to equal the transaction type, which is
          // why the reason needs a field of its own below.
          code: trnType,
          // DR-R001 3.4 (1.10.1): the reason is stored as a CODE as well as
          // words, because a wording that changes leaves old records
          // uncountable and a code survives it - and this wording is changing
          // now, from Credit Control Instruction and Non Payment to Client
          // instruction and Customer instruction.
          // Nothing has been chosen yet on a create, and where there is
          // nothing to write iREPS writes NAv - which the server refuses as
          // a reason, so this cannot be allocated until the page says why.
          reason: {
            code: allocating ? reason.code : "NAv",
            words: text(allocating ? reason.words : ""),
            explanation: text(allocating ? reason.explanation : ""),
          },
          // The words the worker reads, which the server requires for
          // everything but a meter reading. It is `text`, not `note`.
          text: said || "NAv",
          mediaRequired: false,
        },
      },
      media,
    },
  };
}
