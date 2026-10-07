// NA-R005 (one shape, 7 October 2026): the Meter Discovery server must tell a RESEND of the
// same visit apart from a DIFFERENT visit arriving under the same transaction id.
//
// WHY THIS TEST EXISTS. Until today the server answered any id it had seen before with
// "already exists, treated as successful", without looking at what the second payload held.
// A repeat after a lost answer is normal and that answer is right for it. A collision is not:
// nothing is written and the worker is told his visit was saved — the same fault that destroyed
// an office No Access capture on this phone, found on 7 October.
//
// It mattered more from today, because the three random characters that used to sit in a no
// access id are gone. They were what made a collision improbable; the comparison is what makes
// it harmless. A safeguard is not removed before the thing it stood in front of is dealt with.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../index.js", import.meta.url),
  "utf8",
);

const guard = source.slice(
  source.indexOf("onMeterDiscoveryCallable --trn already exists") - 3000,
  source.indexOf("onMeterDiscoveryCallable --trn already exists") + 3000,
);

test("a different visit under an existing id is refused, not called a success", () => {
  assert.match(
    guard,
    /sameCapture/,
    "the server must compare the incoming visit with the one it already holds",
  );
  assert.match(
    guard,
    /TRN_ALREADY_EXISTS/,
    "a collision must be refused out loud, so the worker can save the work again",
  );
});

test("the comparison looks at the work, the premise and the worker", () => {
  for (const [what, pattern] of [
    ["the kind of work", /accessData\?\.trnType/],
    ["the premise", /accessData\?\.premise\?\.id/],
    ["the worker", /createdByUid|createdOnDeviceByUid/],
  ]) {
    assert.match(
      guard,
      pattern,
      `${what} must be part of deciding whether this is the same visit`,
    );
  }
});

test("the refusal comes before the success, or it can never be reached", () => {
  const refusal = guard.indexOf("TRN_ALREADY_EXISTS");
  const success = guard.indexOf("TRN already exists and is treated as successful");

  assert.ok(refusal > -1 && success > -1, "both answers must exist");
  assert.ok(
    refusal < success,
    "a collision must be caught before the id is treated as a success",
  );
});
