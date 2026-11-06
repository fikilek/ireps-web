import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

test("ConsoleLayout does not contain redundant Operations Overview menu item", () => {
  const consoleLayoutPath = path.join(repoRoot, "src/layouts/ConsoleLayout.jsx");
  const content = fs.readFileSync(consoleLayoutPath, "utf8");

  assert.doesNotMatch(
    content,
    /label:\s*"Operations Overview"/,
    "ConsoleLayout must not contain redundant 'Operations Overview' menu item",
  );
});

test("AppRoutes redirects /operations directly to /operations/dashboard", () => {
  const appRoutesPath = path.join(repoRoot, "src/routes/AppRoutes.jsx");
  const content = fs.readFileSync(appRoutesPath, "utf8");

  assert.match(
    content,
    /path="\/operations"\s+element=\{<Navigate to="\/operations\/dashboard" replace \/>\}/,
    "/operations route must redirect to /operations/dashboard",
  );

  const landingPagePath = path.join(repoRoot, "src/pages/operations/OperationsLandingPage.jsx");
  assert.equal(
    fs.existsSync(landingPagePath),
    false,
    "OperationsLandingPage.jsx must be completely removed from codebase",
  );
});
