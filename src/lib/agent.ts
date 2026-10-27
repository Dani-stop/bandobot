import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { listBandi, readPage, searchBandi, type Passage } from "./search";

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type AgentStep = { tool: string; input: unknown; summary: string };
export type AgentResult = { answer: string; steps: AgentStep[]; sources: Passage[] };

const SYSTEM_PROMPT = `Sei BandoBot, un assistente che aiuta i giovani a capire bandi pubblici, concorsi e selezioni italiane.

Rispondi solo con informazioni che trovi nei bandi tramite i tuoi strumenti: prima di rispondere cerca sempre (anche più ricerche con parole diverse, e leggi la pagina intera quando un requisito o una scadenza è spezzato). Se un'informazione non è nei documenti, dillo chiaramente invece di indovinare.

Cita ogni informazione con il riferimento esatto nel formato [slug p.N], per esempio [casino-sanremo-2-2026 p.2].

Quando l'utente descrive il proprio profilo e chiede se può partecipare: elenca i requisiti del bando uno per uno, confrontali con il profilo (✅ posseduto, ❌ mancante, ❓ da verificare) e dai una conclusione onesta. Non suggerire mai di dichiarare il falso: le autocertificazioni false sono reato (art. 76 DPR 445/2000).

Scrivi in italiano semplice, frasi brevi, elenchi puntati quando aiutano. Le date relative (es. "mancano 6 giorni") calcolale rispetto alla data di oggi indicata sotto.`;

export async function runAgent(history: ChatTurn[]): Promise<AgentResult> {
  const client = new Anthropic();
  const steps: AgentStep[] = [];
  const sources = new Map<number, Passage>();

  const tools = [
    betaZodTool({
      name: "list_bandi",
      description: "Elenca i bandi disponibili con slug, ente, scadenza e numero di pagine.",
      inputSchema: z.object({}),
      run: async () => {
        const bandi = await listBandi();
        steps.push({ tool: "list_bandi", input: {}, summary: `${bandi.length} bandi` });
        return JSON.stringify(bandi);
      },
    }),
    betaZodTool({
      name: "search_bandi",
      description:
        "Ricerca ibrida (semantica + parole chiave) nei testi dei bandi. Restituisce i passaggi più rilevanti con slug e pagina. Usa domande o parole chiave specifiche; filtra per slug quando la domanda riguarda un solo bando.",
      inputSchema: z.object({
        query: z.string().describe("Cosa cercare, in italiano"),
        slug: z.string().optional().describe("Limita la ricerca a un bando (slug da list_bandi)"),
      }),
      run: async ({ query, slug }) => {
        const results = await searchBandi(query, slug, 6);
        results.forEach((r) => sources.set(r.chunk_id, r));
        steps.push({ tool: "search_bandi", input: { query, slug }, summary: `${results.length} passaggi` });
        return results
          .map((r) => `[${r.document_slug} p.${r.page}]\n${r.content}`)
          .join("\n\n---\n\n");
      },
    }),
    betaZodTool({
      name: "read_page",
      description: "Legge il testo completo di una pagina di un bando. Usalo quando un passaggio trovato è tagliato o serve il contesto.",
      inputSchema: z.object({
        slug: z.string(),
        page: z.number().int().min(1),
      }),
      run: async ({ slug, page }) => {
        const text = await readPage(slug, page);
        steps.push({ tool: "read_page", input: { slug, page }, summary: `${text.length} caratteri` });
        return `[${slug} p.${page}]\n${text}`;
      },
    }),
  ];

  const today = new Date().toLocaleDateString("it-IT", { timeZone: "Europe/Rome", dateStyle: "full" });

  const finalMessage = await client.beta.messages.toolRunner({
    model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
    max_tokens: 16000,
    max_iterations: 8,
    output_config: { effort: "low" },
    // On a policy decline, the API re-runs the request on a suitable fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: `${SYSTEM_PROMPT}\n\nOggi è ${today}.`,
    tools,
    messages: history.map((turn) => ({ role: turn.role, content: turn.content })),
  });

  if (finalMessage.stop_reason === "refusal") {
    return { answer: "Non posso rispondere a questa richiesta.", steps, sources: [] };
  }

  const answer = finalMessage.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // Keep only the passages the answer actually cites.
  const cited = new Set([...answer.matchAll(/\[([a-z0-9-]+) p\.(\d+)\]/g)].map((m) => `${m[1]}#${m[2]}`));
  const usedSources = [...sources.values()].filter((s) => cited.has(`${s.document_slug}#${s.page}`));

  return { answer, steps, sources: usedSources };
}
