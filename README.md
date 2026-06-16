# Open Data Agent Workbench

DB-GPT-like Data Agent workbench planning repository.

This repository currently contains product research, PRD materials, and the final engineering design for a 10-day MVP:

- DB-GPT-like GUI research
- Product brief
- Chinese and English PRD drafts
- Final engineering design

## Documents

Start here:

- [Docs Index](docs/README.md)
- [Final Engineering Design](docs/engineering/db-gpt-like-data-agent-final-design-zh.md)
- [Main PRD Chinese](docs/prd/db-gpt-like-data-agent-prd-plan-zh.md)

## Current Direction

The product is a TypeScript-first data-agent workbench:

- Next.js GUI
- Node/TypeScript TUI
- Fastify BFF
- Replaceable Agent Runtime Adapter
- Mastra + Vercel AI SDK as MVP path
- Self-developed Data Gateway
- User-scoped Knowledge Service
- Artifact-first UX

OpenCode is treated as a reference implementation or optional tool executor, not as the mandatory core runtime.
