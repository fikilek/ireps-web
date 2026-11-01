// AU-R001 11: one email per person, changed by the person with a link or by the office at once.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  looksLikeEmail,
  mayChangeEmailOf,
  normaliseEmail,
} from "../auth/emailChange.js";

const person = (role, spId = "sp-a") => ({
  employment: { role, serviceProvider: { id: spId } },
});

test("an email is read in one shape", () => {
  assert.equal(normaliseEmail("  Mandy.Mandy@Gmail.COM "), "mandy.mandy@gmail.com");
  assert.ok(looksLikeEmail("mandy.mandy@gmail.com"));
  assert.ok(!looksLikeEmail("mandy.mandy@gmail"));
  assert.ok(!looksLikeEmail("mandy mandy@gmail.com"));
  assert.ok(!looksLikeEmail(""));
});

test("nobody changes their own this way", () => {
  for (const role of ["SPU", "ADM", "MNG", "SPV", "FWR"]) {
    assert.deepEqual(
      mayChangeEmailOf({
        callerUid: "u1",
        caller: person(role),
        targetUid: "u1",
        target: person(role),
      }),
      { allowed: false, reason: "own" },
    );
  }
});

test("the SPU may change anybody's, an admin anybody's but the SPU's", () => {
  for (const role of ["SPU", "ADM", "MNG", "SPV", "FWR"]) {
    assert.equal(
      mayChangeEmailOf({
        callerUid: "spu",
        caller: person("SPU"),
        targetUid: "t",
        target: person(role),
      }).allowed,
      true,
    );
  }

  for (const role of ["ADM", "MNG", "SPV", "FWR"]) {
    assert.equal(
      mayChangeEmailOf({
        callerUid: "adm",
        caller: person("ADM"),
        targetUid: "t",
        target: person(role),
      }).allowed,
      true,
    );
  }

  assert.equal(
    mayChangeEmailOf({
      callerUid: "adm",
      caller: person("ADM"),
      targetUid: "t",
      target: person("SPU"),
    }).allowed,
    false,
  );
});

test("a manager may change only field workers and supervisors of their own service providers", () => {
  const manager = { callerUid: "mng", caller: person("MNG", "sp-a") };
  const tree = ["sp-a", "sp-a-sub"];

  for (const role of ["FWR", "SPV"]) {
    assert.equal(
      mayChangeEmailOf({
        ...manager,
        targetUid: "t",
        target: person(role, "sp-a-sub"),
        managerServiceProviderIds: tree,
      }).allowed,
      true,
    );

    assert.equal(
      mayChangeEmailOf({
        ...manager,
        targetUid: "t",
        target: person(role, "sp-other"),
        managerServiceProviderIds: tree,
      }).allowed,
      false,
      "not outside the manager's own service providers",
    );
  }

  for (const role of ["MNG", "ADM", "SPU"]) {
    assert.equal(
      mayChangeEmailOf({
        ...manager,
        targetUid: "t",
        target: person(role, "sp-a"),
        managerServiceProviderIds: tree,
      }).allowed,
      false,
    );
  }
});

test("supervisors and field workers change nobody's", () => {
  for (const role of ["SPV", "FWR", ""]) {
    assert.equal(
      mayChangeEmailOf({
        callerUid: "x",
        caller: person(role),
        targetUid: "t",
        target: person("FWR"),
        managerServiceProviderIds: ["sp-a"],
      }).allowed,
      false,
    );
  }
});

test("the office change moves the sign-in and the record together, and the record follows the sign-in", async () => {
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");

  const change = source.slice(
    source.indexOf("export const changeUserEmail"),
    source.indexOf("export const syncSignInEmail"),
  );
  const sync = source.slice(
    source.indexOf("export const syncSignInEmail"),
    source.indexOf("export const authorizeFieldWorker"),
  );

  assert.ok(change.length > 0 && sync.length > 0);

  // Both the sign-in and the record, the sign-in first.
  const authAt = change.indexOf("auth.updateUser(targetUid, { email: newEmail })");
  const recordAt = change.indexOf('"profile.email": newEmail');
  assert.ok(authAt > -1 && recordAt > authAt);

  // Refuses an email another account uses, and the rules of who may.
  assert.match(change, /auth\.getUserByEmail\(newEmail\)/);
  assert.match(change, /mayChangeEmailOf\(/);

  // Nothing else about the person changes.
  assert.doesNotMatch(change, /password|employment\.role|onboarding|activeWorkbase/);

  // The sync reads the sign-in email itself; the phone cannot write one in.
  assert.match(sync, /auth\.getUser\(caller\.uid\)/);
  assert.doesNotMatch(sync, /data\?\.email|request\.data/);
});

test("a change that happened is never reported as failed, and is kept on record", async () => {
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");

  const change = source.slice(
    source.indexOf("export const changeUserEmail"),
    source.indexOf("export const syncSignInEmail"),
  );
  const sync = source.slice(
    source.indexOf("export const syncSignInEmail"),
    source.indexOf("export const authorizeFieldWorker"),
  );

  // A stopped account changes nobody's email.
  assert.match(change, /accountStatus \|\| ""\)\.toUpperCase\(\) === "DISABLED"/);

  // Firebase's own refusals come back in words, not as INTERNAL.
  assert.match(change, /auth\/email-already-exists/);
  assert.match(change, /auth\/invalid-email/);

  // After the sign-in has changed, a failed record write does not throw: it says the record lags.
  const afterSignIn = change.slice(change.indexOf("From here the sign-in email HAS changed"));
  assert.doesNotMatch(afterSignIn, /throw new HttpsError/);
  assert.match(afterSignIn, /recordFollowed/);

  // Who changed whose email, from what to what — and the address a sync replaces is kept.
  assert.match(change, /collection\("emailChanges"\)/);
  assert.match(change, /how: "OFFICE"/);
  assert.match(sync, /collection\("emailChanges"\)/);
  assert.match(sync, /recordEmailBefore: recordEmail/);
});
