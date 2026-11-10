import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";

const projectId = "demo-ireps-qa";
const batchId = "MD_BGO_TEST_BATCH";
let env;

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "This test must never use a real database");
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8087,
      rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    await Promise.all([
      setDoc(doc(context.firestore(), "users/active-field-worker"), {
        accountStatus: "ACTIVE",
        employment: { role: "FWR" },
      }),
      setDoc(doc(context.firestore(), "users/inactive-field-worker"), {
        accountStatus: "DISABLED",
        employment: { role: "FWR" },
      }),
      setDoc(doc(context.firestore(), "bgo_rows/row-1"), {
        id: "row-1",
        bgoBatchId: batchId,
        scope: { lmPcode: "ZA5241" },
        workflow: { state: "READY_FOR_ALLOCATION" },
      }),
    ]);
  });
});

after(async () => env?.cleanup());

test("active MD BGO client receives the initial batch row and a live update", async () => {
  const db = env.authenticatedContext("active-field-worker").firestore();
  const rowsQuery = query(collection(db, "bgo_rows"), where("bgoBatchId", "==", batchId));
  const initial = await assertSucceeds(getDocs(rowsQuery));
  assert.equal(initial.size, 1);

  let unsubscribe;
  let eventCount = 0;
  let initialReceived;
  const initialSnapshot = new Promise((resolve) => { initialReceived = resolve; });
  const updatedState = new Promise((resolve, reject) => {
    unsubscribe = onSnapshot(
      rowsQuery,
      (snapshot) => {
        eventCount += 1;
        const row = snapshot.docs[0]?.data();
        if (eventCount === 1) initialReceived();
        if (row?.workflow?.state === "IN_PROGRESS") resolve({ eventCount, row });
      },
      reject,
    );
  });

  try {
    await initialSnapshot;
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "bgo_rows/row-1"), {
        "workflow.state": "IN_PROGRESS",
      });
    });
    const received = await updatedState;
    assert.ok(received.eventCount >= 2, "listener should receive its initial snapshot and a later update");
    assert.equal(received.row.workflow.state, "IN_PROGRESS");
  } finally {
    unsubscribe?.();
  }
});

test("unauthenticated and inactive clients cannot read MD BGO rows", async () => {
  const rowsQuery = (db) => query(collection(db, "bgo_rows"), where("bgoBatchId", "==", batchId));
  await assertFails(getDocs(rowsQuery(env.unauthenticatedContext().firestore())));
  await assertFails(getDocs(rowsQuery(env.authenticatedContext("inactive-field-worker").firestore())));
});

test("active clients cannot write MD BGO rows directly", async () => {
  const db = env.authenticatedContext("active-field-worker").firestore();
  await assertFails(setDoc(doc(db, "bgo_rows/forged-row"), {
    id: "forged-row",
    bgoBatchId: batchId,
    scope: { lmPcode: "ZA5241" },
  }));
});
