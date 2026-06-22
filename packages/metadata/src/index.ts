import type { BaseEvent, EventType } from "@ag-ui/core";
import type { ArtifactSummary, ArtifactType, RunEventEnvelope } from "@open-data-agent/contracts";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type UserRecord = {
  id: string;
  email?: string;
  display_name?: string;
  dev_token?: string;
  created_at: string;
  updated_at: string;
};

export type UserContext = {
  user_id: string;
  email?: string;
  display_name?: string;
};

export type SessionRecord = {
  id: string;
  user_id: string;
  title?: string;
  selected_datasource_id?: string;
  selected_collection_id?: string;
  created_at: string;
  updated_at: string;
};

export type RunRecord = {
  id: string;
  user_id: string;
  session_id: string;
  parent_run_id?: string;
  request_fingerprint?: string;
  status: "queued" | "running" | "suspended" | "completed" | "failed" | "canceled";
  user_input: string;
  model_provider?: string;
  model_name?: string;
  datasource_id?: string;
  collection_id?: string;
  started_at: string;
  finished_at?: string;
  error_message?: string;
};

export type InteractionRecord = {
  id: string;
  user_id: string;
  session_id: string;
  run_id: string;
  tool_call_id: string;
  tool_name: "ask_user" | "submit_plan";
  payload_json: string;
  status: "pending" | "resolved" | "canceled";
  resume_fingerprint?: string;
  response_json?: string;
  created_at: string;
  resolved_at?: string;
};

export type RunEventRecord = {
  id: string;
  user_id: string;
  run_id: string;
  session_id: string;
  seq: number;
  event_type: EventType;
  payload_json: string;
  created_at: string;
};

export type ArtifactRecord = {
  id: string;
  user_id: string;
  session_id: string;
  run_id: string;
  type: ArtifactType;
  name: string;
  mime_type?: string;
  storage_path?: string;
  preview_json?: string;
  metadata_json?: string;
  created_at: string;
};

export type DataSourceRecord = {
  id: string;
  user_id: string;
  name: string;
  type: string;
  config_json: string;
  credential_ref?: string;
  description?: string;
  status: "ready" | "disabled" | "failed";
  last_test_at?: string;
  created_at: string;
  updated_at: string;
};

export type SqlAuditLogRecord = {
  id: string;
  user_id: string;
  run_id?: string;
  datasource_id: string;
  sql_text: string;
  status: "succeeded" | "blocked" | "failed" | "timeout";
  blocked_reason?: string;
  row_count?: number;
  elapsed_ms?: number;
  created_at: string;
};

export type MetadataStoreOptions = {
  database_path?: string;
  dev_user?: {
    id: string;
    email: string;
    display_name: string;
    dev_token: string;
  };
};

export type CreateSessionInput = {
  user_id: string;
  id: string;
  title?: string;
  selected_datasource_id?: string;
  selected_collection_id?: string;
};

export type CreateRunInput = {
  user_id: string;
  id: string;
  session_id: string;
  parent_run_id?: string;
  request_fingerprint?: string;
  user_input: string;
  status?: RunRecord["status"];
  model_provider?: string;
  model_name?: string;
  datasource_id?: string;
  collection_id?: string;
};

export type ClaimRunResult = {
  created: boolean;
  run: RunRecord;
};

export type WriteRunEventInput = {
  user_id: string;
  run_id: string;
  session_id: string;
  event: BaseEvent;
};

export type CreateArtifactInput = {
  user_id: string;
  session_id: string;
  run_id: string;
  id: string;
  type: ArtifactType;
  name: string;
  mime_type?: string;
  storage_path?: string;
  preview_json?: unknown;
  metadata_json?: unknown;
};

export type CreateDataSourceInput = {
  user_id: string;
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  credential_ref?: string;
  description?: string;
  status?: DataSourceRecord["status"];
};

export type CreateSqlAuditLogInput = {
  user_id: string;
  id: string;
  datasource_id: string;
  sql_text: string;
  status: SqlAuditLogRecord["status"];
  run_id?: string;
  blocked_reason?: string;
  row_count?: number;
  elapsed_ms?: number;
};

const DEFAULT_DEV_USER = {
  id: "dev-user",
  email: "dev@example.com",
  display_name: "Dev User",
  dev_token: "dev-token"
};

export class MetadataStore {
  readonly artifacts: ArtifactRepository;
  readonly dataSources: DataSourceRepository;
  readonly interactions: InteractionRepository;
  readonly runEvents: RunEventRepository;
  readonly runs: RunRepository;
  readonly sessions: SessionRepository;
  readonly sqlAuditLogs: SqlAuditLogRepository;
  readonly users: UserRepository;

