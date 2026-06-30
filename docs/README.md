# Documentation

This directory contains user guides, API references, architecture notes, ADRs, and historical working documents for
DataAgent.

Use this page as the documentation map. The repository is still being normalized, so prefer the documents listed in the
first sections below over older dated notes.

## Start Here

| Document | Use When |
| --- | --- |
| [Quick Start](quick-start.md) | You want to install the project, configure a model key, and run the Web workbench. |
| [Repository README](../README.md) | You need the project overview, local commands, and top-level architecture. |
| [Web App README](../apps/web/README.md) | You are working on or running the Next.js workbench. |
| [TUI README](../apps/tui/README.md) | You are trying the terminal client. |

## Reference

These documents describe current integration contracts or runtime behavior.

| Document | Scope |
| --- | --- |
| [Backend REST API Reference](engineering/2026-06-23-backend-rest-api-reference.md) | Available REST endpoints, request JSON, and response examples. |
| [Config Management API](engineering/config-management-api.md) | Resource configuration, secrets, run defaults, model profiles, skills, MCP, and jobs. |
| [CopilotKit / AG-UI Protocol](engineering/copilotkit-ag-ui-frontend-protocol.md) | Frontend protocol surface, AG-UI events, and supported runtime behavior. |
| [Supported Databases](engineering/supported-databases.md) | Data Gateway datasource types, registration fields, and usage examples. |
| [Frontend Capability Status](engineering/2026-06-27-frontend-capability-status.md) | Current frontend capability snapshot and backend expectations. |
| [Backend Requirements Snapshot](engineering/2026-06-27-backend-requirements.md) | Latest dated backend requirements and response notes. |

## Architecture

These are the highest-value design documents to keep aligned with the code.

| Document | Scope |
| --- | --- |
| [File Asset / Workspace / Artifact / Knowledge Design](engineering/2026-06-24-file-asset-workspace-artifact-knowledge-design.md) | Unified lifecycle for uploaded files, workspace files, artifacts, and knowledge imports. |
| [Agent Context Management](engineering/agent-context-management-design.md) | Context inventory, source policy, projection, budget, and prompt compilation. |
| [Context Architecture HTML](engineering/agent-context-architecture.html) | Visual context pipeline and ReAct-loop context flow. |
| [Conversation Memory Design](engineering/2026-06-23-conversation-memory-design.md) | Server-authoritative conversation history and memory assembly. |
| [Mastra Memory Controlled Integration](engineering/mastra-memory-controlled-integration.html) | Controlled Mastra memory integration boundary. |
| [AG-UI Agent Runtime Architecture](engineering/ag-ui-agent-runtime-architecture.svg) | Runtime architecture diagram. |
| [Context Governance Pipeline](engineering/context-governance-pipeline.svg) | Context governance pipeline diagram. |

## ADRs

Architecture decisions should be short, stable, and preferred over dated planning notes when they conflict.

| ADR | Decision |
| --- | --- |
| [ADR-0001](engineering/adr-0001-context-governance-fail-closed.md) | Context governance fails closed for unsafe or duplicate model-visible context. |
| [ADR-0002](engineering/adr-0002-context-compile-every-mastra-step.md) | Context is compiled for every Mastra ReAct step. |
| [ADR-0002 Memory Boundary](engineering/adr-0002-memory-authority-and-mastra-memory-boundary.md) | Metadata remains memory authority; Mastra memory is a controlled projection. |
| [ADR-0003](engineering/adr-0003-context-layering-and-naming.md) | Context layering, naming, file organization, and extension boundaries. |

## Product And Research

These are useful for product intent and background, but they are not implementation contracts.

| Document | Scope |
| --- | --- |
| [Product Brief](product/db-gpt-like-data-agent-product-brief.md) | Product positioning and target workflows. |
| [Chinese PRD](prd/db-gpt-like-data-agent-prd-plan-zh.md) | Product requirements baseline in Chinese. |
| [English PRD](prd/db-gpt-like-data-agent-prd-plan.md) | Product requirements baseline in English. |
| [DB-GPT GUI / Desktop Study](research/db-gpt-gui-desktop-study.md) | Research background. |

## Working Notes And Archives

The following areas contain dated plans, reviews, delivery notes, or earlier collaboration records. They can explain why
decisions were made, but they should not be treated as current API or architecture contracts without checking code and
smoke tests.

- `engineering/2026-*.md`
- `engineering/2026-06-26-review-*.md`
- `engineering/archive/`
- `plans/`
- `planning/`
- `superpowers/`
- TUI implementation summaries at the root of `docs/`

## Documentation Rules

- Keep the root `README.md` concise and reader-facing.
- Prefer one authoritative document per topic; archive or remove duplicates after consolidation.
- Put API contracts under Reference and architectural decisions under ADRs.
- Keep dated requirement and review documents out of the primary reading path.
- Run `npm run smoke:docs` after changing links.
