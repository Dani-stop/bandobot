import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/agent";
import { answerSearchOnly, answerWithGemini, FreeModeError } from "@/lib/free-modes";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
    .min(1)
    .max(30),
});

// Picks the best mode the configured keys allow: Claude agent -> Gemini free tier -> search only (no key).
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  const history = parsed.data.messages;

  try {
    if (process.env.ANTHROPIC_API_KEY) return NextResponse.json({ ...(await runAgent(history)), mode: "claude" });
    if (process.env.GEMINI_API_KEY) return NextResponse.json({ ...(await answerWithGemini(history)), mode: "gemini" });
    return NextResponse.json({ ...(await answerSearchOnly(history)), mode: "search" });
  } catch (error) {
    if (error instanceof FreeModeError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Chiave Claude non valida (ANTHROPIC_API_KEY)." }, { status: 500 });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "Troppe richieste, riprova tra poco." }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Errore API Claude (${error.status}).` }, { status: 502 });
    }
    console.error(error);
    return NextResponse.json({ error: "Errore interno." }, { status: 500 });
  }
}
