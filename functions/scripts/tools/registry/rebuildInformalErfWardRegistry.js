import {
  applicationDefault,
  deleteApp,
  initializeApp,
} from "firebase-admin/app";

import { rebuildWardRegistryRow } from "../../../registry/wardBuilder.js";

function getArgumentValue(flagName) {
  const index = process.argv.indexOf(flagName);

  if (index < 0) return "";
  return String(process.argv[index + 1] || "").trim();
}

function requirePcode(value, fieldName, pattern) {
  const normalized = String(value || "").trim().toUpperCase();

  if (!pattern.test(normalized)) {
    throw new Error(`${fieldName} is invalid: ${value || "(missing)"}`);
  }

  return normalized;
}

async function main() {
  const startedAtMs = Date.now();
  let app = null;
  let lmPcode = "";
  let wardPcode = "";

  try {
    lmPcode = requirePcode(
      getArgumentValue("--lm-pcode"),
      "lmPcode",
      /^ZA\d{4}$/,
    );
    wardPcode = requirePcode(
      getArgumentValue("--ward-pcode"),
      "wardPcode",
      /^ZA\d{7}$/,
    );

    if (!wardPcode.startsWith(lmPcode)) {
      throw new Error(
        `wardPcode ${wardPcode} does not belong to lmPcode ${lmPcode}.`,
      );
    }

    app = initializeApp({
      credential: applicationDefault(),
    });

    console.log("[WARD REGISTRY REFRESH] START", {
      lmPcode,
      wardPcode,
    });

    console.log("[WARD REGISTRY REFRESH] PROGRESS", {
      current: 1,
      total: 1,
      lmPcode,
      wardPcode,
    });

    const row = await rebuildWardRegistryRow({
      lmPcode,
      wardPcode,
      reason: "INFORMAL_ERF_WARD_REGISTRY_BACKFILL",
    });

    console.log("[WARD REGISTRY REFRESH] COMPLETE", {
      lmPcode,
      wardPcode,
      rowId: row?.id || null,
      formalErfs: row?.counts?.formalErfs ?? null,
      informalErfs: row?.counts?.informalErfs ?? null,
      totalErfs: row?.counts?.totalErfs ?? null,
      premises: row?.counts?.premises ?? null,
      totalMeters: row?.counts?.totalMeters ?? null,
      trns: row?.counts?.trns ?? null,
      elapsedMs: Date.now() - startedAtMs,
    });
  } catch (error) {
    console.error("[WARD REGISTRY REFRESH] FAILED", {
      lmPcode: lmPcode || null,
      wardPcode: wardPcode || null,
      code: error?.code || "WARD_REGISTRY_REFRESH_FAILED",
      message: error?.message || String(error),
      stack: error?.stack || null,
      elapsedMs: Date.now() - startedAtMs,
    });

    process.exitCode = 1;
  } finally {
    if (app) {
      await deleteApp(app);
    }
  }
}

await main();
