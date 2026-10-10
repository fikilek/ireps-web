// The service provider's name — one order for the whole of iREPS.
import assert from "node:assert/strict";
import test from "node:test";

import { serviceProviderName } from "../serviceProviders/serviceProviderName.js";

test("the registered name is the name", () => {
  assert.equal(
    serviceProviderName({ profile: { registeredName: "Rural Services (Pty) Ltd", tradingName: "RSTE" } }),
    "Rural Services (Pty) Ltd",
  );
});

test("NAv is not a name, so it falls through to the trading name", () => {
  // Service provider LgIrdHR7cnUPIHPzw5iZ on DEV, read 4 October: registeredName "NAv",
  // tradingName "RSTE". Carrying the NAv would lose the one name it has.
  assert.equal(
    serviceProviderName({ profile: { registeredName: "NAv", tradingName: "RSTE" } }),
    "RSTE",
  );
});

test("a blank registered name falls through the same way", () => {
  assert.equal(serviceProviderName({ profile: { registeredName: "   ", tradingName: "RSTE" } }), "RSTE");
});

test("a service provider has no top-level name, and asking for one is how NAv got written", () => {
  // The fault on the owner's ERF 3619 record: the No Access path read spSnap.data()?.name,
  // which does not exist on a service provider document, and stamped "NAv" beside a correctly
  // resolved id on 20 of the last 25 DEV transactions.
  assert.equal(
    serviceProviderName({ id: "LgIrdHR7cnUPIHPzw5iZ", profile: { registeredName: "NAv", tradingName: "RSTE" } }),
    "RSTE",
  );
});

test("with neither name, NAv — and NAv is the flag that the SP record is incomplete", () => {
  assert.equal(serviceProviderName(null), "NAv");
  assert.equal(serviceProviderName({ id: "LgIrdHR7cnUPIHPzw5iZ" }), "NAv");
  assert.equal(serviceProviderName({ profile: { registeredName: "NAv", tradingName: "NAv" } }), "NAv");
});

test("a stamp keeps the name it was already given", () => {
  // Found by the owner, 10 October 2026, in the first office job. Two shapes
  // reach this function: a service provider DOCUMENT, which carries
  // profile.registeredName and profile.tradingName, and a STAMP - the
  // { id, name } a record keeps - which carries neither. Handed a stamp, the
  // chain ran out and said NAv, although the meter's own stamp said RSTE.
  assert.equal(serviceProviderName({ id: "SP_1", name: "RSTE" }), "RSTE");
});

test("a document still wins over a copy of one", () => {
  assert.equal(
    serviceProviderName({
      name: "an old copy",
      profile: { registeredName: "Real Registered Name" },
    }),
    "Real Registered Name",
  );
});

test("a stamp that never had a name is still NAv", () => {
  for (const stamp of [{ id: "SP_1" }, { id: "SP_1", name: "" }, { id: "SP_1", name: "NAv" }]) {
    assert.equal(serviceProviderName(stamp), "NAv");
  }
});
