# DB-GPT GUI / Desktop-like App Technical Study

Date: 2026-06-16
Reference repo: `eosphoros-ai/DB-GPT`

## 1. Core conclusion

DB-GPT currently does not provide a native Electron/Tauri desktop application in the cloned repo. Its GUI is a Next.js WebUI under `web/`, with a desktop-like multi-panel product experience.

For a 10-day delivery target, the safest path is:

1. Build a local Web desktop console first.
2. Preserve the DB-GPT GUI prototype, navigation, option model, and interaction shape.
3. Implement an API-compatible facade behind the UI.
4. Support fewer real backends first.
5. Package with Tauri/Electron only after the web app is stable.

The mistake to avoid is trying to fully clone DB-GPT backend capability. The GUI can be preserved while many backend capabilities are disabled, stubbed, or mapped to a smaller OpenCode-based data-agent runtime.

## 2. GUI architecture in DB-GPT

### 2.1 Web stack

Evidence:

- `web/package.json` declares `db-gpt-web`, `next 13.4.7`, `react 18.3.1`, `antd`, `tailwindcss`, `@antv/gpt-vis`, `reactflow`, `monaco-editor`, `@microsoft/fetch-event-source`.
- No first-party Electron or Tauri config was found in the shallow checkout.

Meaning:

- The DB-GPT "desktop app feel" is a browser-based workbench.
- It can be copied as a local web console without first solving native desktop packaging.
- If the organization insists on a desktop binary, Tauri can wrap the web console later.

### 2.2 Main GUI surfaces

Important routes under `web/pages`:

- `/`: new Agentic Data home/workbench.
- `/chat`: legacy chat route.
- `/construct/app`: app creation and management.
- `/construct/database`: datasource management.
- `/construct/knowledge`: knowledge base management.
- `/construct/flow`: AWEL flow management.
- `/construct/models`: model management.
- `/construct/prompt`: prompt management.
- `/construct/skills`: skills management.
- `/construct/connectors`: MCP/connectors management.
- `/construct/scheduled-tasks`: scheduled task management.
- `/construct/dbgpts`: DBGPTS community.
- `/share/[token]`: shared conversation replay.
- `/mobile/chat`: mobile chat UI.

For our target, the primary surface to copy is `/`, not the older `/chat`.

## 3. The important DB-GPT desktop-like GUI shape

The current `/web/pages/index.tsx` is the key "Agentic Data" product shell.

### 3.1 Empty state / hero

The first screen has:

- DB-GPT logo.
- `home_title`.
- `home_subtitle`, currently positioned as Agentic Data Driven Decisions.
- Large centered chat input.
- Plus menu for context injection.
- Skill selector.
- Database selector.
- Knowledge selector.
- Connector selector.
- Model selector.
- Context usage bar.
- Voice button placeholder.
- Send button.

This is the product's "desktop app" landing experience. It should be preserved.

### 3.2 In-conversation state

After sending a query, the page changes into a multi-panel workbench:

- Top header:
  - product title
  - selected database tag
  - Clear Chat
  - notification bell
  - credit pill
  - avatar
- Left panel:
  - user query
  - selected file/database/knowledge/skill/connectors
  - task plan card
  - agent steps
  - assistant summary
  - generated artifacts
- Bottom input:
  - context tags
  - textarea
  - plus menu
  - skill button
  - connector button
  - model selector
  - context usage bar
  - voice button placeholder
  - send button
- Right panel:
  - execution details
  - files
  - HTML preview
  - image preview
  - skill preview
  - summary
  - share and schedule actions

This two/three-panel workbench is the highest-value GUI pattern to preserve.

## 4. Must-preserve options

### P0: must preserve visually and functionally

These are needed to make the product feel like DB-GPT:

- Agentic Data home page.
- Large ask-data input.
- File upload entry.
- Database picker.
- Model picker.
- Left execution/step panel.
- Right artifact/preview panel.
- Database management page with:
  - DB type cards
  - badge counts
  - drawer for connections
  - create/edit/delete/refresh actions
  - dynamic connection form
  - test connection before save
