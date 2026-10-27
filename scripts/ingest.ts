// Ingestion pipeline: PDF -> text per page -> overlapping chunks -> local embeddings -> Supabase (pgvector).
//
//   npx tsx scripts/ingest.ts            writes SQL batches to scripts/out/ (apply them with any SQL client)
//   npx tsx scripts/ingest.ts --upload   inserts directly (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local)
//   npx tsx scripts/ingest.ts --rpc      sends each document to the token-protected ingest_document() function
//                                        (needs SUPABASE_URL + SUPABASE_ANON_KEY + INGEST_TOKEN)
import fs from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { createClient } from "@supabase/supabase-js";
import { embedPassages, toPgVector } from "../src/lib/embeddings";

type ManifestEntry = {
  slug: string;
  file: string;
  title: string;
  ente: string;
  source_url: string;
  scadenza: string;
};

type Chunk = { page: number; chunk_index: number; content: string };

const DOCS_DIR = path.resolve("docs");
const OUT_DIR = path.resolve("scripts/out");
const CHUNK_SIZE = 900; // characters
const CHUNK_OVERLAP = 150;
const BATCH_SIZE = 12;

function loadEnv() {
  const file = path.resolve(".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function clean(text: string): string {
  return text
    .replace(/­/g, "") // soft hyphens
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Split a page into chunks on paragraph/sentence boundaries, with overlap so requirements
// that straddle a boundary still appear whole in at least one chunk.
function chunkPage(page: number, text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "));
      if (cut > CHUNK_SIZE * 0.5) end = start + cut + 1;
    }
    const content = text.slice(start, end).trim();
    if (content.length > 40) chunks.push({ page, chunk_index: chunks.length, content });
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

const sqlString = (s: string | null) => (s === null ? "null" : `'${s.replace(/'/g, "''")}'`);

async function main() {
  loadEnv();
  const upload = process.argv.includes("--upload");
  const manifest: ManifestEntry[] = JSON.parse(fs.readFileSync(path.join(DOCS_DIR, "manifest.json"), "utf8"));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const db = upload
    ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    : null;
  if (upload && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("--upload needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  for (const doc of manifest) {
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(path.join(DOCS_DIR, doc.file))));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const chunks = text.flatMap((pageText, i) => chunkPage(i + 1, clean(pageText)));
    console.log(`${doc.slug}: ${totalPages} pages -> ${chunks.length} chunks, embedding...`);

    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      vectors.push(...(await embedPassages(chunks.slice(i, i + BATCH_SIZE).map((c) => c.content))));
    }

    if (process.argv.includes("--rpc")) {
      const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      const { data: inserted, error } = await anon.rpc("ingest_document", {
        token: process.env.INGEST_TOKEN,
        doc: { slug: doc.slug, title: doc.title, ente: doc.ente, source_url: doc.source_url, scadenza: doc.scadenza, pages: totalPages },
        rows: chunks.map((c, i) => ({ ...c, embedding: toPgVector(vectors[i]) })),
      });
      if (error) throw error;
      console.log(`  inserted ${inserted} chunks via rpc`);
      continue;
    }

    if (db) {
      const { data: saved, error } = await db
        .from("documents")
        .upsert({ ...doc, file: undefined, pages: totalPages }, { onConflict: "slug" })
        .select("id")
        .single();
      if (error) throw error;
      await db.from("chunks").delete().eq("document_id", saved.id);
      const rows = chunks.map((c, i) => ({ ...c, document_id: saved.id, embedding: toPgVector(vectors[i]) }));
      for (let i = 0; i < rows.length; i += 50) {
        const { error: insertError } = await db.from("chunks").insert(rows.slice(i, i + 50));
        if (insertError) throw insertError;
      }
      console.log(`  uploaded ${rows.length} chunks`);
      continue;
    }

    // Offline mode: one idempotent SQL file per batch.
    const header = `insert into documents (slug,title,ente,source_url,scadenza,pages) values (${[
      doc.slug, doc.title, doc.ente, doc.source_url, doc.scadenza,
    ].map(sqlString).join(",")},${totalPages})
on conflict (slug) do update set title=excluded.title, ente=excluded.ente, source_url=excluded.source_url, scadenza=excluded.scadenza, pages=excluded.pages;
delete from chunks where document_id = (select id from documents where slug=${sqlString(doc.slug)});\n`;
    fs.writeFileSync(path.join(OUT_DIR, `${doc.slug}-000.sql`), header);
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const values = chunks.slice(i, i + BATCH_SIZE).map((c, j) =>
        `((select id from documents where slug=${sqlString(doc.slug)}),${c.page},${c.chunk_index},${sqlString(c.content)},'${toPgVector(vectors[i + j])}')`,
      );
      const name = `${doc.slug}-${String(i / BATCH_SIZE + 1).padStart(3, "0")}.sql`;
      fs.writeFileSync(
        path.join(OUT_DIR, name),
        `insert into chunks (document_id,page,chunk_index,content,embedding) values\n${values.join(",\n")};\n`,
      );
    }
    console.log(`  wrote SQL batches to scripts/out/`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
