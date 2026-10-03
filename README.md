# LaunchReady AI

A complete Next.js mission-review prototype: backend API, persistent data, validated JSON/CSV uploads, deterministic checks, evidence retrieval, three Gemini agents, and an evidence-grounded chatbot. The existing dark dashboard, evidence drawer, charts, report, responsive cards, and review controls are connected to the backend.

## Run locally

Requires Node.js 22 or newer.

```bash
npm ci
```

Copy `.env.example` to `.env.local`, set `GEMINI_API_KEY`, and keep:

```dotenv
GEMINI_MODEL=gemini-3.8-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
```

Then:

```bash
npm run dev
```

Open http://localhost:3000. Choose **Start a mission review → Demo mission → Run review**, or upload `samples/mission-package.json`.

No database credentials are required locally: SQLite is created at `data/launchready.db`. Do not commit this directory. Without a Gemini key, checks and reports still run with visible fallback labels; the chatbot reports its fallback mode. The application never swaps custom inputs for demo results.

## Deploy the complete app on Vercel

1. Push this project's contents to GitHub with `package.json` at the repository root.
2. Import the repository in Vercel with the Next.js preset.
3. Create a hosted Turso database and generate its database authentication token.
4. Set these **server-only** environment variables in Vercel for the environments you use:

| Variable | Value |
| --- | --- |
| `GEMINI_API_KEY` | Your Google AI Studio API key |
| `GEMINI_MODEL` | `gemini-3.8-flash` |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-2` |
| `TURSO_DATABASE_URL` | Your `libsql://…turso.io` database URL |
| `TURSO_AUTH_TOKEN` | Your database token |

5. Deploy or redeploy. `/api/health` should return `database: "connected"` and `ai: "configured"`.

Tables are created automatically on the first backend request. Vercel's function filesystem is not durable; the app explicitly refuses to use local SQLite there. Never point Vercel persistence at `/tmp`. Use the production database for production; optionally use a separate database for previews. `APP_ORIGIN` is optional; set it to the exact canonical origin only if all browser requests use that origin. Leaving it unset permits same-origin production and preview requests.

The source package does not deploy your site, create cloud accounts, or contain credentials. Model access, quota, billing and database provisioning remain configured in your own accounts. Successful `/api/health` means the key is present; it does not make a paid model call or prove model access.

## What is implemented

- Strict package schema, unknown-field rejection, identifier uniqueness, cross-reference checks, finite values and timestamp validation.
- Explicit conversions for Celsius/Fahrenheit/Kelvin, m/s–km/h and seconds–milliseconds. Unsupported or incompatible data is excluded with warnings.
- Threshold and checklist checks, fresh evidence requirements, source/version/section matching, conflict detection, visible evidence gaps and deterministic confidence explanations.
- Baseline comparisons: New, Resolved, Changed, Unresolved, Unchanged and Not Comparable. No baseline is displayed as unavailable, not as a fabricated previous result.
- Trends computed from distance to the configured acceptable range, at least five comparable observations, minimum duration and slope tolerance. Raw direction and range status stay separate.
- Markdown/TXT section-preserving chunks, Gemini embedding vectors and cosine retrieval. Retrieval falls back to lexical matching when embeddings fail and records its mode.
- **Evidence Agent:** selects supplied chunk IDs and exact source quotations, checked against actual stored passages. Its selections appear in the evidence drawer. Deterministic required-source links cannot be replaced by unrelated passages.
- **Analysis Agent:** adds bounded, cited cross-signal relationships; possible causes are labeled as investigation hypotheses. Numeric rules and computed findings are immutable.
- **Report Agent:** produces a summary; all findings and gaps remain in the report regardless of agent output. Invalid IDs, changed coverage and unsupported numbers cause a fallback.
- **Gemini chatbot:** current review, question-specific retrieved passages and persisted recent conversation history; clickable finding citations and cited source passages.
- Persistent packages, resumable reviews, human dispositions and chat messages. Saved notes never change computed check results; dismissal requires a note.
- Markdown exports from saved server state; print/PDF from the report view.
- Browser-session scoping, HttpOnly cookie, origin checks, streaming body limits, bounded provider timeouts, quotas and stage leases.

## Review execution

The pipeline is:

`Validate → Evaluate rules/trends/diff → Retrieve → Evidence Agent → Analysis Agent → Report Agent → Save`

Each advance request completes and stores one actual stage. The browser runs them sequentially. Nothing continues as an untracked background task after a serverless request ends. If the page closes, the completed stage stays saved; reopen the last review or select it from saved reviews and resume. A stage lease prevents concurrent execution; an abandoned lease expires after 90 seconds.

