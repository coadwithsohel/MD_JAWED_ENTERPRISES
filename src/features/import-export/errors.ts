// ─── Import/Export Error Types ──────────────────────────────────────────────

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 422,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export class CsvParseError extends ImportError {
  constructor(message: string, details?: unknown[]) {
    super(message, "CSV_PARSE_ERROR", 422, details);
    this.name = "CsvParseError";
  }
}

export class ValidationError extends ImportError {
  constructor(message: string, details?: unknown[]) {
    super(message, "IMPORT_VALIDATION_FAILED", 422, details);
    this.name = "ValidationError";
  }
}

export class AuthError extends ImportError {
  constructor(message: string, code: string = "SESSION_USER_NOT_FOUND") {
    super(message, code, 401);
    this.name = "AuthError";
  }
}

export class PermissionError extends ImportError {
  constructor(message: string = "You do not have permission.") {
    super(message, "FORBIDDEN", 403);
    this.name = "PermissionError";
  }
}

export class DuplicateError extends ImportError {
  constructor(message: string, details?: unknown[]) {
    super(message, "DUPLICATE_ERROR", 409, details);
    this.name = "DuplicateError";
  }
}

export class FileTooLargeError extends ImportError {
  constructor(maxSize: string) {
    super(`File is too large. Maximum size is ${maxSize}.`, "FILE_TOO_LARGE", 413);
    this.name = "FileTooLargeError";
  }
}

export class BatchNotFoundError extends ImportError {
  constructor(batchId: string) {
    super(`Import batch not found: ${batchId}`, "BATCH_NOT_FOUND", 404);
    this.name = "BatchNotFoundError";
  }
}

export class BatchAlreadyCommittedError extends ImportError {
  constructor(batchId: string) {
    super(`Batch ${batchId} has already been committed.`, "BATCH_ALREADY_COMMITTED", 409);
    this.name = "BatchAlreadyCommittedError";
  }
}

// ─── Error helpers ──────────────────────────────────────────────────────────

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function getErrorCode(err: unknown): string {
  if (err instanceof ImportError) return err.code;
  if (err instanceof SyntaxError) return "SYNTAX_ERROR";
  return "INTERNAL_ERROR";
}

export function getHttpStatus(err: unknown): number {
  if (err instanceof ImportError) return err.statusCode;
  return 500;
}