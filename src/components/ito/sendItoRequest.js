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
});

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

/**
 * Sends one request, reporting each stage as it really happens.
 *
 * It never throws: the office gets an answer either way, and the answer says
 * whether anything was written. A thrown error that reached the window would
 * leave the office looking at a spinner.
 */
export async function sendItoRequest({ request, imageFile = null, onStep = () => {} }) {
  let media = Array.isArray(request?.media) ? [...request.media] : [];

  if (imageFile) {
    onStep(ITO_STEPS.attach, "active");

    try {
      const path = instructionMediaPath({ trnId: request.id, fileName: imageFile.name });
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
          "The image could not be attached, so nothing was sent. Everything you typed is still on the form — try again, or remove the image and send without it.",
        detail: error?.message || String(error),
      };
    }
  }

  onStep(ITO_STEPS.write, "active");

  try {
    const callable = httpsCallable(functions, "onCreateMeterLifecycleInstructionCallable");
    const response = await callable({ ...request, media });
    const result = response?.data || {};

    if (result?.success) {
      onStep(ITO_STEPS.write, "done");

      return { ok: true, wrote: true, trnId: request.id, result };
    }

    onStep(ITO_STEPS.write, "failed");

    // The server refused on a rule. It wrote nothing: its create runs in one
    // transaction, so a refusal leaves the meter exactly as it was.
    return {
      ok: false,
      wrote: false,
      message:
        REFUSALS[result?.code] || result?.message || "The office could not send this work.",
      code: result?.code || "NAv",
    };
  } catch (error) {
    onStep(ITO_STEPS.write, "failed");

    // The call itself did not come back. We do NOT know whether the job was
    // written, and saying "nothing was changed" here would be a guess. The
    // duplicate-id refusal is what makes pressing Send again safe: the same
    // request carries the same id, so a second attempt cannot issue a second
    // job (DR-R001 3.5).
    return {
      ok: false,
      wrote: null,
      message:
        "iREPS could not be reached, so this may or may not have gone out. Send it again — the job carries its own number, so it cannot go twice.",
      detail: error?.message || String(error),
    };
  }
}
