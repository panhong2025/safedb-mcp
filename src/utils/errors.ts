/**
 * Safe error formatting — never leaks connection strings, passwords, or internal paths.
 */

const SENSITIVE_PATTERNS = [
  /postgresql:\/\/[^\s]+/gi,
  /postgres:\/\/[^\s]+/gi,
  /password[=:]\s*\S+/gi,
  /host[=:]\s*[\d.]+/gi,
  /at\s+\S+\.(?:ts|js):\d+:\d+/g, // stack trace file paths
];

export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }

  return sanitized;
}

export class SafeDBError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = "SafeDBError";
  }
}

export class QueryBlockedError extends SafeDBError {
  constructor(
    public readonly reason: string,
    public readonly blockedStatement?: string,
    suggestion?: string
  ) {
    super(`Query blocked: ${reason}`, "BLOCKED", suggestion);
    this.name = "QueryBlockedError";
  }
}

export class ProRequiredError extends SafeDBError {
  constructor(public readonly feature: string) {
    super(
      `${feature} requires SafeDB Pro ($19/mo).`,
      "PRO_REQUIRED",
      "Buy SafeDB Pro at https://panhong2025.gumroad.com/l/safedb-pro — license key delivered instantly via email."
    );
    this.name = "ProRequiredError";
  }
}

export class ConnectionError extends SafeDBError {
  constructor(message: string) {
    super(
      sanitizeError(message),
      "CONNECTION_ERROR",
      "Check your connection URL, SSL settings, and database availability."
    );
    this.name = "ConnectionError";
  }
}
