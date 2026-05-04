import { z } from "zod";

export const ConnectionMode = z.enum(["readonly", "restricted", "unrestricted"]);
export type ConnectionMode = z.infer<typeof ConnectionMode>;

const ConnectionSchema = z.object({
  type: z.enum(["postgresql"]).default("postgresql"),
  url: z.string().min(1, "Connection URL is required"),
  mode: ConnectionMode.default("readonly"),
  ssl: z
    .union([z.boolean(), z.object({ rejectUnauthorized: z.boolean().optional() })])
    .optional(),
  timeout: z.number().positive().default(30000),
  max_rows: z.number().positive().default(10000),
});

export type ConnectionConfig = z.infer<typeof ConnectionSchema>;

const DefaultsSchema = z.object({
  page_size: z.number().min(10).max(500).default(50),
  query_timeout: z.number().positive().default(30000),
  max_rows: z.number().positive().default(10000),
  truncate_at: z.number().positive().default(500),
});

const ProSchema = z.object({
  license_key: z.string().optional(),
  pii_masking: z.boolean().default(false),
  audit_log: z.boolean().default(false),
  audit_log_path: z.string().default("./safedb-audit.db"),
});

export const ConfigSchema = z.object({
  connections: z.record(z.string(), ConnectionSchema).refine(
    (conns) => Object.keys(conns).length > 0,
    "At least one connection is required"
  ),
  default_connection: z.string().optional(),
  defaults: DefaultsSchema.default({}),
  pro: ProSchema.default({}),
});

export type SafeDBConfig = z.infer<typeof ConfigSchema>;
