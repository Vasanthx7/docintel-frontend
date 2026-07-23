"use client";

import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Doc = {
  id: string;
  filename: string;
  status: string;
  num_pages: number;
  num_chunks: number;
  error?: string | null;
};

type Citation = {
  chunk_id: string;
  document_id: string;
  page: number;
  score: number;
  snippet: string;
};

type Turn = {
  id: number;
  question: string;
  answer: string;
  citations: Citation[];
  streaming: boolean;
};

type Convo = {
  id: string;
  title: string;
  updated_at: string;
};

type ApiMsg = { role: string; content: string; citations: Citation[] | null };

function messagesToTurns(msgs: ApiMsg[]): Turn[] {
  // Persisted messages are a flat alternating list (user, assistant, …).
  const turns: Turn[] = [];
  for (let i = 0; i < msgs.length; i += 2) {
    turns.push({
      id: i / 2,
      question: msgs[i].content,
      answer: msgs[i + 1]?.content ?? "",
      citations: msgs[i + 1]?.citations ?? [],
      streaming: false,
    });
  }
  return turns;
}

/* ---- tiny markdown-ish renderer with interactive [p.N] citations ---- */
function Inline({
  text,
  turnId,
  lit,
  onHover,
}: {
  text: string;
  turnId: number;
  lit: { turn: number; page: number } | null;
  onHover: (h: { turn: number; page: number } | null) => void;
}) {
  const re = /(\*\*[^*]+\*\*)|(\[p\.?\s*(\d+)\])/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      out.push(<strong key={k++}>{m[1].slice(2, -2)}</strong>);
    } else if (m[2]) {
      const page = Number(m[3]);
      const isLit = lit?.turn === turnId && lit?.page === page;
      out.push(
        <sup
          key={k++}
          className={`cite${isLit ? " lit" : ""}`}
          onMouseEnter={() => onHover({ turn: turnId, page })}
          onMouseLeave={() => onHover(null)}
        >
          p.{page}
        </sup>
      );
    }
    last = re.lastIndex;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

