#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
    // Optional HTTP transport
    const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const { randomUUID } = await import("node:crypto");
    const http = await import("http");

    console.error("Redlib MCP Server running on HTTP transport");

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid: string) => {
        console.error(`Session initialized: ${sid}`);
      }
    });

    await server.connect(transport);

    // Create HTTP server
    const httpServer = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Session-ID, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');

      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }

      // Handle MCP endpoint
      if (req.url === '/mcp') {
        transport.handleRequest(req, res);
      } else {
        res.writeHead(404).end('Not found');
      }
    });

    const PORT = parseInt(process.env.PORT || "3000", 10);
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.error(`Redlib MCP Server listening on http://0.0.0.0:${PORT}/mcp`);
    });

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