- Basic app modes:
  - Chat Normal
  - Chat Data
  - Chat DB
  - Chat Excel
  - Chat Knowledge
  - Chat Dashboard
- ReAct streaming endpoint shape:
  - task plan
  - step start/meta/output/chunk/done
  - final summary
  - artifacts

### P1: preserve visually, limited backend support

These should appear in the GUI, but can be partially implemented:

- Knowledge selector and management.
- Skills selector and management.
- Connectors selector and management.
- Prompt management.
- Share conversation.
- Scheduled task entry.

### P2: preserve as disabled or placeholder in 10 days

These are expensive and risky to fully implement:

- AWEL Flow editor.
- Full model evaluation pages.
- DBGPTS community.
- Mobile chat.
- Full dashboard-generation workflow.
- Full multi-database support matrix.

## 5. Datasource GUI

DB-GPT's datasource GUI is implemented in `web/pages/construct/database.tsx`.

The flow is:

1. Fetch all existing datasource connections.
2. Fetch supported datasource types.
3. Render supported DB cards normally.
4. Render unsupported DB cards disabled.
5. Clicking a supported DB opens a drawer.
6. Drawer lists existing connections for that DB type.
7. Create/edit opens a modal.
8. The modal renders a dynamic form from backend-provided `ConfigurableParams`.
9. Submit first calls test connection.
10. If test succeeds, add or edit the datasource.

Important UI details to preserve:

- Many DB cards should still be visible.
- Unsupported DBs should be disabled, not removed.
- Connection count badges should remain.
- Dynamic form should support string, password, select, number, boolean, and nested fields.

Recommended 10-day DB support:

- SQLite
- DuckDB
- PostgreSQL
- MySQL
- CSV/Excel file path upload

Everything else can remain visible but disabled.

## 6. Native App option model

DB-GPT has native app scenes generated server-side and configured in the UI.

Important scene options:

- `chat_normal`: normal LLM chat.
- `chat_knowledge`: knowledge Q&A.
- `chat_with_db_qa`: DB metadata Q&A.
- `chat_with_db_execute`: Chat Data.
- `chat_dashboard`: dashboard/report.
- `chat_excel`: Excel analysis.

The app configuration UI preserves:

- native type
- arguments/resource binding
- model
- prompt template
- temperature
- max_new_tokens

For our build, keep all these options. Unsupported modes can route to a common ReAct agent endpoint and return a clear "capability not enabled yet" result.

## 7. ReAct and streaming contract

The new Agentic Data page posts to:

`POST /api/v1/chat/react-agent`

Typical payload:

```json
{
  "conv_uid": "...",
  "chat_mode": "chat_react_agent",
  "model_name": "...",
  "user_input": "...",
  "temperature": 0.6,
  "max_new_tokens": 4000,
  "select_param": "",
  "ext_info": {
    "file_path": "...",
    "skill_id": "...",
    "skill_name": "...",
    "database_name": "...",
    "database_type": "...",
    "knowledge_space_name": "...",
    "knowledge_space_id": "...",
    "connector_ids": ["..."]
  }
}
```

The frontend expects SSE-like events such as:

- `context.status`
- `plan.update`
- `step.start`
- `step.meta`
- `step.output`
- `step.chunk`
- `step.done`
- `step.thought`
- `final`
- `done`

This contract is the minimal bridge between a DB-GPT-like GUI and an OpenCode-based agent runtime.

## 8. Connector GUI

DB-GPT's connector UI uses:

`/api/v2/serve/connectors`

Expected operations:

- list connector types
- list connectors
- create connector
- update connector
- delete connector
- test connector
- list tools for a connector

The visible form supports:

- connector type
- display name
- server URI
- transport: `streamable_http`, `sse`
- auth type: none/token/bearer
- token/header name
- description

For 10 days, implement only custom MCP connector first. Keep built-in connector catalog visible but disabled if needed.

## 9. Recommended 10-day implementation plan

### Day 1: freeze the GUI contract

