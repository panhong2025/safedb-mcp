import type pg from "pg";
import { logger } from "../utils/logger.js";

interface TableSummary {
  name: string;
  schema: string;
  rows_estimate: number;
  comment: string | null;
}

interface ColumnDetail {
  name: string;
  type: string;
  nullable: boolean;
  default_value: string | null;
  is_pk: boolean;
  comment: string | null;
}

interface ForeignKey {
  column: string;
  references: string; // "table.column"
}

interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface TableDetail {
  table: string;
  schema: string;
  comment: string | null;
  columns: ColumnDetail[];
  indexes: IndexInfo[];
  foreign_keys: ForeignKey[];
  row_estimate: number;
}

export interface SchemaOverview {
  database: string;
  table_count: number;
  tables: TableSummary[];
  hint?: string;
}

const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

/**
 * Reads and caches database schema information.
 * Optimized for token efficiency — summary mode for large databases.
 */
export class SchemaReader {
  private overviewCache: { data: SchemaOverview; at: number } | null = null;
  private tableCache = new Map<string, { data: TableDetail; at: number }>();

  constructor(private pool: pg.Pool) {}

  /** Invalidate caches (call when switching connections). */
  invalidate() {
    this.overviewCache = null;
    this.tableCache.clear();
  }

  /** Update the pool reference (call when switching connections). */
  setPool(pool: pg.Pool) {
    this.pool = pool;
    this.invalidate();
  }

  /** Get database overview — table list with row estimates and comments. */
  async getOverview(): Promise<SchemaOverview> {
    if (this.overviewCache && Date.now() - this.overviewCache.at < SCHEMA_CACHE_TTL_MS) {
      return this.overviewCache.data;
    }

    const dbResult = await this.pool.query("SELECT current_database()");
    const dbName = dbResult.rows[0]?.current_database ?? "unknown";

    const result = await this.pool.query(`
      SELECT
        t.table_schema,
        t.table_name,
        COALESCE(
          obj_description((t.table_schema || '.' || t.table_name)::regclass, 'pg_class'),
          ''
        ) AS comment,
        COALESCE(s.n_live_tup, 0) AS row_estimate
      FROM information_schema.tables t
      LEFT JOIN pg_stat_user_tables s
        ON s.schemaname = t.table_schema AND s.relname = t.table_name
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_schema, t.table_name
    `);

    const tables: TableSummary[] = result.rows.map((r: Record<string, unknown>) => ({
      name: r.table_name as string,
      schema: r.table_schema as string,
      rows_estimate: Number(r.row_estimate),
      comment: (r.comment as string) || null,
    }));

    const overview: SchemaOverview = {
      database: dbName,
      table_count: tables.length,
      tables,
    };

    if (tables.length > 50) {
      overview.hint =
        "Large database detected. Use get_schema(table='table_name') for full column details of specific tables.";
    }

    this.overviewCache = { data: overview, at: Date.now() };
    logger.debug("Schema overview cached", { tables: tables.length });
    return overview;
  }

  /** Get full details for a single table. */
  async getTableDetail(tableName: string, schemaName = "public"): Promise<TableDetail> {
    const cacheKey = `${schemaName}.${tableName}`;
    const cached = this.tableCache.get(cacheKey);
    if (cached && Date.now() - cached.at < SCHEMA_CACHE_TTL_MS) {
      return cached.data;
    }

    const [columns, indexes, foreignKeys, tableComment, rowEstimate] = await Promise.all([
      this.getColumns(tableName, schemaName),
      this.getIndexes(tableName, schemaName),
      this.getForeignKeys(tableName, schemaName),
      this.getTableComment(tableName, schemaName),
      this.getRowEstimate(tableName, schemaName),
    ]);

    const detail: TableDetail = {
      table: tableName,
      schema: schemaName,
      comment: tableComment,
      columns,
      indexes,
      foreign_keys: foreignKeys,
      row_estimate: rowEstimate,
    };

    this.tableCache.set(cacheKey, { data: detail, at: Date.now() });
    return detail;
  }

  private async getColumns(table: string, schema: string): Promise<ColumnDetail[]> {
    const result = await this.pool.query(
      `
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        COALESCE(
          col_description((quote_ident($2) || '.' || quote_ident($1))::regclass, c.ordinal_position),
          ''
        ) AS comment,
        EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_name = $1
            AND tc.table_schema = $2
            AND kcu.column_name = c.column_name
        ) AS is_pk
      FROM information_schema.columns c
      WHERE c.table_name = $1 AND c.table_schema = $2
      ORDER BY c.ordinal_position
    `,
      [table, schema]
    );

    return result.rows.map((r: Record<string, unknown>) => ({
      name: r.column_name as string,
      type: r.data_type as string,
      nullable: r.is_nullable === "YES",
      default_value: (r.column_default as string) ?? null,
      is_pk: r.is_pk as boolean,
      comment: (r.comment as string) || null,
    }));
  }

  private async getIndexes(table: string, schema: string): Promise<IndexInfo[]> {
    const result = await this.pool.query(
      `
      SELECT
        i.relname AS index_name,
        array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns,
        ix.indisunique AS is_unique
      FROM pg_index ix
      JOIN pg_class t ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE t.relname = $1 AND n.nspname = $2
      GROUP BY i.relname, ix.indisunique
      ORDER BY i.relname
    `,
      [table, schema]
    );

    return result.rows.map((r: Record<string, unknown>) => ({
      name: r.index_name as string,
      columns: r.columns as string[],
      unique: r.is_unique as boolean,
    }));
  }

  private async getForeignKeys(table: string, schema: string): Promise<ForeignKey[]> {
    const result = await this.pool.query(
      `
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table,
        ccu.column_name AS foreign_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = $1
        AND tc.table_schema = $2
    `,
      [table, schema]
    );

    return result.rows.map((r: Record<string, unknown>) => ({
      column: r.column_name as string,
      references: `${r.foreign_table}.${r.foreign_column}`,
    }));
  }

  private async getTableComment(table: string, schema: string): Promise<string | null> {
    try {
      const result = await this.pool.query(
        `SELECT obj_description((quote_ident($2) || '.' || quote_ident($1))::regclass, 'pg_class') AS comment`,
        [table, schema]
      );
      return (result.rows[0]?.comment as string) || null;
    } catch {
      return null;
    }
  }

  private async getRowEstimate(table: string, schema: string): Promise<number> {
    const result = await this.pool.query(
      `SELECT COALESCE(n_live_tup, 0) AS estimate FROM pg_stat_user_tables WHERE relname = $1 AND schemaname = $2`,
      [table, schema]
    );
    return Number(result.rows[0]?.estimate ?? 0);
  }
}
