/* eslint-disable no-unused-vars -- JSX tags are consumed by React. */
export default function BatchMapLayerControl({ open, setOpen, visible, setVisible, counts }) {
  return <div style={{ position: "absolute", top: 90, right: 12, zIndex: 5 }}>
    {!open ? <button type="button" aria-label="Map Layers" title="Map Layers" aria-expanded={false} onClick={() => setOpen(true)} style={styles.icon}>
      <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></svg>
    </button> : <section aria-label="Map Layers" style={styles.panel}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><strong>MAP LAYERS</strong><button type="button" aria-label="Close Map Layers" onClick={() => setOpen(false)} style={{ border: 0, background: "none", cursor: "pointer", fontSize: 21 }}>×</button></header>
      {[["erfs", "ERFs"], ["premises", "Premises"], ["meters", "Assets"]].map(([key, label]) => <label key={key} style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", cursor: "pointer" }}>
        <input type="checkbox" checked={visible[key]} onChange={event => setVisible(current => ({ ...current, [key]: event.target.checked }))} />{label}<strong style={{ marginLeft: "auto" }}>{counts[key]}</strong>
      </label>)}
    </section>}
  </div>;
}
const styles = { icon: { display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 10, border: "1px solid #cbd5e1", background: "white", color: "#334155", boxShadow: "0 3px 12px #0002", cursor: "pointer" }, panel: { width: 245, padding: "12px 16px", borderRadius: 14, border: "1px solid #cbd5e1", background: "#ffffffed", boxShadow: "0 8px 24px #0002", fontSize: 14, color: "#0f172a" } };