  constructor(readonly db: DatabaseSync) {
    this.users = new UserRepository(db);
    this.sessions = new SessionRepository(db);
    this.runs = new RunRepository(db);
    this.runEvents = new RunEventRepository(db);
    this.artifacts = new ArtifactRepository(db);
    this.dataSources = new DataSourceRepository(db);
    this.interactions = new InteractionRepository(db);
    this.sqlAuditLogs = new SqlAuditLogRepository(db);
  }

  close(): void {
    this.db.close();
  }
}

export class InteractionRepository {
  constructor(private readonly db: DatabaseSync) {}

  request(input: {
    id: string;
    user_id: string;
    session_id: string;
    run_id: string;
    tool_call_id: string;
    tool_name: InteractionRecord["tool_name"];
    payload: unknown;
  }): InteractionRecord {
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO interactions (
        id, user_id, session_id, run_id, tool_call_id, tool_name, payload_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT(user_id, run_id, tool_call_id) DO NOTHING
    `).run(
      input.id,
      input.user_id,
      input.session_id,
      input.run_id,
      input.tool_call_id,
      input.tool_name,
      JSON.stringify(input.payload),
      createdAt
    );
    return this.getByToolCall(input);
  }

  getByToolCall(input: { user_id: string; run_id: string; tool_call_id: string }): InteractionRecord {
    const interaction = mapInteractionRow(
      this.db.prepare(
        "SELECT * FROM interactions WHERE user_id = ? AND run_id = ? AND tool_call_id = ?"
      ).get(input.user_id, input.run_id, input.tool_call_id)
    );
    if (!interaction) {
      throw new Error(`INTERACTION_NOT_FOUND:${input.tool_call_id}`);
    }
    return interaction;
  }

  resolve(input: {
    user_id: string;
    run_id: string;
    tool_call_id: string;
    resume_fingerprint: string;
    response: unknown;
  }): InteractionRecord {
    const current = this.getByToolCall(input);
    if (current.status === "resolved") {
      if (current.resume_fingerprint !== input.resume_fingerprint) {
        throw new Error(`INTERACTION_RESUME_MISMATCH:${input.tool_call_id}`);
      }
      return current;
    }
    const resolvedAt = new Date().toISOString();
    this.db.prepare(`
      UPDATE interactions
      SET status = 'resolved', resume_fingerprint = ?, response_json = ?, resolved_at = ?
      WHERE user_id = ? AND run_id = ? AND tool_call_id = ? AND status = 'pending'
    `).run(
      input.resume_fingerprint,
      JSON.stringify(input.response),
      resolvedAt,
      input.user_id,
      input.run_id,
      input.tool_call_id
    );
    return this.getByToolCall(input);
  }

  cancel(input: {
    user_id: string;
    run_id: string;
    tool_call_id: string;
    resume_fingerprint: string;
  }): InteractionRecord {
    const resolvedAt = new Date().toISOString();
    this.db.prepare(`
      UPDATE interactions
      SET status = 'canceled', resume_fingerprint = ?, response_json = 'false', resolved_at = ?
      WHERE user_id = ? AND run_id = ? AND tool_call_id = ? AND status = 'pending'
    `).run(
      input.resume_fingerprint,
      resolvedAt,
      input.user_id,
      input.run_id,
      input.tool_call_id
    );
    return this.getByToolCall(input);
  }
}

export class UserRepository {
  constructor(private readonly db: DatabaseSync) {}

  upsertDevUser(input: { id: string; email: string; display_name: string; dev_token: string }): UserRecord {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO users (id, email, display_name, dev_token, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          display_name = excluded.display_name,
          dev_token = excluded.dev_token,
          updated_at = excluded.updated_at
      `
      )
      .run(input.id, input.email, input.display_name, input.dev_token, now, now);

    return this.getById({ user_id: input.id });
  }

  getByDevToken(input: { dev_token: string }): Optional<UserRecord> {
    return mapUserRow(this.db.prepare("SELECT * FROM users WHERE dev_token = ?").get(input.dev_token));
  }

  getById(input: { user_id: string }): UserRecord {
    const user = mapUserRow(this.db.prepare("SELECT * FROM users WHERE id = ?").get(input.user_id));

    if (!user) {
      throw new Error(`User not found: ${input.user_id}`);
    }

    return user;
  }
}

