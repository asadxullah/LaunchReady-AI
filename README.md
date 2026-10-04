# LaunchReady AI

**Mission review, evidence analysis, and actionable findings in one workspace.**

LaunchReady AI helps reviewers compare mission measurements, identify missing evidence, and track follow-up actions. It combines a Next.js web application with rule-based checks, document retrieval, three specialized AI agents, and a review assistant.

[Live demo](https://launch-ready-ai.vercel.app/)

> This project is an engineering review prototype. The sample mission uses simulated data and illustrative limits. Reports support human review and do not authorize or certify a launch.

## Features

- **Mission intake:** drag and drop a JSON mission package with optional CSV observations and Markdown/TXT evidence.
- **Mission overview:** compare current and previous results, filter findings, and inspect measurement trends.
- **Evidence tracing:** view requirements, source excerpts, evidence confidence, and clickable finding citations.
- **AI review agents:** check supporting evidence, analyze related findings, and prepare a report using Groq.
- **Review assistant:** ask questions about findings, missing records, and next steps using the current review and saved conversation history.
- **Reviewer notes:** acknowledge findings, mark follow-up actions, or dismiss a finding with a required note.
- **Saved progress:** resume interrupted reviews and reopen saved mission packages in the same browser session.
- **Report exports:** download Markdown or use the report's Print / PDF option.
- **Resilient responses:** retain computed results and provide a basic summary when an AI service fails, times out, or reaches a usage limit.

## How it works

1. **Validate the package.** Check references, timestamps, units, and required input fields.
2. **Evaluate the measurements.** Apply configured rules, compare the baseline, calculate trends, and identify evidence gaps.
3. **Retrieve evidence.** Match relevant document passages using Gemini embeddings, with keyword matching as a fallback.
4. **Run the AI agents.** Generate supporting explanations and a summary, then validate their references and quotations.
5. **Review and follow up.** Inspect findings, ask the assistant questions, save notes, and export the report.

| Agent | Role |
| --- | --- |
| Evidence Agent | Selects supplied source passages and exact quotations supporting each finding. |
| Analysis Agent | Identifies related findings and labels possible causal explanations as hypotheses. |
| Report Agent | Summarizes the review while preserving the complete findings in the report. |

Check results, thresholds, priorities, and trends are computed by the application. AI output is checked for valid references, supported numbers, and exact source quotations where required.

## Technology

| Layer | Technologies |
| --- | --- |
| Web application | Next.js 16, React 19, TypeScript |
| Interface | CSS, Framer Motion, Recharts, Lucide icons |
| Backend | Next.js Route Handlers running on Node.js |
| AI agents and chat | Groq Chat Completions with strict JSON schemas |
| Evidence retrieval | Gemini embeddings, cosine similarity, keyword fallback |
| Storage | SQLite locally; Turso/libSQL on Vercel |
| Input validation | Zod and CSV Parse |

Default generation model: `openai/gpt-oss-120b` through Groq. Default embedding model: `gemini-embedding-2`.

## Local setup

### 1. Install dependencies

Install **Node.js 22 or newer** and npm. Clone or download this repository, open the directory containing `package.json`, and run:

```bash
npm ci
```

### 2. Configure the environment

Copy `.env.example` to `.env.local` and add your credentials:

```dotenv
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-120b

GEMINI_API_KEY=your_gemini_api_key
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
```

The Groq key enables the agents and chatbot. The Gemini key enables embedding-based retrieval and is optional. Without these keys, the application uses basic summaries and keyword matching.

For local storage, leave `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` unset. The app creates `data/launchready.db` and its tables automatically.

### 3. Start the application

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000), then select **Start a mission review → Sample mission → Run review**.

To run a production build locally:

```bash
npm run build
npm start
```

## Environment variables

All credentials are server-side values. Keep `.env.local` out of Git and never prefix these credentials with `NEXT_PUBLIC_`.

| Variable | Purpose | Required |
| --- | --- | --- |
| `GROQ_API_KEY` | Groq authentication for agents and chat | For AI generation |
| `GROQ_MODEL` | Generation model; defaults to `openai/gpt-oss-120b` | No |
| `GEMINI_API_KEY` | Gemini authentication for embeddings | For vector retrieval |
| `GEMINI_EMBEDDING_MODEL` | Embedding model; defaults to `gemini-embedding-2` | No |
| `TURSO_DATABASE_URL` | Hosted database URL | On Vercel |
| `TURSO_AUTH_TOKEN` | Hosted Turso database authentication | On Vercel |
| `APP_ORIGIN` | Optional exact allowed application origin | No |

Keep `APP_ORIGIN` unset when using both production and preview URLs. Set it only when requests should use a single canonical origin.

## Deploy on Vercel

1. Push the project to GitHub with `package.json` at the configured project root.
2. Import the repository in Vercel and select the **Next.js** framework preset.
3. Use `npm ci` for installation, `npm run build` for the build, and the default Next.js output directory. Keep the supplied `package-lock.json` in the repository.
4. Create a hosted Turso database and obtain its URL and authentication token.
5. Add the environment variables above for **Production** and, if needed, **Preview**. Store API keys and database tokens as secrets.
6. Deploy the app. After changing environment variables, redeploy to apply them.
7. Check `/api/health` for `database: "connected"`, `provider: "groq"`, and `ai: "configured"`.

