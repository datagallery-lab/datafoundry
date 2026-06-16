# DB-GPT-like Data Agent Product Brief for PRD Discussion

Date: 2026-06-16
Project: DB-GPT-like data agent workbench
Reference repo: `eosphoros-ai/DB-GPT`
Current workspace: this repository

## 1. Current product intent

We need to build a DB-GPT-like data agent product within 10 days.

The target is not to fully clone DB-GPT. The target is to quickly deliver a credible data-agent workbench with a GUI that preserves the DB-GPT product prototype and option model, while supporting a smaller set of real backend capabilities.

The user-facing product must feel like:

- a desktop-style data workbench
- an agentic data analysis console
- a GUI-first product, not a CLI demo
- an interactive data assistant with visible execution traces and generated artifacts

The implementation can be narrower:

- fewer database types
- fewer connectors
- fewer knowledge and skill capabilities
- fewer app modes fully supported

But the visible option structure should remain close to DB-GPT.

## 2. Non-negotiable delivery constraint

Deadline: 10 days.

This means the PRD should optimize for a sharp MVP, not a complete platform.

Product scope must be staged:

- preserve DB-GPT-like visual and interaction structure
- implement only the data paths needed for a convincing demo
- disable or stub expensive surfaces
- make unsupported options visible but clearly unavailable

Any PRD proposal that requires reproducing full DB-GPT backend scope in 10 days should be rejected.

## 3. Key DB-GPT GUI finding

DB-GPT's current GUI in the cloned repo is not a native Electron/Tauri desktop app. It is a Next.js WebUI under `web/`.

However, the product experience is desktop-like:

- full-height workbench
- top header
- large ask-data input
- contextual pickers
- left agent execution panel
- right artifact/preview panel
- Construct management console

Recommended product decision:

- Build a local web workbench first.
- Treat native desktop packaging as optional day-10 packaging or post-MVP work.
- If a desktop binary is mandatory, wrap the working web app with Tauri/Electron after the core workflow is stable.

## 4. Core product surfaces to preserve

### P0: must preserve and make usable

These define the minimum acceptable product experience:

- Agentic Data home page:
  - large central input
  - model selector
  - file upload
  - database picker
  - send button
  - selected context tags
- Conversation workbench:
  - user query
  - task plan
  - visible agent steps
  - final answer
  - artifacts
  - left execution timeline
  - right preview/artifact panel
- Datasource management:
  - DB type cards
  - supported/unsupported visual states
  - connection count badges
  - drawer with connection list
  - create/edit/delete/refresh
  - dynamic connection form
  - test connection before save
- Knowledge management:
  - create/select knowledge collection
  - upload user documents and PDFs
  - parse/index status
  - document list and delete action
  - citation-capable document Q&A
  - selected knowledge context tags in the chat input
- ReAct-style streaming run:
  - plan
  - step start
  - tool input/output
  - observations
  - final answer
  - generated artifacts

### P1: preserve visually, implement partially

- Advanced knowledge settings such as batch reindex, OCR, external connectors, and permission sync
- Skills selector and management
- Connectors/MCP selector and management
- Prompt management
- App management
- Share conversation
- Scheduled task entry

### P2: show as placeholder or disable

- AWEL Flow editor
- DBGPTS community
- model evaluation pages
- mobile chat
- full dashboard generation
- full multi-database matrix

## 5. App modes to keep in the product

DB-GPT exposes several native app modes. The PRD should keep them as visible product concepts:

- Chat Normal
- Chat Data
- Chat DB
- Chat Excel
- Chat Knowledge
- Chat Dashboard

MVP support suggestion:

- fully support Chat Data
- fully support Chat Excel/CSV analysis
- fully support basic Chat Knowledge for uploaded documents/PDFs
- partially support Chat DB metadata Q&A
- stub Chat Dashboard by producing HTML/markdown reports first
- keep Chat Normal as a basic LLM chat route

## 6. Database support principle

The GUI should show a broad DB support matrix, but the backend should only enable a small initial set.

Recommended enabled databases:

- SQLite
- DuckDB
- PostgreSQL
- MySQL
- CSV/Excel files

Recommended disabled but visible:

- ClickHouse
- Oracle
- SQL Server
- MongoDB
- StarRocks
- Redis
- Cassandra
- Neo4j
- HBase
- other DB-GPT-supported database cards

Product copy should avoid overclaiming. Disabled options can say:

- "Coming soon"
- "Not enabled in this deployment"
- "Contact admin to enable"

## 7. Technical product principles

### Principle 1: GUI contract first

The GUI should drive the API contract.

We should implement a DB-GPT-compatible facade that satisfies the frontend workflow, instead of cloning DB-GPT internals.

### Principle 2: OpenCode is the agent runtime, not the whole product

