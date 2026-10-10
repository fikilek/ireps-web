// The job the office sends. `DR-R001` 3.4, 3.5 and 4.
//
// WHAT THESE GUARD. Two things that are permanent and one that is invisible.
//
// The ID is permanent: it can never be rewritten, so a prefix that drifts
// from the phone's splits one kind of work into two in every report that
// reads an id. The prefixes are pinned against the phone's own file.
//
// The REASON'S CODE is what makes old records countable after a rewording -
// and the wording is changing right now. The server forces
// assignment.instruction.code to equal the transaction type, so the reason
// needs a field of its own or it survives only as English that somebody will
// rewrite.
//
// And the MUNICIPALITY AND WARD are invisible when missing: a job without
// them exists and cannot be found. It is refused here rather than written.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  TRN_PREFIX_BY_TYPE,
  TRN_TYPE_BY_WORK,
  buildItoRequest,
  buildItoTrnId,
  itoSendProblem,
  meterTypeCode,
} from "../src/components/ito/itoRequest.js";

const AT = 1_791_538_506_000;

const METER = {
  meterType: "electricity",
  ast: { astData: { astId: "AST_1", astNo: "04297758791" } },
  accessData: {
    erfNo: "5213",
    premise: { id: "PRM_1", address: "5213 Yellowwood Street" },
    parents: { lmPcode: "ZA5241", wardPcode: "ZA5241006" },
  },
};

const WORKER = { uid: "u1", name: "Peter M." };
const REASON = { code: "CREDIT_CONTROL_INSTRUCTION", words: "Client instruction" };

const build = (over = {}) =>
  buildItoRequest({ meter: METER, work: "disconnect", worker: WORKER, reason: REASON, instructionWords: "Disconnect at the box", atMs: AT, ...over });

test("the prefixes are the phone's, letter for letter", async () => {
  // Two repositories, one shape. An office disconnection and a field
  // disconnection must carry the same prefix or they are two kinds of work.
  const source = await readFile(
    new URL("../../ireps-mobile/src/features/trns/trnId.js", import.meta.url),
    "utf8",
  );

  for (const [trnType, prefix] of Object.entries(TRN_PREFIX_BY_TYPE)) {
    assert.ok(
      source.includes(`${trnType}: "${prefix}"`),
      `${trnType} must still be ${prefix} on the phone`,
    );
  }
});

test("the id carries the work, the time, the service, the ward and the ERF", () => {
  assert.equal(
    buildItoTrnId({ trnType: "METER_DISCONNECTION", meterType: "electricity", wardPcode: "ZA5241006", erfNo: "5213", atMs: AT }),
    "TRN_MDCN_1791538506000_ELC_ZA5241006_5213",
  );
});

test("water and an unknown service each read truly", () => {
  assert.equal(meterTypeCode("water"), "WTR");
  assert.equal(meterTypeCode("Electricity"), "ELC");
  assert.equal(meterTypeCode(""), "NAv");
  assert.equal(meterTypeCode(null), "NAv");
  assert.equal(meterTypeCode("gas"), "NAv", "an unknown service is NAv, never guessed");
});

test("an id part that cleans away to nothing reads NAv", () => {
  const id = buildItoTrnId({ trnType: "METER_READING", meterType: "water", wardPcode: "", erfNo: "--", atMs: AT });

  assert.equal(id, "TRN_MREAD_1791538506000_WTR_NAv_NAv");
});

test("an unknown transaction type throws rather than inventing a prefix", () => {
  assert.throws(() => buildItoTrnId({ trnType: "METER_SOMETHING", atMs: AT }), /No transaction prefix/);
});

test("the five buttons map to the five transactions", () => {
  assert.deepEqual(TRN_TYPE_BY_WORK, {
    disconnect: "METER_DISCONNECTION",
    reconnect: "METER_RECONNECTION",
    inspect: "METER_INSPECTION",
    remove: "METER_REMOVAL",
    read: "METER_READING",
  });
});

test("a complete request carries what the server demands", () => {
  const out = build();

  assert.equal(out.ok, true);
  assert.equal(out.request.id, "TRN_MDCN_1791538506000_ELC_ZA5241006_5213");
  assert.equal(out.request.trnType, "METER_DISCONNECTION");
  assert.equal(out.request.astId, "AST_1");
  assert.equal(out.request.premiseId, "PRM_1");
  assert.equal(out.request.accessData.trnType, "METER_DISCONNECTION");
  assert.equal(out.request.accessData.parents.lmPcode, "ZA5241");
  assert.equal(out.request.accessData.parents.wardPcode, "ZA5241006");
});

test("it goes to exactly one field worker, never a team", () => {
  const { targets } = build().request.assignment;

  assert.equal(targets.length, 1);
  assert.equal(targets[0].type, "USER");
  assert.equal(targets[0].id, "u1");
  assert.equal(targets[0].name, "Peter M.");
});

test("the instruction code is the transaction type, and the reason keeps its own", () => {
  // The server refuses anything else for instruction.code
  // (helpers.js: "assignment.instruction.code must match accessData.trnType"),
  // which is exactly why the reason cannot live there.
  const { instruction } = build().request.assignment;

  assert.equal(instruction.code, "METER_DISCONNECTION");
  assert.equal(instruction.reason.code, "CREDIT_CONTROL_INSTRUCTION");
  assert.equal(instruction.reason.words, "Client instruction");
});

