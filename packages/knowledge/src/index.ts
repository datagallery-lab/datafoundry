import type { Citation } from "@open-data-agent/contracts";
import type { MetadataStore } from "@open-data-agent/metadata";
import { randomUUID } from "node:crypto";

export type KnowledgeCollection = {
  id: string;
  user_id: string;
  name: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dim: number;
  status: "ready" | "indexing" | "failed";
};

export type DocumentRecord = {
  id: string;
  user_id: string;
  collection_id: string;
  filename: string;
  file_asset_ref_id?: string;
  mime_type: string;
  status: "uploaded" | "parsing" | "indexing" | "ready" | "failed" | "deleted";
};

export type RetrieveKnowledgeInput = {
  user_id: string;
  collection_id: string;
  query: string;
  top_k?: number;
};

export type RetrievedChunk = Citation & {
  content: string;
};

export type EmbeddingConfig = {
  api_key?: string;
  base_url: string;
  model: string;
  provider: string;
};

export type LocalKnowledgeServiceOptions = {
  embedding?: EmbeddingConfig;
};

export interface KnowledgeService {
  retrieve(input: RetrieveKnowledgeInput): Promise<RetrievedChunk[]>;
}

export class LocalKnowledgeService implements KnowledgeService {
  constructor(
    private readonly metadataStore: MetadataStore,
    private readonly options: LocalKnowledgeServiceOptions = {}
  ) {
    this.initializeSchema();
    this.ensureDocumentFileAssetRefColumn();
  }