- Fork or copy only the needed UI modules.
- Keep DB-GPT visual structure.
- Define API facade responses.
- Decide supported DBs.
- Decide whether desktop packaging is required for demo or after demo.

### Day 2-3: build the Agentic Data workbench

- Home/hero state.
- Multi-panel conversation state.
- Bottom input and context tags.
- Model selector.
- File/database/connector/skill pickers.
- SSE rendering for steps and final answer.

### Day 3-4: datasource console

- DB cards.
- Disabled unsupported DB cards.
- Drawer connection list.
- Dynamic datasource form.
- Test connection.
- Save/delete/refresh.

### Day 4-6: OpenCode-based data agent backend

- Implement DB registry.
- Implement schema introspection for supported DBs.
- Implement SQL query tool with read-only guard.
- Implement Python/analysis tool for CSV/Excel.
- Implement artifact generation:
  - table
  - chart
  - markdown
  - HTML
  - file
- Emit DB-GPT-compatible SSE events.

### Day 6-7: connectors and skills facade

- Implement connector list/create/test/tools minimal APIs.
- Implement skill list facade.
- Keep skill execution optional.
- Wire connector IDs into agent runtime context.

### Day 7-8: app management shell

- Preserve Construct navigation.
- Implement `/construct/app` enough to create/edit app modes.
- Store model/resource/temperature/max_new_tokens/prompt config.
- Stub unsupported app modes.

### Day 8-9: polish and demos

- Full demo script:
  - connect database
  - ask question
  - generate SQL
  - execute SQL
  - produce table/chart
  - upload Excel
  - generate report artifact
- Add empty/error/loading states.
- Add share stub or simple share.

### Day 10: package and stabilize

- Fix UI overlap and edge cases.
- Add read-only SQL policy.
- Add logs and replayable traces.
- Optional: Tauri/Electron wrapper.

## 10. Backend API facade checklist

Minimum endpoints to implement for a DB-GPT-like GUI:

- `GET /api/v1/chat/db/list`
- `GET /api/v1/chat/db/support_type`
- `POST /api/v1/chat/db/test-connect`
- `POST /api/v1/chat/db/add`
- `POST /api/v1/chat/db/edit`
- `POST /api/v1/chat/db/delete`
- `POST /api/v1/chat/db/refresh`
- `GET /api/v1/skills/list`
- `GET /api/v2/serve/connectors/`
- `GET /api/v2/serve/connectors/types`
- `POST /api/v2/serve/connectors/`
- `PUT /api/v2/serve/connectors/{id}`
- `DELETE /api/v2/serve/connectors/{id}`
- `POST /api/v2/serve/connectors/{id}/test`
- `GET /api/v2/serve/connectors/{id}/tools`
- `POST /api/v1/python/file/upload`
- `POST /api/v1/chat/react-agent`
- file/artifact download endpoint

Exact endpoint names should be verified against `web/client/api` before implementation, but the list above is the functional minimum.

## 11. Key source references

- `web/package.json`
- `web/pages/index.tsx`
- `web/new-components/layout/Construct.tsx`
- `web/pages/construct/database.tsx`
- `web/components/database/database-form.tsx`
- `web/components/common/configurable-form.tsx`
- `web/pages/construct/app/extra/components/NativeApp.tsx`
- `web/hooks/use-react-agent.ts`
- `web/hooks/use-connector-api.ts`
- `packages/dbgpt-serve/src/dbgpt_serve/agent/db/gpts_app.py`
- `packages/dbgpt-app/src/dbgpt_app/scene/base.py`

## 12. Final recommendation

Use DB-GPT GUI as the product reference, not DB-GPT backend as the implementation target.

In 10 days, the winning architecture is:

- DB-GPT-like React/Next desktop workbench.
- OpenCode-style ReAct runtime.
- Small data-agent toolset:
  - DB introspection
  - read-only SQL
  - CSV/Excel analysis
  - chart/report artifacts
  - optional MCP connector
- API facade compatible with the DB-GPT UI contract.

This preserves the user's perceived product shape while keeping implementation scope survivable.
