import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import TrnBgoUploadPage from "../../src/pages/operations/TrnBgoUploadPage.jsx";
createRoot(document.getElementById("root")).render(<MemoryRouter><TrnBgoUploadPage /></MemoryRouter>);
