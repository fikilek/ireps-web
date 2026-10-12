// What the office may do to a job after it exists, and what it needs to say.
// `DR-R001` 5.5, 5.
//
// NO FIREBASE HERE, deliberately: everything in this file is a decision, and
// a decision has to be testable. The call itself is in `manageItoWork.js`,
// which imports the app and so cannot be imported by a test at all - the same
// split `itoRequest.js` and `sendItoRequest.js` already use.
//
// Delete it while it waits in the pool, bring it back out of the bin, or take
// it off the worker it is with. All three are moves on the state machine and
// all three go to the same callable, `onManageLifecycleInstructionCallable`,
// which checks them against the machine and refuses in the machine's own
// words.
//
// NO WEB CODE HAS EVER CALLED THAT CALLABLE. It has existed since the office
// lane was built, with REASSIGN and CANCEL, and only the phone has ever used
// it. So this module is the web's first caller, and the three actions below
// are deliberately the only three it offers: an allocate goes through the ITO
// page, which has a whole screen's worth of context behind it.

/**
 * What the server refused, in the office's own words.
 *
 * The state machine's own refusals are passed through untouched: they already
 * say what the state CAN take instead of only no - *"A transaction that is
 * ACCEPTED cannot take 'delete'. From here it can only take: cancel,
 * execute."* Rewriting those would lose the half that tells you what to do.
 */
export const REFUSALS = Object.freeze({
  DELETE_REASON_REQUIRED: "Say why this work is being deleted.",
  CANCEL_REASON_REQUIRED: "Say why the office is taking this work back.",
  ACTIVE_LCT_ALREADY_EXISTS:
    "This meter already has an open job of this kind, so the deleted one cannot come back. Finish or cancel that one first.",
  TRN_NOT_FOUND:
    "This transaction is no longer in iREPS. Refresh the screen - somebody else may have acted on it.",
  UNAUTHORIZED_LCT_MANAGER:
    "You cannot do this. Only a manager, or a supervisor of the main contractor, can.",
  UNKNOWN_TRN_STATE:
    "This job carries a state iREPS does not know, so nothing can be done to it from here. It is a fault in the record.",
  UNAUTHENTICATED: "You are signed out. Sign in and try again.",
  INVALID_MANAGE_ACTION: "That is not something iREPS does to a transaction.",
});

/**
 * Who may take work off a worker, bin a job, or bring one back.
 * `DR-R001` 5.5: a supervisor and a manager, and nobody else.
 *
 * The route into the monitoring screen admits a supervising user and an
 * administrator as READERS, so the screen is not the gate - this is. They see
 * the screen with no buttons rather than buttons that refuse.
 */
export const ITO_MANAGE_ROLES = Object.freeze(["SPV", "MNG"]);

export function canManageItoWork(role) {
  return ITO_MANAGE_ROLES.includes(String(role || "").trim().toUpperCase());
}

/** The three moves this screen offers, and what each needs. */
export const ITO_MANAGE_ACTIONS = Object.freeze({
  DELETE: {
    action: "DELETE",
    verb: "Delete",
    // `DR-R001` 5.1: a rejection needs a reason, and so does a cancellation
    // and a deletion.
    needsReason: true,
    reasonKey: "deleteReason",
    reasonLabel: "Why is this being deleted?",
  },
  RESTORE: {
    action: "RESTORE",
    verb: "Restore",
    // Not on 5.1's list, so it is not demanded - but it is recorded when
    // given.
    needsReason: false,
    reasonKey: "restoreReason",
    reasonLabel: "Why is it coming back? (optional)",
  },
  CANCEL: {
    action: "CANCEL",
    verb: "Take it back",
    needsReason: true,
    reasonKey: "cancelReason",
    reasonLabel: "Why is the office taking this work back?",
  },
});

/**
 * NAv IS NOT A REASON (`DR-R001` 1.12.9). The form refuses exactly what the
 * server refuses, so nothing is ever sent that was going to come straight
 * back - and the server strips `NAv` the same way.
 */
export function saidReason(value) {
  return String(value ?? "")
    .trim()
    .replace(/^NAv$/i, "")
    .trim();
}

/** What stops this being sent, in words - or `null`. */
export function manageProblem({ action, reason } = {}) {
  const move = ITO_MANAGE_ACTIONS[String(action || "").toUpperCase()];

  if (!move) return "That is not something iREPS does to a transaction.";
  if (move.needsReason && !saidReason(reason)) return move.reasonLabel;

  return null;
}

/**
 * Builds the request, or says why it cannot be built.
 *
 * It refuses rather than sending half a request: the server would refuse it
 * anyway, and a refusal the office can read beats a field name.
 */
export function buildManageRequest({ action, trnId, reason } = {}) {
  const key = String(action || "").toUpperCase();
  const move = ITO_MANAGE_ACTIONS[key];
  const id = String(trnId || "").trim();

  if (!move) return { ok: false, message: "That is not something iREPS does to a transaction." };

  if (!id) {
    return {
      ok: false,
      message: "No transaction was named, so nothing has been sent. Refresh the screen and try again.",
    };
  }

  const problem = manageProblem({ action: key, reason });

  if (problem) return { ok: false, message: problem };

  return {
    ok: true,
    request: {
      action: key,
      trnId: id,
      [move.reasonKey]: saidReason(reason) || "NAv",
    },
  };
}