test("a rewording leaves the code untouched", () => {
  // The whole point. The same stored code, under the new English.
  const before = build({ reason: { code: "NON_PAYMENT", words: "Non Payment" } });
  const after = build({ reason: { code: "NON_PAYMENT", words: "Customer instruction" } });

  assert.equal(before.request.assignment.instruction.reason.code, after.request.assignment.instruction.reason.code);
  assert.notEqual(before.request.assignment.instruction.reason.words, after.request.assignment.instruction.reason.words);
});

test("the instruction is what the worker reads, and it is optional", () => {
  // The server demands assignment.instruction.text for every transaction but
  // a meter reading, so the office is told here rather than refused there.
  const { instruction } = build().request.assignment;

  assert.equal(instruction.text, "Disconnect at the box");

  // Owner, 10 October 2026: optional, not conditional. The coded reason
  // carries why the work is being sent; the words elaborate it for the worker
  // and are not demanded. Nothing typed stores NAv.
  for (const nothing of [undefined, "", "   ", String.fromCharCode(10)]) {
    const out = build({ instructionWords: nothing });

    assert.equal(out.ok, true, `an instruction of ${JSON.stringify(nothing)} must be allowed`);
    assert.equal(out.request.assignment.instruction.text, "NAv");
  }
});

test("an image stands for the instruction, exactly as the server allows", () => {
  // DR-R001 3.4: words, an image, or both. The form must refuse what the
  // server refuses and allow what it allows - nothing is sent that was going
  // to come back.
  assert.equal(
    itoSendProblem({ work: "disconnect", reason: REASON, instructionWords: "", hasImage: true, worker: WORKER }),
    null,
  );

  assert.equal(
    itoSendProblem({ work: "disconnect", reason: REASON, instructionWords: "", hasImage: false, worker: WORKER }),
    null,
    "neither words nor an image still sends - the reason is what is required",
  );

  assert.equal(build({ instructionWords: "", hasImage: true }).ok, true);
});

test("the transactions whose reasons are not settled cannot be sent at all", () => {
  // Only disconnection has an agreed reason list. An empty list is the honest
  // answer, and it stops the office sending work nobody has designed.
  for (const work of ["reconnect", "inspect", "remove", "read"]) {
    assert.ok(itoSendProblem({ work, worker: WORKER, instructionWords: "Do it" }));
  }
});

test("an Other with no explanation still reads NAv rather than blank", () => {
  assert.equal(build().request.assignment.instruction.reason.explanation, "NAv");
});

test("a meter with no premise is refused, in words the office can act on", () => {
  const out = build({ meter: { ...METER, accessData: { ...METER.accessData, premise: {} } } });

  assert.equal(out.ok, false);
  assert.match(out.message, /premise/i);
  assert.ok(!/undefined|null|INVALID_/.test(out.message), "no jargon in a refusal");
});

test("a meter with no workbase or ward is refused, because the job could never be found", () => {
  for (const parents of [{}, { lmPcode: "ZA5241" }, { wardPcode: "ZA5241006" }]) {
    const out = build({ meter: { ...METER, accessData: { ...METER.accessData, parents } } });

    assert.equal(out.ok, false, `parents ${JSON.stringify(parents)} must be refused`);
    assert.match(out.message, /workbase|ward/i);
  }
});

test("no worker and no reason are each refused before anything is sent", () => {
  assert.equal(build({ worker: null }).ok, false);
  assert.match(build({ worker: null }).message, /field worker/i);

  assert.equal(build({ reason: null }).ok, false);
  assert.match(build({ reason: null }).message, /why/i);
});

test("an unknown button sends nothing", () => {
  assert.equal(build({ work: "vend" }).ok, false);
  assert.equal(build({ work: "" }).ok, false);
});

test("the attached image travels with the request", () => {
  const media = [{ tag: "instructionMedia", url: "https://example/one.jpg" }];

  assert.deepEqual(build({ media }).request.media, media);
  assert.deepEqual(build().request.media, [], "and nothing is invented when there is none");
});

test("an issued job does not claim the worker reached the meter", () => {
  // Found in the owner's first office job: hasAccess "yes" on work nobody had
  // done, copied out of the meter's own block where a worker really did reach
  // it the day it was discovered. Access is settled at the service point and
  // nowhere else; until then there is nothing to write, and nothing to write
  // reads NAv.
  const meterThatWasReached = {
    ...METER,
    accessData: {
      ...METER.accessData,
      access: { hasAccess: "yes", reason: "NAv" },
    },
  };

  const { accessData } = build({ meter: meterThatWasReached }).request;

  assert.equal(accessData.access.hasAccess, "NAv");
  assert.equal(accessData.access.reason, "NAv");
  assert.equal(accessData.erfNo, "5213", "the rest of the block is still carried");
  assert.equal(accessData.premise.id, "PRM_1");
});

test("an instruction with no words stores NAv, never blank", () => {
  const { instruction } = build({ instructionWords: "", hasImage: true }).request.assignment;

  assert.equal(instruction.text, "NAv");
});
