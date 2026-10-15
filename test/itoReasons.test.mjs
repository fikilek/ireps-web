import { resolve } from "node:path";
// Why the office is sending this work: the reason list behind the ITO page.
// `DR-R001` 3.4, `UI-R006` 1.2.0.
//
// WHAT THESE GUARD. Not that a dropdown has four entries — that is not where
// this breaks. It breaks when the WORDS change and the stored value changes
// with them, because then every record written under the old words stops
// being countable. The owner settled that on 9 October: the reason is stored
// as a code as well as words, and this wording is changing right now, from
// Credit Control Instruction to Client instruction and from Non Payment to
// Customer instruction. So most of what follows checks the codes, which must
// not move, rather than the words, which just did.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ITO_REASONS_BY_WORK,
  itoReasonByCode,
  itoReasonProblem,
  itoReasonsFor,
} from "../src/components/ito/itoReasons.js";

const disconnect = itoReasonsFor("disconnect");

test("a disconnection offers the four reasons the owner settled", () => {
  assert.deepEqual(
    disconnect.map((r) => r.words),
    ["Illegal connection", "Client instruction", "Customer instruction", "Other"],
  );
});

test("the codes are the ones already written on the phone", async () => {
  // The phone has been writing these three since before the rewording. If this
  // list invented its own codes, a disconnection sent from the office and one
  // started in the field would be the same reason under two different values,
  // and no report could add them together.
  const source = await readFile(
    process.env.IREPS_MOBILE_ROOT ? resolve(process.env.IREPS_MOBILE_ROOT, "src/features/meters/formOptions.js") : new URL(
      "../../ireps-mobile/src/features/meters/formOptions.js",
      import.meta.url,
    ),
    "utf8",
  );

  for (const code of ["ILLEGAL_CONNECTION", "CREDIT_CONTROL_INSTRUCTION", "NON_PAYMENT"]) {
    assert.ok(
      source.includes(`"${code}"`),
      `${code} must be the code the phone already writes, not a new one`,
    );
    assert.ok(
      disconnect.some((r) => r.code === code),
      `${code} must still be offered — a code is never renumbered to tidy it`,
    );
  }
});

test("the words moved and the codes did not", () => {
  // The exact pairing the owner asked for. A record written last month under
  // "Credit Control Instruction" reads "Client instruction" today and is still
  // the same row in the same count.
  assert.equal(itoReasonByCode("disconnect", "CREDIT_CONTROL_INSTRUCTION").words, "Client instruction");
  assert.equal(itoReasonByCode("disconnect", "NON_PAYMENT").words, "Customer instruction");
  assert.equal(itoReasonByCode("disconnect", "ILLEGAL_CONNECTION").words, "Illegal connection");
});

test("a code is found however it is cased, and an unknown one is not invented", () => {
  assert.equal(itoReasonByCode("disconnect", "non_payment")?.code, "NON_PAYMENT");
  assert.equal(itoReasonByCode("disconnect", "NOT_A_REASON"), null);
  assert.equal(itoReasonByCode("disconnect", ""), null);
  assert.equal(itoReasonByCode("disconnect", undefined), null);
});

test("Other may never be sent empty", () => {
  // UI-R006 1.2.0, the owner's global rule: no iREPS form may ever be
  // submitted with an empty Other. Blank, spaces and a line break are all the
  // same empty, and each of them has to be refused by name or one gets through.
  for (const said of [undefined, null, "", "   ", "\t", "\n", "  \n "]) {
    assert.ok(
      itoReasonProblem({ work: "disconnect", code: "OTHER", explanation: said }),
      `an Other explanation of ${JSON.stringify(said)} must be refused`,
    );
  }

  assert.equal(
    itoReasonProblem({ work: "disconnect", code: "OTHER", explanation: "Court order" }),
    null,
  );
});

test("the other three reasons need no explanation", () => {
  for (const code of ["ILLEGAL_CONNECTION", "CREDIT_CONTROL_INSTRUCTION", "NON_PAYMENT"]) {
    assert.equal(itoReasonProblem({ work: "disconnect", code }), null);
  }
});

test("no reason chosen is refused in words the office can act on", () => {
  const problem = itoReasonProblem({ work: "disconnect", code: "" });

  assert.ok(problem);
  assert.ok(!/undefined|null|error|invalid/i.test(problem), "no jargon in a refusal");
});

test("all five are settled now, and nothing is invented beyond them", () => {
  // AMENDED IN PLACE, 13 October 2026. This said "only disconnection is
  // settled", which was true and is no longer: the owner settled reconnection
  // and then "after RCN .. do all the other TRNs also". The principle it was
  // guarding is unchanged and still guarded below - a list iREPS has not been
  // given is EMPTY, never plausible.
  assert.deepEqual(
    Object.keys(ITO_REASONS_BY_WORK).sort(),
    ["disconnect", "inspect", "read", "reconnect", "remove"],
  );

  // Ask for work iREPS does not do and you get nothing, not a guess.
  for (const unknown of ["commission", "install", "discover", "nonsense"]) {
    assert.deepEqual(itoReasonsFor(unknown), []);
  }

  assert.deepEqual(itoReasonsFor(""), []);
  assert.deepEqual(itoReasonsFor(undefined), []);
});