export class SessionRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(input: CreateSessionInput): SessionRecord {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO sessions (
          id, user_id, title, selected_datasource_id, selected_collection_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET
          title = COALESCE(excluded.title, sessions.title),
          selected_datasource_id = COALESCE(excluded.selected_datasource_id, sessions.selected_datasource_id),
          selected_collection_id = COALESCE(excluded.selected_collection_id, sessions.selected_collection_id),
          updated_at = excluded.updated_at
      `
      )
      .run(
        input.id,
        input.user_id,
        input.title ?? null,
        input.selected_datasource_id ?? null,
        input.selected_collection_id ?? null,
        now,
        now
      );

    return this.get({ user_id: input.user_id, session_id: input.id });
  }

  get(input: { user_id: string; session_id: string }): SessionRecord {
    const session = mapSessionRow(
      this.db.prepare("SELECT * FROM sessions WHERE user_id = ? AND id = ?").get(input.user_id, input.session_id)
    );

    if (!session) {
      throw new Error(`Session not found: ${input.session_id}`);
    }

    return session;
  }

  list(input: { user_id: string }): SessionRecord[] {
    return this.db
      .prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC")
      .all(input.user_id)
      .map(mapRequiredSessionRow);
  }
}

export class DataSourceRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(input: CreateDataSourceInput): DataSourceRecord {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO data_sources (
          id, user_id, name, type, config_json, credential_ref, description, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          config_json = excluded.config_json,
          credential_ref = excluded.credential_ref,
          description = excluded.description,
          status = excluded.status,
          updated_at = excluded.updated_at
      `
      )
      .run(
        input.id,
        input.user_id,
        input.name,
        input.type,
        JSON.stringify(input.config),
        input.credential_ref ?? null,
        input.description ?? null,
        input.status ?? "ready",
        now,
        now
      );

    return this.get({ user_id: input.user_id, datasource_id: input.id });
  }

  get(input: { user_id: string; datasource_id: string }): DataSourceRecord {
    const dataSource = mapDataSourceRow(
      this.db
        .prepare("SELECT * FROM data_sources WHERE user_id = ? AND id = ?")
        .get(input.user_id, input.datasource_id)
    );

    if (!dataSource) {
      throw new Error(`Data source not found: ${input.datasource_id}`);
    }

    return dataSource;
  }

  list(input: { user_id: string; enabled_only?: boolean }): DataSourceRecord[] {
    const sql = input.enabled_only
      ? "SELECT * FROM data_sources WHERE user_id = ? AND status = 'ready' ORDER BY updated_at DESC"
      : "SELECT * FROM data_sources WHERE user_id = ? ORDER BY updated_at DESC";

    return this.db.prepare(sql).all(input.user_id).map(mapRequiredDataSourceRow);
  }

  touchTest(input: { user_id: string; datasource_id: string; status: DataSourceRecord["status"] }): DataSourceRecord {
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        UPDATE data_sources
        SET status = ?, last_test_at = ?, updated_at = ?
        WHERE user_id = ? AND id = ?
      `
      )
      .run(input.status, now, now, input.user_id, input.datasource_id);

    return this.get({ user_id: input.user_id, datasource_id: input.datasource_id });
  }
}

export class RunRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(input: CreateRunInput): RunRecord {
    const result = this.claim(input);

    if (!result.created) {
      throw new Error(`Run already exists: ${input.id}`);
    }

    return result.run;
  }

  claim(input: CreateRunInput): ClaimRunResult {
    const now = new Date().toISOString();

    const result = this.db
      .prepare(
        `
        INSERT INTO runs (
          id, user_id, session_id, parent_run_id, request_fingerprint, status, user_input,
          model_provider, model_name, datasource_id, collection_id, started_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO NOTHING
      `
      )
      .run(
        input.id,
        input.user_id,
        input.session_id,
        input.parent_run_id ?? null,
        input.request_fingerprint ?? null,
        input.status ?? "queued",
        input.user_input,
        input.model_provider ?? null,
        input.model_name ?? null,
        input.datasource_id ?? null,
        input.collection_id ?? null,
        now
      );

    return {
      created: result.changes === 1,
      run: this.get({ user_id: input.user_id, run_id: input.id })
    };
  }

  find(input: { user_id: string; run_id: string }): Optional<RunRecord> {
    return mapRunRow(
      this.db.prepare("SELECT * FROM runs WHERE user_id = ? AND id = ?").get(input.user_id, input.run_id)
    );
  }

  get(input: { user_id: string; run_id: string }): RunRecord {
    const run = this.find(input);

    if (!run) {
      throw new Error(`Run not found: ${input.run_id}`);
    }

    return run;
  }

  updateStatus(input: {
    user_id: string;
    run_id: string;
    status: RunRecord["status"];
    error_message?: string;
  }): RunRecord {
    const finishedAt = ["completed", "failed", "canceled"].includes(input.status) ? new Date().toISOString() : null;

    this.db
      .prepare(
        `
        UPDATE runs
        SET status = ?, finished_at = ?, error_message = ?
        WHERE user_id = ? AND id = ?
      `
      )
      .run(input.status, finishedAt, input.error_message ?? null, input.user_id, input.run_id);

    return this.get({ user_id: input.user_id, run_id: input.run_id });
  }
}

export class RunEventRepository {
  constructor(private readonly db: DatabaseSync) {}

  append(input: WriteRunEventInput): RunEventRecord {
    const seq = this.nextSeq({ user_id: input.user_id, run_id: input.run_id });
    const createdAt = new Date().toISOString();
    const id = `${input.run_id}:${seq}`;

    this.db
      .prepare(
        `
        INSERT INTO run_events (id, user_id, run_id, session_id, seq, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        id,
        input.user_id,
        input.run_id,
        input.session_id,
        seq,
        input.event.type,
        JSON.stringify(input.event),
        createdAt
      );

    return this.getBySeq({ user_id: input.user_id, run_id: input.run_id, seq });
  }

  listByRun(input: { user_id: string; run_id: string }): RunEventRecord[] {
    return this.db
      .prepare("SELECT * FROM run_events WHERE user_id = ? AND run_id = ? ORDER BY seq ASC")
      .all(input.user_id, input.run_id)
      .map(mapRequiredRunEventRow);
  }

  private getBySeq(input: { user_id: string; run_id: string; seq: number }): RunEventRecord {
    const event = mapRunEventRow(
      this.db
        .prepare("SELECT * FROM run_events WHERE user_id = ? AND run_id = ? AND seq = ?")
        .get(input.user_id, input.run_id, input.seq)
    );

    if (!event) {
      throw new Error(`Run event not found: ${input.run_id}:${input.seq}`);
    }

    return event;
  }

  private nextSeq(input: { user_id: string; run_id: string }): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM run_events WHERE user_id = ? AND run_id = ?")
      .get(input.user_id, input.run_id);

    if (!isRecord(row) || typeof row.next_seq !== "number") {
      throw new Error(`Unable to allocate event seq for run: ${input.run_id}`);
    }

    return row.next_seq;
  }
}

