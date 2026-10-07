import { recordLifecycleNoAccess } from "../noAccess/recordLifecycleNoAccess.js";
import { recordRefusedSubmission } from "../registration/refusedSubmissions.js";
import { SYSTEM_FAULT_CODES } from "./systemFault.js";
import { onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";

import { writeRegistryMreadFromTrn } from "../registry/mread/writeRegistryMreadFromTrn.js";
// Targeted Batch rules TB-R059 (1.3.60): work on a meter in another team's allocated batch is refused.
import { astMeterNo, checkBatchWork, recognisedBatchContext, recordErfOverride } from "../targetedBatches/batch-work-guard.js";
import { recordDifferentMeterAtErf } from "../targetedBatches/differentMeterAtErf.js";
// DR-R001 section 4: only the worker the job was sent to may report it.
import { actorIsAssignee, resolveActorIdentity } from "./assignee.js";

import {
  linkFollowUp,
  ACTIVE_LCT_WORKFLOW_STATES,
  IMPLEMENTED_LIFECYCLE_TRN_TYPES,
  buildFailureResult,
  buildLifecycleTrnPayload,
  buildPremiseServiceSnapshotPatch,
  buildSuccessResult,
  getActorNameFromRequest,
  getAstMeterType,
  normalizeUpper,
  validateAssignment,
  validateCommonLifecycleInput,
  validateMeterCommissioning,
  validateMeterInspection,
  validateMeterRemoval,
  validateMeterReading,
  validateMeterDisconnection,
  validateMeterReconnection,
} from "./helpers.js";

function readWorkflowState(trnData = {}) {
  return normalizeUpper(
    trnData?.workflow?.state || trnData?.workflowState || "",
  );
}

function readTrnType(trnData = {}) {
  return normalizeUpper(trnData?.accessData?.trnType || trnData?.trnType || "");
}


const INSTRUCTION_MEDIA_TAG = "instructionMedia";

// Work a field worker or supervisor may start on the spot. METER_INSPECTION
// joined in MN-R001 1.1.0: the re-offender is inspected from the meter card.
const DIRECT_FIELD_DUAL_ORIGIN_TRN_TYPES = [
  "METER_DISCONNECTION",
  "METER_RECONNECTION",
  "METER_REMOVAL",
  "METER_INSPECTION",
];

function readFirstString(...values) {
  for (const value of values) {
    const clean = String(value || "").trim();
    if (clean) return clean;
  }

  return "";
}

function getActorRole({ profile = {}, token = {} }) {
  return normalizeUpper(
    readFirstString(
      token?.role,
      token?.userRole,
      token?.employmentRole,
      token?.employment_role,
      token?.irepsRole,
      profile?.employment?.role,
      profile?.role,
      profile?.userRole,
    ),
  );
}

function getActorServiceProviderId({ profile = {}, token = {} }) {
  return readFirstString(
    token?.spId,
    token?.serviceProviderId,
    token?.employmentServiceProviderId,
    profile?.employment?.serviceProvider?.id,
    profile?.serviceProvider?.id,
  );
}

function serviceProviderLooksMnc(serviceProvider = {}) {
  const classification = normalizeUpper(
    serviceProvider?.profile?.classification ||
      serviceProvider?.classification ||
      serviceProvider?.type,
  );

  if (classification === "MNC") return true;

  const clients = Array.isArray(serviceProvider?.clients)
    ? serviceProvider.clients
    : [];

  return clients.some(
    (client) =>
      normalizeUpper(client?.clientType) === "LM" &&
      normalizeUpper(client?.relationshipType) === "MNC",
  );
}

function serviceProviderLooksSubc(serviceProvider = {}) {
  const clients = Array.isArray(serviceProvider?.clients)
    ? serviceProvider.clients
    : [];

  return clients.some(
    (client) =>
      normalizeUpper(client?.clientType) === "SP" &&
      normalizeUpper(client?.relationshipType) === "SUBC",
  );
}

async function findActorProfile(db, uid) {
  const candidatePaths = [
    `users/${uid}`,
    `userProfiles/${uid}`,
    `profiles/${uid}`,
  ];

  for (const path of candidatePaths) {
    const snap = await db.doc(path).get();

    if (snap.exists) {
      return snap.data() || {};
    }
  }

  return {};
}

async function resolveDirectFieldAuthority({ db, request }) {
  const uid = request?.auth?.uid;
  const token = request?.auth?.token || {};
  const profile = await findActorProfile(db, uid);
  const role = getActorRole({ profile, token });
  const spId = getActorServiceProviderId({ profile, token });

  if (role === "FWR") {
    return {
      ok: true,
      role,
      spId: spId || "UNKNOWN",
      isSubc: false,
    };
  }

  if (role !== "SPV" || !spId) {
    return {
      ok: false,
      role: role || "UNKNOWN",
      spId: spId || "UNKNOWN",
      isSubc: false,
    };
  }

  const spSnap = await db.collection("serviceProviders").doc(spId).get();
  const actorSp = spSnap.exists
    ? {
        id: spSnap.id,
        ...spSnap.data(),
      }
    : null;

  const isSubc =
    serviceProviderLooksSubc(actorSp || {}) &&
    !serviceProviderLooksMnc(actorSp || {});

  return {
    ok: role === "SPV",
    role,
    spId,
    isSubc,
  };
}

function isMeaningfulLifecycleText(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;

  return !["nav", "n/av", "n/a", "na", "null", "undefined"].includes(
    text.toLowerCase(),
  );
}

function firstMeaningfulLifecycleText(...values) {
  for (const value of values) {
    if (isMeaningfulLifecycleText(value)) return String(value).trim();
  }

  return "NAv";
}

function withResolvedNoAccessReason({ executionOutcome = {}, access = {} } = {}) {
  if (executionOutcome?.outcome !== "NO_ACCESS") return executionOutcome;

  const noAccessReason = firstMeaningfulLifecycleText(
    executionOutcome?.noAccessReason,
    executionOutcome?.reasonText,
    executionOutcome?.reason,
    access?.noAccessReason,
    access?.reasonText,
    access?.reason,
  );

  return {
    ...executionOutcome,
    noAccessReason,
    reasonText: noAccessReason,
    reason: noAccessReason,
  };
}

function withResolvedNoAccessAccessBlock(access = {}, executionOutcome = {}) {
  if (executionOutcome?.outcome !== "NO_ACCESS") return access;

  const noAccessReason = firstMeaningfulLifecycleText(
    access?.noAccessReason,
    access?.reasonText,
    access?.reason,
    executionOutcome?.noAccessReason,
    executionOutcome?.reasonText,
    executionOutcome?.reason,
  );

  return {
    ...access,
    hasAccess: "no",
    reason: noAccessReason,
    noAccessReason,
  };
}


function readMediaUniqueKey(mediaItem = {}) {
  return [
    String(mediaItem?.tag || "").trim(),
    String(mediaItem?.url || mediaItem?.uri || "").trim(),
  ].join("::");
}

function getPreservedInstructionMedia(existingMedia = []) {
  if (!Array.isArray(existingMedia)) return [];

  return existingMedia.filter((mediaItem) => {
    if (!mediaItem) return false;
    if (mediaItem?.tag !== INSTRUCTION_MEDIA_TAG) return false;

    return Boolean(mediaItem?.url || mediaItem?.uri);
  });
}

function mergeUniqueMediaGroups(mediaGroups = []) {
  const seenKeys = new Set();
  const mergedMedia = [];

  mediaGroups.forEach((mediaGroup) => {
    const safeMediaGroup = Array.isArray(mediaGroup) ? mediaGroup : [];

    safeMediaGroup.forEach((mediaItem) => {
      if (!mediaItem) return;

      const key = readMediaUniqueKey(mediaItem);

      if (seenKeys.has(key)) return;

      seenKeys.add(key);
      mergedMedia.push(mediaItem);
    });
  });

  return mergedMedia;
}

function buildWmsCompletedMedia({
  existingTrn = {},
  executionMedia = [],
} = {}) {
  const preservedInstructionMedia = getPreservedInstructionMedia(
    existingTrn?.media,
  );

  const safeExecutionMedia = Array.isArray(executionMedia)
    ? executionMedia
    : [];

  return mergeUniqueMediaGroups([
    preservedInstructionMedia,
    safeExecutionMedia,
  ]);
}

function buildHistoryEvent({
  trnId,
  trnType,
  astId,
  event,
  workflowState,
  outcome = "NAv",
  actorUid,
  actorName,
  now,
  note = "",
}) {
  return {
    event,
    workflowState,
    outcome,
    trnId,
    trnType,
    astId,
    note,
    actor: {
      uid: actorUid || "NAv",
      name: actorName || "NAv",
    },
    metadata: {
      createdAt: now,
      createdByUid: actorUid || "NAv",
      createdByUser: actorName || "NAv",
      updatedAt: now,
      updatedByUid: actorUid || "NAv",
      updatedByUser: actorName || "NAv",
    },
  };
}

// DR-R001 3.2 and 3.3: three numbers the meter keeps about itself, so the
// Meter Registry can show and filter them without counting transactions while
// it draws. A disconnection or reconnection counts only when it was actually
// done. Nothing is ever lowered.
//
// No Access is NOT counted here, and must not be. Every No Access now leaves
// this callable through one door — `recordLifecycleNoAccess` — before the
// transaction body below is ever reached, so a count written here could never
// fire. It is raised inside that one writer instead, in the same commit as the
// record itself. That is what stops the number on the Meter Registry and the
// list of visits behind it from disagreeing (DR-R001 3.3).
export function buildMeterCountPatch({ trnType, outcome }) {
  if (normalizeUpper(outcome) !== "SUCCESS") return {};

  if (trnType === "METER_DISCONNECTION") {
    return { "counts.disconnections": FieldValue.increment(1) };
  }

  if (trnType === "METER_RECONNECTION") {
    return { "counts.reconnections": FieldValue.increment(1) };
  }

  return {};
}

function buildUpdateMetadataPatch({ now, actorUid, actorName }) {
  return {
    "metadata.updatedAt": now,
    "metadata.updatedByUid": actorUid || "NAv",
    "metadata.updatedByUser": actorName || "NAv",
  };
}

function getActionCheck({ trnType, data, astDoc, actorUid = "NAv", actorName = "NAv" }) {
  if (trnType === "METER_COMMISSIONING") {
    return validateMeterCommissioning({
      data,
      astDoc,
    });
  }

  if (trnType === "METER_INSPECTION") {
    return validateMeterInspection({
      data,
      astDoc,
    });
  }

  if (trnType === "METER_REMOVAL") {
    return validateMeterRemoval({
      data,
      astDoc,
    });
  }

  if (trnType === "METER_READING") {
    return validateMeterReading({
      data,
      astDoc,
      actorUid,
      actorName,
    });
  }

  if (trnType === "METER_DISCONNECTION") {
    return validateMeterDisconnection({
      data,
      astDoc,
    });
  }

  if (trnType === "METER_RECONNECTION") {
    return validateMeterReconnection({
      data,
      astDoc,
    });
  }

  return {
    ok: false,
    code: "LCT_TYPE_NOT_IMPLEMENTED",
    message: `${trnType} is not implemented yet`,
  };
}

export const onMeterLifecycleTrnCallable = onCall(async (request) => {
  try {
    const db = getFirestore();

    const data = request?.data || {};
    const authContext = request?.auth || null;

    if (!authContext?.uid) {
      return buildFailureResult(
        "UNAUTHENTICATED",
        "Authentication is required",
      );
    }

    const actorUid = authContext.uid;
    const actorName = getActorNameFromRequest(request);
    const now = new Date().toISOString();

    const commonCheck = validateCommonLifecycleInput(data);

    if (!commonCheck.ok) {
      // NA-R065 (owner, 7 October 2026) - A FAULT IN THE SYSTEM MUST BE VISIBLE.
      //
      // "If somehow the system does the ID wrong, you can't submit that because the ID doesn't
      // meet the rules. But then in situations like that, we need to have a way to know, because
      // then it means the problem is not from the user, it's from the system."
      //
      // These are the captures the APP built wrong: no transaction id, no accessData, no meter,
      // no premise, a type this callable does not own. The worker can do nothing about any of
      // them, so the phone no longer asks them to - which means that without this line the fault
      // would live in one phone's queue and a log entry, and nobody would ever fix it.
      //
      // recordRefusedSubmission never throws and never blocks the answer: a failure to record a
      // failure must not become a worse one.
      if (SYSTEM_FAULT_CODES.includes(commonCheck.code)) {
        await recordRefusedSubmission({
          db,
          trnId: data?.id || "NAv",
          code: commonCheck.code,
          message: commonCheck.message,
          data,
          actorUid,
          actorUser: actorName,
          now,
        });
      }

      return buildFailureResult(commonCheck.code, commonCheck.message);
    }

    const { trnId, trnType, astId, premiseId } = commonCheck;

    const instructionTrnId = String(data?.instructionTrnId || "").trim();

    const WMS_EXECUTION_TRN_TYPES = [
      "METER_INSPECTION",
      "METER_DISCONNECTION",
      "METER_RECONNECTION",
      "METER_REMOVAL",
      "METER_READING",
    ];

    const isWmsLifecycleExecution =
      WMS_EXECUTION_TRN_TYPES.includes(trnType) && instructionTrnId === trnId;

    const originChannel = normalizeUpper(data?.origin?.channel);

    logger.info("onMeterLifecycleTrnCallable -- START", {
      trnId,
      instructionTrnId,
      trnType,
      astId,
      premiseId,
      actorUid,
      originChannel,
      isWmsLifecycleExecution,
    });

    if (!IMPLEMENTED_LIFECYCLE_TRN_TYPES.includes(trnType)) {
      return buildFailureResult(
        "LCT_TYPE_NOT_IMPLEMENTED",
        `${trnType} is not implemented yet`,
        {
          trnId,
          trnType,
          astId,
        },
      );
    }

    // MN-R001 1.1.0 section 8: AN INSPECTION COMES FROM EITHER CHANNEL. Office work executed
    // from an accepted instruction, or field work started on the spot from the meter card -
    // and the owner, 4 October 2026: "an inspection can be originated on the field and in the
    // office ... you can't disconnect a meter that's disconnected, so you will have to inspect
    // it first and indicate that the meter is connected. The important thing is that the
    // inspection tells you the origination channel. That's all."
    //
    // So this is NOT a rule that field work is forbidden. It is the check that the capture
    // SAID which channel it came through. Its old name and message - INSPECTION_OFFICE_WMS_ONLY,
    // "must complete an accepted office-originated instruction TRN" - stated a rule iREPS does
    // not have, and on 4 October it told the owner his own field inspection was not allowed.
    // A message that misnames the rule is worse than no message: it sends the reader to fix
    // something that was never wrong.
    if (
      trnType === "METER_INSPECTION" &&
      !isWmsLifecycleExecution &&
      originChannel !== "FIELD"
    ) {
      return buildFailureResult(
        "INSPECTION_ORIGIN_MISSING",
        "A meter inspection must say which channel it came from: field work started at the meter, or an accepted office instruction",
        {
          trnId,
          trnType,
          astId,
          originChannel: originChannel || "NAv",
        },
      );
    }

    const isDirectFieldDualOrigin =
      !isWmsLifecycleExecution &&
      originChannel === "FIELD" &&
      DIRECT_FIELD_DUAL_ORIGIN_TRN_TYPES.includes(trnType);

    if (isDirectFieldDualOrigin) {
      const fieldAuthority = await resolveDirectFieldAuthority({
        db,
        request,
      });

      if (!fieldAuthority.ok) {
        return buildFailureResult(
          "UNAUTHORIZED_FIELD_ORIGIN",
          "Only FWR or SPV actors can originate this lifecycle transaction from the field",
          {
            trnId,
            trnType,
            astId,
            actorRole: fieldAuthority.role,
            actorServiceProviderId: fieldAuthority.spId,
          },
        );
      }
    }

    if (String(data?.accessData?.access?.hasAccess).toLowerCase() === "no") {
      try {
        return await recordLifecycleNoAccess({ db, data, actor: { uid: actorUid, name: actorName }, now, isOffice: isWmsLifecycleExecution });
      } catch (error) {
        if (error.irepsCode) return buildFailureResult(error.irepsCode, error.message, { trnId, trnType, astId });
        // Transport/server failures are retryable; they are not a business refusal.
        logger.error("No Access could not be committed", { trnId, code: error.code, cause: error.message, stack: error.stack });
        return buildFailureResult("UNAVAILABLE", "The server could not confirm this visit. It is safe to retry with the same visit ID.");
      }
    }

    const assignmentCheck = validateAssignment(
      data?.assignment || {},
      trnType,
      { originChannel },
    );

    if (!assignmentCheck.ok) {
      return buildFailureResult(assignmentCheck.code, assignmentCheck.message, {
        trnId,
        trnType,
        astId,
      });
    }

    // DR-R001 section 4: who is submitting, so the server can check that the
    // work was sent to them. Read before the transaction opens.
    const actorIdentity = isWmsLifecycleExecution
      ? await resolveActorIdentity({ db, request })
      : null;

    const trnRef = db.collection("trns").doc(trnId);
    const astRef = db.collection("asts").doc(astId);
    const premiseRef = db.collection("premises").doc(premiseId);

    let responsePayload = null;
    // Targeted Batch rules TB-R062 (1.3.65): kept for after the transaction, so a use of the
    // illegally-connected gate is recorded only when the work itself went through.
    let batchWorkDecision = null;
    // Targeted Batch rules TB-R063 (1.3.66): the meter and the ERF this work recorded, kept for after the
    // transaction, so a Sales meter replaced at that ERF is settled only once the work itself is committed.
    let workMeterNo = "";
    let workErfId = "";

    await db.runTransaction(async (tx) => {
      // ------------------------------------------------------------
      // READS FIRST
      // Firestore transactions must do all reads before writes.
      // ------------------------------------------------------------
      const trnSnap = await tx.get(trnRef);
      const astSnap = await tx.get(astRef);
      const premiseSnap = await tx.get(premiseRef);

      if (!astSnap.exists) {
        responsePayload = buildFailureResult(
          "AST_NOT_FOUND",
          "The referenced AST does not exist",
          {
            trnId,
            trnType,
            astId,
          },
        );

        return;
      }

      if (!premiseSnap.exists) {
        responsePayload = buildFailureResult(
          "PREMISE_NOT_FOUND",
          "The referenced premise does not exist",
          {
            trnId,
            trnType,
            astId,
            premiseId,
          },
        );

        return;
      }

      const astDoc = astSnap.data() || {};
      const premiseData = premiseSnap.data() || {};

      // Targeted Batch rules TB-R059 (1.3.60): a DCN, RCN, Removal, Inspection or Reading on a meter that
      // sits in another team's allocated batch is refused, and nothing is written. This path names only the
      // AST, so the meter number comes from the AST already read here. Read inside the transaction, before
      // any write, so the facts and the refusal are one picture.
      //
      // Rules TB-R062 (1.3.65): the ERF too — the AST's own ERF, or the premise this work is using. The
      // anomaly is read from what this form captured, falling back to what the AST already holds.
      const batchWorkCheck = await checkBatchWork({
        db,
        read: (refOrQuery) => tx.get(refOrQuery),
        meterNo: astMeterNo(astDoc),
        uid: actorUid,
        erfId: astDoc?.accessData?.erfId || data?.accessData?.erfId || "",
        premiseId,
        anomaly: [data, astDoc?.ast],
        log: logger,
      });

      batchWorkDecision = batchWorkCheck;
      workMeterNo = astMeterNo(astDoc);
      workErfId = astDoc?.accessData?.erfId || data?.accessData?.erfId || "";

      if (!batchWorkCheck.allowed) {
        responsePayload = buildFailureResult(
          batchWorkCheck.code,
          batchWorkCheck.message,
          {
            trnId,
            trnType,
            astId,
            batch: batchWorkCheck.details,
          },
        );

        return;
      }

      // ------------------------------------------------------------
      // WMS DCN EXECUTION PATH
      // DCN execution updates the existing instructionTrnId.
      // It must not create a second TRN_MDCN document.
      // ------------------------------------------------------------
      if (isWmsLifecycleExecution) {
        if (!trnSnap.exists) {
          responsePayload = buildFailureResult(
            "INSTRUCTION_TRN_NOT_FOUND",
            "The lifecycle instruction TRN does not exist",
            {
              trnId,
              trnType,
              astId,
            },
          );

          return;
        }

        const existingTrn = trnSnap.data() || {};
        const existingTrnType = readTrnType(existingTrn);
        const workflowState = readWorkflowState(existingTrn);

        if (existingTrnType !== trnType) {
          responsePayload = buildFailureResult(
            "INVALID_INSTRUCTION_TRN_TYPE",
            "The referenced instruction TRN type does not match the execution payload",
            {
              trnId,
              existingTrnType,
              trnType,
              astId,
            },
          );

          return;
        }

        if (workflowState === "COMPLETED") {
          const existingOutcome =
            existingTrn?.executionOutcome?.outcome || "NAv";

          responsePayload = buildSuccessResult(
            trnId,
            `${trnType} instruction is already completed`,
            {
              trnType,
              astId,
              premiseId,
              astStatusAfter: astDoc?.status?.state || "NAv",
              astStatusChanged: false,
              astDataChanged: false,
              executionOutcome: existingTrn?.executionOutcome || {
                outcome: existingOutcome,
                success: ["SUCCESS", "SUCCESSFUL_READING"].includes(existingOutcome),
              },
              idempotent: true,
            },
          );

          return;
        }

        if (["REJECTED", "CANCELLED"].includes(workflowState)) {
          responsePayload = buildFailureResult(
            "INSTRUCTION_NOT_EXECUTABLE",
            "Rejected or cancelled lifecycle instructions cannot be executed",
            {
              trnId,
              trnType,
              workflowState,
              astId,
            },
          );

          return;
        }

        // DR-R001 section 5: the worker accepts the job, opens the form
        // (IN_PROGRESS) and then submits it, so either state can be completed.
        if (!["ACCEPTED", "IN_PROGRESS"].includes(workflowState)) {
          responsePayload = buildFailureResult(
            "INSTRUCTION_NOT_ACCEPTED",
            "Lifecycle instruction must be accepted before execution can be submitted",
            {
              trnId,
              trnType,
              workflowState,
              astId,
            },
          );

          return;
        }

        // DR-R001 section 4: only the worker the job was sent to may report
        // it, and only for the meter on the job. The phone shows the work to
        // nobody else; these two refusals are what make it a rule.
        const instructionAstId = String(
          existingTrn?.ast?.astData?.astId || "",
        ).trim();

        if (instructionAstId && instructionAstId !== astId) {
          responsePayload = buildFailureResult(
            "INSTRUCTION_ASSET_MISMATCH",
            "This work belongs to another meter",
            {
              trnId,
              trnType,
              astId,
              instructionAstId,
            },
          );

          return;
        }

        const actorIsTheAssignee = await actorIsAssignee({
          reader: tx,
          db,
          trnData: existingTrn,
          actorUid,
          actorSpId: actorIdentity?.spId || "",
        });

        if (!actorIsTheAssignee) {
          responsePayload = buildFailureResult(
            "INSTRUCTION_NOT_ASSIGNED",
            "This work was sent to somebody else",
            {
              trnId,
              trnType,
              astId,
              actorUid,
            },
          );

          return;
        }

        const actionCheck = getActionCheck({
          trnType,
          data,
          astDoc,
          actorUid,
          actorName,
        });

        if (!actionCheck?.ok) {
          responsePayload = buildFailureResult(
            actionCheck?.code,
            actionCheck?.message,
            {
              trnId,
              trnType,
              astId,
            },
          );

          return;
        }

        const statusAfter = actionCheck.nextAstState;

        const cleanExecution = buildLifecycleTrnPayload({
          data,
          astDoc,
          now,
          actorUid,
          actorName,
          statusState: statusAfter,
        });

        let premiseServicePatch = null;

        if (actionCheck.astStatusChanged) {
          const servicePatchResult = buildPremiseServiceSnapshotPatch({
            premiseData,
            astId,
            meterType: getAstMeterType(astDoc, data),
            status: statusAfter,
            updatedAt: now,
          });

          if (!servicePatchResult.ok) {
            responsePayload = buildFailureResult(
              servicePatchResult.code,
              servicePatchResult.message,
              {
                trnId,
                trnType,
                astId,
              },
            );

            return;
          }

          premiseServicePatch = servicePatchResult.patch;
        }

        const passed =
          trnType === "METER_INSPECTION"
            ? actionCheck.inspectionPassed === true
            : trnType === "METER_DISCONNECTION"
              ? actionCheck.disconnectionPassed === true
              : trnType === "METER_RECONNECTION"
                ? actionCheck.reconnectionPassed === true
                : trnType === "METER_REMOVAL"
                  ? actionCheck.removalPassed === true
                  : trnType === "METER_READING"
                    ? actionCheck.readingPassed === true
                    : false;

        const baseExecutionOutcome = actionCheck.executionOutcome ||
          cleanExecution?.executionOutcome || {
            outcome:
              trnType === "METER_READING" && passed
                ? "SUCCESSFUL_READING"
                : passed
                  ? "SUCCESS"
                  : "NO_ACCESS",
            success: passed,
          };

        const executionOutcome = withResolvedNoAccessReason({
          executionOutcome: baseExecutionOutcome,
          access: cleanExecution?.accessData?.access || {},
        });

        const completedAccessBlock = withResolvedNoAccessAccessBlock(
          cleanExecution?.accessData?.access || {
            hasAccess: "yes",
            reason: "NAv",
          },
          executionOutcome,
        );

        const completedMedia = buildWmsCompletedMedia({
          existingTrn,
          executionMedia: cleanExecution?.media || [],
        });

        // GMR-R038 (1.6.0): this work happened on a premise that belongs to a batch, so the transaction
        // says so. An inspection, disconnection, reconnection or removal started from the meter card
        // carried no batch and read as work outside batches that never happened. What the transaction
        // already carries is left alone; this only fills the gap.
        const recognisedBatch = existingTrn?.targetedBatchContext
          ? null
          : recognisedBatchContext({
              decision: batchWorkDecision,
              erfId: workErfId,
              premiseId,
            });

        const trnUpdatePatch = {
          ...(recognisedBatch ? { targetedBatchContext: recognisedBatch } : {}),
          "workflow.state": "COMPLETED",
          "workflow.completedAt": now,
          "workflow.completedByUid": actorUid,
          "workflow.completedByUser": actorName,

          ...(trnType === "METER_INSPECTION"
            ? { inspection: cleanExecution?.inspection || {} }
            : {}),

          ...(trnType === "METER_DISCONNECTION"
            ? {
                disconnection: cleanExecution?.disconnection || {},
                fieldComment: cleanExecution?.fieldComment || { text: "" },
              }
            : {}),

          ...(trnType === "METER_RECONNECTION"
            ? {
                reconnection: cleanExecution?.reconnection || {},
                fieldComment: cleanExecution?.fieldComment || { text: "" },
              }
            : {}),

          ...(trnType === "METER_REMOVAL"
            ? { removal: cleanExecution?.removal || {} }
            : {}),

          ...(trnType === "METER_READING"
            ? { meterReading: cleanExecution?.meterReading || {} }
            : {}),

          executionOutcome,

          media: completedMedia,

          status: cleanExecution?.status || {
            state: statusAfter,
            id: astDoc?.status?.id || "NAv",
            detail: astDoc?.status?.detail || "NAv",
          },

          "accessData.access": completedAccessBlock,
          ...Object.fromEntries(Object.entries(cleanExecution.metadata || {})
            .filter(([key]) => key.includes("OnDevice")).map(([key, value]) => [`metadata.${key}`, value])),

          ...buildUpdateMetadataPatch({
            now,
            actorUid,
            actorName,
          }),
        };

        tx.update(trnRef, trnUpdatePatch);

        const astPatch = actionCheck?.astPatch || {};
        const astDataChanged = Object.keys(astPatch).length > 0;

        const astUpdatePatch = {
          ...astPatch,

          trnActiveLifecycle: FieldValue.delete(),

          // DR-R001 3.2 and 3.3: the meter carries its own counts, raised in
          // the same commit as the work that earned them.
          ...buildMeterCountPatch({
            trnType,
            outcome: executionOutcome?.outcome,
          }),

          ...buildUpdateMetadataPatch({
            now,
            actorUid,
            actorName,
          }),
        };

        if (actionCheck.astStatusChanged) {
          astUpdatePatch["status.state"] = statusAfter;
        }

        tx.update(astRef, astUpdatePatch);

        // The premise's No Access list is NOT written here. It used to be,
        // because work the office issued was already created when it was
        // issued and the create-time trigger never saw the refusal. That hole
        // is closed on main: `recordLifecycleNoAccess` writes the link in the
        // same commit as the record, and `reconcileNoAccessChange` rebuilds
        // the list from the transactions afterwards. A second writer appending
        // here would be one fact with two owners — the shape that made these
        // numbers stop agreeing in the first place.
        const premiseUpdatePatch = {
          ...(actionCheck.astStatusChanged ? premiseServicePatch : {}),
        };

        if (Object.keys(premiseUpdatePatch).length > 0) {
          tx.update(premiseRef, {
            ...premiseUpdatePatch,
            ...buildUpdateMetadataPatch({
              now,
              actorUid,
              actorName,
            }),
          });
        }

        const historyRef = trnRef.collection("history").doc();

        tx.set(
          historyRef,
          buildHistoryEvent({
            trnId,
            trnType,
            astId,
            event: "COMPLETED",
            workflowState: "COMPLETED",
            outcome: executionOutcome?.outcome || "NAv",
            actorUid,
            actorName,
            now,

            note:
              executionOutcome?.outcome === "NO_ACCESS"
                ? `${trnType} completed with NO_ACCESS outcome`
                : `${trnType} completed successfully`,
          }),
        );

        responsePayload = buildSuccessResult(
          trnId,

          executionOutcome?.outcome === "NO_ACCESS"
            ? `${trnType} completed with NO ACCESS. AST status unchanged.`
            : trnType === "METER_READING" &&
                executionOutcome?.outcome === "UNSUCCESSFUL_READING"
              ? `${trnType} completed with UNSUCCESSFUL_READING. AST reading cache unchanged.`
              : trnType === "METER_INSPECTION"
                ? `${trnType} completed successfully. AST status unchanged.`
                : `${trnType} completed and AST updated successfully`,

          {
            trnType,
            astId,
            premiseId,
            astStatusAfter: statusAfter,
            astStatusChanged: actionCheck.astStatusChanged === true,
            astDataChanged,
            executionOutcome,
            distanceMeters: actionCheck.distanceMeters ?? null,
          },
        );

        return;
      }

      // ------------------------------------------------------------
      // CURRENT CREATE-STYLE LIFECYCLE PATH
      // This remains for non-WMS create-style lifecycle submissions.
      // ------------------------------------------------------------
      if (trnSnap.exists) {
        logger.info("onMeterLifecycleTrnCallable -- TRN already exists", {
          trnId,
          trnType,
          astId,
        });

        responsePayload = buildSuccessResult(
          trnId,
          "Lifecycle TRN already exists and is treated as successful",
          {
            trnType,
            astId,
            idempotent: true,
          },
        );

        return;
      }

      // DR-R001 section 5: one open job of a kind per meter. The office path
      // already refuses a second one; the field channel follows the same rule,
      // so a worker cannot start work the office is still waiting on.
      const openInstructionSnap = await tx.get(
        db
          .collection("trns")
          .where("ast.astData.astId", "==", astId)
          .where("accessData.trnType", "==", trnType)
          .where("workflow.state", "in", ACTIVE_LCT_WORKFLOW_STATES)
          .limit(1),
      );

      if (!openInstructionSnap.empty) {
        const openDoc = openInstructionSnap.docs[0];

        responsePayload = buildFailureResult(
          "ACTIVE_LCT_ALREADY_EXISTS",
          "This meter already has work of this kind waiting to be done",
          {
            trnId,
            trnType,
            astId,
            existingTrnId: openDoc.id,
            existingWorkflowState: openDoc.data()?.workflow?.state || "NAv",
          },
        );

        return;
      }

      const actionCheck = getActionCheck({
        trnType,
        data,
        astDoc,
        actorUid,
        actorName,
      });

      if (!actionCheck?.ok) {
        responsePayload = buildFailureResult(
          actionCheck?.code,
          actionCheck?.message,
          {
            trnId,
            trnType,
            astId,
          },
        );

        return;
      }

      const statusAfter = actionCheck.nextAstState;

      const cleanTrn = buildLifecycleTrnPayload({
        data,
        astDoc,
        now,
        actorUid,
        actorName,
        statusState: statusAfter,
      });

      let premiseServicePatch = null;

      if (actionCheck.astStatusChanged) {
        const servicePatchResult = buildPremiseServiceSnapshotPatch({
          premiseData,
          astId,
          meterType: getAstMeterType(astDoc, data),
          status: statusAfter,
          updatedAt: now,
        });

        if (!servicePatchResult.ok) {
          responsePayload = buildFailureResult(
            servicePatchResult.code,
            servicePatchResult.message,
            {
              trnId,
              trnType,
              astId,
            },
          );

          return;
        }

        premiseServicePatch = servicePatchResult.patch;
      }

      const trnToCreate =
        trnType === "METER_READING"
          ? {
              ...cleanTrn,
              executionOutcome:
                actionCheck.executionOutcome || cleanTrn?.executionOutcome,
            }
          : cleanTrn;

      // ------------------------------------------------------------
      // WRITES
      // Audit TRN first, then AST, then premise snapshot.
      // All writes commit together or all fail together.
      // ------------------------------------------------------------
      tx.create(trnRef, trnToCreate);

      const astPatch = actionCheck?.astPatch || {};
      const astDataChanged = Object.keys(astPatch).length > 0;

      // DR-R001 section 5: work done in the field also clears the open-job
      // marker, so a marker left behind by cancelled or rejected office work
      // never outlives the work itself.
      const hasStaleActiveLifecycle = Boolean(astDoc?.trnActiveLifecycle);

      // DR-R001 3.2 and 3.3: the same three counts, whichever channel the work
      // came from. The outcome is read from the document being written.
      const fieldOutcome = trnToCreate?.executionOutcome?.outcome || "";

      const countPatch = buildMeterCountPatch({
        trnType,
        outcome: fieldOutcome,
      });

      const countsChanged = Object.keys(countPatch).length > 0;

      const shouldUpdateAst =
        actionCheck.astStatusChanged ||
        astDataChanged ||
        hasStaleActiveLifecycle ||
        countsChanged;

      if (shouldUpdateAst) {
        const astUpdatePatch = {
          ...astPatch,
          ...countPatch,
          ...buildUpdateMetadataPatch({
            now,
            actorUid,
            actorName,
          }),
        };

        if (hasStaleActiveLifecycle) {
          astUpdatePatch.trnActiveLifecycle = FieldValue.delete();
        }

        if (actionCheck.astStatusChanged) {
          astUpdatePatch["status.state"] = statusAfter;
        }

        tx.update(astRef, astUpdatePatch);
      }

      // The premise's No Access list is NOT written here either, for the same
      // reason as the office path above: one fact, one writer.
      //
      // There is a second reason on this path. A real No Access never reaches
      // this code at all — it leaves through `recordLifecycleNoAccess` above.
      // What could still arrive here is an outcome of NO_ACCESS on a visit
      // where the worker DID reach the meter and simply did not do the work,
      // which the outcome sanitiser allows. Writing that onto the premise's
      // No Access list would put a second meaning behind the words: the owner's
      // rule of 30 September is that No Access means the worker could not reach
      // and touch the meter, and nothing else.
      const fieldPremisePatch = {
        ...(actionCheck.astStatusChanged ? premiseServicePatch : {}),
      };

      if (Object.keys(fieldPremisePatch).length > 0) {
        tx.update(premiseRef, {
          ...fieldPremisePatch,
          ...buildUpdateMetadataPatch({
            now,
            actorUid,
            actorName,
          }),
        });
      }

      // DR-R001 section 5: a field job leaves the same trail as an office one,
      // so the office can read both the same way.
      tx.set(
        trnRef.collection("history").doc(),
        buildHistoryEvent({
          trnId,
          trnType,
          astId,
          event: "COMPLETED",
          workflowState: "COMPLETED",
          outcome: actionCheck?.executionOutcome?.outcome || "NAv",
          actorUid,
          actorName,
          now,
          note: `${trnType} done in the field and recorded at once`,
        }),
      );

      responsePayload = buildSuccessResult(
        trnId,
        actionCheck.astStatusChanged
          ? "Meter lifecycle TRN created and AST updated successfully"
          : "Meter lifecycle TRN created successfully. AST state unchanged.",
        {
          trnType,
          astId,
          premiseId,
          astStatusAfter: statusAfter,
          astStatusChanged: actionCheck.astStatusChanged === true,
          astDataChanged: actionCheck.astDataChanged === true,
          executionOutcome: actionCheck.executionOutcome || null,
          distanceMeters: actionCheck.distanceMeters ?? null,
        },
      );
    });

    // Targeted Batch rules TB-R062 (1.3.65): one document per use of the illegally-connected gate, written
    // once the work itself is committed, so the office can count them per worker and per team.
    if (responsePayload?.success === true) {
      await recordErfOverride({ db, decision: batchWorkDecision, trnId, trnType, log: logger });
      // Targeted Batch rules TB-R063 (1.3.66): a Sales meter was expected at this ERF under another number.
      // It has been replaced, so it reads Completed and its batch row closes. Never fails the submission.
      await recordDifferentMeterAtErf({ db, Timestamp, FieldValue, meterNo: workMeterNo, erfId: workErfId, premiseId,
        trnId, trnType, astId, uid: actorUid, log: logger });
    }

    // MN-R001 section 7: the finding that called for this disconnection now has
    // it. Never fails the submission: the work is saved, and anything that
    // cannot be linked is logged for the office.
    // Only work that was actually done is linked: not a No Access visit, and
    // not a resend of a transaction that already existed.
    if (
      (trnType === "METER_DISCONNECTION" || trnType === "METER_REMOVAL") &&
      responsePayload?.success === true &&
      responsePayload?.idempotent !== true &&
      responsePayload?.executionOutcome?.success === true
    ) {
      try {
        await linkFollowUp({
          db,
          parentTrnId: data?.origin?.parentTrnId,
          parentTrnType: data?.origin?.parentTrnType,
          workTrnType: trnType,
          trnId,
          astId,
        });
      } catch (linkError) {
        logger.error("onMeterLifecycleTrnCallable -- parent follow-up not linked", {
          trnId,
          parentTrnId: data?.origin?.parentTrnId || "NAv",
          message: linkError?.message || String(linkError),
        });
      }
    }

    if (trnType === "METER_READING" && responsePayload?.success === true) {
      try {
        await writeRegistryMreadFromTrn({
          db,
          trnId,
          source: "MREAD_COMPLETION",
        });
      } catch (registryError) {
        logger.error("onMeterLifecycleTrnCallable -- registry_mread write failed", {
          trnId,
          trnType,
          astId,
          message: registryError?.message || String(registryError),
          stack: registryError?.stack || "NAv",
        });
      }
    }

    return (
      responsePayload ||
      buildFailureResult("UNKNOWN_ERROR", "Lifecycle TRN was not processed", {
        trnId,
        trnType,
        astId,
      })
    );
  } catch (error) {
    logger.error("onMeterLifecycleTrnCallable -- ERROR", {
      message: error?.message || String(error),
      stack: error?.stack || "NAv",
    });

    // An error that already carries an iREPS code keeps it, so the phone can tell a refusal iREPS
    // decided on (TB-R059, 1.3.62) from an unknown failure.
    return buildFailureResult(
      error?.irepsCode || "UNKNOWN_ERROR",
      error?.message || "Failed to submit lifecycle transaction",
    );
  }
});
