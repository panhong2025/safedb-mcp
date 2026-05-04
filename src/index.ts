#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("Starting SafeDB MCP Server v1.0.0");

  try {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info("SafeDB MCP Server running (stdio transport)");
  } catch (e) {
    logger.error("Failed to start server", {
      error: e instanceof Error ? e.message : String(e),
    });
    process.exit(1);
  }
}

main();
