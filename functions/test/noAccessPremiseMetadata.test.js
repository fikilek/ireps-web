import test from "node:test";
import assert from "node:assert/strict";
import { noAccessPremiseMetadata } from "../noAccess/premiseMetadata.js";

test("a recorded visit advances premise update time with server authorship", () => {
  const metadata = { updatedAt: "2026-10-05T11:38:40.755Z", updatedByUid: "U1", updatedByUser: "Worker", createdOnDevice: "2026-10-04T09:00:00Z" };
  assert.deepEqual(noAccessPremiseMetadata(metadata, { updatedAt: "2026-10-04T13:07:26.907Z" }), {
    "metadata.updatedAt": metadata.updatedAt, "metadata.updatedByUid": "U1", "metadata.updatedByUser": "Worker",
  });
  assert.deepEqual(noAccessPremiseMetadata(metadata, metadata), {});
  assert.deepEqual(noAccessPremiseMetadata(metadata, { updatedAt: "2026-10-06T11:00:00Z" }), {});
  assert.deepEqual(noAccessPremiseMetadata({ updatedAt: "invalid" }), {});
});
test("the installation Timestamp representation is stored as canonical ISO", () => {
  assert.equal(noAccessPremiseMetadata({ updatedAt: { toDate: () => new Date("2026-10-05T11:00:00Z") } })['metadata.updatedAt'], "2026-10-05T11:00:00.000Z");
});
