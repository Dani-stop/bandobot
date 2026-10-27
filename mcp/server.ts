// BandoBot MCP server (stdio): lets Claude Desktop / Claude Code search Italian public calls directly.
//
//   npx tsx mcp/server.ts
//
// Config example (Claude Code):  claude mcp add bandobot -- npx tsx C:/path/to/bandobot/mcp/server.ts
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listBandi, readPage, searchBandi } from "../src/lib/search";

// Load ../.env.local so the server works no matter which directory the client starts it from.
const envFile = path.resolve(__dirname, "..", ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const server = new McpServer({ name: "bandobot", version: "1.0.0" });

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

server.registerTool(
  "list_bandi",
  {
    title: "Elenca bandi",
    description: "Elenca i bandi indicizzati con slug, ente, scadenza e numero di pagine.",
    inputSchema: {},
  },
  async () => text(JSON.stringify(await listBandi(), null, 2)),
);

server.registerTool(
  "search_bandi",
  {
    title: "Cerca nei bandi",
    description:
      "Ricerca ibrida (semantica + parole chiave italiane) nei testi dei bandi. Restituisce i passaggi più rilevanti con slug e pagina da citare.",
    inputSchema: {
      query: z.string().describe("Cosa cercare, in italiano"),
      slug: z.string().optional().describe("Limita la ricerca a un bando (slug da list_bandi)"),
      limit: z.number().int().min(1).max(15).optional().describe("Numero di passaggi (default 6)"),
    },
  },
  async ({ query, slug, limit }) => {
    const results = await searchBandi(query, slug, limit ?? 6);
    if (!results.length) return text("Nessun passaggio trovato.");
    return text(results.map((r) => `[${r.document_slug} p.${r.page}] (score ${r.score.toFixed(3)})\n${r.content}`).join("\n\n---\n\n"));
  },
);

server.registerTool(
  "read_page",
  {
    title: "Leggi pagina",
    description: "Restituisce il testo completo di una pagina di un bando.",
    inputSchema: {
      slug: z.string().describe("Slug del bando"),
      page: z.number().int().min(1).describe("Numero di pagina (da 1)"),
    },
  },
  async ({ slug, page }) => text(await readPage(slug, page)),
);

server.connect(new StdioServerTransport()).catch((err) => {
  console.error(err);
  process.exit(1);
});
