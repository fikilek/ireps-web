import { after, before, beforeEach, describe, test } from "node:test";
import { readFile } from "node:fs/promises";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteObject,
  getBytes,
  ref,
  uploadBytes,
} from "firebase/storage";

const PROJECT_ID = "demo-ireps-report-platform";
const OWNER_A = "UserA";
const OWNER_B = "UserB";
const REPORT_PATH =
  "generated-reports/UserA/USER_ACTIVITY/RPT123/report.xlsx";
const TEST_BYTES = new Uint8Array([73, 82, 69, 80, 83]);

let testEnv;

function storageForAuthenticatedUser(uid) {
  return testEnv.authenticatedContext(uid).storage();
}

function storageForUnauthenticatedUser() {
  return testEnv.unauthenticatedContext().storage();
}

function objectRef(storage, path) {
  return ref(storage, path);
}

async function upload(storage, path) {
  return uploadBytes(objectRef(storage, path), TEST_BYTES, {
    contentType: "application/octet-stream",
  });
}

async function read(storage, path) {
  return getBytes(objectRef(storage, path));
}

async function remove(storage, path) {
  return deleteObject(objectRef(storage, path));
}

before(async () => {
  const rules = await readFile(new URL("../storage.rules", import.meta.url), "utf8");

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: { rules },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

describe("existing non-report Storage compatibility", () => {
  const knownPaths = [
    "meters/test/file.jpg",
    "premises/test/file.jpg",
    "informal_erfs/test/file.jpg",
    "trns/test/file.jpg",
    "data-cleansing/test/file.csv",
  ];

  for (const path of knownPaths) {
    test(`authenticated users retain read/write/delete access to ${path}`, async () => {
      const userA = storageForAuthenticatedUser(OWNER_A);
      const userB = storageForAuthenticatedUser(OWNER_B);

      await assertSucceeds(upload(userA, path));
      await assertSucceeds(read(userB, path));
      await assertSucceeds(upload(userB, path));
      await assertSucceeds(remove(userA, path));
    });
  }

  test("authenticated access is preserved for an arbitrary unknown non-report path", async () => {
    const userA = storageForAuthenticatedUser(OWNER_A);
    const userB = storageForAuthenticatedUser(OWNER_B);
    const path = "future-unknown-path/deep/object.bin";

    await assertSucceeds(upload(userA, path));
    await assertSucceeds(read(userB, path));
    await assertSucceeds(upload(userB, path));
    await assertSucceeds(remove(userA, path));
  });

  test("authenticated access is preserved for a top-level non-report object", async () => {
    const userA = storageForAuthenticatedUser(OWNER_A);
    const userB = storageForAuthenticatedUser(OWNER_B);
    const path = "legacy-root-object.bin";

    await assertSucceeds(upload(userA, path));
    await assertSucceeds(read(userB, path));
    await assertSucceeds(remove(userB, path));
  });

  test("unauthenticated users remain denied on non-report paths", async () => {
    const userA = storageForAuthenticatedUser(OWNER_A);
    const guest = storageForUnauthenticatedUser();
    const paths = [
      "meters/test/file.jpg",
      "premises/test/file.jpg",
      "arbitrary-existing-path/test/file.bin",
    ];

    for (const path of paths) {
      await assertSucceeds(upload(userA, path));
      await assertFails(read(guest, path));
      await assertFails(upload(guest, path));
      await assertFails(remove(guest, path));
    }
  });
});

describe("generated-reports owner isolation", () => {
  test("owner can read, write and delete the exact canonical report object", async () => {
    const owner = storageForAuthenticatedUser(OWNER_A);

    await assertSucceeds(upload(owner, REPORT_PATH));
    await assertSucceeds(read(owner, REPORT_PATH));
    await assertSucceeds(remove(owner, REPORT_PATH));
  });

  test("another authenticated user cannot read, overwrite or delete the owner's report", async () => {
    const owner = storageForAuthenticatedUser(OWNER_A);
    const otherUser = storageForAuthenticatedUser(OWNER_B);

    await assertSucceeds(upload(owner, REPORT_PATH));
    await assertFails(read(otherUser, REPORT_PATH));
    await assertFails(upload(otherUser, REPORT_PATH));
    await assertFails(remove(otherUser, REPORT_PATH));
  });

  test("unauthenticated users cannot access a canonical report object", async () => {
    const owner = storageForAuthenticatedUser(OWNER_A);
    const guest = storageForUnauthenticatedUser();

    await assertSucceeds(upload(owner, REPORT_PATH));
    await assertFails(read(guest, REPORT_PATH));
    await assertFails(upload(guest, REPORT_PATH));
    await assertFails(remove(guest, REPORT_PATH));
  });

  const malformedPaths = [
    "generated-reports/UserA/invalid",
    "generated-reports/UserA/USER_ACTIVITY",
    "generated-reports/UserA/USER_ACTIVITY/RPT123",
    "generated-reports/UserA/USER_ACTIVITY/RPT123/subdir/file.xlsx",
  ];

  for (const path of malformedPaths) {
    test(`malformed generated-reports path remains denied: ${path}`, async () => {
      const owner = storageForAuthenticatedUser(OWNER_A);

      await assertFails(read(owner, path));
      await assertFails(upload(owner, path));
      await assertFails(remove(owner, path));
    });
  }
});
