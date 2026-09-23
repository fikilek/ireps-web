// TB-R066 (1.3.71): a replaced meter carries its batch row and the Sales record's
// field work to the new meter, and leaves the statuses alone.
import test from "node:test";
import assert from "node:assert/strict";

import { recordReplacedMeter } from "../targetedBatches/replacedMeter.js";

const OLD_AST = "TRN_MDIS_OLD";
const NEW_AST = "TRN_MINST_NEW";
const ROW = "TBR_1";
const SALES = "04297749733";
const AT = "2026-09-23T03:00:00.000Z";

const copy = (value) => JSON.parse(JSON.stringify(value));

function world({ rowRefsMeterId = OLD_AST } = {}) {
  const store = new Map(
    Object.entries({
      [`tb_rows/${ROW}`]: {
        id: ROW,
        salesAllMeterId: SALES,
        meter: { numberRaw: SALES },
        execution: { outcome: "METER_DISCOVERED", status: "COMPLETED", foundMeterNo: null },
        refs: { meterId: rowRefsMeterId, trnId: OLD_AST, erfId: "ERF_1" },
        metadata: { updatedAt: "2026-09-23T02:34:00.000Z" },
      },
      [`sales-all-meters/${SALES}`]: {
        meterNo: SALES,
        master: { id: SALES, visibility: "VISIBLE" },
        tbRefs: [
          {
            id: "TGB_1",
            rowId: ROW,
            fieldWork: {
              status: "COMPLETED",
              outcomeCode: "METER_DISCOVERED",
              targetedMeterNo: SALES,
              discoveredMeterNo: SALES,
              meterMatch: true,
              meterId: OLD_AST,
              trnId: OLD_AST,
            },
          },
        ],
      },
    }).map(([path, data]) => [path, copy(data)]),
  );

  const doc = (path) => ({
    path,
    id: path.split("/").pop(),
    get: async () => ({
      exists: store.has(path),
      id: path.split("/").pop(),
      data: () => store.get(path),
    }),
  });

  const rows = (key) =>
    key === `tb_rows|refs.meterId=${rowRefsMeterId}`
      ? [{ id: ROW, data: () => store.get(`tb_rows/${ROW}`) }]
      : [];

  const query = (key) => ({
    where: (field, _op, value) => query(`${key}|${field}=${value}`),
    get: async () => ({ docs: rows(key) }),
  });

  return {
    store,
    collection: (name) => ({
      doc: (id) => doc(`${name}/${id}`),
      where: (field, _op, value) => query(`${name}|${field}=${value}`),
    }),
    runTransaction: async (run) =>
      run({
        get: (ref) => ref.get(),
        update: (ref, data) => {
          const next = copy(store.get(ref.path) || {});
          for (const [key, value] of Object.entries(data)) {
            const parts = key.split(".");
            let node = next;
            while (parts.length > 1) node = node[parts.shift()] ??= {};
            node[parts[0]] = value;
          }
          store.set(ref.path, next);
        },
      }),
  };
}

const run = (db) =>
  recordReplacedMeter({
    db,
    replacedAstId: OLD_AST,
    replacedMeterNo: SALES,
    newAstId: NEW_AST,
    newMeterNo: "07134286754",
    installationTrnId: NEW_AST,
    at: AT,
  });

test("the row and the field work point at the new meter, and the number found is recorded", async () => {
  const db = world();
  const results = await run(db);

  assert.deepEqual(
    results.map((r) => r.code),
    ["ROW_AND_SALES"],
  );

  const row = db.store.get(`tb_rows/${ROW}`);
  assert.equal(row.refs.meterId, NEW_AST);
  assert.equal(row.refs.trnId, NEW_AST);
  assert.equal(row.execution.foundMeterNo, "07134286754");
  assert.equal(row.execution.replacedMeterNo, SALES);
  // the work is done and stays done
  assert.equal(row.execution.status, "COMPLETED");
  assert.equal(row.meter.numberRaw, SALES, "the number the batch was sent for stays");

  const fieldWork = db.store.get(`sales-all-meters/${SALES}`).tbRefs[0].fieldWork;
  assert.equal(fieldWork.meterId, NEW_AST, "My Work Orders opens the meter that is there");
  assert.equal(fieldWork.discoveredMeterNo, "07134286754");
  assert.equal(fieldWork.replacedMeterNo, SALES);
  assert.equal(fieldWork.meterMatch, false);
  assert.equal(fieldWork.status, "COMPLETED");

  // the Sales meter was found, so it stays Completed and visible (owner, 23 Sep 2026)
  assert.equal(db.store.get(`sales-all-meters/${SALES}`).master.visibility, "VISIBLE");
});

test("running it again writes nothing", async () => {
  const db = world();
  await run(db);
  const after = copy(db.store.get(`tb_rows/${ROW}`));

  const again = await recordReplacedMeter({
    db,
    replacedAstId: OLD_AST,
    replacedMeterNo: SALES,
    newAstId: NEW_AST,
    newMeterNo: "07134286754",
    at: AT,
  });

  assert.deepEqual(db.store.get(`tb_rows/${ROW}`), after);
  assert.ok(again.every((r) => r.decision !== "RECORD" || r.code !== "ROW_AND_SALES"));
});

test("a meter on no batch, or an installation that replaces nothing, changes nothing", async () => {
  const db = world({ rowRefsMeterId: "SOMEONE_ELSE" });
  assert.deepEqual(await run(db), []);

  assert.deepEqual(
    await recordReplacedMeter({ db: world(), replacedAstId: "", newAstId: NEW_AST }),
    [],
  );
  assert.deepEqual(
    await recordReplacedMeter({ db: world(), replacedAstId: OLD_AST, newAstId: OLD_AST }),
    [],
  );
});
