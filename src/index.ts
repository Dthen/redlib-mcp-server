#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { registerTools } from "./tools.js";

// Configuration
const USE_HTTP = process.env.USE_HTTP === "true";  // Optional: enable HTTP transport

// Create MCP server instance
const server = new McpServer({
  name: "redlib-mcp-server",
  version: "1.0.0",
  description: "MCP server for interacting with Redlib (private Reddit front-end)"
});

// Register all tools
registerTools(server);

// Start the server
async function main() {
  if (USE_HTTP) {
    // Optional HTTP transport — TODO: implement with v2 SDK
    console.error("HTTP transport not yet implemented in v2 SDK");
    process.exit(1);

  } else {
    // Default stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Redlib MCP Server running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
