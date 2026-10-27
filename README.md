# BandoBot

Assistente AI che legge **bandi pubblici, concorsi e selezioni italiane** e risponde con quello che c'è scritto, **citando la pagina**. Se gli descrivi il tuo profilo, controlla i requisiti uno per uno (✅ / ❌ / ❓).

Nasce da un problema vero: un bando di 10 pagine per capire, alla pagina 2, che servono 3 anni di esperienza.

## Cosa mostra tecnicamente

| Parte | Come è fatta |
|---|---|
| **RAG** | PDF → testo per pagina (`unpdf`) → blocchi da ~900 caratteri con sovrapposizione → embeddings multilingua `multilingual-e5-small` (384 dim, eseguiti **in locale**, zero costi) |
| **Vector DB** | Supabase Postgres + **pgvector**, indice HNSW, RLS in sola lettura |
| **Ricerca ibrida** | Funzione SQL `hybrid_search`: similarità coseno **+** full-text in italiano (`tsvector`), fuse con **Reciprocal Rank Fusion** |
| **Agente** | Claude (Anthropic SDK, tool runner) con 3 tool: `list_bandi`, `search_bandi`, `read_page`. Fa più ricerche, legge le pagine intere, cita `[slug p.N]` |
| **Costo zero** | Senza chiavi: modalità *solo ricerca* (passaggi + estratto della frase più pertinente). Con una chiave **Gemini gratuita**: risposta generata con citazioni. La modalità si sceglie da sola in base alle chiavi presenti |
| **MCP server** | Gli stessi tool esposti via **Model Context Protocol** (stdio) per Claude Desktop / Claude Code |
| **Frontend** | Next.js 15 (App Router) + Tailwind, citazioni cliccabili che aprono il passaggio, traccia dei passaggi dell'agente, tema chiaro/scuro |

```
docs/*.pdf ──► scripts/ingest.ts ──► Supabase (documents, chunks + vector(384) + tsvector)
                                            ▲
             src/lib/search.ts (hybrid_search RPC) ◄── embeddings query (locale)
                    ▲                         ▲
     src/lib/agent.ts (Claude + tool)    mcp/server.ts (MCP stdio)
                    ▲
        /api/chat ◄── UI Next.js
```

## Avvio

```bash
npm install
cp .env.example .env.local   # poi inserisci SUPABASE_URL, SUPABASE_ANON_KEY, ANTHROPIC_API_KEY
npm run dev
```

Endpoint:
- `POST /api/chat` – agente con citazioni (`{ messages: [{ role, content }] }`)
- `GET /api/search?q=...&slug=...` – solo ricerca ibrida, senza LLM
- `GET /api/bandi` – elenco dei bandi indicizzati

## Aggiungere un bando

1. Copia il PDF in `docs/` e aggiungi una voce in `docs/manifest.json` (slug, titolo, ente, scadenza).
2. `npx tsx scripts/ingest.ts --upload` (con `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`), oppure senza flag per generare i batch SQL in `scripts/out/`.

## Server MCP

```bash
npx tsx scripts/mcp-test.ts        # test end-to-end
claude mcp add bandobot -- npx tsx /percorso/bandobot/mcp/server.ts
```

Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "bandobot": { "command": "npx", "args": ["tsx", "C:/percorso/bandobot/mcp/server.ts"] } } }
```

## Note

- Le risposte si basano solo sui documenti indicizzati: se un'informazione non c'è, l'agente lo dice.
- I bandi sono documenti pubblici; verificare sempre sul sito ufficiale dell'ente prima di candidarsi.

Autore: **Daniele Luigi Barbieri** – sviluppato con un flusso di lavoro AI-first (Claude Code).