AI timeouts, missing keys, quota failures and malformed model output produce explicit fallback events rather than erase results. Text generation has an 18-second deadline, including reading the response; embedding calls have a 6-second deadline. Requests that exceed the deadline are cancelled. A temporary HTTP 503 receives one retry after 250 milliseconds, sharing the original 18-second deadline; other failures are not retried. The chatbot returns code-generated review information, and the report displays a Code-generated summary notice with the failure reason. Failure details persist in chat history, review events, and Markdown exports. If a review agent encounters a provider failure, subsequent agents use code fallbacks immediately instead of repeating failing calls. Reasons distinguish missing configuration, rejected credentials, denied permissions, unavailable model, quota/rate limit, timeout, network failure, server outage, rejected request and invalid or rejected AI output. HTTP status is included when the provider supplied one; secrets and raw provider messages are not exposed. Gemini is called through the Interactions REST API with the documented revision header, JSON response schemas and `store: false`; responses are read from native REST `model_output` steps. Chat history is kept in the application's database and sent as bounded context; this option is not a claim about Google's other data-processing policies.

## Upload format

Primary support is JSON packages and optional CSV plus Markdown/TXT. PDF, DOCX, OCR and arbitrary telemetry streams are not implemented.

`samples/mission-package.json` is the complete reference. It contains 26 requirements, 60 observations, 15 checklist entries, five documents and a previous snapshot. All thresholds are illustrative.

| Object | Main fields |
| --- | --- |
| Package | `schema_version: "1"`, `mission`, `requirements`, `observations`, `checklists`, `documents`, `baseline` |
| Mission | `id`, `name`, `configuration_version`, `timestamp` with timezone, `simulated` |
| Requirement | `id`, `item_id`, `version`, `title`, `subsystem`, `parameter`, `operator`, bounds, `unit`, `priority`, configuration, test condition, freshness, material-change threshold, trend settings, source, required document IDs, configured action, demo assumption |
| Observation | `id`, `item_id`, `test_id`, `timestamp`, `value`, `unit`, `configuration_version`, `test_condition`, `valid` |
| Checklist | `item_id`, `state` (`COMPLETE`/`INCOMPLETE`), `timestamp`, `evidence_document_ids` |
| Document | `id`, `version`, `title`, `content`, `simulated` |
| Baseline | `id`, `timestamp`, `configuration_version`, evaluated `findings`; or `null` |

Operators are `LTE`, `GTE`, `RANGE` and `CHECKLIST`. Checklist unit is `boolean`. Supported subsystems are PROPULSION, AVIONICS, STRUCTURE, RECOVERY and ENVIRONMENT. Requirement bounds must use the requirement's unit. A source refers to a matching document version and Markdown section heading. Missing required documents are permitted as explicit gaps; invalid observation/checklist references are rejected.

Maximum combined upload size is 3 MB: up to 40 requirements, 2,000 observations, 100 checklist entries, 12 documents, and 80 document chunks. Files do not need local disk storage: their normalized data and parsed document content are saved in the database.

To upload separate files, select the JSON package, optional `samples/observations.csv`, and optional `samples/documents/*.md`. CSV replaces the observations array. CSV `valid` must be exactly `true` or `false`. Markdown/TXT filenames must equal a document ID plus extension, such as `DOC-AVIONICS.md`; content replaces that manifest document's content.

## API

All saved-data endpoints are scoped to the current browser's opaque session cookie. JSON mutations require `Content-Type: application/json`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database availability, AI configuration and model ID |
| GET | `/api/sample` | Download supported sample package |
| GET / POST | `/api/packages` | List / validate and save mission packages |
| GET / POST | `/api/reviews` | List / create a review with `{ "packageId": "…" }` |
| GET | `/api/reviews/:id` | Saved progress, findings, notes, sources and execution events |
| POST | `/api/reviews/:id/advance` | Complete one stage; send `{}` |
| POST | `/api/reviews/:id/notes` | `{ "findingId": "…", "state": "NEEDS_ACTION", "note": "…" }` |
| GET | `/api/reviews/:id/export` | Markdown export including saved notes |
| GET | `/api/chat?reviewId=…` | Saved chat history |
| POST | `/api/chat` | `{ "reviewId": "…", "question": "…", "findingId": null }` |

Create the demo package through POST `/api/packages` with `{}` and `x-launchready-demo: 1`. Custom JSON goes directly in the body. Multipart fields are `package`, `observations` and repeated `documents`.

Session quotas per hour: 20 package uploads, 10 reviews and 30 chat questions. Global quotas per hour: 100 uploads, 40 reviews and 200 chat questions. These are prototype cost controls rather than account-based quotas. There is no login, cross-device account, sharing, or authenticated engineering sign-off. Clearing cookies loses the browser's access to its records; export important work before doing so. Old rows are not automatically deleted.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run test:integration
```

Integration tests start an isolated production server with a temporary SQLite database and a test-only mocked Gemini API; they do not consume tokens. They cover custom and demo uploads, all agent stages, browser-session isolation, CSRF origin rejection, notes and exports, chat history, CSV ingestion, fabricated citations and provider failure fallback.

Live Gemini and hosted Turso calls require your credentials and have not been exercised in this workspace. The existing design was inspected on the user's deployed site before backend integration. This new connected UI still needs a browser check on the new deployment because the cloud browser cannot access the local execution server.

Generate fresh sample files with `npm run sample`. No simulation data represents actual rocket engineering limits.

Human engineering review required. This tool does not approve or certify launches.
