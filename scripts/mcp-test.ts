// End-to-end check of the MCP server: spawns it over stdio, lists tools and calls search_bandi.
//   npx tsx scripts/mcp-test.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const client = new Client({ name: "bandobot-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "mcp/server.ts"], stderr: "ignore" }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));

  const result = await client.callTool({
    name: "search_bandi",
    arguments: { query: "anni di esperienza richiesti", slug: "casino-sanremo-2-2026", limit: 2 },
  });
  const content = result.content as { type: string; text: string }[];
  console.log(content[0].text.slice(0, 400));
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
