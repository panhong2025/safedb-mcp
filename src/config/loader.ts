import fs from "node:fs";
import path from "node:path";
import { ConfigSchema, type SafeDBConfig } from "./schema.js";
import { logger } from "../utils/logger.js";

/**
 * Resolve environment variable references in a string.
 * Supports ${VAR_NAME} syntax.
 */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(`Environment variable ${varName} is not set`);
    }
    return envValue;
  });
}

/**
 * Recursively resolve env vars in all string values of an object.
 */
function resolveEnvVarsDeep(obj: unknown): unknown {
  if (typeof obj === "string") return resolveEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(resolveEnvVarsDeep);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVarsDeep(value);
    }
    return result;
  }
  return obj;
}

/**
 * Build config from DATABASE_URL env var (simple mode).
 */
function buildConfigFromEnv(): Record<string, unknown> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "No config file found and DATABASE_URL is not set.\n" +
        "Either create a safedb.config.json or set DATABASE_URL environment variable."
    );
  }

  return {
    connections: {
      default: {
        type: "postgresql",
        url,
        mode: process.env.SAFEDB_MODE || "readonly",
      },
    },
    default_connection: "default",
    pro: {
      license_key: process.env.SAFEDB_LICENSE_KEY,
    },
  };
}

/**
 * Load and validate SafeDB configuration.
 * Priority: safedb.config.json > DATABASE_URL env var
 */
export function loadConfig(): SafeDBConfig {
  const configPaths = [
    path.resolve("safedb.config.json"),
    path.resolve(".safedb.json"),
  ];

  let rawConfig: unknown;

  const configFile = configPaths.find((p) => fs.existsSync(p));
  if (configFile) {
    logger.info("Loading config from file", { path: configFile });
    const content = fs.readFileSync(configFile, "utf-8");
    rawConfig = JSON.parse(content);
  } else {
    logger.info("No config file found, using DATABASE_URL");
    rawConfig = buildConfigFromEnv();
  }

  const resolved = resolveEnvVarsDeep(rawConfig);
  const result = ConfigSchema.safeParse(resolved);

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }

  const config = result.data;

  // Set default_connection if not specified
  if (!config.default_connection) {
    config.default_connection = Object.keys(config.connections)[0];
  }

  return config;
}