export class ArtifactRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(input: CreateArtifactInput): ArtifactRecord {
    const createdAt = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO artifacts (
          id, user_id, session_id, run_id, type, name, mime_type,
          storage_path, preview_json, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        input.id,
        input.user_id,
        input.session_id,
        input.run_id,
        input.type,
        input.name,
        input.mime_type ?? null,
        input.storage_path ?? null,
        input.preview_json === undefined ? null : JSON.stringify(input.preview_json),
        input.metadata_json === undefined ? null : JSON.stringify(input.metadata_json),
        createdAt
      );

    return this.get({ user_id: input.user_id, artifact_id: input.id });
  }

  get(input: { user_id: string; artifact_id: string }): ArtifactRecord {
    const artifact = mapArtifactRow(
      this.db.prepare("SELECT * FROM artifacts WHERE user_id = ? AND id = ?").get(input.user_id, input.artifact_id)
    );

    if (!artifact) {
      throw new Error(`Artifact not found: ${input.artifact_id}`);
    }

    return artifact;
  }

  listByRun(input: { user_id: string; run_id: string }): ArtifactRecord[] {
    return this.db
      .prepare("SELECT * FROM artifacts WHERE user_id = ? AND run_id = ? ORDER BY created_at ASC")
      .all(input.user_id, input.run_id)
      .map(mapRequiredArtifactRow);
  }
}

export class SqlAuditLogRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(input: CreateSqlAuditLogInput): SqlAuditLogRecord {
    const createdAt = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO sql_audit_logs (
          id, user_id, run_id, datasource_id, sql_text, status,
          blocked_reason, row_count, elapsed_ms, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        input.id,
        input.user_id,
        input.run_id ?? null,
        input.datasource_id,
        input.sql_text,
        input.status,
        input.blocked_reason ?? null,
        input.row_count ?? null,
        input.elapsed_ms ?? null,
        createdAt
      );

