import { createClient } from "@supabase/supabase-js";
import { embedQuery, toPgVector } from "./embeddings";

export type Passage = {
  chunk_id: number;
  document_slug: string;
  document_title: string;
  page: number;
  content: string;
  score: number;
};

export type Bando = {
  slug: string;
  title: string;
  ente: string | null;
  source_url: string | null;
  scadenza: string | null;
  pages: number | null;
};

function supabase() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_ANON_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function listBandi(): Promise<Bando[]> {
  const { data, error } = await supabase()
    .from("documents")
    .select("slug,title,ente,source_url,scadenza,pages")
    .order("scadenza", { ascending: true });
  if (error) throw error;
  return data;
}

// Hybrid retrieval: pgvector cosine + Italian full-text, fused in Postgres with RRF.
export async function searchBandi(query: string, slug?: string, limit = 6): Promise<Passage[]> {
  const embedding = await embedQuery(query);
  const { data, error } = await supabase().rpc("hybrid_search", {
    query_text: query,
    query_embedding: toPgVector(embedding),
    match_count: limit,
    doc_slug: slug ?? null,
  });
  if (error) throw error;
  return data as Passage[];
}

export async function readPage(slug: string, page: number): Promise<string> {
  const db = supabase();
  const { data: doc, error: docError } = await db
    .from("documents")
    .select("id,title")
    .eq("slug", slug)
    .single();
  if (docError) throw docError;
  const { data, error } = await db
    .from("chunks")
    .select("content,chunk_index")
    .eq("document_id", doc.id)
    .eq("page", page)
    .order("chunk_index");
  if (error) throw error;
  if (!data.length) return `Pagina ${page} non trovata in "${doc.title}".`;
  return data.map((c) => c.content).join("\n");
}
