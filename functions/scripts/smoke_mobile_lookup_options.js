import fs from "fs";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";

import { onIrepsSelectOptionsCallable } from "../lookups/onIrepsSelectOptionsCallable.js";

const PROJECTS = [
  {
    projectId: "ireps2",
    serviceAccountPath:
      process.env.IREPS_SOURCE_SERVICE_ACCOUNT ||
      "C:\\dev\\secrets\\ireps2-e72fd9dc94de.json",
  },
  {
    projectId: "ireps-test",
    serviceAccountPath:
      process.env.IREPS_TARGET_SERVICE_ACCOUNT ||
      "C:\\dev\\secrets\\ireps-test-firebase-adminsdk-fbsvc-d02929e1e3.json",
  },
];

const MOBILE_LOOKUP_KEYS = [
  "ANOMALY_DETAIL",
  "METER_ANOMALY",
  "METER_CB_SIZE",
  "METER_CONNECTION_STATUS",
  "METER_DISCONNECTION_INSTRUCTION",
  "METER_DISCONNECTION_LEVEL",
  "METER_INSPECTION_INSTRUCTION",
  "METER_MANUFACTURER",
  "METER_NO_ACCESS_REASON",
  "METER_NO_READING_REASON",
  "METER_NORMALISATION_ACTION",
  "METER_PHASE",
  "METER_PLACEMENT",
  "METER_READING_INSTRUCTION",
  "METER_RECONNECTION_INSTRUCTION",
  "METER_REMOVAL_INSTRUCTION",
];

function readServiceAccount(filePath, expectedProjectId) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Service account file not found: ${filePath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (serviceAccount.project_id !== expectedProjectId) {
    throw new Error(
      `Service account project mismatch. Expected ${expectedProjectId}, got ${serviceAccount.project_id}.`,
    );
  }

  return serviceAccount;
}

function normalizeResponse(response) {
  return {
    lookupKey: response.lookupKey,
    title: response.title,
    description: response.description,
    domain: response.domain,
    fieldKey: response.fieldKey,
    version: response.version,
    allowOther: response.allowOther,
    otherCode: response.otherCode,
    otherLabel: response.otherLabel,
    options: response.options,
  };
}

function optionFailures(lookupKey, options) {
  const failures = [];

  if (!Array.isArray(options) || options.length === 0) {
    failures.push("returned zero published options");
    return failures;
  }

  options.forEach((option, index) => {
    const path = `options[${index}]`;

    if (!option.code) failures.push(`${path}.code is missing`);
    if (!option.label) failures.push(`${path}.label is missing`);
    if (!option.value) failures.push(`${path}.value is missing`);
    if (!option.name) failures.push(`${path}.name is missing`);
    if (!option.status) failures.push(`${path}.status is missing`);
    if (!Number.isFinite(option.sortOrder)) {
      failures.push(`${path}.sortOrder is invalid`);
    }

    if (lookupKey === "ANOMALY_DETAIL" && !option.parentCode) {
      failures.push(`${path}.parentCode is missing`);
    }

    if (
      lookupKey === "METER_MANUFACTURER" &&
      (!Array.isArray(option.appliesTo) || option.appliesTo.length === 0)
    ) {
      failures.push(`${path}.appliesTo is missing`);
    }
  });

  return failures;
}

async function runCallableSilently(lookupKey) {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};
  process.stdout.write = () => true;
  process.stderr.write = () => true;

  try {
    return await onIrepsSelectOptionsCallable.run({
      auth: {
        uid: "LOOKUP_SMOKE_TEST",
      },
      data: {
        lookupKey,
      },
    });
  } finally {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

async function inspectProject(project) {
  const serviceAccount = readServiceAccount(
    project.serviceAccountPath,
    project.projectId,
  );

  const app = initializeApp({
    credential: cert(serviceAccount),
    projectId: project.projectId,
  });

  const responses = new Map();
  const failures = [];

  try {
    for (const lookupKey of MOBILE_LOOKUP_KEYS) {
      try {
        const response = await runCallableSilently(lookupKey);
        const normalized = normalizeResponse(response);

        responses.set(lookupKey, normalized);

        for (const failure of optionFailures(lookupKey, normalized.options)) {
          failures.push({
            projectId: project.projectId,
            lookupKey,
            failure,
          });
        }
      } catch (error) {
        failures.push({
          projectId: project.projectId,
          lookupKey,
          failure: error?.message || String(error),
          code: error?.code || "unknown",
        });
      }
    }
  } finally {
    await deleteApp(app);
  }

  return {
    projectId: project.projectId,
    responses,
    failures,
  };
}

const projectResults = [];

for (const project of PROJECTS) {
  projectResults.push(await inspectProject(project));
}

const failures = projectResults.flatMap((result) => result.failures);
const devResponses = projectResults[0].responses;
const testResponses = projectResults[1].responses;

for (const lookupKey of MOBILE_LOOKUP_KEYS) {
  const dev = devResponses.get(lookupKey);
  const test = testResponses.get(lookupKey);

  if (!dev || !test) continue;

  if (JSON.stringify(dev) !== JSON.stringify(test)) {
    failures.push({
      projectId: "ireps2 vs ireps-test",
      lookupKey,
      failure: "callable responses do not match",
    });
  }
}

if (failures.length > 0) {
  console.error(
    JSON.stringify(
      {
        result: "FAIL",
        failureCount: failures.length,
        failures,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} else {
  console.log(
    `PASS — ${MOBILE_LOOKUP_KEYS.length} mobile lookup keys returned valid, matching callable responses in ireps2 and ireps-test.`,
  );
}