    return this.get({ user_id: input.user_id, audit_log_id: input.id });
  }

  get(input: { user_id: string; audit_log_id: string }): SqlAuditLogRecord {
    const log = mapSqlAuditLogRow(
      this.db
        .prepare("SELECT * FROM sql_audit_logs WHERE user_id = ? AND id = ?")
        .get(input.user_id, input.audit_log_id)
    );

    if (!log) {
      throw new Error(`SQL audit log not found: ${input.audit_log_id}`);
    }

    return log;
  }

  listByRun(input: { user_id: string; run_id: string }): SqlAuditLogRecord[] {
    return this.db
      .prepare("SELECT * FROM sql_audit_logs WHERE user_id = ? AND run_id = ? ORDER BY created_at ASC")
      .all(input.user_id, input.run_id)
      .map(mapRequiredSqlAuditLogRow);
  }

  listByDataSource(input: { user_id: string; datasource_id: string }): SqlAuditLogRecord[] {
    return this.db
      .prepare("SELECT * FROM sql_audit_logs WHERE user_id = ? AND datasource_id = ? ORDER BY created_at ASC")
      .all(input.user_id, input.datasource_id)
      .map(mapRequiredSqlAuditLogRow);
  }
}

export class RunEventWriter {
  constructor(private readonly repository: RunEventRepository) {}

  write(input: WriteRunEventInput): RunEventEnvelope {
    const record = this.repository.append(input);

    return runEventRecordToEnvelope(record);
  }

  replay(input: { user_id: string; run_id: string }): RunEventEnvelope[] {
    return this.repository.listByRun(input).map(runEventRecordToEnvelope);
  }
}

