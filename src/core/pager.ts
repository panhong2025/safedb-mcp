import { logger } from "../utils/logger.js";

export interface PagedResult {
  columns: string[];
  rows: unknown[][];
  total_rows: number;
  page: number;
  total_pages: number;
  has_more: boolean;
  execution_time_ms: number;
  truncated_fields?: string[];
}

interface CachedQuery {
  columns: string[];
  allRows: unknown[][];
  executionTime: number;
  createdAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHED_QUERIES = 10;

/**
 * Handles query result pagination and field truncation.
 * Caches full results for next_page calls.
 */
export class Pager {
  private cache = new Map<string, CachedQuery>();
  private currentQueryId: string | null = null;
  private currentPage = 0;

  constructor(
    private pageSize: number = 50,
    private truncateAt: number = 500
  ) {}

  /**
   * Format a fresh query result into a paged response.
   * Caches the full result for subsequent next_page calls.
   */
  formatResult(
    columns: string[],
    rows: unknown[][],
    executionTimeMs: number
  ): PagedResult {
    this.cleanup();

    const queryId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.cache.set(queryId, {
      columns,
      allRows: rows,
      executionTime: executionTimeMs,
      createdAt: Date.now(),
    });

    // Evict oldest if over limit
    if (this.cache.size > MAX_CACHED_QUERIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }

    this.currentQueryId = queryId;
    this.currentPage = 0;

    const totalPages = Math.max(1, Math.ceil(rows.length / this.pageSize));
    logger.debug("Query result cached", { queryId, rows: rows.length, totalPages });

    return this.getPage(queryId, 0);
  }

  /** Get the next page of the current query. */
  nextPage(): PagedResult | null {
    if (!this.currentQueryId) return null;
    this.currentPage++;
    const cached = this.cache.get(this.currentQueryId);
    if (!cached) return null;

    const totalPages = Math.ceil(cached.allRows.length / this.pageSize);
    if (this.currentPage >= totalPages) return null;

    return this.getPage(this.currentQueryId, this.currentPage);
  }

  private getPage(queryId: string, page: number): PagedResult {
    const cached = this.cache.get(queryId);
    if (!cached) {
      return {
        columns: [],
        rows: [],
        total_rows: 0,
        page: 0,
        total_pages: 0,
        has_more: false,
        execution_time_ms: 0,
      };
    }

    const start = page * this.pageSize;
    const pageRows = cached.allRows.slice(start, start + this.pageSize);
    const totalPages = Math.max(1, Math.ceil(cached.allRows.length / this.pageSize));

    // Truncate long fields
    const truncatedFields: string[] = [];
    const processedRows = pageRows.map((row) =>
      row.map((value, colIdx) => {
        if (typeof value === "string" && value.length > this.truncateAt) {
          const colName = cached.columns[colIdx] ?? `col_${colIdx}`;
          if (!truncatedFields.includes(colName)) {
            truncatedFields.push(colName);
          }
          return `${value.substring(0, this.truncateAt)}... [truncated, ${value.length} chars]`;
        }
        return value;
      })
    );
    if (truncatedFields.length > 0) {
      logger.debug("Fields truncated", { fields: truncatedFields, page: page + 1 });
    }

    return {
      columns: cached.columns,
      rows: processedRows,
      total_rows: cached.allRows.length,
      page: page + 1,
      total_pages: totalPages,
      has_more: page + 1 < totalPages,
      execution_time_ms: cached.executionTime,
      ...(truncatedFields.length > 0 ? { truncated_fields: truncatedFields } : {}),
    };
  }

  /** Remove expired cache entries. */
  private cleanup() {
    const now = Date.now();
    for (const [id, entry] of this.cache) {
      if (now - entry.createdAt > CACHE_TTL_MS) {
        this.cache.delete(id);
      }
    }
  }
}
