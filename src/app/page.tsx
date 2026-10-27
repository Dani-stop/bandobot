"use client";

import { useEffect, useRef, useState } from "react";

type Bando = { slug: string; title: string; ente: string | null; scadenza: string | null; pages: number | null };
type Source = { chunk_id: number; document_slug: string; document_title: string; page: number; content: string };
type Step = { tool: string; input: Record<string, unknown>; summary: string };
type Mode = "claude" | "gemini" | "search";
type Message = {
  role: "user" | "assistant";
  content: string;
  steps?: Step[];
  sources?: Source[];
  mode?: Mode;
  error?: boolean;
};

const MODE_LABEL: Record<Mode, string> = {
  claude: "Agente Claude",
  gemini: "Gemini (gratuito)",
  search: "Solo ricerca, senza AI",
};

const EXAMPLES = [
  "Quali requisiti servono per il bando del Casinò di Sanremo?",
  "Quali sedi del servizio civile ci sono in provincia di Imperia?",
  "Quando scadono i bandi e come si presenta la domanda?",
  "Ho 21 anni, diploma di perito informatico e partita IVA da agosto 2025 come sviluppatore web. Posso partecipare al bando del Casinò?",
];

// Calendar days between today and the deadline, both taken in Italian time.
function daysLeft(iso: string | null) {
  if (!iso) return null;
  const day = (d: Date) => Date.parse(d.toLocaleDateString("en-CA", { timeZone: "Europe/Rome" }));
  const deadline = new Date(iso);
  if (deadline.getTime() < Date.now()) return -1;
  return Math.round((day(deadline) - day(new Date())) / 86_400_000);
}

// Renders **bold**, bullet lists and [slug p.N] citations without pulling in a markdown library.
function RichText({ text, onCite }: { text: string; onCite: (slug: string, page: number) => void }) {
  return (
    <div className="space-y-1.5 leading-relaxed">
      {text.split("\n").map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line);
        const heading = /^#{1,4}\s+/.test(line);
        const body = line.replace(/^\s*[-*•]\s+/, "").replace(/^#{1,4}\s+/, "");
        const parts = body.split(/(\*\*[^*]+\*\*|\[[a-z0-9-]+ p\.\d+\])/g).map((part, j) => {
          const cite = part.match(/^\[([a-z0-9-]+) p\.(\d+)\]$/);
          if (cite) {
            return (
              <button
                key={j}
                onClick={() => onCite(cite[1], Number(cite[2]))}
                className="mx-0.5 rounded bg-accent-soft px-1.5 py-0.5 align-baseline text-xs font-medium text-accent hover:underline"
                title={`Apri ${cite[1]} pagina ${cite[2]}`}
              >
                p.{cite[2]}
              </button>
            );
          }
          if (part.startsWith("**") && part.endsWith("**")) return <strong key={j}>{part.slice(2, -2)}</strong>;
          return <span key={j}>{part}</span>;
        });
        if (!body.trim()) return <div key={i} className="h-1" />;
        if (heading) return <p key={i} className="pt-1 font-semibold">{parts}</p>;
        if (bullet)
          return (
            <p key={i} className="flex gap-2 pl-1">
              <span className="text-muted">•</span>
              <span>{parts}</span>
            </p>
          );
        return <p key={i}>{parts}</p>;
      })}
    </div>
  );
}

export default function Home() {
  const [bandi, setBandi] = useState<Bando[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<Source | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/bandi")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setBandi(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;
    const next: Message[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore");
      setMessages([
        ...next,
        { role: "assistant", content: data.answer, steps: data.steps, sources: data.sources, mode: data.mode },
      ]);
    } catch (err) {
      setMessages([...next, { role: "assistant", content: (err as Error).message, error: true }]);
    } finally {
      setLoading(false);
    }
  }

  function openCitation(sources: Source[] | undefined, slug: string, page: number) {
    const match = sources?.find((s) => s.document_slug === slug && s.page === page);
    if (match) setFocused(match);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:py-10">
      <aside className="lg:w-80 lg:shrink-0">
        <div className="space-y-4 lg:sticky lg:top-10">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">BandoBot</h1>
            <p className="mt-1 text-sm text-muted">
              Fai domande sui bandi: rispondo solo con quello che c&apos;è scritto, citando la pagina.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Bandi indicizzati</h2>
            <ul className="mt-3 space-y-3">
              {bandi.map((b) => {
                const left = daysLeft(b.scadenza);
                return (
                  <li key={b.slug} className="text-sm">
                    <p className="font-medium leading-snug">{b.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {b.ente} · {b.pages} pagine
                      {left !== null && (
                        <span className={left >= 0 && left <= 7 ? "font-semibold text-red-600 dark:text-red-400" : ""}>
                          {" · "}
                          {left < 0 ? "scaduto" : left === 0 ? "scade oggi" : `scade tra ${left} giorni`}
                        </span>
                      )}
                    </p>
                  </li>
                );
              })}
              {!bandi.length && <li className="text-sm text-muted">Caricamento…</li>}
            </ul>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted">
            <p className="font-semibold text-foreground">Come funziona</p>
            <p className="mt-1">
              PDF → blocchi di testo → embeddings multilingua → Supabase pgvector. Un agente Claude cerca con ricerca
              ibrida (semantica + parole chiave), legge le pagine e risponde citando le fonti.
            </p>
          </div>
        </div>
      </aside>

      <main className="flex min-h-[70vh] flex-1 flex-col rounded-2xl border border-border bg-card">
        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted">Prova con una di queste domande:</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {EXAMPLES.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="rounded-xl border border-border px-3 py-2.5 text-left text-sm hover:border-accent hover:bg-accent-soft"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div
                key={i}
                className="ml-auto max-w-[85%] rounded-2xl bg-accent px-4 py-2.5 text-sm text-white dark:text-[#0d1220]"
              >
                {m.content}
              </div>
            ) : (
              <div key={i} className="max-w-[95%] space-y-2 text-sm">
                {m.steps && m.steps.length > 0 && (
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer select-none">
                      {m.mode && <span className="mr-2 rounded bg-accent-soft px-1.5 py-0.5 text-accent">{MODE_LABEL[m.mode]}</span>}
                      {m.steps.length} passaggi
                    </summary>
                    <ol className="mt-1.5 space-y-0.5 pl-4 font-mono">
                      {m.steps.map((s, j) => (
                        <li key={j}>
                          {s.tool}(
                          {Object.values(s.input)
                            .filter(Boolean)
                            .map((v) => JSON.stringify(v))
                            .join(", ")}
                          ) → {s.summary}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                <div className={m.error ? "text-red-600 dark:text-red-400" : ""}>
                  <RichText text={m.content} onCite={(slug, page) => openCitation(m.sources, slug, page)} />
                </div>
              </div>
            ),
          )}

          {loading && <p className="animate-pulse text-sm text-muted">Sto leggendo i bandi…</p>}
          <div ref={bottomRef} />
        </div>

        {focused && (
          <div className="border-t border-border bg-accent-soft/40 p-4 text-xs">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold">
                {focused.document_title} · pagina {focused.page}
              </p>
              <button onClick={() => setFocused(null)} className="text-muted hover:text-foreground" aria-label="Chiudi fonte">
                ✕
              </button>
            </div>
            <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-line text-muted">{focused.content}</p>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2 border-t border-border p-3"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Scrivi una domanda sui bandi o descrivi il tuo profilo…"
            className="flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-accent"
          />
          <button
            disabled={loading || !input.trim()}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40 dark:text-[#0d1220]"
          >
            Invia
          </button>
        </form>
      </main>
    </div>
  );
}
