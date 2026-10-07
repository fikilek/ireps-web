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
