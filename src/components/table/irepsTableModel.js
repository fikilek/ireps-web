// What every iREPS table does with its rows: filter them by the box under each
// heading, sort them by the heading, and cut them into pages. Pure, so it is
// tested on its own and every table behaves identically.
//
// A column is:
//   { key, label, group?, filter: "text" | "select" | "date" | "salesRange" | null,
//     value(row), sortValue?(row), render?(row), align? }
//
// `value` is what the filters and the sort read; `render` is what the worker
// sees, when that is more than the value itself.
// Select columns may provide filterValues(row) for multiple memberships and
// filterOptions as strings or { value, label } objects. filterDisabled suspends
// filtering while supporting data is unavailable. sortEmptyLast is opt-in.

import { isSalesRangeFilterActive, matchesSalesRangeFilter } from "../../pages/sales/salesUtils.js";

export const IREPS_TABLE_PAGE_SIZES = [5, 10, 25, 50, 100];
export const IREPS_TABLE_DEFAULT_PAGE_SIZE = 5;

const text = (value) => String(value ?? "").trim();

// The standard iREPS date window: Today, Yesterday, Past 3 days, this calendar
// week or month, or a custom range — the same day ranges as the registries.
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
const endOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0);
const dateOnly = (value) => {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
};

export function irepsTableDateRange(filter, now = new Date()) {
  const mode = filter?.mode || "ALL";
  const today = startOfDay(now);

  if (mode === "TODAY") return { start: today, end: endOfDay(now) };
  if (mode === "YESTERDAY") {
    const yesterday = addDays(today, -1);
    return { start: yesterday, end: endOfDay(yesterday) };
  }
  if (mode === "PAST_3_DAYS") return { start: addDays(today, -2), end: endOfDay(now) };
  if (mode === "THIS_WEEK") {
    const sunday = addDays(today, -today.getDay());
    return { start: sunday, end: endOfDay(addDays(sunday, 6)) };
  }
  if (mode === "THIS_MONTH") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
    };
  }
  if (mode === "CUSTOM") {
    const start = dateOnly(filter?.startDate);
    const end = dateOnly(filter?.endDate);
    return { start: start ? startOfDay(start) : null, end: end ? endOfDay(end) : null };
  }

  return { start: null, end: null };
}

export function irepsTableFilterActive(column, filter) {
  if (!column?.filter) return false;
  if (column.filterAllValue !== undefined && filter === column.filterAllValue) return false;
  if (column.filter === "salesRange") return isSalesRangeFilterActive(filter);
  if (column.filter === "date") {
    return Boolean(filter && typeof filter === "object" && filter.mode && filter.mode !== "ALL");
  }
  return Boolean(text(filter));
}

const shownText = (column, row) => text(column.value ? column.value(row) : "");

function matchesFilter(column, row, filter, now) {
  if (column.filter === "salesRange") {
    const value = column.value?.(row);
    return value != null && value !== "" && Number.isFinite(Number(value)) && matchesSalesRangeFilter(value, filter);
  }
  if (column.filter === "date") {
    const at = Number(column.value ? column.value(row) : 0);
    if (!Number.isFinite(at) || at <= 0) return false;

    const { start, end } = irepsTableDateRange(filter, now);
    const when = new Date(at);
    return (!start || when >= start) && (!end || when <= end);
  }

  const shown = shownText(column, row);
  if (column.filter === "select") {
    const values = column.filterValues ? column.filterValues(row) : [shown];
    return values.some(value => text(value) === text(filter));
  }
  return shown.toLowerCase().includes(text(filter).toLowerCase());
}

export function filterIrepsTableRows(rows = [], columns = [], { filters = {}, now = new Date(), searchValue } = {}) {
  const active = columns.filter((column) => !column.filterDisabled && irepsTableFilterActive(column, filters[column.key]));
  const search = text(filters.$search).toLowerCase();
  if (!active.length && !search) return rows;

  return rows.filter((row) =>
    (!search || text(searchValue ? searchValue(row) : columns.map(column => shownText(column, row)).join(" ")).toLowerCase().includes(search)) &&
    active.every((column) => matchesFilter(column, row, filters[column.key], now)),
  );
}

export function irepsTableDownloadColumns(columns = []) {
  return columns.filter(column => column.export !== false && column.value).map(column => ({
    key: column.key,
    header: column.label,
    value: column.exportValue || column.value,
  }));
}

// Derive dropdown options from rows unless the page supplies scoped options.
export function irepsTableSelectOptions(rows = [], column) {
  if (!column || column.filter !== "select") return [];
  if (column.filterOptions) return column.filterOptions;

  return [...new Set(rows.flatMap(row => column.filterValues ? column.filterValues(row).map(text) : [shownText(column, row)]).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export function sortIrepsTableRows(rows = [], columns = [], sort = {}) {
  const column = columns.find((item) => item.key === sort?.key);
  if (!column) return rows;

  const read = column.sortValue || ((row) => shownText(column, row));
  const direction = sort?.direction === "desc" ? -1 : 1;

  return [...rows].sort((left, right) => {
    const a = read(left);
    const b = read(right);

    if (column.sortEmptyLast) {
      const aEmpty = a == null || a === "";
      const bEmpty = b == null || b === "";
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
    }

    if (typeof a === "number" && typeof b === "number") return (a - b) * direction;

    return (
      String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }) * direction
    );
  });
}

export function paginateIrepsTableRows(rows = [], page = 1, pageSize = IREPS_TABLE_DEFAULT_PAGE_SIZE) {
  const size = Number(pageSize) > 0 ? Number(pageSize) : IREPS_TABLE_DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (current - 1) * size;

  return { page: current, totalPages, rows: rows.slice(start, start + size) };
}

// The bands above the headings: one per group, spanning its columns, in the
// order the groups are given.
export function irepsTableBands(columns = [], groups = []) {
  return groups
    .map((group) => ({
      ...group,
      span: columns.filter((column) => column.group === group.key).length,
    }))
    .filter((group) => group.span > 0);
}
