// In-memory audit log for v1.
// TODO v1.1: Replace with better-sqlite3 for persistence
interface LogEntry {
  timestamp: string;
  sql: string;
  connection: string;
  execution_time_ms: number;
  rows_returned: number;
  blocked: boolean;
}

export class QueryAuditLog {
  private entries: LogEntry[] = [];
  private maxEntries = 1000;

  record(entry: Omit<LogEntry, "timestamp">) {
    this.entries.push({
      timestamp: new Date().toISOString(),
      ...entry,
    });
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  getRecent(limit: number): LogEntry[] {
    return this.entries.slice(-limit).reverse();
  }
}
