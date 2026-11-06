import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

test("ConsoleLayout isolates Operations Overview from child routes using end prop", () => {
  const consoleLayoutPath = path.join(repoRoot, "src/layouts/ConsoleLayout.jsx");
  const content = fs.readFileSync(consoleLayoutPath, "utf8");

  assert.match(
    content,
    /end=\{item\.path === "\/operations"\}/,
    "ConsoleLayout must apply end prop to /operations so child pages don't highlight Operations Overview",
  );
});

test("OperationsLandingPage module cards match Operations sidebar 1-to-1 and banner is removed", () => {
  const landingPath = path.join(repoRoot, "src/pages/operations/OperationsLandingPage.jsx");
  const content = fs.readFileSync(landingPath, "utf8");

  // Verify obsolete notice banner is removed
  assert.doesNotMatch(
    content,
    /TC Uploads v1/,
    "Must not contain obsolete 'TC Uploads v1' banner",
  );

  // Verify mandatory module cards
  assert.match(content, /title:\s*"TRN BGO Register"/, "Must have TRN BGO Register card");
  assert.match(content, /path:\s*"\/operations\/trn-bgo"/, "TRN BGO Register must link to /operations/trn-bgo");

  assert.match(content, /title:\s*"TB Register"/, "Must have TB Register card");
  assert.match(content, /path:\s*"\/operations\/targeted-batches"/, "TB Register must link to /operations/targeted-batches");

  assert.match(content, /title:\s*"MD BGO Register"/, "Must have MD BGO Register card");
  assert.match(content, /path:\s*"\/operations\/bgo"/, "MD BGO Register must link to /operations/bgo");

  assert.match(content, /title:\s*"Dashboard"/, "Must have Dashboard card");
  assert.match(content, /path:\s*"\/operations\/dashboard"/, "Dashboard must link to /operations/dashboard");

  assert.match(content, /title:\s*"Operational Teams"/, "Must have Operational Teams card");
  assert.match(content, /path:\s*"\/operations\/teams"/, "Operational Teams must link to /operations/teams");

  assert.match(content, /title:\s*"Geo-Fences"/, "Must have Geo-Fences card");
  assert.match(content, /path:\s*"\/operations\/geo-fences"/, "Geo-Fences must link to /operations/geo-fences");

  // Verify legacy WMS placeholder is removed
  assert.doesNotMatch(
    content,
    /WMS Dashboard/,
    "Must not contain obsolete 'WMS Dashboard' card",
  );
});