function Answer(props: {
  text: string;
  turnId: number;
  lit: { turn: number; page: number } | null;
  onHover: (h: { turn: number; page: number } | null) => void;
}) {
  const { text } = props;
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let list: string[] = [];
  let bk = 0;

  const flushList = () => {
    if (!list.length) return;
    const items = [...list];
    blocks.push(
      <ul key={`ul${bk++}`}>
        {items.map((li, i) => (
          <li key={i}>
            <Inline {...props} text={li} />
          </li>
        ))}
      </ul>
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[*-]\s+/.test(line)) {
      list.push(line.replace(/^\s*[*-]\s+/, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      blocks.push(
        <p key={`p${bk++}`}>
          <Inline {...props} text={line} />
        </p>
      );
    }
  }
  flushList();
  return <div className="answer">{blocks}</div>;
}

export default function ChatApp({
  initialConversationId = null,
}: {
  initialConversationId?: string | null;
}) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<string | null>(null); // document_id filter
  const [drag, setDrag] = useState(false);
  const [lit, setLit] = useState<{ turn: number; page: number } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Refs mirror state for use inside stable event handlers (popstate) that
  // would otherwise close over stale values.
  const convIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  function setConvId(id: string | null) {
    convIdRef.current = id;
    setConversationId(id);
  }

  async function loadDocs() {
    try {
      const res = await fetch(`${API}/documents`);
      setDocs(await res.json());
    } catch {
      /* backend warming up */
    }
  }

  async function loadConvos() {
    try {
      const res = await fetch(`${API}/conversations`);
      setConvos(await res.json());
    } catch {
      /* backend warming up */
    }
  }

  async function openConvo(id: string, push = true) {
    if (busyRef.current || id === convIdRef.current) return;
    try {
      const res = await fetch(`${API}/conversations/${id}`);
      const data = await res.json();
      setConvId(id);
      setTurns(messagesToTurns(data.messages ?? []));
      setLit(null);
      if (push) window.history.pushState(null, "", `/chat/${id}`);
    } catch {
      /* ignore */
    }
  }

  function newChat(push = true) {
    if (busyRef.current) return;
    setConvId(null);
    setTurns([]);
    setLit(null);
    if (push) window.history.pushState(null, "", "/");
  }

  async function deleteConvo(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await fetch(`${API}/conversations/${id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
    if (id === convIdRef.current) newChat();
    loadConvos();
  }

  // Mount: initial data + hydrate a deep-linked conversation.
  useEffect(() => {
    loadDocs();
    loadConvos();
    if (initialConversationId) openConvo(initialConversationId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back/forward navigation between /, /chat/:id.
  useEffect(() => {
    const onPop = () => {
      const m = window.location.pathname.match(/^\/chat\/(.+)$/);
      if (m) openConvo(m[1], false);
      else newChat(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anyProcessing = docs.some((d) => d.status === "processing");

  // Poll /documents ONLY while something is ingesting (#1), and skip ticks
  // while the tab is hidden (#2). No polling once everything is settled.
  useEffect(() => {
    if (!anyProcessing) return;
    const tick = () => {
      if (document.visibilityState === "visible") loadDocs();
    };
    const iv = setInterval(tick, 3000);
    // Catch up immediately when the tab regains focus.
    const onVis = () => {
      if (document.visibilityState === "visible") loadDocs();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyProcessing]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [turns]);

  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    await fetch(`${API}/documents`, { method: "POST", body: form });
    loadDocs();
  }

  function autosize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }

  const [copied, setCopied] = useState<number | null>(null);
  function copyAnswer(turnId: number, text: string) {
    navigator.clipboard?.writeText(text);
    setCopied(turnId);
    setTimeout(() => setCopied((c) => (c === turnId ? null : c)), 1400);
  }

  const ready = docs.some((d) => d.status === "ready");

  async function ask() {
    const question = input.trim();
    if (!question || busy || !ready) return;
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";

    const id = turns.length;
    setTurns((t) => [
      ...t,
      { id, question, answer: "", citations: [], streaming: true },
    ]);
    setBusy(true);
    busyRef.current = true;

    const patch = (fn: (t: Turn) => Turn) =>
      setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)));

    try {
      // Create the conversation lazily on the first turn, then reuse its id.
      let convId = convIdRef.current;
      if (!convId) {
        const cres = await fetch(`${API}/conversations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        convId = (await cres.json()).id;
        setConvId(convId);
        // Reflect the new thread in the URL without remounting (keeps the stream).
        window.history.replaceState(null, "", `/chat/${convId}`);
      }

      const res = await fetch(`${API}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, document_id: scope, conversation_id: convId }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.type === "sources") patch((t) => ({ ...t, citations: evt.citations }));
          else if (evt.type === "token")
            patch((t) => ({ ...t, answer: t.answer + evt.text }));
          else if (evt.type === "error")
            patch((t) => ({ ...t, answer: evt.message ?? "Something went wrong." }));
        }
      }
      patch((t) => ({ ...t, streaming: false }));
      // Refresh the rail so a newly-created thread (and its auto title) appears.
      loadConvos();
    } catch {
      setTurns((all) =>
        all.map((t) =>
          t.id === id
            ? { ...t, streaming: false, answer: t.answer || "Couldn't reach the model. Is the backend running?" }
            : t
        )
      );
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  const scopedDoc = docs.find((d) => d.id === scope);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">D</span>
          DocIntel
        </div>
        <div className="status" title="Everything runs on this machine. No data leaves.">
          <span className="dot" />
          Local · llama3.1
        </div>
      </header>

      {/* Hidden file input shared by the landing dropzone and the Library add button. */}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />

      <div className="main">
        {/* ---------- Rail ---------- */}
        <aside className="library">
          {/* Chats */}
          <div className="library-head">
            <span className="eyebrow">Chats</span>
            <button className="newchat" onClick={() => newChat()} disabled={busy}>
              + New
            </button>
          </div>
          <ul className="chat-list">
            {convos.length === 0 ? (
              <li className="chat-empty">No chats yet</li>
            ) : (
              convos.map((c) => (
                <li key={c.id}>
                  <button
                    className={`chat${conversationId === c.id ? " active" : ""}`}
                    onClick={() => openConvo(c.id)}
                    title={c.title}
                  >
                    <span className="chat-title">{c.title}</span>
                    <span
                      className="chat-del"
                      role="button"
                      aria-label="Delete chat"
                      onClick={(e) => deleteConvo(c.id, e)}
                    >
                      ×
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="rail-divider" />

          {/* Library */}
          <div className="library-head">
            <span className="eyebrow">
              Library
              <span className="count">{docs.length}</span>
            </span>
            <button
              className="lib-add"
              onClick={() => fileRef.current?.click()}
              title="Add a document"
              aria-label="Add a document"
            >
              +
            </button>
          </div>

          {scope && (
            <button className="scope-clear" onClick={() => setScope(null)}>
              ← clear filter
            </button>
          )}

          <ul className="doc-list">
            {docs.map((d) => (
              <button
                key={d.id}
                className={`doc${scope === d.id ? " active" : ""}`}
                onClick={() => setScope(scope === d.id ? null : d.id)}
                title={d.error || d.filename}
              >
                <span className={`sdot ${d.status}`} />
                <span className="doc-name">{d.filename}</span>
                <span className="doc-meta">
                  {d.status === "ready" ? `${d.num_chunks}` : d.status}
                </span>
              </button>
            ))}
          </ul>
        </aside>

        {/* ---------- Workspace ---------- */}
        <section className="workspace">
          <div className="thread" ref={threadRef}>
            {turns.length === 0 ? (
              <div className="empty">
                <div className="empty-badge">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                    <path d="M7 8h10M7 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    <path d="M5 4h14a1 1 0 0 1 1 1v11l-4 4H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  </svg>
                </div>
                <h1>
                  Ask your documents <em>anything</em>.
                </h1>
                <p>
                  Upload a PDF and get clear answers drawn only from it — each
                  one showing the exact page it came from.
                </p>

                {/* Uploader lives on the landing, next to the call to start. */}
                <div className="empty-drop">
                  <div
                    className={`dropzone${drag ? " drag" : ""}`}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDrag(true);
                    }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDrag(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) upload(f);
                    }}
                  >
                    <div className="dropzone-plus">+</div>
                    <div className="dropzone-title">Add a document</div>
                    <div className="dropzone-sub">Drop a PDF or click to browse</div>
                  </div>
                </div>

                <div className="hint">
                  {ready
                    ? "👇 Type a question below to begin"
                    : anyProcessing
                    ? "⏳ Processing your document…"
                    : "👆 Upload a PDF to begin"}
                </div>
              </div>
            ) : (
              turns.map((t) => (
                <article className="turn" key={t.id}>
                  {/* user question — quiet bubble, right */}
                  <div className="msg user">
                    <div className="bubble">{t.question}</div>
                  </div>

                  {/* assistant answer — plain text, left */}
                  <div className="msg assistant">
                    <div className="msg-body">
                      <Answer text={t.answer} turnId={t.id} lit={lit} onHover={setLit} />
                      {t.streaming && !t.answer && <span className="caret" />}

                      {t.citations.length > 0 && (
                        <div className="sources">
                          <div className="sources-label">Sources</div>
                          <div className="source-grid">
                            {t.citations.map((c, i) => {
                              const isLit = lit?.turn === t.id && lit?.page === c.page;
                              return (
                                <div
                                  key={c.chunk_id}
                                  className={`source${isLit ? " lit" : ""}`}
                                  onMouseEnter={() => setLit({ turn: t.id, page: c.page })}
                                  onMouseLeave={() => setLit(null)}
                                >
                                  <div className="source-head">
                                    <span className="source-ref">
                                      <span className="source-num">{i + 1}</span>
                                      page {c.page}
                                    </span>
                                    <span className="source-score">{c.score.toFixed(3)}</span>
                                  </div>
                                  <div className="source-snip">{c.snippet}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {!t.streaming && t.answer && (
                        <div className="msg-actions">
                          <button
                            className="act"
                            onClick={() => copyAnswer(t.id, t.answer)}
                            aria-label="Copy answer"
                            title={copied === t.id ? "Copied" : "Copy"}
                          >
                            {copied === t.id ? (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
                                <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                              </svg>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>

          {/* ---------- Ask bar ---------- */}
          <div className="askbar">
            <div className="ask">
              <textarea
                ref={taRef}
                rows={1}
                value={input}
                placeholder={ready ? "Ask about your documents…" : "Add a document first…"}
                disabled={!ready}
                onChange={(e) => {
                  setInput(e.target.value);
                  autosize();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask();
                  }
                }}
              />
              <button className="send" onClick={ask} disabled={busy || !ready || !input.trim()} aria-label="Ask">
                {busy ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
                    </path>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>
            <div className="ask-foot">
              <span>Enter to send · Shift+Enter for a new line</span>
              {scopedDoc && <span className="scope">Scoped to {scopedDoc.filename}</span>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
