// Create at the button, allocate on the ITO page. `DR-R001` 3.2, 3.4, 5.
//
// Owner, 11 October 2026: "the moment you click on the ITO button, you
// actually creating a transaction... it must show you a model that confirms
// that this click or this action will create a transaction... let's create
// and then go to the ITO page to allocate."
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  buildItoAllocation,
  buildItoRequest,
  meterFromRegistryRow,
  notNav,
} from "../src/components/ito/itoRequest.js";
import {
  ITO_TRANSACTIONS,
  allocatingTrnId,
} from "../src/components/ito/itoTransactions.js";

const row = {
  id: "AST_1",
  meterId: "AST_1",
  meterNo: "042042",
  meterType: "electricity",
  erfId: "ERF_1",
  erfNo: "5213",
  premiseId: "PRM_1",
  premiseAddress: "26 Oldacre Street",
  lmPcode: "ZA524",
  wardPcode: "ZA5241006",
};

const dcn = ITO_TRANSACTIONS.find((item) => item.work === "disconnect");

const kaiser = { uid: "fwr-1", name: "Kaiser" };
// The codes are the ones the phone already writes. `DR-R001` 3.4 settled
// that the reason is stored as a code as well as words precisely so the
// rewording under way - Credit Control Instruction to Client instruction -
// leaves old records countable.
const client = { code: "CREDIT_CONTROL_INSTRUCTION", words: "Client instruction" };

test("the button makes a transaction with nobody on it and no reason yet", () => {
  const built = buildItoRequest({
    meter: meterFromRegistryRow(row),
    work: "disconnect",
    atMs: 1791538506000,
    allocating: false,
  });

  assert.equal(built.ok, true);
  assert.deepEqual(built.request.assignment.targets, []);
  assert.equal(built.request.assignment.instruction.reason.code, "NAv");
  assert.equal(built.request.assignment.instruction.code, "METER_DISCONNECTION");
});

test("the number is the same number it would always have had", () => {
  // An id can never be rewritten, so what goes in it is permanent. Creating
  // earlier must not change its shape.
  const built = buildItoRequest({
    meter: meterFromRegistryRow(row),
    work: "disconnect",
    atMs: 1791538506000,
    allocating: false,
  });

  assert.equal(built.id, "TRN_MDCN_1791538506000_ELC_ZA5241006_5213");
});

test("creating still refuses a meter that could not be found again", () => {
  // Owner, 3 October 2026: every record carries its municipality and its
  // ward, or it exists and cannot be found.
  const built = buildItoRequest({
    meter: meterFromRegistryRow({ ...row, wardPcode: "NAv" }),
    work: "disconnect",
    atMs: 1791538506000,
    allocating: false,
  });

  assert.equal(built.ok, false);
  assert.match(built.message, /workbase or no ward/);
});

test("creating still refuses a meter with no premise", () => {
  const built = buildItoRequest({
    meter: meterFromRegistryRow({ ...row, premiseId: "NAv" }),
    work: "disconnect",
    atMs: 1791538506000,
    allocating: false,
  });

  assert.equal(built.ok, false);
  assert.match(built.message, /not linked to a premise/);
});

test("NAv is read as the gap it is, not passed on as a value", () => {
  // A registry row writes "NAv" where a fact is missing. Handing it through
  // would create a job whose premise is the word NAv.
  assert.equal(notNav("NAv"), "");
  assert.equal(notNav("nav"), "");
  assert.equal(notNav("  NAV "), "");
  assert.equal(notNav(null), "");
  assert.equal(notNav("PRM_1"), "PRM_1");

  const meter = meterFromRegistryRow({ ...row, premiseId: "NAv", wardPcode: "NAv" });

  assert.equal(meter.accessData.premise.id, "");
  assert.equal(meter.accessData.parents.wardPcode, "");
});

test("the registry row carries everything a create needs", () => {
  // Measured against DEV on 11 October: 196 of 196 registry rows carry the
  // same meterType word as their asset - "electricity" or "water" - which is
  // what the id's ELC/WTR code is read from.
  const meter = meterFromRegistryRow(row);

  assert.equal(meter.id, "AST_1");
  assert.equal(meter.meterType, "electricity");
  assert.equal(meter.ast.astData.astId, "AST_1");
  assert.equal(meter.accessData.erfNo, "5213");
  assert.equal(meter.accessData.parents.lmPcode, "ZA524");
});

test("a send that carries a worker still writes ISSUED, as it always did", () => {
  const built = buildItoRequest({
    meter: meterFromRegistryRow(row),
    work: "disconnect",
    worker: kaiser,
    reason: client,
    instructionWords: "The box is locked",
    atMs: 1791538506000,
  });

  assert.equal(built.ok, true);
  assert.equal(built.request.assignment.targets[0].id, "fwr-1");
  assert.equal(built.request.assignment.instruction.reason.code, "CREDIT_CONTROL_INSTRUCTION");
});

test("the allocate carries the worker, the reason and the words", () => {
  const built = buildItoAllocation({
    trnId: "TRN_MDCN_1791538506000_ELC_ZA5241006_5213",
    work: "disconnect",
    worker: kaiser,
    reason: client,
    instructionWords: "The box is locked",
  });

  assert.equal(built.ok, true);
  assert.equal(built.request.action, "ALLOCATE");
  assert.equal(built.request.trnId, "TRN_MDCN_1791538506000_ELC_ZA5241006_5213");
  assert.equal(built.request.targets[0].id, "fwr-1");
  assert.equal(built.request.instruction.reason.code, "CREDIT_CONTROL_INSTRUCTION");
  assert.equal(built.request.instruction.text, "The box is locked");
  assert.equal(built.request.instruction.code, "METER_DISCONNECTION");
});