  /** Store one text document as bounded searchable chunks. */
  async ingestText(input: {
    user_id: string;
    collection_id: string;
    filename: string;
    content: string;
    file_asset_ref_id?: string;
    mime_type?: string;
  }): Promise<DocumentRecord> {
    if (!input.content.trim()) {
      throw new Error("KNOWLEDGE_DOCUMENT_EMPTY");
    }
    const documentId = randomUUID();
    const now = new Date().toISOString();
    this.metadataStore.db.prepare(`
      INSERT INTO knowledge_documents (id, user_id, collection_id, filename, mime_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'indexing', ?, ?)
    `).run(
      documentId,
      input.user_id,
      input.collection_id,
      input.filename,
      input.mime_type ?? "text/plain",
      now,
      now
    );
    if (input.file_asset_ref_id) {
      this.metadataStore.db.prepare(`
        UPDATE knowledge_documents SET file_asset_ref_id = ? WHERE user_id = ? AND id = ?
      `).run(input.file_asset_ref_id, input.user_id, documentId);
    }
    const chunks = splitText(input.content);
    chunks.forEach((content, index) => {
      this.metadataStore.db.prepare(`
        INSERT INTO knowledge_chunks (
          id, user_id, collection_id, document_id, filename, chunk_index, content
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), input.user_id, input.collection_id, documentId, input.filename, index, content);
    });
    const embedding = this.resolveEmbeddingConfig(input.user_id, input.collection_id);
    try {
      if (embedding?.api_key) {
        await this.indexDocumentChunks({
          user_id: input.user_id,
          collection_id: input.collection_id,
          document_id: documentId,
          filename: input.filename,
          chunks,
          embedding
        });
      }
    } catch (error) {
      this.metadataStore.db.prepare(
        "DELETE FROM knowledge_embeddings WHERE user_id = ? AND document_id = ?"
      ).run(input.user_id, documentId);
      this.metadataStore.db.prepare(`
        UPDATE knowledge_documents SET status = 'failed', updated_at = ? WHERE user_id = ? AND id = ?
      `).run(new Date().toISOString(), input.user_id, documentId);
      throw error;
    }
    this.metadataStore.db.prepare(`
      UPDATE knowledge_documents SET status = 'ready', updated_at = ? WHERE user_id = ? AND id = ?
    `).run(new Date().toISOString(), input.user_id, documentId);
    return this.getDocument({ user_id: input.user_id, document_id: documentId });
  }

  /** Retrieve the most relevant local full-text chunks with citations. */
  async retrieve(input: RetrieveKnowledgeInput): Promise<RetrievedChunk[]> {
    const embedding = this.resolveEmbeddingConfig(input.user_id, input.collection_id);
    if (embedding?.api_key && this.hasVectorIndex(input.user_id, input.collection_id)) {
      return this.retrieveByVector(input, embedding);
    }
    return this.retrieveByFullText(input);
  }

  /** Rebuild vector entries for every current document in one collection. */
  async reindex(input: { user_id: string; collection_id: string }): Promise<{ chunks: number; mode: string }> {
    const embedding = this.resolveEmbeddingConfig(input.user_id, input.collection_id);
    this.metadataStore.db.prepare(
      "DELETE FROM knowledge_embeddings WHERE user_id = ? AND collection_id = ?"
    ).run(input.user_id, input.collection_id);
    if (!embedding?.api_key) {
      return { chunks: 0, mode: "fts" };
    }
    const rows = this.metadataStore.db.prepare(`
      SELECT id, document_id, filename, content FROM knowledge_chunks WHERE user_id = ? AND collection_id = ?
      ORDER BY document_id, chunk_index
    `).all(input.user_id, input.collection_id).filter(isRecord);
    await this.indexRows(input.user_id, input.collection_id, rows, embedding);
    return { chunks: rows.length, mode: "vector" };
  }

  private retrieveByFullText(input: RetrieveKnowledgeInput): RetrievedChunk[] {
    const terms = tokenizeQuery(input.query);
    if (!terms) {
      return [];
    }
    const topK = Math.max(1, Math.min(input.top_k ?? 5, 20));
    const rows = this.metadataStore.db.prepare(`
      SELECT id, document_id, filename, content, bm25(knowledge_chunks) AS rank
      FROM knowledge_chunks
      WHERE knowledge_chunks MATCH ? AND user_id = ? AND collection_id = ?
      ORDER BY rank ASC
      LIMIT ?
    `).all(terms, input.user_id, input.collection_id, topK);
    return rows.filter(isRecord).map((row) => ({
      document_id: requiredString(row, "document_id"),
      chunk_id: requiredString(row, "id"),
      filename: requiredString(row, "filename"),
      quote: requiredString(row, "content").slice(0, 500),
      content: requiredString(row, "content"),
      score: rankToScore(row.rank)
    }));
  }

  private async retrieveByVector(
    input: RetrieveKnowledgeInput,
    embedding: EmbeddingConfig
  ): Promise<RetrievedChunk[]> {
    const [queryVector] = await requestEmbeddings([input.query], embedding);
    if (!queryVector) {
      return [];
    }
    const topK = Math.max(1, Math.min(input.top_k ?? 5, 20));
    const rows = this.metadataStore.db.prepare(`
      SELECT chunk_id, document_id, filename, content, vector_json FROM knowledge_embeddings
      WHERE user_id = ? AND collection_id = ?
    `).all(input.user_id, input.collection_id).filter(isRecord);
    return rows.map((row) => ({
      document_id: requiredString(row, "document_id"),
      chunk_id: requiredString(row, "chunk_id"),
      filename: requiredString(row, "filename"),
      quote: requiredString(row, "content").slice(0, 500),
      content: requiredString(row, "content"),
      score: cosineSimilarity(queryVector, parseVector(row.vector_json))
    })).sort((left, right) => right.score - left.score).slice(0, topK);
  }

  private hasVectorIndex(userId: string, collectionId: string): boolean {
    const row = this.metadataStore.db.prepare(`
      SELECT 1 AS present FROM knowledge_embeddings WHERE user_id = ? AND collection_id = ? LIMIT 1
    `).get(userId, collectionId);
    return isRecord(row);
  }

  private resolveEmbeddingConfig(userId: string, collectionId: string): EmbeddingConfig | undefined {
    const resource = this.metadataStore.configResources.find({
      id: collectionId,
      workspace_id: "default",
      user_id: userId,
      kind: "knowledge-base"
    });
    const payload = resource?.payload ?? {};
    const secret = resource?.secret_ref
      ? this.metadataStore.secrets.get({ ref: resource.secret_ref, workspace_id: "default", user_id: userId })
      : {};
    const fallback = this.options.embedding;
    const apiKey = optionalString(secret.apiKey) ?? optionalString(secret.api_key) ?? fallback?.api_key;
    const baseUrl = optionalString(payload.embeddingBaseUrl) ?? optionalString(payload.baseUrl) ?? fallback?.base_url;
    const model = optionalString(payload.embeddingModel) ?? fallback?.model;
    const provider = optionalString(payload.embeddingProvider) ?? fallback?.provider;
    if (!baseUrl || !model || !provider) {
      return undefined;
    }
    return { ...(apiKey ? { api_key: apiKey } : {}), base_url: baseUrl, model, provider };
  }

  private async indexDocumentChunks(input: {
    user_id: string;
    collection_id: string;
    document_id: string;
    filename: string;
    chunks: string[];
    embedding: EmbeddingConfig;
  }): Promise<void> {
    const rows = input.chunks.map((content, index) => ({
      id: this.findChunkId(input.user_id, input.document_id, index),
      document_id: input.document_id,
      filename: input.filename,
      content
    }));
    await this.indexRows(input.user_id, input.collection_id, rows, input.embedding);
  }

  private async indexRows(
    userId: string,
    collectionId: string,
    rows: Record<string, unknown>[],
    embedding: EmbeddingConfig
  ): Promise<void> {
    for (let offset = 0; offset < rows.length; offset += 32) {
      const batch = rows.slice(offset, offset + 32);
      const vectors = await requestEmbeddings(batch.map((row) => requiredString(row, "content")), embedding);
      batch.forEach((row, index) => {
        const vector = vectors[index];
        if (!vector) {
          throw new Error("EMBEDDING_RESPONSE_COUNT_MISMATCH");
        }
        this.metadataStore.db.prepare(`
          INSERT INTO knowledge_embeddings (
            chunk_id, user_id, collection_id, document_id, filename, content, vector_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          requiredString(row, "id"),
          userId,
          collectionId,
          requiredString(row, "document_id"),
          requiredString(row, "filename"),
          requiredString(row, "content"),
          JSON.stringify(vector),
          new Date().toISOString()
        );
      });
    }
  }

