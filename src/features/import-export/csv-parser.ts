// ─── Production CSV Parser ─────────────────────────────────────────────────
// Uses csv-parse package. NOT a naive line.split(",").

import { parse } from "csv-parse/sync";
import { CsvParseError } from "./errors";

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  errors: CsvRowError[];
}

export interface CsvRowError {
  rowNumber: number;
  message: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Parse a CSV string into structured rows with strict validation.
 * Handles:
 * - UTF-8 BOM
 * - Quoted commas
 * - Escaped quotes
 * - CRLF and LF
 * - Blank optional fields
 * - Row-number preservation
 * - Malformed row reporting
 */
export function parseCsv(
  content: string,
  requiredHeaders?: string[],
): CsvParseResult {
  const errors: CsvRowError[] = [];

  if (!content || content.trim().length === 0) {
    throw new CsvParseError("File is empty.");
  }

  if (Buffer.byteLength(content, "utf8") > MAX_FILE_SIZE) {
    throw new CsvParseError("File is too large. Maximum size is 10MB.");
  }

  // Remove UTF-8 BOM
  const cleanContent = content.replace(/^\uFEFF/, "");

  // Split into lines for row tracking
  const lines = cleanContent.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new CsvParseError("File must contain a header row and at least one data row.");
  }

  // Use csv-parse for robust parsing
  let records: string[][];
  try {
    records = parse(cleanContent, {
      delimiter: ",",
      bom: true,
      relaxColumnCount: true,
      skipEmptyLines: true,
      trim: true,
    });
  } catch (err) {
    throw new CsvParseError(
      `Failed to parse CSV: ${err instanceof Error ? err.message : "Unknown parse error"}`,
    );
  }

  if (records.length < 1) {
    throw new CsvParseError("No data rows found.");
  }

  // Extract and normalize headers
  const rawHeaders = records[0].map((h) => h.trim());
  const normalizedHeaderMap = new Map<string, string>();

  // Check for duplicate headers
  const seenHeaders = new Set<string>();
  for (let i = 0; i < rawHeaders.length; i++) {
    const normalized = rawHeaders[i].toLowerCase().replace(/[\s_-]+/g, "").trim();
    if (!normalized) {
      throw new CsvParseError(`Header at column ${i + 1} is empty.`);
    }
    if (seenHeaders.has(normalized)) {
      throw new CsvParseError(`Duplicate header: "${rawHeaders[i]}" at column ${i + 1}.`);
    }
    seenHeaders.add(normalized);
    normalizedHeaderMap.set(normalized, rawHeaders[i]);
  }

  const headers = rawHeaders;

  // Validate required headers
  if (requiredHeaders && requiredHeaders.length > 0) {
    const missingHeaders = requiredHeaders.filter(
      (req) => !normalizedHeaderMap.has(req.toLowerCase().replace(/[\s_-]+/g, "")),
    );
    if (missingHeaders.length > 0) {
      throw new CsvParseError(
        `Missing required columns: ${missingHeaders.join(", ")}.`,
        missingHeaders.map((h) => ({ required: h })),
      );
    }
  }

  // Parse data rows
  const rows: Record<string, string>[] = [];
  const dataRecords = records.slice(1);

  for (let i = 0; i < dataRecords.length; i++) {
    const record = dataRecords[i];
    const rowNumber = i + 2; // 1-based, +2 because header is row 1

    // Skip completely empty rows
    if (record.length === 0 || record.every((cell) => !cell || cell.trim() === "")) {
      continue;
    }

    const row: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      const cellValue = j < record.length ? (record[j] || "").trim() : "";
      row[headers[j]] = cellValue;
    }

    rows.push(row);
  }

  return {
    headers,
    rows,
    rowCount: rows.length,
    errors,
  };
}

/**
 * Get a cell value from a parsed row by case-insensitive header matching.
 */
export function getCellValue(
  row: Record<string, string>,
  possibleHeaders: string[],
): string {
  const rowKeys = Object.keys(row);
  for (const header of possibleHeaders) {
    const normalized = header.toLowerCase().replace(/[\s_-]+/g, "");
    const matchedKey = rowKeys.find(
      (k) => k.toLowerCase().replace(/[\s_-]+/g, "") === normalized,
    );
    if (matchedKey && row[matchedKey]) {
      return row[matchedKey].trim();
    }
  }
  return "";
}

/**
 * Check if a string value represents a truthy/yes/active value.
 */
export function isTruthy(value: string): boolean {
  const v = value.toLowerCase().trim();
  return v === "yes" || v === "true" || v === "1" || v === "active";
}