test("the allocate refuses with no transaction to land on", () => {
  // The front must know what the back knows. Finding this out at Send would
  // waste everything the office had typed.
  for (const trnId of ["", "   ", null, undefined]) {
    const built = buildItoAllocation({
      trnId,
      work: "disconnect",
      worker: kaiser,
      reason: client,
    });

    assert.equal(built.ok, false, String(trnId));
    assert.match(built.message, /which transaction/);
  }
});

test("the allocate refuses with no worker and with no reason", () => {
  const noWorker = buildItoAllocation({
    trnId: "TRN_1",
    work: "disconnect",
    reason: client,
  });

  assert.equal(noWorker.ok, false);
  assert.match(noWorker.message, /field worker/);

  const noReason = buildItoAllocation({
    trnId: "TRN_1",
    work: "disconnect",
    worker: kaiser,
    reason: null,
  });

  assert.equal(noReason.ok, false);
});

test("the words stay optional on an allocate", () => {
  // Owner, 10 October 2026, having asked twice: the instruction is optional.
  const built = buildItoAllocation({
    trnId: "TRN_1",
    work: "disconnect",
    worker: kaiser,
    reason: client,
  });

  assert.equal(built.ok, true);
  assert.equal(built.request.instruction.text, "NAv");
});

test("the page is told which transaction it allocates, in the address", () => {
  assert.equal(
    allocatingTrnId({ fromUrl: "TRN_MDCN_1_ELC_W_5213", meter: null, transaction: dcn }),
    "TRN_MDCN_1_ELC_W_5213",
  );
});

test("a reloaded page finds it on the meter instead", () => {
  // DR-R001 5.2 guarantees it is the same job: a second of its kind cannot
  // exist on one meter.
  const meter = {
    trnActiveLifecycle: {
      trnId: "TRN_MDCN_2_ELC_W_5213",
      trnType: "METER_DISCONNECTION",
      workflowState: "CREATED",
    },
  };

  assert.equal(allocatingTrnId({ fromUrl: "", meter, transaction: dcn }), "TRN_MDCN_2_ELC_W_5213");
});

test("a job of another kind on the meter is not this page's", () => {
  const meter = {
    trnActiveLifecycle: {
      trnId: "TRN_MINSP_3_ELC_W_5213",
      trnType: "METER_INSPECTION",
      workflowState: "ISSUED",
    },
  };

  assert.equal(allocatingTrnId({ fromUrl: "", meter, transaction: dcn }), "");
});

test("neither knowing is empty, which the page shows as a fault", () => {
  assert.equal(allocatingTrnId({ fromUrl: "", meter: {}, transaction: dcn }), "");
  assert.equal(allocatingTrnId(), "");
});

test("the launch button asks before it writes anything", async () => {
  // The owner's submit standard: a confirmation window before, visible
  // progress during, a result window after. It now writes a record, so a
  // single unconfirmed click will not do.
  const page = await readFile(
    new URL("../src/pages/registries/MetersRegistryPage.jsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /onLaunch=\{askToCreate\}/);
  assert.match(page, /function askToCreate\(row, work\) \{/);
  assert.match(page, /setCreating\(\{ row, work \}\)/);
  assert.match(page, /\{creating \? \(/, "the confirmation window is drawn");
  assert.match(page, /Create and allocate/);
  assert.match(page, /label: "Cancel"/);
});

test("the guard runs before the work is made, not after", async () => {
  // DR-R001 3.1: a meter iREPS cannot account for never reaches a worker.
  // Creating first and checking after would leave a job on a meter the
  // checks had just refused.
  const page = await readFile(
    new URL("../src/pages/registries/MetersRegistryPage.jsx", import.meta.url),
    "utf8",
  );
  const handler = page.slice(page.indexOf("async function createAndOpen"));

  const check = handler.indexOf("checkMeterRegistration");
  const make = handler.indexOf("makeTheWork");

  assert.ok(check > -1 && make > -1);
  assert.ok(check < make, "the check comes first");
});

test("the page opens only once the work exists, and carries its number", async () => {
  const page = await readFile(
    new URL("../src/pages/registries/MetersRegistryPage.jsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /if \(made\) navigate\(`\/operations\/ito\/\$\{row\.id\}\/\$\{work\}\?trn=/);
});

test("the ITO page allocates, it does not create", async () => {
  const itoPage = await readFile(
    new URL("../src/pages/operations/ItoPage.jsx", import.meta.url),
    "utf8",
  );

  assert.match(itoPage, /buildItoAllocation/);
  assert.match(itoPage, /allocateItoRequest/);
  // The module's own filename still carries the old name, so what is
  // pinned is that neither function is CALLED here.
  assert.doesNotMatch(itoPage, /buildItoRequest\(/);
  assert.doesNotMatch(itoPage, /await sendItoRequest\(/);
});

test("the office's own callable does the allocate", async () => {
  const sender = await readFile(
    new URL("../src/components/ito/sendItoRequest.js", import.meta.url),
    "utf8",
  );

  assert.match(sender, /"onManageLifecycleInstructionCallable"/);
  assert.match(sender, /"onCreateMeterLifecycleInstructionCallable"/);
  assert.doesNotMatch(sender, /export async function sendItoRequest/);
});
