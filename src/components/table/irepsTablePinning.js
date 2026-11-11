// Resolve in visual column order. Existing single-column callers keep their defaults.
export function irepsTablePinnedKeys(columns, { stickyColumnKeys, stickyColumnKey, stickyFirstColumn } = {}) {
  const requested = new Set(stickyColumnKeys ?? [stickyColumnKey ?? (stickyFirstColumn ? columns[0]?.key : null)]);
  return columns.filter(column => requested.has(column.key)).map(column => column.key);
}

export function irepsTablePinnedLayout(keys, widths = {}) {
  let width = 0;
  const offsets = {};
  for (const key of keys) {
    offsets[key] = width;
    width += Math.max(0, Number(widths[key]) || 0);
  }
  return { offsets, width };
}