Database tables are created automatically. Vercel deployments require a hosted database; local SQLite files are not used for persistent storage there. A separate database for preview deployments keeps test data apart from production data.

The health endpoint checks database access and whether AI credentials are present. It does not test model access or make a generation request.

## Upload your own mission

Start with [samples/mission-package.json](samples/mission-package.json). The sample includes 26 requirements, 60 observations, 15 checklist entries, five documents, and a previous review snapshot.

| Input | Usage |
| --- | --- |
| JSON mission package | Required. Contains `schema_version`, `mission`, `requirements`, `observations`, `checklists`, `documents`, and `baseline`. |
| Observations CSV | Optional. Replaces the JSON observations array. Use the headers in [samples/observations.csv](samples/observations.csv); `valid` must be `true` or `false`. |
| Markdown/TXT documents | Optional. Each filename must match a document ID in the package, such as `DOC-AVIONICS.md`. Uploaded content replaces that document's content. |

Supported rule operators are `LTE`, `GTE`, `RANGE`, and `CHECKLIST`. Set `baseline` to `null` for a first review.

The combined upload limit is **3 MB**, with up to 40 requirements, 2,000 observations, 100 checklist entries, and 12 documents. PDF, DOCX, images, and live telemetry ingestion are not currently supported.

Regenerate the sample files with:

```bash
npm run sample
```

## Timeouts and usage limits

- **Generation:** each request has an 18-second deadline. Embedding requests have a 6-second deadline.
- **Temporary rate limits:** a review-agent HTTP 429 with a numeric `Retry-After` of up to 60 seconds saves a cooldown and retries that stage once. The interface shows a countdown; the wait does not hold a server function open.
- **Temporary outages:** HTTP 503 receives one retry within the original generation deadline.
- **Persistent failures:** repeated rate limits, long waits, missing credentials, timeouts, and rejected AI output use the basic summary. Chat rate-limit errors fall back immediately.
- **Failure reasons:** available under **Error details** and retained in saved records and exports.

Groq generation and Gemini embeddings use separate provider credentials. Either service can fail independently. Compact prompts reduce token use, but provider quotas still apply.

Progress is saved after each stage. Reopen an interrupted review to resume it. To regenerate a report that already completed with a fallback, start a new review from the saved mission.

## API reference

Saved-data routes are scoped to the browser session. JSON POST requests use `Content-Type: application/json`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database and AI configuration status |
| GET | `/api/sample` | Download the sample mission package |
| GET / POST | `/api/packages` | List or upload mission packages |
| GET / POST | `/api/reviews` | List reviews or create one with `{ "packageId": "..." }` |
| GET | `/api/reviews/:id` | Retrieve review progress, findings, notes, and evidence |
| POST | `/api/reviews/:id/advance` | Advance the review or return its saved cooldown; body: `{}` |
| POST | `/api/reviews/:id/notes` | Save `{ "findingId": "...", "state": "NEEDS_ACTION", "note": "..." }` |
| GET | `/api/reviews/:id/export` | Download the Markdown report |
| GET | `/api/chat?reviewId=...` | Retrieve conversation history |
| POST | `/api/chat` | Send `{ "reviewId": "...", "question": "...", "findingId": null }` |

For multipart uploads, use `package`, optional `observations`, and repeated `documents` fields. To create the bundled demo package, POST `{}` to `/api/packages` with the header `x-launchready-demo: 1`.

## Project structure

| Path | Contents |
| --- | --- |
| `app/page.tsx` | Mission intake, overview, report, evidence drawer, and assistant |
| `app/globals.css` | Responsive interface and print styles |
| `app/api/` | Backend endpoints |
| `lib/server/engine.ts` | Rule checks, trends, comparisons, and document chunking |
| `lib/server/retrieval.ts` | Evidence ranking and retrieval fallback |
| `lib/server/gemini.ts` | Groq generation and Gemini embedding requests |
| `lib/server/reviews.ts` | Review stages, saved cooldowns, and chat context |
| `lib/server/db.ts` | Database initialization, session quotas, and stage leases |
| `lib/server/schema.ts` | Input schemas and reference validation |
| `components/markdown-text.tsx` | Markdown rendering for summaries and chat |
| `samples/` | Example mission package, CSV, and supporting documents |
| `tests/` | Rule, provider, and integration tests |

## Development checks

```bash
npm run typecheck
npm test
npm run build
npm run test:integration
```

Run the build before the integration tests. Integration tests use a temporary SQLite database and mocked Groq/Gemini responses, so they do not consume provider tokens. Coverage includes input validation, agent stages, citation rejection, saved notes, chat history, session isolation, cooldown recovery, and fallback behavior.

## Current scope

Reviews belong to an opaque browser session cookie rather than a signed-in account. Use the same browser to reopen your records; clearing cookies removes access to that session's saved data. Export important reports before clearing browser data.

The app includes upload and chat quotas, origin checks, bounded requests, and stage leases. User accounts, cross-device access, shared reviews, automatic data retention, and authenticated engineering sign-off are not implemented.
