import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";

import "./index.css";
import App from "./App.jsx";
import { AuthProvider } from "./auth/AuthProvider.jsx";
import { GeoProvider } from "@/context/GeoContext.jsx";
import { WarehouseProvider } from "@/context/WarehouseContext.jsx";
import { store } from "./redux/store.js";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Provider store={store}>
      <AuthProvider>
        <GeoProvider>
          <WarehouseProvider>
            <App />
          </WarehouseProvider>
        </GeoProvider>
      </AuthProvider>
    </Provider>
  </StrictMode>,
);
