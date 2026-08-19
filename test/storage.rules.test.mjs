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

async function upload(storage, path, {
  bytes = TEST_BYTES,
  contentType = "application/octet-stream",
  customMetadata,
} = {}) {
  const metadata = { contentType };
  if (customMetadata) metadata.customMetadata = customMetadata;
  return uploadBytes(objectRef(storage, path), bytes, metadata);
}

async function uploadReport(storage, path = REPORT_PATH, options = {}) {
  return upload(storage, path, {
    contentType: XLSX_CONTENT_TYPE,
    ...options,
  });
}

async function read(storage, path) {
  return getBytes(objectRef(storage, path));
}

async function remove(storage, path) {
  return deleteObject(objectRef(storage, path));
}

async function seedReport(path = REPORT_PATH, options = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadReport(context.storage(), path, options);
  });
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

describe("generated-reports create-only browser ingress", () => {
  test("owner can create an exact canonical XLSX report object", async () => {
    const owner = storageForAuthenticatedUser(OWNER_A);
    await assertSucceeds(uploadReport(owner));
  });

  test("owner can create an exact canonical PDF report object", async () => {
    const owner = storageForAuthenticatedUser(OWNER_A);
    const path = "generated-reports/UserA/QUICK_TRN/RPT456/report.pdf";

    await assertSucceeds(upload(owner, path, {
      contentType: "application/pdf",
    }));
  });

  test("another authenticated user cannot create inside the owner's path", async () => {
    const otherUser = storageForAuthenticatedUser(OWNER_B);
    await assertFails(uploadReport(otherUser));
  });

  test("unauthenticated user cannot create a generated report", async () => {
    const guest = storageForUnauthenticatedUser();
    await assertFails(uploadReport(guest));
  });

  test("zero-byte generated reports are rejected", async () => {
    const owner = storageForAuthenticatedUser(OWNER_A);
    await assertFails(uploadReport(owner, REPORT_PATH, {
      bytes: new Uint8Array(),
    }));
  });

  test("unsupported generated-report MIME is rejected", async () => {
    const owner = storageForAuthenticatedUser(OWNER_A);
    await assertFails(upload(owner, REPORT_PATH, {
      contentType: "application/octet-stream",
    }));
  });

  for (const reservedKey of [
    "irepsReportState",
    "irepsReportSchemaVersion",
    "irepsReportManifestB64",
  ]) {
    test(`browser cannot supply reserved metadata ${reservedKey}`, async () => {
      const owner = storageForAuthenticatedUser(OWNER_A);
      await assertFails(uploadReport(owner, REPORT_PATH, {
        customMetadata: { [reservedKey]: "forged" },
      }));
    });
  }

  test("owner cannot directly read a managed report after creation", async () => {
    const owner = storageForAuthenticatedUser(OWNER_A);
    await seedReport();
    await assertFails(read(owner, REPORT_PATH));
  });

  test("owner cannot list managed reports", async () => {
    const owner = storageForAuthenticatedUser(OWNER_A);
    await seedReport();
    await assertFails(listAll(objectRef(owner, "generated-reports/UserA")));
  });

  test("owner cannot overwrite or update a managed report after creation", async () => {
    const owner = storageForAuthenticatedUser(OWNER_A);
    await seedReport();
    await assertFails(uploadReport(owner));
  });

  test("owner cannot directly delete a managed report after creation", async () => {
    const owner = storageForAuthenticatedUser(OWNER_A);
    await seedReport();
    await assertFails(remove(owner, REPORT_PATH));
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
      await assertFails(uploadReport(owner, path));
      await assertFails(remove(owner, path));
    });
  }
});