OpenCode can provide the ReAct/session/tool execution foundation.

The product still needs:

- datasource registry
- schema introspection
- safe SQL execution
- file upload and parsing
- artifact generation
- GUI state management
- connector management
- run history
- permissions and guardrails

### Principle 3: ReAct trace must be visible

The product should not hide the agent process.

The user should see:

- plan
- tool calls
- SQL
- execution results
- generated files/charts
- failures and retries

This is important for trust in data work.

### Principle 4: read-only data safety by default

MVP database execution should default to read-only.

Guardrails:

- block destructive SQL by default
- allow only SELECT-like queries initially
- set query timeout
- set row limit
- show generated SQL before or during execution
- log executed SQL

### Principle 5: artifacts are first-class

The right panel should not be just logs.

It should support:

- table preview
- chart preview
- markdown report
- HTML report
- code block
- generated files
- image/chart preview
- cited document snippets
- source document/page references

### Principle 5.5: knowledge grounding is useful but bounded

MVP knowledge support should help users bring their own business context into the data-agent workflow.

The first-stage knowledge capability should support:

- uploading documents and PDFs
- parsing and chunking text content
- indexing documents into a selectable knowledge collection
- retrieving cited snippets during a ReAct run
- showing source file/page references in answers
- combining selected knowledge with database or Excel analysis

The PRD should avoid promising:

- enterprise-grade knowledge management
- perfect retrieval accuracy
- OCR for scanned PDFs
- full image/table extraction from PDFs
- permission sync with external document systems
- unlimited document scale

### Principle 6: unsupported options remain visible

Do not remove DB-GPT-like options just because backend support is not ready.

Instead:

- show the option
- disable it
- label its status
- keep the product information architecture stable

This preserves prototype fidelity.

### Principle 7: demo path beats platform completeness

The 10-day PRD should define one or two end-to-end demo paths:

1. Upload a metrics/business-context PDF, connect a SQLite/DuckDB/PostgreSQL datasource, ask a business question, retrieve cited business definitions, generate SQL, execute, show table/chart, and produce a grounded summary.
2. Upload CSV/Excel, analyze data, generate chart/report artifact.

Everything else should be judged by whether it strengthens these demos.

## 8. Minimum API facade for PRD scope

The PRD should require a minimal backend facade with these capability groups:

Datasource:

- list datasource connections
- list supported datasource types
- test connection
- add/edit/delete/refresh connection

Agent run:

- start ReAct data-agent run
- stream plan/step/output/final events through SSE
- return generated artifacts

Files:

- upload CSV/Excel
- preview uploaded file
- download generated artifact

Knowledge:

- create/list/delete knowledge collections
- upload document/PDF into a knowledge collection
- parse and index document content
- list indexed documents and parse status
- retrieve relevant chunks with citations
- attach selected knowledge collection to a ReAct agent run

Connectors:

- list connector types
- list connector instances
- create/update/delete/test connector
- list connector tools

Skills:

- list skills
- select skill as run context
- optional skill execution in MVP

Apps:

- list/create/edit app mode configs
- preserve model/resource/prompt/temperature/max token options

## 9. PRD discussion questions for Product

Product should answer these before the PRD is locked:

1. Who is the first user: analyst, data engineer, PM, executive, or internal support?
2. Which data source matters most for the first demo?
3. Is native desktop packaging mandatory for the 10-day deadline, or is local Web acceptable?
4. Which workflow is the flagship demo: database Q&A, Excel analysis, dashboard/report generation, or scheduled data task?
5. Which DB-GPT options must be visible even if disabled?
6. What claims are we allowed to make in the first demo?
7. What must not happen in demo: wrong SQL, destructive SQL, hallucinated chart, leaking credentials, empty right panel?
8. Is this a prototype, internal PoC, or external-facing MVP?
9. What is the minimum "wow moment" that proves the product direction?
10. What should be explicitly out of scope for the first PRD?

## 10. Suggested MVP positioning

Working name:

Open Data Agent Workbench

Positioning:

A GUI-first data agent workbench that lets users connect a database or upload a spreadsheet, ask questions in natural language, inspect the agent's reasoning/action trace, and receive executable SQL, tables, charts, and reports.

Differentiation for MVP:

- DB-GPT-like workbench UX
- OpenCode-based agent runtime
- transparent ReAct execution trace
- artifact-first data analysis
- narrower but reliable database support

## 11. Immediate next step for Product

Start a pre-PRD discussion focused on:

- first user persona
- flagship demo path
- must-preserve DB-GPT GUI options
- enabled vs disabled capabilities
- product claims and non-goals
- 10-day acceptance criteria

The PRD should not begin as a broad platform spec. It should begin as a 10-day survival MVP with a polished DB-GPT-like GUI and a narrow data-agent core.
