import Papa from "papaparse";
import { orderedFields, type ExportSource, type ExportValue } from "./allowlist";

/** Pure: turn allowlisted columns of source rows into CSV or JSON text. */

export type ExportRow = Record<string, ExportValue>;

export function projectRow(fields: readonly string[], source: ExportSource): ExportRow {
  const out: ExportRow = {};
  for (const f of orderedFields(fields)) out[f.key] = f.extract(source);
  return out;
}

/** Spreadsheet formula injection guard: a text cell must not start with = + - @ tab or CR. */
export function safeCell(value: ExportValue): string | number | boolean {
  if (value === null) return "";
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

export function toCsv(fields: readonly string[], rows: readonly ExportRow[]): string {
  const columns = orderedFields(fields).map((f) => f.key);
  const data = rows.map((r) => columns.map((c) => safeCell(r[c] ?? null)));
  return Papa.unparse({ fields: columns, data }, { newline: "\n" }) + "\n";
}

export function toJson(rows: readonly ExportRow[]): string {
  return JSON.stringify(rows, null, 2) + "\n";
}

export function serialize(
  format: "CSV" | "JSON",
  fields: readonly string[],
  rows: readonly ExportRow[],
): string {
  return format === "CSV" ? toCsv(fields, rows) : toJson(rows);
}
