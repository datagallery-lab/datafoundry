# Design: Authoritative tool-parent message persistence

Date: 2026-07-09  
Status: Approved (options 1+3)  
Scope: Eliminate orphan `parentMessageId` at the persistence source

## Problem

`TOOL_CALL_START.parentMessageId` often points at an AG-UI assistant message that never becomes a conversation row (tool-only / empty step). Restore then invents `restored-tool-parent:*` placeholders; an earlier frontend patch reordered those by `callEventSeq`, but that is not a complete fix.

## Goals

1. Every `toolCalls[].parentMessageId` in a new run exists as `messages[].messageId`.
2. Restore order matches live tool order without relying on synthetic orphans for new data.
3. Empty tool-parent rows are not fed into model history text.
4. Keep frontend orphan insertion as legacy fallback only.

## Design

### Backend (`ConversationMemoryEventObserver`)

On `TOOL_CALL_START` with `parentMessageId`:

- If no draft for that id, create an assistant draft with `toolParent: true`, empty text/reasoning.
- If draft exists, set `toolParent: true` (keep text/reasoning).

On flush:

- Persist drafts that have text, reasoning, **or** `toolParent`.
- Empty tool-parent content: `{ "text": "", "kind": "tool_parent" }`, `content_text: ""`.

### History assembly

Skip assistant rows whose visible text is empty and `kind === "tool_parent"` (same spirit as reasoning-only skip).

### Live / regression (option 3)

- Smoke: tool-only parent after `TOOL_CALL_START` persists; history excludes empty tool-parent; write→publish style parents both present.
- Frontend orphan path remains for old sessions.

## Non-goals

- DB role migration
- Bulk backfill of old sessions
- Removing frontend orphan fallback in this change
