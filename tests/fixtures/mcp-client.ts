import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";

export class McpTestClient {
  private client: Client;
  private transport: StdioClientTransport;

  private constructor(client: Client, transport: StdioClientTransport) {
    this.client = client;
    this.transport = transport;
  }

  static async create(): Promise<McpTestClient> {
    const serverPath = path.resolve("build/index.js");

    const transport = new StdioClientTransport({
      command: "node",
      args: [serverPath],
      stderr: "pipe",
    });

    const client = new Client(
      { name: "mcp-rtfm-test", version: "0.1.0" },
      { capabilities: {} },
    );

    await client.connect(transport);

    return new McpTestClient(client, transport);
  }

  async callTool(name: string, args: Record<string, unknown>) {
    return this.client.callTool({ name, arguments: args });
  }

  async close() {
    await this.client.close();
    await this.transport.close();
  }
}