  private findChunkId(userId: string, documentId: string, index: number): string {
    const row = this.metadataStore.db.prepare(`
      SELECT id FROM knowledge_chunks WHERE user_id = ? AND document_id = ? AND chunk_index = ?
    `).get(userId, documentId, index);
    if (!isRecord(row)) {
      throw new Error(`KNOWLEDGE_CHUNK_NOT_FOUND:${documentId}:${index}`);
    }
    return requiredString(row, "id");
  }

  /** List documents in one knowledge collection. */
  listDocuments(input: { user_id: string; collection_id: string }): DocumentRecord[] {
    return this.metadataStore.db.prepare(`
      SELECT * FROM knowledge_documents WHERE user_id = ? AND collection_id = ? ORDER BY created_at DESC
    `).all(input.user_id, input.collection_id).filter(isRecord).map(mapDocument);
  }

  private getDocument(input: { user_id: string; document_id: string }): DocumentRecord {
    const row = this.metadataStore.db.prepare(
      "SELECT * FROM knowledge_documents WHERE user_id = ? AND id = ?"
    ).get(input.user_id, input.document_id);
    if (!isRecord(row)) {
      throw new Error(`KNOWLEDGE_DOCUMENT_NOT_FOUND:${input.document_id}`);
    }
    return mapDocument(row);
  }

