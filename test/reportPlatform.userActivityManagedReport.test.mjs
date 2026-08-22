import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUserActivityManagedReport,
  createUserActivityManagedReportGenerator,
} from "../src/pages/reports/userActivityReportArtifact.js";

const ROWS = [
  { userName: "Alice", totalTrns: 3 },
  { userName: "Bob", totalTrns: 2 },
];

const COLUMNS = [
  { header: "User", value: (row) => row.userName },
  { header: "Total TRNs", value: (row) => row.totalTrns },
];

const SCOPE = {
  lmName: "Example LM",
  lmPcode: "LM001",
  wardLabel: "All Time",
  wardPcode: "NAv",
};

const SOURCE_SCOPE = {
  view: "FILTERED_SORTED_ROWS",
  tableView: "USERS",
  lmPcode: "LM001",
  lmName: "Example LM",
  datePreset: "ALL_TIME",
  dateRange: "All Time",
  columnFilters: {},
  sort: {
    key: "lastUpdatedAt",
    direction: "desc",
  },
};

const GENERATED_AT = new Date("2026-08-19T08:45:00.000Z");

function fakeArtifactBuilder({ fileName }) {
  return {
    format: "XLSX",
    fileName,
    bytes: Uint8Array.from([1, 2, 3, 4]),
  };
}

test("builds canonical USER_ACTIVITY metadata around exactly one XLSX artifact", () => {
  let builds = 0;

  const result = buildUserActivityManagedReport({
    rows: ROWS,
    columns: COLUMNS,
    scope: SCOPE,
    sourceScope: SOURCE_SCOPE,
    generatedAt: GENERATED_AT,
    buildArtifact(args) {
      builds += 1;
      return fakeArtifactBuilder(args);
    },
  });

  assert.equal(builds, 1);
  assert.equal(result.artifact.format, "XLSX");
  assert.match(
    result.artifact.fileName,
    /^user_activity_report_example_lm_all_time_\d{12}\.xlsx$/,
  );

  assert.deepEqual(result.metadata, {
    reportType: "USER_ACTIVITY",
    reportName: "User Activity Report",
    format: "XLSX",
    sourceType: "REPORT",
    sourceId: null,
    sourceScope: SOURCE_SCOPE,
    itemCount: 2,
    fileName: result.artifact.fileName,
  });
});

test("managed Full Download persists then downloads the exact same artifact object", async () => {
  const calls = [];
  let persistedArtifact = null;
  let downloadedArtifact = null;

  const generate = createUserActivityManagedReportGenerator({
    buildArtifact: fakeArtifactBuilder,
    async persist({ artifact, metadata }) {
      calls.push("persist");
      persistedArtifact = artifact;
      assert.equal(metadata.fileName, artifact.fileName);
      return {
        lifecycle: { reportId: "RPT_test" },
      };
    },
    download(artifact) {
      calls.push("download");
      downloadedArtifact = artifact;
    },
  });

  const result = await generate({
    rows: ROWS,
    columns: COLUMNS,
    scope: SCOPE,
    sourceScope: SOURCE_SCOPE,
    generatedAt: GENERATED_AT,
  });

  assert.deepEqual(calls, ["persist", "download"]);
  assert.strictEqual(persistedArtifact, downloadedArtifact);
  assert.strictEqual(result.artifact, persistedArtifact);
  assert.deepEqual(result.persistence, {
    lifecycle: { reportId: "RPT_test" },
  });
  assert.equal(result.downloaded, true);
});

test("browser download failure does not misreport a successfully persisted report", async () => {
  let persists = 0;

  const generate = createUserActivityManagedReportGenerator({
    buildArtifact: fakeArtifactBuilder,
    async persist() {
      persists += 1;
      return {
        lifecycle: { reportId: "RPT_stored" },
      };
    },
    download() {
      throw new Error("browser blocked");
    },
  });

  const result = await generate({
    rows: ROWS,
    columns: COLUMNS,
    scope: SCOPE,
    sourceScope: SOURCE_SCOPE,
    generatedAt: GENERATED_AT,
  });

  assert.equal(persists, 1);
  assert.equal(result.downloaded, false);
  assert.equal(result.persistence.lifecycle.reportId, "RPT_stored");
});

test("persistence failure prevents browser download of an unmanaged artifact", async () => {
  let downloads = 0;

  const generate = createUserActivityManagedReportGenerator({
    buildArtifact: fakeArtifactBuilder,
    async persist() {
      throw new Error("persistence failed");
    },
    download() {
      downloads += 1;
    },
  });

  await assert.rejects(
    generate({
      rows: ROWS,
      columns: COLUMNS,
      scope: SCOPE,
      sourceScope: SOURCE_SCOPE,
      generatedAt: GENERATED_AT,
    }),
    /persistence failed/,
  );

  assert.equal(downloads, 0);
});


test("managed report metadata preserves the selected TEAMS table view", () => {
  const sourceScope = {
    ...SOURCE_SCOPE,
    tableView: "TEAMS",
    columnFilters: { teamName: "Alpha Team" },
  };

  const result = buildUserActivityManagedReport({
    rows: [{ teamName: "Alpha Team", totalTrns: 5 }],
    columns: [
      { header: "Team", value: (row) => row.teamName },
      { header: "Total TRNs", value: (row) => row.totalTrns },
    ],
    scope: SCOPE,
    sourceScope,
    generatedAt: GENERATED_AT,
    buildArtifact: fakeArtifactBuilder,
  });

  assert.equal(result.metadata.reportType, "USER_ACTIVITY");
  assert.equal(result.metadata.sourceScope.tableView, "TEAMS");
  assert.deepEqual(result.metadata.sourceScope.columnFilters, { teamName: "Alpha Team" });
});

test("managed User Activity generation rejects an empty report", async () => {
  const generate = createUserActivityManagedReportGenerator({
    buildArtifact: fakeArtifactBuilder,
    async persist() {
      throw new Error("should not persist");
    },
    download() {
      throw new Error("should not download");
    },
  });

  await assert.rejects(
    generate({
      rows: [],
      columns: COLUMNS,
      scope: SCOPE,
      sourceScope: SOURCE_SCOPE,
      generatedAt: GENERATED_AT,
    }),
    RangeError,
  );
});
