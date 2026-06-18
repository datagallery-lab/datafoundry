import type { Citation } from "@open-data-agent/contracts";

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

export interface KnowledgeService {
  retrieve(input: RetrieveKnowledgeInput): Promise<RetrievedChunk[]>;
}