export const createMetadataStore = (options: MetadataStoreOptions = {}): MetadataStore => {
  const databasePath = resolve(options.database_path ?? "storage/metadata/workbench.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);

  const store = new MetadataStore(db);
  store.users.upsertDevUser(options.dev_user ?? DEFAULT_DEV_USER);

  return store;
};

export const runEventRecordToEnvelope = (record: RunEventRecord): RunEventEnvelope => ({
  type: record.event_type,
  run_id: record.run_id,
  session_id: record.session_id,
  seq: record.seq,
  ts: record.created_at,
  event: JSON.parse(record.payload_json) as BaseEvent
});

export const artifactRecordToSummary = (record: ArtifactRecord): ArtifactSummary => ({
  id: record.id,
  type: record.type,
  name: record.name,
  ...(record.preview_json ? { preview_json: JSON.parse(record.preview_json) as unknown } : {})
});

const runMigrations = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      display_name TEXT,
      dev_token TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT,
      selected_datasource_id TEXT,
      selected_collection_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS data_sources (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config_json TEXT NOT NULL,
      credential_ref TEXT,
      description TEXT,
      status TEXT NOT NULL,
      last_test_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_data_sources_user ON data_sources(user_id);

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      parent_run_id TEXT,
      request_fingerprint TEXT,
      status TEXT NOT NULL,
      user_input TEXT NOT NULL,
      model_provider TEXT,
      model_name TEXT,
      datasource_id TEXT,
      collection_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error_message TEXT,
      PRIMARY KEY (user_id, id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (user_id, session_id) REFERENCES sessions(user_id, id),
      FOREIGN KEY (user_id, parent_run_id) REFERENCES runs(user_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_runs_user_session ON runs(user_id, session_id);

    CREATE TABLE IF NOT EXISTS run_events (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, run_id, seq),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (user_id, run_id) REFERENCES runs(user_id, id),
      FOREIGN KEY (user_id, session_id) REFERENCES sessions(user_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_user_run ON run_events(user_id, run_id);

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT,
      storage_path TEXT,
      preview_json TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (user_id, session_id) REFERENCES sessions(user_id, id),
      FOREIGN KEY (user_id, run_id) REFERENCES runs(user_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_user_run ON artifacts(user_id, run_id);

    CREATE TABLE IF NOT EXISTS sql_audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      run_id TEXT,
      datasource_id TEXT NOT NULL,
      sql_text TEXT NOT NULL,
      status TEXT NOT NULL,
      blocked_reason TEXT,
      row_count INTEGER,
      elapsed_ms INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (user_id, run_id) REFERENCES runs(user_id, id),
      FOREIGN KEY (datasource_id) REFERENCES data_sources(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sql_audit_logs_user_run ON sql_audit_logs(user_id, run_id);
    CREATE INDEX IF NOT EXISTS idx_sql_audit_logs_user_datasource ON sql_audit_logs(user_id, datasource_id);

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      resume_fingerprint TEXT,
      response_json TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      PRIMARY KEY (user_id, id),
      UNIQUE (user_id, run_id, tool_call_id),
      FOREIGN KEY (user_id, session_id) REFERENCES sessions(user_id, id),
      FOREIGN KEY (user_id, run_id) REFERENCES runs(user_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_interactions_user_run ON interactions(user_id, run_id);
  `);

  if (requiresUserScopedIdentityMigration(db)) {
    migrateUserScopedIdentity(db);
  }

  createMetadataIndexes(db);
};

const requiresUserScopedIdentityMigration = (db: DatabaseSync): boolean => {
  const primaryKeyColumns = db
    .prepare("PRAGMA table_info(sessions)")
    .all()
    .filter((row) => isRecord(row) && typeof row.pk === "number" && row.pk > 0)
    .sort((left, right) => Number((left as Record<string, unknown>).pk) - Number((right as Record<string, unknown>).pk))
    .map((row) => (row as Record<string, unknown>).name);

  return primaryKeyColumns.join(",") !== "user_id,id";
};

const migrateUserScopedIdentity = (db: DatabaseSync): void => {
  db.exec("PRAGMA foreign_keys = OFF");

  try {
    db.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE sessions_user_scoped (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT,
        selected_datasource_id TEXT,
        selected_collection_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE runs_user_scoped (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        parent_run_id TEXT,
        request_fingerprint TEXT,
        status TEXT NOT NULL,
        user_input TEXT NOT NULL,
        model_provider TEXT,
        model_name TEXT,
        datasource_id TEXT,
        collection_id TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error_message TEXT,
        PRIMARY KEY (user_id, id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (user_id, session_id) REFERENCES sessions_user_scoped(user_id, id),
        FOREIGN KEY (user_id, parent_run_id) REFERENCES runs_user_scoped(user_id, id)
      );

      CREATE TABLE run_events_user_scoped (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, run_id, seq),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (user_id, run_id) REFERENCES runs_user_scoped(user_id, id),
        FOREIGN KEY (user_id, session_id) REFERENCES sessions_user_scoped(user_id, id)
      );

      CREATE TABLE artifacts_user_scoped (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT,
        storage_path TEXT,
        preview_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (user_id, session_id) REFERENCES sessions_user_scoped(user_id, id),
        FOREIGN KEY (user_id, run_id) REFERENCES runs_user_scoped(user_id, id)
      );

      CREATE TABLE sql_audit_logs_user_scoped (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        run_id TEXT,
        datasource_id TEXT NOT NULL,
        sql_text TEXT NOT NULL,
        status TEXT NOT NULL,
        blocked_reason TEXT,
        row_count INTEGER,
        elapsed_ms INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (user_id, run_id) REFERENCES runs_user_scoped(user_id, id),
        FOREIGN KEY (datasource_id) REFERENCES data_sources(id)
      );

      INSERT INTO sessions_user_scoped SELECT * FROM sessions;
      INSERT INTO runs_user_scoped (
        id, user_id, session_id, status, user_input, model_provider, model_name,
        datasource_id, collection_id, started_at, finished_at, error_message
      )
      SELECT
        id, user_id, session_id, status, user_input, model_provider, model_name,
        datasource_id, collection_id, started_at, finished_at, error_message
      FROM runs;
      INSERT INTO run_events_user_scoped SELECT * FROM run_events;
      INSERT INTO artifacts_user_scoped SELECT * FROM artifacts;
      INSERT INTO sql_audit_logs_user_scoped SELECT * FROM sql_audit_logs;

      DROP TABLE run_events;
      DROP TABLE artifacts;
      DROP TABLE sql_audit_logs;
      DROP TABLE runs;
      DROP TABLE sessions;

      ALTER TABLE sessions_user_scoped RENAME TO sessions;
      ALTER TABLE runs_user_scoped RENAME TO runs;
      ALTER TABLE run_events_user_scoped RENAME TO run_events;
      ALTER TABLE artifacts_user_scoped RENAME TO artifacts;
      ALTER TABLE sql_audit_logs_user_scoped RENAME TO sql_audit_logs;

      COMMIT;
    `);
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The migration may have failed before opening the transaction.
    }
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }

  const violations = db.prepare("PRAGMA foreign_key_check").all();

  if (violations.length > 0) {
    throw new Error(`Metadata identity migration produced ${violations.length} foreign key violation(s)`);
  }
};

const createMetadataIndexes = (db: DatabaseSync): void => {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_data_sources_user ON data_sources(user_id);
    CREATE INDEX IF NOT EXISTS idx_runs_user_session ON runs(user_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_run_events_user_run ON run_events(user_id, run_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_user_run ON artifacts(user_id, run_id);
    CREATE INDEX IF NOT EXISTS idx_sql_audit_logs_user_run ON sql_audit_logs(user_id, run_id);
    CREATE INDEX IF NOT EXISTS idx_sql_audit_logs_user_datasource ON sql_audit_logs(user_id, datasource_id);
  `);
};

type Optional<T> = T | undefined;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const optionalString = (value: unknown): Optional<string> => (typeof value === "string" ? value : undefined);

const optionalNumber = (value: unknown): Optional<number> => (typeof value === "number" ? value : undefined);

const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];

  if (typeof value !== "string") {
    throw new Error(`Expected string column: ${key}`);
  }

  return value;
};

const requiredNumber = (row: Record<string, unknown>, key: string): number => {
  const value = row[key];

  if (typeof value !== "number") {
    throw new Error(`Expected number column: ${key}`);
  }

  return value;
};

const mapUserRow = (row: unknown): Optional<UserRecord> => {
  if (!isRecord(row)) {
    return undefined;
  }

  const email = optionalString(row.email);
  const displayName = optionalString(row.display_name);
  const devToken = optionalString(row.dev_token);

  return {
    id: requiredString(row, "id"),
    ...(email ? { email } : {}),
    ...(displayName ? { display_name: displayName } : {}),
    ...(devToken ? { dev_token: devToken } : {}),
    created_at: requiredString(row, "created_at"),
    updated_at: requiredString(row, "updated_at")
  };
};

const mapSessionRow = (row: unknown): Optional<SessionRecord> => {
  if (!isRecord(row)) {
    return undefined;
  }

  const title = optionalString(row.title);
  const selectedDatasourceId = optionalString(row.selected_datasource_id);
  const selectedCollectionId = optionalString(row.selected_collection_id);

  return {
    id: requiredString(row, "id"),
    user_id: requiredString(row, "user_id"),
    ...(title ? { title } : {}),
    ...(selectedDatasourceId ? { selected_datasource_id: selectedDatasourceId } : {}),
    ...(selectedCollectionId ? { selected_collection_id: selectedCollectionId } : {}),
    created_at: requiredString(row, "created_at"),
    updated_at: requiredString(row, "updated_at")
  };
};

const mapRequiredSessionRow = (row: unknown): SessionRecord => {
  const session = mapSessionRow(row);

  if (!session) {
    throw new Error("Invalid session row");
  }

  return session;
};

const mapRunRow = (row: unknown): Optional<RunRecord> => {
  if (!isRecord(row)) {
    return undefined;
  }

  const modelProvider = optionalString(row.model_provider);
  const modelName = optionalString(row.model_name);
  const parentRunId = optionalString(row.parent_run_id);
  const requestFingerprint = optionalString(row.request_fingerprint);
  const datasourceId = optionalString(row.datasource_id);
  const collectionId = optionalString(row.collection_id);
  const finishedAt = optionalString(row.finished_at);
  const errorMessage = optionalString(row.error_message);

  return {
    id: requiredString(row, "id"),
    user_id: requiredString(row, "user_id"),
    session_id: requiredString(row, "session_id"),
    ...(parentRunId ? { parent_run_id: parentRunId } : {}),
    ...(requestFingerprint ? { request_fingerprint: requestFingerprint } : {}),
    status: requiredString(row, "status") as RunRecord["status"],
    user_input: requiredString(row, "user_input"),
    ...(modelProvider ? { model_provider: modelProvider } : {}),
    ...(modelName ? { model_name: modelName } : {}),
    ...(datasourceId ? { datasource_id: datasourceId } : {}),
    ...(collectionId ? { collection_id: collectionId } : {}),
    started_at: requiredString(row, "started_at"),
    ...(finishedAt ? { finished_at: finishedAt } : {}),
    ...(errorMessage ? { error_message: errorMessage } : {})
  };
};

const mapInteractionRow = (row: unknown): Optional<InteractionRecord> => {
  if (!isRecord(row)) {
    return undefined;
  }
  const resumeFingerprint = optionalString(row.resume_fingerprint);
  const responseJson = optionalString(row.response_json);
  const resolvedAt = optionalString(row.resolved_at);
  return {
    id: requiredString(row, "id"),
    user_id: requiredString(row, "user_id"),
    session_id: requiredString(row, "session_id"),
    run_id: requiredString(row, "run_id"),
    tool_call_id: requiredString(row, "tool_call_id"),
    tool_name: requiredString(row, "tool_name") as InteractionRecord["tool_name"],
    payload_json: requiredString(row, "payload_json"),
    status: requiredString(row, "status") as InteractionRecord["status"],
    ...(resumeFingerprint ? { resume_fingerprint: resumeFingerprint } : {}),
    ...(responseJson ? { response_json: responseJson } : {}),
    created_at: requiredString(row, "created_at"),
    ...(resolvedAt ? { resolved_at: resolvedAt } : {})
  };
};

const mapDataSourceRow = (row: unknown): Optional<DataSourceRecord> => {
  if (!isRecord(row)) {
    return undefined;
  }

  const credentialRef = optionalString(row.credential_ref);
  const description = optionalString(row.description);
  const lastTestAt = optionalString(row.last_test_at);

  return {
    id: requiredString(row, "id"),
    user_id: requiredString(row, "user_id"),
    name: requiredString(row, "name"),
    type: requiredString(row, "type"),
    config_json: requiredString(row, "config_json"),
    ...(credentialRef ? { credential_ref: credentialRef } : {}),
    ...(description ? { description } : {}),
    status: requiredString(row, "status") as DataSourceRecord["status"],
    ...(lastTestAt ? { last_test_at: lastTestAt } : {}),
    created_at: requiredString(row, "created_at"),
    updated_at: requiredString(row, "updated_at")
  };
};

const mapRequiredDataSourceRow = (row: unknown): DataSourceRecord => {
  const dataSource = mapDataSourceRow(row);

  if (!dataSource) {
    throw new Error("Invalid data source row");
  }

  return dataSource;
};

const mapRunEventRow = (row: unknown): Optional<RunEventRecord> => {
  if (!isRecord(row)) {
    return undefined;
  }

  return {
    id: requiredString(row, "id"),
    user_id: requiredString(row, "user_id"),
    run_id: requiredString(row, "run_id"),
    session_id: requiredString(row, "session_id"),
    seq: requiredNumber(row, "seq"),
    event_type: requiredString(row, "event_type") as EventType,
    payload_json: requiredString(row, "payload_json"),
    created_at: requiredString(row, "created_at")
  };
};

const mapRequiredRunEventRow = (row: unknown): RunEventRecord => {
  const event = mapRunEventRow(row);

  if (!event) {
    throw new Error("Invalid run event row");
  }

  return event;
};

const mapArtifactRow = (row: unknown): Optional<ArtifactRecord> => {
  if (!isRecord(row)) {
    return undefined;
  }

  const mimeType = optionalString(row.mime_type);
  const storagePath = optionalString(row.storage_path);
  const previewJson = optionalString(row.preview_json);
  const metadataJson = optionalString(row.metadata_json);

  return {
    id: requiredString(row, "id"),
    user_id: requiredString(row, "user_id"),
    session_id: requiredString(row, "session_id"),
    run_id: requiredString(row, "run_id"),
    type: requiredString(row, "type") as ArtifactType,
    name: requiredString(row, "name"),
    ...(mimeType ? { mime_type: mimeType } : {}),
    ...(storagePath ? { storage_path: storagePath } : {}),
    ...(previewJson ? { preview_json: previewJson } : {}),
    ...(metadataJson ? { metadata_json: metadataJson } : {}),
    created_at: requiredString(row, "created_at")
  };
};

const mapSqlAuditLogRow = (row: unknown): Optional<SqlAuditLogRecord> => {
  if (!isRecord(row)) {
    return undefined;
  }

  const runId = optionalString(row.run_id);
  const blockedReason = optionalString(row.blocked_reason);
  const rowCount = optionalNumber(row.row_count);
  const elapsedMs = optionalNumber(row.elapsed_ms);

  return {
    id: requiredString(row, "id"),
    user_id: requiredString(row, "user_id"),
    ...(runId ? { run_id: runId } : {}),
    datasource_id: requiredString(row, "datasource_id"),
    sql_text: requiredString(row, "sql_text"),
    status: requiredString(row, "status") as SqlAuditLogRecord["status"],
    ...(blockedReason ? { blocked_reason: blockedReason } : {}),
    ...(rowCount !== undefined ? { row_count: rowCount } : {}),
    ...(elapsedMs !== undefined ? { elapsed_ms: elapsedMs } : {}),
    created_at: requiredString(row, "created_at")
  };
};

const mapRequiredSqlAuditLogRow = (row: unknown): SqlAuditLogRecord => {
  const log = mapSqlAuditLogRow(row);

  if (!log) {
    throw new Error("Invalid SQL audit log row");
  }

  return log;
};

const mapRequiredArtifactRow = (row: unknown): ArtifactRecord => {
  const artifact = mapArtifactRow(row);

  if (!artifact) {
    throw new Error("Invalid artifact row");
  }

  return artifact;
};
