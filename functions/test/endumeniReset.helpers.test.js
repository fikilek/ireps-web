import test from "node:test";
import assert from "node:assert/strict";
import {classifyScope, parseStorageReference, removeExactReferences, cleanSales} from "../scripts/tools/endumeni-reset/endumeniReset.helpers.js";

test("scope is anchored to ZA5241 and conflicts block", () => {
  assert.equal(classifyScope({scope: {lmPcode: "ZA5241"}}).scope, "TARGET");
  assert.equal(classifyScope({scope: {lmPcode: "ZA5241"}, other: {lmPcode: "ZA7423"}}).scope, "AMBIGUOUS");
  assert.equal(classifyScope({scope: {lmPcode: "ZA7423"}}).scope, "NON_TARGET");
});

test("storage parser accepts only exact expected bucket objects", () => {
  assert.deepEqual(parseStorageReference("gs://ireps2.appspot.com/media/ZA5241/a.jpg"), {eligible: true, bucket: "ireps2.appspot.com", objectPath: "media/ZA5241/a.jpg"});
  assert.equal(parseStorageReference("gs://other.appspot.com/media/a.jpg").eligible, false);
  assert.equal(parseStorageReference("gs://ireps2.appspot.com/media/*").eligible, false);
});

test("retired reference cleanup cannot remove operational evidence", () => assert.throws(() => removeExactReferences({}, new Set()), /MAINTENANCE_RETIRED/));

test("retired Sales cleanup cannot reset visibility or remove batch history", () => assert.throws(() => cleanSales({}, new Set()), /MAINTENANCE_RETIRED/));
