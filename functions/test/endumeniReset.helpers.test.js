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

test("reference cleanup removes exact operational IDs only", () => {
  const result = removeExactReferences({premiseId: "P1", note: "P1", ids: ["P1", "P2"], nested: {meterId: "M1"}}, new Set(["P1", "M1"]));
  assert.deepEqual(result, {note: "P1", ids: ["P2"], nested: {}});
});

test("sales cleanup preserves the document and removes operational links", () => {
  assert.deepEqual(cleanSales({amount: 10, tbRefs: [{id: "TB1"}], premiseId: "P1", master: {visibility: "VISIBLE"}}, new Set(["P1"])), {amount: 10, master: {visibility: "INVISIBLE"}});
});
