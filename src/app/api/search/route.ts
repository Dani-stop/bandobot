import { NextResponse } from "next/server";
import { searchBandi } from "@/lib/search";

export const runtime = "nodejs";

// GET /api/search?q=requisiti&slug=casino-sanremo-2-2026  -> raw hybrid-search passages (no LLM)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q || q.length > 500) return NextResponse.json({ error: "Parametro q mancante o troppo lungo" }, { status: 400 });
  try {
    return NextResponse.json(await searchBandi(q, searchParams.get("slug") ?? undefined, 6));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Ricerca non riuscita." }, { status: 500 });
  }
}
