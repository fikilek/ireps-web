export const pageStyle = {
  height: "calc(100vh - 96px)",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

export const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  padding: "0 0 4px",
};

export const eyebrowStyle = {
  margin: 0,
  color: "#64748B",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

export const headerActionsStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

export const wardSelectWrapStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #CBD5E1",
  background: "white",
  borderRadius: 10,
  padding: "6px 8px",
};

export const wardSelectLabelStyle = {
  color: "#475569",
  fontSize: 12,
  fontWeight: 900,
  whiteSpace: "nowrap",
};

export const wardSelectStyle = {
  border: "none",
  outline: "none",
  background: "transparent",
  color: "#0F172A",
  fontWeight: 900,
  cursor: "pointer",
};

export const countPillStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid #E5E7EB",
  background: "white",
  borderRadius: 999,
  padding: "8px 12px",
  color: "#334155",
};

export const buttonStyle = {
  border: "1px solid #CBD5E1",
  background: "white",
  color: "#0F172A",
  borderRadius: 10,
  padding: "9px 12px",
  fontWeight: 800,
  cursor: "pointer",
};

export const primaryButtonStyle = {
  border: "1px solid #0F172A",
  background: "#0F172A",
  color: "white",
  borderRadius: 10,
  padding: "9px 12px",
  fontWeight: 800,
  cursor: "pointer",
};

export const mapShellStyle = {
  position: "relative",
  flex: 1,
  minHeight: 520,
  border: "1px solid #E5E7EB",
  borderRadius: 16,
  overflow: "hidden",
  background: "#E2E8F0",
};

export const drawingPanelStyle = {
  position: "absolute",
  top: 14,
  left: 14,
  right: 14,
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  background: "rgba(255,255,255,0.95)",
  border: "1px solid #E5E7EB",
  borderRadius: 14,
  padding: 12,
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.16)",
};

export const drawingStatsStyle = {
  color: "#334155",
  fontSize: 12,
  fontWeight: 700,
};

export const countDetailStyle = {
  display: "block",
  marginTop: 4,
  color: "#475569",
  fontSize: 11,
  fontWeight: 800,
};

export const integrityDetailStyle = {
  display: "block",
  marginTop: 4,
  color: "#b91c1c",
  fontSize: 11,
  fontWeight: 900,
};

export const modalBackdropStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 200,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(15, 23, 42, 0.45)",
  padding: 24,
};

export const modalCardStyle = {
  width: "100%",
  maxHeight: "86vh",
  overflow: "auto",
  background: "white",
  borderRadius: 18,
  padding: 18,
  boxShadow: "0 24px 60px rgba(15, 23, 42, 0.28)",
};

export const modalHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 16,
};

export const modalCloseButtonStyle = {
  border: "none",
  background: "#F1F5F9",
  color: "#0F172A",
  width: 34,
  height: 34,
  borderRadius: 17,
  fontSize: 24,
  lineHeight: "30px",
  cursor: "pointer",
};

export const modalCountsRowStyle = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 10,
  color: "#334155",
  fontSize: 13,
  fontWeight: 800,
};

export const confirmIntroStyle = {
  color: "#475569",
  marginTop: 0,
  marginBottom: 16,
};

export const countCardGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 12,
  marginBottom: 18,
};

export const countCardStyle = {
  border: "1px solid #E5E7EB",
  background: "#F8FAFC",
  borderRadius: 14,
  padding: "16px 14px",
  textAlign: "center",
};

export const countLabelStyle = {
  display: "block",
  color: "#64748B",
  fontSize: 12,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

export const countValueStyle = {
  display: "block",
  color: "#0F172A",
  fontSize: 30,
  lineHeight: "38px",
  marginTop: 4,
};

export const confirmDetailsStyle = {
  display: "grid",
  gap: 12,
  borderTop: "1px solid #E5E7EB",
  paddingTop: 14,
};

export const confirmFieldLabelStyle = {
  display: "block",
  color: "#64748B",
  fontSize: 12,
  fontWeight: 900,
  marginBottom: 4,
};

export const modalActionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 20,
};

export const successBoxStyle = {
  border: "1px solid #BBF7D0",
  background: "#F0FDF4",
  color: "#14532D",
  borderRadius: 14,
  padding: 14,
  marginBottom: 16,
};

export const inputStyle = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  marginTop: 6,
  marginBottom: 12,
  padding: "10px 12px",
  border: "1px solid #CBD5E1",
  borderRadius: 10,
};

export const textareaStyle = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  marginTop: 6,
  marginBottom: 12,
  padding: "10px 12px",
  border: "1px solid #CBD5E1",
  borderRadius: 10,
  minHeight: 84,
};
