// A REFUSAL AND A FAILURE ARE NOT THE SAME THING.
//
// The owner, on TEST: a window headed CANNOT BE WORKED ON YET over the words
// "This meter could not be checked", with no checks listed. Two faults in one
// screen:
//
//   it ACCUSED THE METER for something that was wrong in iREPS - the heading
//   is a statement about the meter's records, and the check had not run;
//
//   and it THREW THE CAUSE AWAY. The page caught the error with a bare
//   `catch {}`, so after he reported it there was nothing to investigate
//   with. Then it told him to "try again", which is advice about a cause
//   nobody kept.
//
// These read the source, because what is being guarded is that the error is
// KEPT and that the two cases are drawn differently - neither of which a
// behavioural test on a happy path would notice.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");

test("the page keeps the error instead of swallowing it", async () => {
  const page = await read("../src/pages/registries/MetersRegistryPage.jsx");

  assert.doesNotMatch(page, /\} catch \{/, "a bare catch throws the cause away");
  assert.match(page, /\} catch \(error\) \{/);
  assert.match(page, /console\.error\("Meter registration check could not run"/);
});

test("the page does not tell the office to try again", async () => {
  const page = await read("../src/pages/registries/MetersRegistryPage.jsx");
  const callable = await read("../functions/meterLifecycle/checkRegistrationCallable.js");

  // Nothing here knows whether the cause will pass. Checked against the code
  // with its comments stripped, because the comments SAY "Try again" - they
  // record what the office used to be told, and a test that cannot tell a
  // comment from a message would forbid writing that down.
  const withoutComments = (source) =>
    source
      .split(String.fromCharCode(10))
      .filter((line) => !line.trim().startsWith("//"))
      .join(String.fromCharCode(10));

  for (const [name, source] of [["page", page], ["callable", callable]]) {
    assert.doesNotMatch(withoutComments(source), /Try again/, name);
  }
});

test("a check that could not run is marked as such, not as the meter's fault", async () => {
  const page = await read("../src/pages/registries/MetersRegistryPage.jsx");

  assert.match(page, /kind: "unavailable"/);
  assert.match(page, /kind: "refused"/);
});

test("the window says the two cases in different words", async () => {
  const modal = await read("../src/pages/registries/components/RegistrationGuardModal.jsx");

  assert.match(modal, /kind === "unavailable"/);
  assert.match(modal, /Could not be checked/);
  assert.match(modal, /Cannot be worked on yet/);

  // And it says plainly that the meter is not being accused.
  assert.match(modal, /says nothing about the meter itself/);
});

test("the failure carries something to report", async () => {
  const callable = await read("../functions/meterLifecycle/checkRegistrationCallable.js");

  assert.match(callable, /CHECK_COULD_NOT_RUN/);
  assert.match(callable, /detail: error\?\.message/);
  assert.doesNotMatch(callable, /"UNKNOWN_ERROR"/, "a code with no detail cannot be reported");
});

test("the window reads the shape the endpoint actually throws", async () => {
  // Found by an adversarial review of the morning's own fix. The endpoint
  // rejects with RTK Query's shape - { status, error } - so reading `code` and
  // `message` left the code and the detail ALWAYS EMPTY, and the window said
  // no more than the version it replaced.
  const api = await read("../src/redux/creditControlApi.js");
  const page = await read("../src/pages/registries/MetersRegistryPage.jsx");

  // this is what it throws
  assert.match(api, /status: "REGISTRATION_CHECK_FAILED"/);
  assert.match(api, /error: error\?\.message \|\| String\(error\)/);

  // so this is what the page must read, before anything else
  const codeRead = page.slice(page.indexOf("const code = String("), page.indexOf("const detail = String("));
  const detailRead = page.slice(page.indexOf("const detail = String("));

  assert.ok(codeRead.indexOf("error?.status") < codeRead.indexOf("error?.code"), "status first");
  assert.ok(
    detailRead.indexOf("error?.error") < detailRead.indexOf("error?.message"),
    "the endpoint's own `error` field first",
  );
});
