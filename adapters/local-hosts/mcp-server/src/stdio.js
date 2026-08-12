import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createAutocacheMcpServer } from './mcp.js';

export async function runStdio() {
  const server = createAutocacheMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, transport };
}
