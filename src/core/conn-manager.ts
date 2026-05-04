import pg from "pg";
import type { SafeDBConfig, ConnectionConfig, ConnectionMode } from "../config/schema.js";
import { ConnectionError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export interface ActiveConnection {
  name: string;
  pool: pg.Pool;
  config: ConnectionConfig;
  mode: ConnectionMode;
}

/**
 * Manages named database connections with pooling.
 */
export class ConnManager {
  private pools = new Map<string, pg.Pool>();
  private configs: Record<string, ConnectionConfig>;
  private activeName: string;

  constructor(private config: SafeDBConfig) {
    this.configs = config.connections;
    this.activeName = config.default_connection ?? Object.keys(config.connections)[0]!;
  }

  /** Get the current active connection. Lazily creates pool on first access. */
  getActive(): ActiveConnection {
    const connConfig = this.configs[this.activeName];
    if (!connConfig) {
      throw new ConnectionError(`Connection '${this.activeName}' not found in config.`);
    }

    if (!this.pools.has(this.activeName)) {
      this.pools.set(this.activeName, this.createPool(connConfig));
    }

    return {
      name: this.activeName,
      pool: this.pools.get(this.activeName)!,
      config: connConfig,
      mode: connConfig.mode,
    };
  }

  /** Switch active connection by name. */
  switchTo(name: string): ActiveConnection {
    if (!this.configs[name]) {
      const available = Object.keys(this.configs).join(", ");
      throw new ConnectionError(
        `Connection '${name}' not found. Available: ${available}`
      );
    }
    this.activeName = name;
    logger.info("Switched connection", { name });
    return this.getActive();
  }

  /** List all configured connections. */
  listConnections(): Array<{ name: string; type: string; mode: ConnectionMode; active: boolean }> {
    return Object.entries(this.configs).map(([name, config]) => ({
      name,
      type: config.type,
      mode: config.mode,
      active: name === this.activeName,
    }));
  }

  /** Test the active connection. */
  async testConnection(): Promise<boolean> {
    try {
      const { pool } = this.getActive();
      await pool.query("SELECT 1");
      return true;
    } catch (e) {
      logger.error("Connection test failed", {
        connection: this.activeName,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  }

  /** Gracefully close all pools. */
  async closeAll(): Promise<void> {
    for (const [name, pool] of this.pools) {
      try {
        await pool.end();
        logger.debug("Closed pool", { name });
      } catch {
        // ignore close errors
      }
    }
    this.pools.clear();
  }

  private createPool(connConfig: ConnectionConfig): pg.Pool {
    const poolConfig: pg.PoolConfig = {
      connectionString: connConfig.url,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: connConfig.timeout,
    };

    // SSL configuration — default to verifying certificates
    if (connConfig.ssl === true) {
      poolConfig.ssl = { rejectUnauthorized: true };
    } else if (typeof connConfig.ssl === "object") {
      poolConfig.ssl = connConfig.ssl;
    }

    const pool = new pg.Pool(poolConfig);
    logger.info("Connection pool created", { ssl: !!connConfig.ssl, timeout: connConfig.timeout });

    pool.on("error", (err) => {
      logger.error("Unexpected pool error", { error: err.message });
    });

    return pool;
  }
}
