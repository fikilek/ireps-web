// Real Firebase SDK discovery only; no handlers may execute or access a network.
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");
const attempts = [];
const deny = label => () => {
  attempts.push(label);
  throw new Error(`OFFLINE_DISCOVERY_DENIED: ${label}`);
};
for (const name of ["node:http", "node:https"]) {
  const module = require(name);
  module.request = deny(`${name}.request`);
  module.get = deny(`${name}.get`);
}
const net = require("node:net");
net.connect = deny("net.connect");
net.createConnection = deny("net.createConnection");
net.Socket.prototype.connect = deny("Socket.connect");
global.fetch = deny("fetch");
const childProcess = require("node:child_process");
for (const name of ["exec", "execFile", "spawn", "fork", "execSync", "execFileSync", "spawnSync"]) {
  childProcess[name] = deny(`child_process.${name}`);
}
syncBuiltinESMExports();
const functionsDir = path.resolve(__dirname, "../..");
const runtimeDir = path.join(functionsDir, "node_modules/firebase-functions/lib/runtime");
(async () => {
  const { loadStack } = require(path.join(runtimeDir, "loader.js"));
  const { stackToWire } = require(path.join(runtimeDir, "manifest.js"));
  const stack = stackToWire(await loadStack(functionsDir));
  if (attempts.length) throw new Error(`Discovery attempted effects: ${attempts.join(", ")}`);
  process.stdout.write(JSON.stringify({ stack, deniedEffectAttempts: attempts }));
})().catch(error => {
  process.stderr.write(error.stack + "\n");
  process.exitCode = 1;
});
