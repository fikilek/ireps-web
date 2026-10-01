// DR-R001 3.1: the Meter Registry asks this before it opens the window where
// a disconnection or a reconnection is issued, so the office is told that a
// meter cannot be accounted for BEFORE it types anything — not after.
//
// The same check runs again when the work is issued. This one is only the
// courtesy; the refusal that matters is the one on the issue.

import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { getFirestore } from "firebase-admin/firestore";

import { buildFailureResult, buildSuccessResult } from "./helpers.js";
import { resolveActorIdentity } from "./assignee.js";
import { checkMeterRegistration } from "./registrationGuard.js";

// DR-R001 section 4: a Manager and a supervisor launch this work, so they are
// the ones who ask.
const LAUNCH_ROLES = ["MNG", "SPV"];

export const onCheckMeterRegistrationCallable = onCall(async (request) => {
  try {
    const db = getFirestore();

    if (!request?.auth?.uid) {
      return buildFailureResult("UNAUTHENTICATED", "Authentication is required");
    }

    const astId = String(request?.data?.astId || "").trim();

    if (!astId) {
      return buildFailureResult("INVALID_AST_ID", "No meter was named");
    }

    const actor = await resolveActorIdentity({ db, request });

    if (!LAUNCH_ROLES.includes(actor.role)) {
      return buildFailureResult(
        "UNAUTHORIZED_LCT_ORIGINATOR",
        "Only a Manager or a supervisor can issue this work",
        { actorRole: actor.role || "UNKNOWN" },
      );
    }

    const outcome = await checkMeterRegistration({ db, astId });

    if (!outcome.ok) {
      logger.info("onCheckMeterRegistrationCallable -- meter not accounted for", {
        astId,
        code: outcome.code,
      });

      return buildFailureResult(outcome.code, outcome.message, {
        astId,
        checks: outcome.checks,
      });
    }

    return buildSuccessResult(astId, "This meter can be worked on", {
      astId,
      checks: outcome.checks,
    });
  } catch (error) {
    logger.error("onCheckMeterRegistrationCallable -- ERROR", {
      message: error?.message || String(error),
    });

    return buildFailureResult(
      "UNKNOWN_ERROR",
      "The meter could not be checked. Try again.",
    );
  }
});
