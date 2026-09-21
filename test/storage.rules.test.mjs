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
  listAll,
  ref,
  uploadBytes,
} from "firebase/storage";

const PROJECT_ID = "demo-ireps-report-platform";
const OWNER_A = "UserA";
const OWNER_B = "UserB";

const REPORT_PATH =
  "generated-reports/UserA/USER_ACTIVITY/RPT123/report.xlsx";

const SECOND_REPORT_PATH =
  "generated-reports/UserA/USER_ACTIVITY/RPT456/report-2.xlsx";

const TEST_BYTES = new Uint8Array([73, 82, 69, 80, 83]);

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

async function upload(
  storage,
  path,
  {
    bytes = TEST_BYTES,
    contentType = "application/octet-stream",
  } = {},
) {
  return uploadBytes(objectRef(storage, path), bytes, { contentType });
}

async function uploadReport(storage, path = REPORT_PATH) {
  return upload(storage, path, {
    contentType: XLSX_CONTENT_TYPE,
  });
}

async function read(storage, path) {
  return getBytes(objectRef(storage, path));
}

async function remove(storage, path) {
  return deleteObject(objectRef(storage, path));
}

async function seed(path, {
  contentType = "application/octet-stream",
} = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await upload(context.storage(), path, { contentType });
  });
}

before(async () => {
  const rules = await readFile(
    new URL("../storage.rules", import.meta.url),
    "utf8",
  );

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

describe("Storage policy: saved reports belong to their owner, other paths keep signed-in access", () => {
  test("authenticated users retain read/write/delete access to existing non-report Storage paths", async () => {
    const userA = storageForAuthenticatedUser(OWNER_A);
    const userB = storageForAuthenticatedUser(OWNER_B);

    const paths = [
      "meters/test/file.jpg",
      "premises/test/file.jpg",
      "informal_erfs/test/file.jpg",
      "trns/test/file.jpg",
      "data-cleansing/test/file.csv",
      "future-unknown-path/deep/object.bin",
    ];

    for (const path of paths) {
      await assertSucceeds(upload(userA, path));
      await assertSucceeds(read(userB, path));
      await assertSucceeds(upload(userB, path));
      await assertSucceeds(remove(userA, path));
    }
  });

  test("the owner may save, read, list and delete their own generated reports (GMR-R004)", async () => {
    const userA = storageForAuthenticatedUser(OWNER_A);

    await assertSucceeds(uploadReport(userA, REPORT_PATH));
    await assertSucceeds(uploadReport(userA, SECOND_REPORT_PATH));
    await assertSucceeds(read(userA, REPORT_PATH));
    await assertSucceeds(listAll(objectRef(userA, "generated-reports/UserA")));
    await assertSucceeds(remove(userA, REPORT_PATH));
  });

  test("another signed-in user can neither read, overwrite, delete nor list someone else's reports", async () => {
    const userB = storageForAuthenticatedUser(OWNER_B);

    await seed(REPORT_PATH, { contentType: XLSX_CONTENT_TYPE });

    await assertFails(read(userB, REPORT_PATH));
    await assertFails(uploadReport(userB, REPORT_PATH));
    await assertFails(remove(userB, REPORT_PATH));
    await assertFails(listAll(objectRef(userB, "generated-reports/UserA")));
    await assertFails(listAll(objectRef(userB, "generated-reports")));
  });

  test("unauthenticated users remain denied everywhere, including generated reports", async () => {
    const guest = storageForUnauthenticatedUser();

    const paths = [
      "meters/test/file.jpg",
      REPORT_PATH,
    ];

    for (const path of paths) {
      await seed(path, {
        contentType: path === REPORT_PATH
          ? XLSX_CONTENT_TYPE
          : "application/octet-stream",
      });

      await assertFails(read(guest, path));
      await assertFails(upload(guest, path));
      await assertFails(remove(guest, path));
    }

    await assertFails(
      listAll(objectRef(guest, "generated-reports")),
    );
  });
});