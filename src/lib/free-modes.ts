// Zero-cost answer modes, used when no Claude key is configured:
//  - Gemini (free tier from Google AI Studio, no credit card): one retrieval pass + one generation call.
//  - Search-only: no LLM at all, returns the most relevant passages with their page.
import type { AgentResult, ChatTurn } from "./agent";
import { listBandi, readPage, searchBandi, type Passage } from "./search";

const GEMINI_SYSTEM = `Sei BandoBot, un assistente che aiuta i giovani a capire bandi pubblici italiani.
Rispondi SOLO con le informazioni nelle schede e nei passaggi forniti. Se la risposta non c'è, dillo chiaramente.
Cita ogni informazione presa dai passaggi con il riferimento esatto nel formato [slug p.N]. Le scadenze delle schede sono dati verificati: indicale come "(scheda del bando)".
Leggi con attenzione le tabelle: le righe con sigla provincia (es. IM, GE, SV) elencano sedi diverse, riportale tutte.
Se l'utente descrive il suo profilo, confronta i requisiti uno per uno (✅ posseduto, ❌ mancante, ❓ da verificare) e dai una conclusione onesta. Non suggerire mai di dichiarare il falso.
Scrivi in italiano semplice, frasi brevi, elenchi puntati.`;

// Uses the latest user turn plus the previous one, so follow-ups ("e per il servizio civile?") keep context.
// Two searches (latest question alone, and with the previous turn), merged in page order so tables
// and lists split across neighbouring chunks reach the model together.
async function retrieve(history: ChatTurn[], limit = 8): Promise<Passage[]> {
  const userTurns = history.filter((t) => t.role === "user").map((t) => t.content);
  const latest = userTurns.at(-1) ?? "";
  const withContext = userTurns.slice(-2).join("\n").slice(-1500);
  const runs = await Promise.all([
    searchBandi(latest, undefined, limit),
    withContext !== latest ? searchBandi(withContext, undefined, limit) : Promise.resolve([]),
  ]);
  const byId = new Map<number, Passage>();
  for (const p of runs.flat()) if (!byId.has(p.chunk_id)) byId.set(p.chunk_id, p);
  return [...byId.values()];
}

// Picks the sentence sharing the most word stems with the question, plus the next one.
function bestSnippet(content: string, question: string): string {
  const stems = new Set(
    question.toLowerCase().match(/[a-zàèéìòù]{4,}/g)?.map((w) => w.slice(0, 5)) ?? [],
  );
  const sentences = content.replace(/\s+/g, " ").split(/(?<=[.;:])\s+/);
  let best = 0;
  let bestScore = -1;
  sentences.forEach((s, i) => {
    const words = s.toLowerCase().match(/[a-zàèéìòù]{4,}/g) ?? [];
    const score = words.filter((w) => stems.has(w.slice(0, 5))).length;
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  const snippet = sentences.slice(best, best + 2).join(" ");
  return snippet.length > 320 ? `${snippet.slice(0, 320)}…` : snippet;
}

export async function answerSearchOnly(history: ChatTurn[]): Promise<AgentResult> {
  const passages = await retrieve(history);
  const question = history.at(-1)?.content ?? "";
  const lines = passages
    .slice(0, 5)
    .map((p) => `- **${p.document_title}** [${p.document_slug} p.${p.page}]: ${bestSnippet(p.content, question)}`);
  return {
    answer: `Modalità solo ricerca (senza AI): ecco i passaggi più rilevanti dei bandi. Clicca sulla pagina per leggerli.\n\n${lines.join("\n")}`,
    steps: [{ tool: "search_bandi", input: { query: history.at(-1)?.content ?? "" }, summary: `${passages.length} passaggi` }],
    sources: passages,
  };
}

export async function answerWithGemini(history: ChatTurn[]): Promise<AgentResult> {
  const [found, bandi] = await Promise.all([retrieve(history, 12), listBandi()]);
  const passages = found.sort((a, b) => a.document_slug.localeCompare(b.document_slug) || a.page - b.page || a.chunk_id - b.chunk_id);
  // Give the model whole pages (top 6 by relevance), so tables split across chunks arrive complete.
  const pages = [...new Map(found.slice().sort((a, b) => b.score - a.score).map((p) => [`${p.document_slug}#${p.page}`, p])).values()].slice(0, 6);
  const pageTexts = await Promise.all(pages.map(async (p) => `[${p.document_slug} p.${p.page}]\n${await readPage(p.document_slug, p.page)}`));
  const catalog = bandi
    .map((b) => `- ${b.slug}: ${b.title} · ente: ${b.ente} · scadenza domande: ${b.scadenza ? new Date(b.scadenza).toLocaleString("it-IT", { timeZone: "Europe/Rome" }) : "n.d."} · fonte: ${b.source_url}`)
    .join("\n");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const today = new Date().toLocaleDateString("it-IT", { timeZone: "Europe/Rome", dateStyle: "full" });

  // Earlier turns as plain conversation, the retrieved passages attached to the latest question.
  const contents = history.map((turn, i) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [
      {
        text:
          i === history.length - 1
            ? `SCHEDE DEI BANDI (da citare come [scheda slug]):\n${catalog}\n\nPAGINE DAI BANDI:\n\n${pageTexts.join("\n\n---\n\n")}\n\nDOMANDA: ${turn.content}`
            : turn.content,
      },
    ],
  }));

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${GEMINI_SYSTEM}\n\nOggi è ${today}.` }] },
      contents,
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
    }),
  });

  if (res.status === 429) throw new FreeModeError("Limite gratuito di Gemini raggiunto, riprova tra un minuto.", 429);
  if (!res.ok) throw new FreeModeError(`Errore Gemini (${res.status}).`, 502);

  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const answer = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!answer) throw new FreeModeError("Gemini non ha restituito una risposta.", 502);

  const cited = new Set([...answer.matchAll(/\[([a-z0-9-]+) p\.(\d+)\]/g)].map((m) => `${m[1]}#${m[2]}`));
  return {
    answer,
    steps: [
      { tool: "search_bandi", input: { query: history.at(-1)?.content ?? "" }, summary: `${passages.length} passaggi` },
      { tool: model, input: {}, summary: "risposta generata" },
    ],
    sources: passages.filter((p) => cited.has(`${p.document_slug}#${p.page}`)),
  };
}

export class FreeModeError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