test("the page reads the well and does not keep a list of its own", async () => {
  // One well. A screen that writes its own options is how two lists for one
  // thing start, and the second one is never updated.
  const page = await readFile(
    new URL("../src/pages/operations/ItoPage.jsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /itoReasonsFor/, "the page must ask the well for the reasons");
  assert.match(page, /itoReasonProblem/, "the page must ask the well what blocks a send");

  for (const words of ["Client instruction", "Customer instruction", "Illegal connection"]) {
    assert.ok(
      !page.includes(words),
      `"${words}" is written in the page as well as the well — one of them will go stale`,
    );
  }
});

test("the button, the route and the page agree on one address", async () => {
  // The route was renamed off "credit control" when the owner named this ITO.
  // A registry that still navigates to the old path reaches no page at all.
  const [routes, registry] = await Promise.all([
    readFile(new URL("../src/routes/AppRoutes.jsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/pages/registries/MetersRegistryPage.jsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(routes, /path="\/operations\/ito\/:astId\/:work"/);
  assert.match(registry, /\/operations\/ito\/\$\{row\.id\}\/\$\{work\}/);
  assert.ok(!routes.includes("credit-control/"), "the old route is gone");
  assert.ok(!registry.includes("credit-control/"), "the old address is gone");
});

// ---------------------------------------------------------------------------
// `DR-R001` 3.4.1, owner 13 October 2026: every transaction's reasons.
// These pin the CODES, never the words - 3.4 stores a code precisely so the
// words can be reworded without making old records uncountable, and that is
// exactly what happened to the disconnection pair on 9 and 13 October.
// ---------------------------------------------------------------------------

test("every ITO transaction now offers reasons, and none offers none", () => {
  for (const work of ["disconnect", "reconnect", "inspect", "remove", "read"]) {
    const list = itoReasonsFor(work);

    assert.ok(list.length >= 2, `${work} offers reasons`);
    assert.ok(list.some((r) => r.code === "OTHER"), `${work} offers Other`);
    assert.ok(
      list.find((r) => r.code === "OTHER").needsExplanation,
      `${work}'s Other demands its explanation (UI-R006 1.2.0)`,
    );
  }
});

test("the reconnection reasons the owner settled", () => {
  assert.deepEqual(
    itoReasonsFor("reconnect").map((r) => r.code),
    ["PAYMENT_RECEIVED", "CLIENT_INSTRUCTION", "OTHER"],
  );
});

test("Client instruction is one word for one thing, across both lanes", () => {
  // Owner: "lets stick to 'client instruction' for both DCN and RCN". The LM
  // IS the client, so the same party's instruction must not wear two names.
  const words = (work) =>
    itoReasonsFor(work).find((r) => /client/i.test(r.words))?.words;

  assert.equal(words("disconnect"), "Client instruction");
  assert.equal(words("reconnect"), "Client instruction");
});

test("...but the two carry DIFFERENT codes, so the counts stay apart", () => {
  // The office counts a client's disconnection instruction separately from a
  // client's reconnection instruction. Merging them under one number is a
  // thing no later rewording could undo.
  const codeFor = (work) =>
    itoReasonsFor(work).find((r) => r.words === "Client instruction").code;

  assert.equal(codeFor("disconnect"), "CREDIT_CONTROL_INSTRUCTION");
  assert.equal(codeFor("reconnect"), "CLIENT_INSTRUCTION");
  assert.notEqual(codeFor("disconnect"), codeFor("reconnect"));
});

test("the codes already on the phone are reused, never renumbered", () => {
  // Inspection, Removal and Meter Reading had real lists in the mobile repo
  // long before the web had any. Changing a code would make every record
  // captured under it uncountable.
  assert.deepEqual(itoReasonsFor("inspect").map((r) => r.code),
    ["CHECK_ILLEGAL_CONNECTION", "GENERAL_INSPECTION", "OTHER"]);

  assert.deepEqual(itoReasonsFor("remove").map((r) => r.code),
    ["REMOVE_METER", "REPLACE_METER_STEP_1", "OTHER"]);

  assert.deepEqual(itoReasonsFor("read").map((r) => r.code),
    ["MONTHLY_METER_READING", "ROUTINE_METER_READING", "VERIFY_METER_READING",
     "FINAL_METER_READING", "INVESTIGATION_METER_READING", "BULK_METER_READING", "OTHER"]);
});

test("RECONNECT_METER is gone from the offered list", () => {
  // It said "Reconnect meter" on a reconnection - the transaction's own name,
  // not a reason for sending it. Retired from the list; records carrying it
  // are untouched.
  assert.ok(!itoReasonsFor("reconnect").some((r) => r.code === "RECONNECT_METER"));
});
