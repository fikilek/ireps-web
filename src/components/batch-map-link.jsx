/* eslint-disable no-unused-vars -- JSX tags are used by React. */
import { Link } from "react-router-dom";
import { batchMapPath } from "./batch-map-path.js";

// Targeted Batch rules TB-R043: batch lists (Sales Reporting, TB Register) start each row
// with this button, which opens the Batch Map. `from` ({ path, label }) is where the Batch
// Map's back button returns.

export default function BatchMapLink({ tbId, from = null }) {
  return (
    <Link
      to={batchMapPath(tbId)}
      state={from ? { from } : undefined}
      style={batchMapLinkStyle}
      aria-label={`View Batch Map for ${tbId}`}
      title="View Batch Map"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
        <path d="M9 3v15" />
        <path d="M15 6v15" />
      </svg>
    </Link>
  );
}

const batchMapLinkStyle = {
  width: 30,
  height: 30,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "0 0 auto",
  borderRadius: 9,
  border: "1px solid #93c5fd",
  background: "#eff6ff",
  color: "#1d4ed8",
  textDecoration: "none",
};
