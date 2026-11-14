export function parseCsv(text) {
  let quoted = false, fieldStart = true, afterQuote = false;
  let field = "", record = [], line = 1, startLine = 1;
  const rows = [], positions = [];
  const endRecord = () => { record.push(field); rows.push(record); positions.push(startLine); record = []; field = ""; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; afterQuote = true; }
      } else { field += char; if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) line++; }
    } else if (char === ",") { record.push(field); field = ""; fieldStart = true; afterQuote = false; }
    else if (char === "\n" || char === "\r") {
      endRecord(); if (char === "\r" && text[i + 1] === "\n") i++;
      line++; startLine = line; fieldStart = true; afterQuote = false;
    }
    else if (char === '"' && fieldStart) { quoted = true; fieldStart = false; }
    else {
      if (char === '"' || afterQuote) throw new Error("Unreadable CSV quoting. Quote whole fields and escape quotes with double quotes.");
      fieldStart = false; field += char;
    }
  }
  if (quoted) throw new Error("Unreadable CSV: an opening quote has no closing quote.");
  if (field || record.length || afterQuote) endRecord();
  return { rows, positions };
}


export function serializeCsv(matrix) { return matrix.map(row => row.map(value => { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }).join(",")).join("\r\n"); }
