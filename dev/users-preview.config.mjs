import { defineConfig, mergeConfig } from "vite";
import { fileURLToPath } from "node:url";
import base from "../vite.config.js";

// Explicit opt-in preview server only. The normal app and builds use real APIs.
const fixture = fileURLToPath(new URL("./users-preview-data.jsx", import.meta.url));
export default mergeConfig(base, defineConfig({
  cacheDir: ".vite-users-preview.local",
  plugins: [{
    name: "users-preview-fixtures",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer?.replaceAll("\\", "/").endsWith("/src/pages/users/UsersPage.jsx")) return null;
      return ["../../auth/useAuth", "../../firebase", "../../redux/teamsApi", "../../redux/usersApi", "firebase/firestore"].includes(source) ? fixture : null;
    },
  }],
}));