  private initializeSchema(): void {
    this.metadataStore.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_asset_ref_id TEXT,
        mime_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_documents_scope
        ON knowledge_documents(user_id, collection_id, created_at DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks USING fts5(
        id UNINDEXED,
        user_id UNINDEXED,
        collection_id UNINDEXED,
        document_id UNINDEXED,
        filename UNINDEXED,
        chunk_index UNINDEXED,
        content,
        tokenize = 'unicode61'
      );
      CREATE TABLE IF NOT EXISTS knowledge_embeddings (
        chunk_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        content TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_scope
        ON knowledge_embeddings(user_id, collection_id);
    `);
  }

  private ensureDocumentFileAssetRefColumn(): void {
    const hasColumn = this.metadataStore.db.prepare("PRAGMA table_info(knowledge_documents)").all()
      .some((row) => isRecord(row) && row.name === "file_asset_ref_id");
    if (!hasColumn) {
      this.metadataStore.db.exec("ALTER TABLE knowledge_documents ADD COLUMN file_asset_ref_id TEXT");
    }
  }
}

const splitText = (content: string): string[] => {
  const paragraphs = content.split(/\n\s*\n/gu).map((value) => value.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  paragraphs.forEach((paragraph) => {
    if (current && current.length + paragraph.length + 2 > 1600) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  });
  if (current) {
    chunks.push(current);
  }
  return chunks.flatMap((chunk) => chunk.length <= 2000
    ? [chunk]
    : Array.from({ length: Math.ceil(chunk.length / 1800) }, (_, index) => chunk.slice(index * 1800, (index + 1) * 1800)));
};

const tokenizeQuery = (query: string): string => query
  .trim()
  .split(/[^\p{L}\p{N}_-]+/gu)
  .filter((value) => value.length > 1)
  .slice(0, 12)
  .map((value) => `"${value.replaceAll('"', '""')}"`)
  .join(" OR ");

const mapDocument = (row: Record<string, unknown>): DocumentRecord => {
  const fileAssetRefId = optionalString(row.file_asset_ref_id);
  return {
    id: requiredString(row, "id"),
    user_id: requiredString(row, "user_id"),
    collection_id: requiredString(row, "collection_id"),
    filename: requiredString(row, "filename"),
    ...(fileAssetRefId ? { file_asset_ref_id: fileAssetRefId } : {}),
    mime_type: requiredString(row, "mime_type"),
    status: requiredString(row, "status") as DocumentRecord["status"]
  };
};

const rankToScore = (value: unknown): number => typeof value === "number" ? 1 / (1 + Math.abs(value)) : 0;
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`KNOWLEDGE_COLUMN_INVALID:${key}`);
  }
  return value;
};

const requestEmbeddings = async (texts: string[], config: EmbeddingConfig): Promise<number[][]> => {
  if (!config.api_key) {
    throw new Error("EMBEDDING_API_KEY_REQUIRED");
  }
  const response = await fetch(`${config.base_url.replace(/\/$/u, "")}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input: texts, model: config.model })
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`EMBEDDING_REQUEST_FAILED:${response.status}:${detail}`);
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("EMBEDDING_RESPONSE_INVALID");
  }
  return payload.data.filter(isRecord).sort((left, right) => numberValue(left.index) - numberValue(right.index))
    .map((item) => parseVector(item.embedding));
};

const parseVector = (value: unknown): number[] => {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((item) => typeof item === "number")) {
    throw new Error("EMBEDDING_VECTOR_INVALID");
  }
  return parsed;
};

const cosineSimilarity = (left: number[], right: number[]): number => {
  if (left.length !== right.length) {
    throw new Error("EMBEDDING_DIMENSION_MISMATCH");
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  left.forEach((value, index) => {
    const other = right[index] ?? 0;
    dot += value * other;
    leftNorm += value * value;
    rightNorm += other * other;
  });
  return leftNorm > 0 && rightNorm > 0 ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
};

const numberValue = (value: unknown): number => typeof value === "number" && Number.isFinite(value) ? value : 0;
