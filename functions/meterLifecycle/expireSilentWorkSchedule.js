// The clock that returns unanswered work. `DR-R001` 5.6.
//
// A thin wrapper over `expireSilentWork`, following the same shape as the
// report-retention cleanup beside it: the schedule and the real clock live
// here, the decision lives in the pure module, so the rule is tested without
// an emulator and without waiting three days.
//
// IT RUNS HOURLY, not daily. The rule is seventy-two hours, so the hour of the
// day does not matter - but an hourly run keeps every batch small, means the
// per-run cap almost never binds, and means a run that stops on its deadline
// is picked up sixty minutes later instead of tomorrow.
//
// It takes no retry options. An expiry is idempotent: a job already returned
// to `Created` is no longer `Issued`, so the next tick simply does not find
// it. The next tick IS the retry.

import { getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { expireSilentWork } from "./expireSilentWork.js";

/**
 * Of the 540 seconds the function is allowed, stop paging at 420 and let the
 * next tick finish. Being killed mid-page tells us nothing; stopping on
 * purpose tells us there is a backlog.
 */
const DEADLINE_MS = 420_000;

export const onIssuedWorkExpires = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "Africa/Johannesburg",
    timeoutSeconds: 540,
  },
  async () => {
    const startedMs = Date.now();

    const result = await expireSilentWork({
      db: getFirestore(),
      nowMs: startedMs,
      deadlineMs: DEADLINE_MS,
      startedMs,
    });

    // Logged whole, every run, including the zeros. A run that found nothing
    // and a run that never happened look the same in a log that only speaks
    // when something moved.
    logger.info("onIssuedWorkExpires -- RUN", {
      ...result,
      ranForMs: Date.now() - startedMs,
    });

    if (result.stoppedOnCap || result.stoppedOnDeadline) {
      logger.warn("onIssuedWorkExpires -- MORE TO DO", {
        remaining: result.remaining,
        stoppedOnCap: result.stoppedOnCap,
        stoppedOnDeadline: result.stoppedOnDeadline,
      });
    }

    if (result.leftAlone.length) {
      // Somebody acted on the job between the scan and the write, and the
      // person wins. Worth seeing, not worth an alarm.
      logger.info("onIssuedWorkExpires -- LEFT ALONE", { leftAlone: result.leftAlone });
    }
  },
);
