// Sending the job. `DR-R001` 3.5.
//
// The window shows what is actually happening, not a performance of it.
//
// `DR-R001` 3.5 names three steps - checking the meter, writing the job,
// updating the registry - from a drawing made before the server was known.
// The server does all three in ONE call and tells us nothing in between, so
// drawing three ticks appearing one after another would be theatre: lights
// moving on a dashboard that is not wired to anything. What can honestly be
// shown is the attachment going up, which really does finish first, and then
// the job being written. Where the rule and the thing diverge, the thing
// wins and the rule is told.
//
// THE JOB AND THE METER ARE WRITTEN TOGETHER OR NEITHER IS, which is why
// there is no Cancel once it starts and why a failure can say "nothing was
// changed" and mean it: the server's write is one transaction.

import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { functions, storage } from "../../firebase";

/**
 * What the server refused, said in the office's own words.
 *
 * The server's own messages name fields: "assignment.instruction.text is
 * required" is true and is no use to the person reading it. The code stays,
 * small, beside the words - the office can quote it and the next person can
 * find it - but the sentence is one somebody can act on.
 */
const REFUSALS = Object.freeze({
  INVALID_ASSIGNMENT_INSTRUCTION_TEXT:
    "Say what the worker must do. Your words reach his form exactly as you type them.",
  INVALID_ASSIGNMENT_INSTRUCTION_CODE:
    "This work has no instruction behind it, so it cannot be sent from the office.",
  ASSIGNMENT_INSTRUCTION_MISMATCH:
    "The instruction does not match the work being sent. This is a fault in iREPS, not in what you typed.",
  ACTIVE_LCT_ALREADY_EXISTS:
    "This meter already has an open job of this kind. Finish or cancel that one before issuing another.",
  TRN_ALREADY_EXISTS: "This job has already been sent.",
  AST_NOT_FOUND: "This meter is no longer in iREPS, so nothing can be sent to it.",
  PREMISE_NOT_FOUND:
    "The premise this meter belongs to is no longer in iREPS. The record has to be fixed before work can be sent here.",
  UNAUTHORIZED_LCT_ORIGINATOR:
    "You cannot send work out. Only a manager, or a supervisor of the main contractor, can.",
  INVALID_ASSIGNMENT_TARGETS: "Choose the field worker this goes to.",
  UNAUTHENTICATED: "You are signed out. Sign in and send it again.",
  INVALID_ASSIGNMENT_INSTRUCTION_REASON: "Choose why this work is being sent.",
  INVALID_ASSIGNMENT_INSTRUCTION_REASON_EXPLANATION:
    "Say what the other reason is.",
  // The office's own callable refuses by the state machine's words, which
  // already say what the state can take instead (`DR-R001` 5), so those are
  // passed through rather than rewritten here.
  UNAUTHORIZED_LCT_MANAGER:
    "You cannot allocate work. Only a manager, or a supervisor of the main contractor, can.",
  TRN_NOT_FOUND:
    "This transaction is no longer in iREPS, so it cannot be allocated. Start again from the meter's row.",
});

/**
 * Making the work, at the button on the meter's row. `DR-R001` 3.2, 5.
 *
 * It writes a transaction with NOBODY ON IT - the office has chosen only the
 * meter and the kind of work - and the ITO page then allocates it. No image
 * goes up here: an image belongs to the instruction, and the instruction is
 * what the page fills in.
 *
 * It never throws. A create that does not come back is the one case where we
 * do not know whether the work exists, and the office is told exactly that
 * rather than a guess either way.
 */
export async function createItoTransaction({ request }) {
  try {
    const callable = httpsCallable(functions, "onCreateMeterLifecycleInstructionCallable");
    const response = await callable(request);
    const result = response?.data || {};

    if (result?.success) return { ok: true, wrote: true, trnId: request.id, result };

    return {
      ok: false,
      wrote: false,
      message:
        REFUSALS[result?.code] || result?.message || "This work could not be created.",
      code: result?.code || "NAv",
      checks: result?.data?.checks || result?.checks || [],
    };
  } catch (error) {
    return {
      ok: false,
      wrote: null,
      message:
        "iREPS could not be reached, so this work may or may not have been created. Look at the meter's row again before pressing it a second time.",
      detail: error?.message || String(error),
    };
  }
}

/**
 * Allocating it, on the ITO page. `DR-R001` 3.4, 3.5, 5.
 *
 * The same two steps the office has always watched - the attachment going
 * up, then the write - because that is still what happens. What changed is
 * which callable does the write: the transaction already exists, so this
 * puts a name on it rather than creating one.
 */
export async function allocateItoRequest({ allocation, imageFile = null, onStep = () => {} }) {
  let media = Array.isArray(allocation?.media) ? [...allocation.media] : [];

  if (imageFile) {
    onStep(ITO_STEPS.attach, "active");

    try {
      const path = instructionMediaPath({ trnId: allocation.trnId, fileName: imageFile.name });
      const objectRef = ref(storage, path);

      await uploadBytes(objectRef, imageFile, { contentType: imageFile.type || "image/jpeg" });

      media = [
        ...media,
        {
          tag: "instructionMedia",
          url: await getDownloadURL(objectRef),
          path,
          name: String(imageFile.name || "NAv"),
        },
      ];

      onStep(ITO_STEPS.attach, "done");
    } catch (error) {
      onStep(ITO_STEPS.attach, "failed");

      return {
        ok: false,
        wrote: false,
        message:
          "The image could not be attached, so nothing was sent. Everything you typed is still on the form - try again, or remove the image and send without it.",
        detail: error?.message || String(error),
      };
    }
  }

  onStep(ITO_STEPS.write, "active");

  try {
    const callable = httpsCallable(functions, "onManageLifecycleInstructionCallable");
    const response = await callable({ ...allocation, media });
    const result = response?.data || {};

    if (result?.success) {
      onStep(ITO_STEPS.write, "done");

      return { ok: true, wrote: true, trnId: allocation.trnId, result };
    }

    onStep(ITO_STEPS.write, "failed");

    // The server refused on a rule, and wrote nothing: its allocate runs in
    // one transaction, so the job is exactly as it was - still waiting.
    return {
      ok: false,
      wrote: false,
      message:
        REFUSALS[result?.code] || result?.message || "The office could not allocate this work.",
      code: result?.code || "NAv",
    };
  } catch (error) {
    onStep(ITO_STEPS.write, "failed");

    // We do NOT know whether it went. Allocating twice is harmless in a way
    // creating twice is not: the second allocate lands on the same
    // transaction, and the worst it can do is name the same worker again.
    return {
      ok: false,
      wrote: null,
      message:
        "iREPS could not be reached, so this may or may not have gone out. Send it again - it is the same job either way, so it cannot go twice.",
      detail: error?.message || String(error),
    };
  }
}

export const ITO_STEPS = Object.freeze({
  attach: "attach",
  write: "write",
});

/** Where an office instruction's image lives. */
export function instructionMediaPath({ trnId, fileName }) {
  const safe = String(fileName || "instruction")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(-60);

  return `lifecycleInstructions/${trnId}/${Date.now()}_${safe}`;
}
