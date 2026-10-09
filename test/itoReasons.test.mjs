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
    new URL(
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

test("only disconnection is settled, and nothing is invented for the rest", () => {
  // The owner deferred the option lists for every transaction other than
  // disconnection until its own process is designed. An empty list is the
  // honest answer; a plausible one would be a decision nobody made.
  assert.deepEqual(Object.keys(ITO_REASONS_BY_WORK), ["disconnect"]);

  for (const work of ["reconnect", "inspect", "remove", "read"]) {
    assert.deepEqual(itoReasonsFor(work), []);
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
