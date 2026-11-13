import { defineConfig, mergeConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "../../vite.config.js";
const fixture = fileURLToPath(new URL("./fixtures.js", import.meta.url));
export default mergeConfig(base, defineConfig({ plugins: [{ name: "stage1-test-only", enforce: "pre", resolveId(source, importer) {
  if (!importer?.replaceAll("\\", "/").endsWith("/src/pages/operations/TrnBgoUploadPage.jsx")) return null;
  if (source.replaceAll("\\", "/").includes("/src/context/GeoContext")) return fixture;
  return ["firebase/functions", "../../firebase", "../../auth/useAuth", "@/context/GeoContext", "../../redux/tcApi", "../../redux/teamsApi", "../../redux/serviceProvidersApi"].includes(source) ? fixture : null;
} }] }));
