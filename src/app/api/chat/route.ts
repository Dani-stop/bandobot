import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) }))
    .min(1)
    .max(30),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Chat non ancora attiva: manca la chiave Claude (ANTHROPIC_API_KEY in .env.local)." },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json(await runAgent(parsed.data.messages));
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "Chiave Claude mancante o non valida (ANTHROPIC_API_KEY)." }, { status: 500 });
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
