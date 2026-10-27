// Zero-cost answer modes, used when no Claude key is configured:
//  - Gemini (free tier from Google AI Studio, no credit card): one retrieval pass + one generation call.
//  - Search-only: no LLM at all, returns the most relevant passages with their page.
import type { AgentResult, ChatTurn } from "./agent";
import { searchBandi, type Passage } from "./search";

const GEMINI_SYSTEM = `Sei BandoBot, un assistente che aiuta i giovani a capire bandi pubblici italiani.
Rispondi SOLO con le informazioni nei passaggi forniti. Se la risposta non c'è, dillo chiaramente.
Cita ogni informazione con il riferimento esatto del passaggio nel formato [slug p.N].
Se l'utente descrive il suo profilo, confronta i requisiti uno per uno (✅ posseduto, ❌ mancante, ❓ da verificare) e dai una conclusione onesta. Non suggerire mai di dichiarare il falso.
Scrivi in italiano semplice, frasi brevi, elenchi puntati.`;

// Uses the latest user turn plus the previous one, so follow-ups ("e per il servizio civile?") keep context.
async function retrieve(history: ChatTurn[]): Promise<Passage[]> {
  const userTurns = history.filter((t) => t.role === "user").map((t) => t.content);
  const query = userTurns.slice(-2).join("\n").slice(-1500);
  return searchBandi(query, undefined, 8);
}

function formatPassages(passages: Passage[]) {
  return passages.map((p) => `[${p.document_slug} p.${p.page}]\n${p.content}`).join("\n\n---\n\n");
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
  const passages = await retrieve(history);
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const today = new Date().toLocaleDateString("it-IT", { timeZone: "Europe/Rome", dateStyle: "full" });

  // Earlier turns as plain conversation, the retrieved passages attached to the latest question.
  const contents = history.map((turn, i) => ({
    role: turn.role === "assistant" ? "model" : "user",
    parts: [
      {
        text:
          i === history.length - 1
            ? `PASSAGGI DAI BANDI:\n\n${formatPassages(passages)}\n\nDOMANDA: ${turn.content}`
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
