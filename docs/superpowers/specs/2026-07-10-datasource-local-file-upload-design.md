# Datasource local-file upload (A1)

Date: 2026-07-10  
Status: approved (user chose A1)

## Problem

Remote Web cannot use browser-machine absolute paths. File-backed datasources
(DuckDB / SQLite / CSV / Excel / Access) must accept a **local file pick + upload**,
then store a **server-readable path** on the datasource config.

## Design

1. UI: beside `filePath`, add “Choose local file”; on select, upload immediately.
2. API: `POST /api/v1/datasources/uploads` (multipart `file`) → write under
   user workspace `datasources/` → return `{ path, originalName, size, mimeType }`.
3. Frontend writes returned `path` into `settings.filePath` and shows original name.
4. Keep existing save/test flow; path remains server-local after upload.
5. Extension allowlist by type; reject empty/oversized files.

## Out of scope

- Parsing browser absolute paths
- Restoring DuckDB demo datasource
- BigQuery keyFilename / KB vectorStore
