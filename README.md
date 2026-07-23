# DocIntel — Frontend

Next.js 14 chat UI for **DocIntel**, a local RAG knowledge assistant: upload
PDFs, ask questions, and get **streamed answers with page citations**.

Backend lives in a separate repo: **[docintel-backend](https://github.com/Vasanthx7/docintel-backend)** — run it first.

## Stack

- Next.js 14 (App Router) + React 18
- TypeScript
- Tailwind CSS
- Server-Sent Events for token-by-token answer streaming

## Prerequisites

- Node.js 18+
- A running **docintel-backend** (default `http://localhost:8000`)

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Configuration

The backend URL defaults to `http://localhost:8000`. Override it with an env var:

```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Usage

1. Click **Upload PDF** — status goes `processing → ready` as the backend worker
   parses, chunks, embeds, and stores vectors.
2. Ask a question. The answer streams token-by-token; **Sources** below it show
   the pages used, with relevance scores.
3. Follow-up questions run inside a persisted **conversation**, so multi-turn
   context works.

## Build

```bash
npm run build   # produces a standalone build (see next.config.js)
npm run start   # serves on port 3000
```

A `Dockerfile` is included for containerized deployment.

## Layout

```
frontend/
├── Dockerfile
├── next.config.js          # standalone output
├── package.json
├── tailwind.config.ts
├── tsconfig.json
└── app/
    ├── layout.tsx
    ├── page.tsx
    ├── ChatApp.tsx         # main chat component (upload, query, streaming, sources)
    ├── globals.css
    └── chat/[id]/page.tsx  # per-conversation view
```
