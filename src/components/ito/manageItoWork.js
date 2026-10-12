// Sending what the office decided. `DR-R001` 5.5.
//
// The decisions - which moves exist, who may make them, what each must say -
// are in `manageItoRequest.js`, which has no firebase import and is tested.
// This file is the call.

import { httpsCallable } from "firebase/functions";

import { functions } from "../../firebase";
import { REFUSALS } from "./manageItoRequest";

/**
 * Sends it. It never throws: the office gets an answer either way, and the
 * answer says whether anything was written.
 */
export async function manageItoWork({ request }) {
  try {
    const callable = httpsCallable(functions, "onManageLifecycleInstructionCallable");
    const response = await callable(request);
    const result = response?.data || {};

    if (result?.success) {
      return { ok: true, wrote: true, trnId: request?.trnId, result };
    }

    // The server refused on a rule, and wrote nothing: its whole move runs in
    // one transaction, so the job is exactly as it was.
    return {
      ok: false,
      wrote: false,
      message: REFUSALS[result?.code] || result?.message || "iREPS could not do that.",
      code: result?.code || "NAv",
    };
  } catch (error) {
    // We do NOT know whether it went. Every one of these three moves is safe
    // to repeat: the second attempt lands on the same transaction, and the
    // machine refuses a move the state no longer takes.
    return {
      ok: false,
      wrote: null,
      message:
        "iREPS could not be reached, so this may or may not have gone through. Refresh the screen to see where the job is before trying again.",
      detail: error?.message || String(error),
    };
  }
}
