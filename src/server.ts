import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { probes } from "./lib.js";
import { renderDiagram } from "./diagram.js";
import type { CapturedTcpData, CapturedWsMessage, ProbesConfig } from "./interfaces/types.js";

export async function startMcpServer(config: ProbesConfig): Promise<void> {
  const instance = await probes(config);
  const server = new McpServer({
    name: "@codery/probes",
    version: "0.1.0",
  });

  server.registerTool(
    "configure",
    {
      description:
        "Merge partial config into running probes instance. Accepts same schema as probes.yml. Returns full current config after merge.",
      inputSchema: {
        config: z.string().describe("JSON string of partial config to merge"),
      },
    },
    async ({ config: configStr }) => {
      const partial = JSON.parse(configStr);
      const merged = await instance.configure(partial);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(merged, null, 2) }],
      };
    }
  );

  server.registerTool(
    "http_send",
    {
      description:
        "Send an HTTP request to the configured server (client mode). Returns { status, headers, body }.",
      inputSchema: {
        method: z.string().describe("HTTP method (GET, POST, PUT, DELETE, PATCH)"),
        path: z.string().describe("Request path (e.g., /v1/users)"),
        headers: z.record(z.string()).optional().describe("Additional request headers"),
        body: z.string().optional().describe("Request body as JSON string"),
      },
    },
    async ({ method, path, headers, body }) => {
      const res = await instance.http.send({
        method,
        path,
        headers,
        body: body ? JSON.parse(body) : undefined,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
      };
    }
  );

  server.registerTool(
    "http_put",
    {
      description:
        "Stage a response for the test HTTP server (server mode). The next incoming request receives this response.",
      inputSchema: {
        status: z.number().describe("HTTP status code"),
        headers: z.record(z.string()).optional().describe("Response headers"),
        body: z.string().optional().describe("Response body as JSON string"),
      },
    },
    async ({ status, headers, body }) => {
      await instance.http.put({
        status,
        headers,
        body: body ? JSON.parse(body) : undefined,
      });
      return {
        content: [{ type: "text" as const, text: "Response staged" }],
      };
    }
  );

  server.registerTool(
    "http_read",
    {
      description:
        "Read captured requests from the test HTTP server (server mode). Returns all requests since last read, then clears the buffer.",
      inputSchema: {},
    },
    async () => {
      const captured = await instance.http.read();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(captured, null, 2) }],
      };
    }
  );

  server.registerTool(
    "http_watch",
    {
      description:
        "Wait for an incoming HTTP request on the test server (server mode). Blocks until a request arrives or timeout.",
      inputSchema: {
        timeout_ms: z.number().optional().describe("Timeout in milliseconds (default 30000)"),
      },
    },
    async ({ timeout_ms }) => {
      const req = await instance.http.watch({ timeout_ms });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(req, null, 2) }],
      };
    }
  );

  server.registerTool(
    "http_reset",
    {
      description: "Clear captured requests and reset staged response on the test HTTP server.",
      inputSchema: {},
    },
    async () => {
      await instance.http.reset();
      return {
        content: [{ type: "text" as const, text: "HTTP state reset" }],
      };
    }
  );

  server.registerTool(
    "sql_put",
    {
      description:
        "Materialize a database table: drop existing table, recreate with inferred schema, insert provided rows. Empty rows drops table only. Schema inferred from first row: string->TEXT, number->REAL/INTEGER, boolean->INTEGER.",
      inputSchema: {
        table: z.string().describe("Table name"),
        rows: z.string().describe("JSON array of row objects"),
      },
    },
    async ({ table, rows: rowsStr }) => {
      const rows = JSON.parse(rowsStr);
      await instance.sql.put({ table, rows });
      return {
        content: [
          {
            type: "text" as const,
            text: `Table "${table}" materialized with ${rows.length} rows`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "sql_read",
    {
      description:
        "Read rows from a table. Where is an object mapping column to value (not raw SQL). Returns array of row objects.",
      inputSchema: {
        table: z.string().describe("Table name"),
        where: z.string().optional().describe('JSON object for WHERE conditions, e.g. {"name": "Alice"}'),
        order_by: z.string().optional().describe("Column name to order by"),
        limit: z.number().optional().describe("Max rows to return"),
      },
    },
    async ({ table, where: whereStr, order_by, limit }) => {
      const rows = await instance.sql.read({
        table,
        where: whereStr ? JSON.parse(whereStr) : undefined,
        order_by,
        limit,
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
      };
    }
  );

  server.registerTool(
    "sql_reset",
    {
      description:
        "Drop a specific table or wipe entire database. Omit table to drop all tables.",
      inputSchema: {
        table: z.string().optional().describe("Table name to drop. Omit to drop all tables."),
      },
    },
    async ({ table }) => {
      await instance.sql.reset(table ? { table } : undefined);
      return {
        content: [
          {
            type: "text" as const,
            text: table ? `Table "${table}" dropped` : "All tables dropped",
          },
        ],
      };
    }
  );

  server.registerTool(
    "fs_put",
    {
      description:
        "Write content to a file relative to configured root. Creates parent directories.",
      inputSchema: {
        path: z.string().describe("File path relative to root"),
        content: z.string().describe("File content to write"),
      },
    },
    async ({ path, content }) => {
      await instance.fs.put({ path, content });
      return {
        content: [{ type: "text" as const, text: `Written to ${path}` }],
      };
    }
  );

  server.registerTool(
    "fs_read",
    {
      description: "Read file content relative to configured root. Returns file content as string.",
      inputSchema: {
        path: z.string().describe("File path relative to root"),
      },
    },
    async ({ path }) => {
      const content = await instance.fs.read({ path });
      return {
        content: [{ type: "text" as const, text: content }],
      };
    }
  );

  server.registerTool(
    "fs_watch",
    {
      description:
        "Watch a file for content changes. Blocks until the file content differs from current. Returns new content.",
      inputSchema: {
        path: z.string().describe("File path relative to root"),
        timeout_ms: z.number().optional().describe("Timeout in milliseconds (default 5000)"),
      },
    },
    async ({ path, timeout_ms }) => {
      const content = await instance.fs.watch({ path, timeout_ms });
      return {
        content: [{ type: "text" as const, text: content }],
      };
    }
  );

  server.registerTool(
    "fs_reset",
    {
      description:
        "Delete a specific file/directory, or wipe everything under configured root.",
      inputSchema: {
        path: z.string().optional().describe("File or directory to delete. Omit to wipe root."),
      },
    },
    async ({ path }) => {
      await instance.fs.reset(path ? { path } : undefined);
      return {
        content: [
          {
            type: "text" as const,
            text: path ? `Deleted ${path}` : "Root wiped",
          },
        ],
      };
    }
  );

  server.registerTool(
    "tcp_send",
    {
      description:
        "Send base64-encoded bytes to all connected clients on a TCP target.",
      inputSchema: {
        target: z.string().describe("TCP target name from config"),
        data: z.string().describe("Base64-encoded bytes to send"),
      },
    },
    async ({ target, data }) => {
      await instance.tcp.send({ target, data });
      return {
        content: [
          {
            type: "text" as const,
            text: `Sent ${Buffer.from(data, "base64").length} bytes to ${target}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "tcp_watch",
    {
      description:
        "Wait for incoming data on a TCP target. Blocks until data arrives or timeout.",
      inputSchema: {
        target: z.string().describe("TCP target name from config"),
        timeout_ms: z
          .number()
          .optional()
          .describe("Timeout in milliseconds (default 30000)"),
      },
    },
    async ({ target, timeout_ms }) => {
      const iter = instance.tcp.watch({ target, timeout_ms });
      const result = await iter[Symbol.asyncIterator]().next();
      if (result.done) {
        return {
          content: [{ type: "text" as const, text: "Watch ended" }],
        };
      }
      const captured: CapturedTcpData = result.value;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(captured, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "ws_server_send",
    {
      description:
        "Send a message to all connected WebSocket clients on a server target. Use binary: true to send base64-encoded bytes as a binary frame.",
      inputSchema: {
        target: z.string().describe("WS server target name from config"),
        data: z.string().describe("Message content (text) or base64-encoded bytes (if binary)"),
        binary: z.boolean().optional().describe("Send as binary frame (data is base64)"),
      },
    },
    async ({ target, data, binary }) => {
      if (!instance.ws.server) throw new Error("WS server interface not configured");
      await instance.ws.server.send({ target, data, binary });
      return {
        content: [
          {
            type: "text" as const,
            text: binary
              ? `Sent ${Buffer.from(data, "base64").length} bytes to ${target}`
              : `Sent text message to ${target}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "ws_server_watch",
    {
      description:
        "Wait for an incoming WebSocket message on a server target. Blocks until data arrives or timeout.",
      inputSchema: {
        target: z.string().describe("WS server target name from config"),
        timeout_ms: z
          .number()
          .optional()
          .describe("Timeout in milliseconds (default 30000)"),
      },
    },
    async ({ target, timeout_ms }) => {
      if (!instance.ws.server) throw new Error("WS server interface not configured");
      const iter = instance.ws.server.watch({ target, timeout_ms });
      const result = await iter[Symbol.asyncIterator]().next();
      if (result.done) {
        return {
          content: [{ type: "text" as const, text: "Watch ended" }],
        };
      }
      const captured: CapturedWsMessage = result.value;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(captured, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "ws_server_reset",
    {
      description: "Clear buffered WebSocket messages for a server target.",
      inputSchema: {
        target: z.string().describe("WS server target name from config"),
      },
    },
    async ({ target }) => {
      if (!instance.ws.server) throw new Error("WS server interface not configured");
      await instance.ws.server.reset({ target });
      return {
        content: [
          {
            type: "text" as const,
            text: `WS server buffer cleared for ${target}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "ws_client_send",
    {
      description:
        "Send a message to the WebSocket server on a client target. Use binary: true to send base64-encoded bytes as a binary frame.",
      inputSchema: {
        target: z.string().describe("WS client target name from config"),
        data: z.string().describe("Message content (text) or base64-encoded bytes (if binary)"),
        binary: z.boolean().optional().describe("Send as binary frame (data is base64)"),
      },
    },
    async ({ target, data, binary }) => {
      if (!instance.ws.client) throw new Error("WS client interface not configured");
      await instance.ws.client.send({ target, data, binary });
      return {
        content: [
          {
            type: "text" as const,
            text: binary
              ? `Sent ${Buffer.from(data, "base64").length} bytes to ${target}`
              : `Sent text message to ${target}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "ws_client_watch",
    {
      description:
        "Wait for a WebSocket message from the server on a client target. Blocks until data arrives or timeout.",
      inputSchema: {
        target: z.string().describe("WS client target name from config"),
        timeout_ms: z
          .number()
          .optional()
          .describe("Timeout in milliseconds (default 30000)"),
      },
    },
    async ({ target, timeout_ms }) => {
      if (!instance.ws.client) throw new Error("WS client interface not configured");
      const iter = instance.ws.client.watch({ target, timeout_ms });
      const result = await iter[Symbol.asyncIterator]().next();
      if (result.done) {
        return {
          content: [{ type: "text" as const, text: "Watch ended" }],
        };
      }
      const captured: CapturedWsMessage = result.value;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(captured, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "ws_client_reset",
    {
      description: "Clear buffered WebSocket messages for a client target.",
      inputSchema: {
        target: z.string().describe("WS client target name from config"),
      },
    },
    async ({ target }) => {
      if (!instance.ws.client) throw new Error("WS client interface not configured");
      await instance.ws.client.reset({ target });
      return {
        content: [
          {
            type: "text" as const,
            text: `WS client buffer cleared for ${target}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "render_diagram",
    {
      description:
        "Render an ASCII architecture diagram showing an app surrounded by its probe interfaces. Call this before writing E2E test files and embed the result as a block comment at the top of each test file.",
      inputSchema: {
        app: z.string().describe("App name shown in the center box"),
        inbound: z
          .array(z.string())
          .describe("Inbound external interfaces (left side, arrows point into app)"),
        outbound: z
          .array(z.string())
          .describe("Outbound external interfaces (right side, arrows point into app)"),
        internal: z
          .array(z.string())
          .optional()
          .describe("Internal-facing interfaces below the box (DB, queue, filesystem, etc.)"),
      },
    },
    ({ app, inbound, outbound, internal }) => {
      const diagram = renderDiagram({ app, inbound, outbound, internal });
      return {
        content: [{ type: "text" as const, text: diagram }],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
