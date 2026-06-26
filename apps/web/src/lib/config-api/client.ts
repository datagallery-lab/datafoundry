import type {
  ApiResult,
  ArtifactDto,
  BackendCapabilitiesResponse,
  DatasourceDto,
  DatasourceTypeDto,
  FileAssetRefDto,
  JobDto,
  KnowledgeBaseDto,
  McpServerDto,
  ModelProfileDto,
  RunDefaultsDto,
  SessionConversationDto,
  SkillDto,
  WorkspaceConfigDto,
} from "./types";
import { ConfigApiError as ConfigApiErrorClass } from "./types";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";

export function getConfigApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_CONFIG_API_URL ??
    process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL?.replace(/\/api\/copilotkit\/?$/u, "") ??
    DEFAULT_BASE_URL
  ).replace(/\/$/u, "");
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new ConfigApiErrorClass("INTERNAL_ERROR", "Empty response body", response.status);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConfigApiErrorClass(
      "INTERNAL_ERROR",
      `Invalid JSON response (${response.status})`,
      response.status,
    );
  }
  return parsed as T;
}

async function requestEnvelope<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const baseUrl = getConfigApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  const envelope = await parseJsonResponse<ApiResult<T>>(response);
  if (!envelope.success) {
    throw new ConfigApiErrorClass(
      envelope.error.code,
      envelope.error.message,
      response.status,
    );
  }
  return envelope.data;
}

async function requestRaw(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = getConfigApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    const text = await response.text();
    throw new ConfigApiErrorClass(
      "INTERNAL_ERROR",
      text || `Request failed (${response.status})`,
      response.status,
    );
  }
  return response;
}

export const configApi = {
  getCapabilities(): Promise<BackendCapabilitiesResponse> {
    return requestEnvelope<BackendCapabilitiesResponse>("/api/v1/capabilities");
  },

  getWorkspaceConfig(): Promise<WorkspaceConfigDto> {
    return requestEnvelope<WorkspaceConfigDto>("/api/v1/workspace-config");
  },

  getRunDefaults(): Promise<RunDefaultsDto> {
    return requestEnvelope<RunDefaultsDto>("/api/v1/run-defaults");
  },

  async uploadChatFile(
    file: File,
    sessionId?: string | null,
  ): Promise<{ path: string; mimeType: string; size: number }> {
    const form = new FormData();
    form.append("file", file);
    if (sessionId) {
      form.append("sessionId", sessionId);
      form.append("threadId", sessionId);
    }
    const response = await requestRaw("/api/v1/chat/uploads", {
      method: "POST",
      body: form,
    });
    return parseJsonResponse<{ path: string; mimeType: string; size: number }>(
      response,
    );
  },

  getSessionConversation(sessionId: string, limit?: number): Promise<SessionConversationDto> {
    const params = new URLSearchParams();
    if (limit !== undefined) {
      params.set("limit", String(limit));
    }
    const query = params.toString();
    return requestEnvelope<SessionConversationDto>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/conversation${query ? `?${query}` : ""}`,
    );
  },

  listDatasourceTypes(): Promise<DatasourceTypeDto[]> {
    return requestEnvelope<DatasourceTypeDto[]>("/api/v1/datasource-types");
  },

  createDatasource(body: Record<string, unknown>): Promise<DatasourceDto> {
    return requestEnvelope<DatasourceDto>("/api/v1/datasources", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  patchDatasource(id: string, body: Record<string, unknown>): Promise<DatasourceDto> {
    return requestEnvelope<DatasourceDto>(`/api/v1/datasources/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteDatasource(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/datasources/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  testDatasource(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/datasources/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  },

  introspectDatasource(id: string, idempotencyKey?: string): Promise<JobDto> {
    return requestEnvelope<JobDto>(`/api/v1/datasources/${encodeURIComponent(id)}/introspect`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    });
  },

  createKnowledgeBase(body: Record<string, unknown>): Promise<KnowledgeBaseDto> {
    return requestEnvelope<KnowledgeBaseDto>("/api/v1/knowledge-bases", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  patchKnowledgeBase(id: string, body: Record<string, unknown>): Promise<KnowledgeBaseDto> {
    return requestEnvelope<KnowledgeBaseDto>(
      `/api/v1/knowledge-bases/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },

  deleteKnowledgeBase(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/knowledge-bases/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  testKnowledgeBase(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/knowledge-bases/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  },

  uploadKnowledgeFile(
    id: string,
    file: File,
  ): Promise<Record<string, unknown>> {
    const form = new FormData();
    form.append("file", file);
    return requestEnvelope(`/api/v1/knowledge-bases/${encodeURIComponent(id)}/files`, {
      method: "POST",
      body: form,
    });
  },

  reindexKnowledgeBase(id: string, idempotencyKey?: string): Promise<JobDto> {
    return requestEnvelope<JobDto>(
      `/api/v1/knowledge-bases/${encodeURIComponent(id)}/reindex`,
      {
        method: "POST",
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      },
    );
  },

  createMcpServer(body: Record<string, unknown>): Promise<McpServerDto> {
    return requestEnvelope<McpServerDto>("/api/v1/mcp-servers", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  patchMcpServer(id: string, body: Record<string, unknown>): Promise<McpServerDto> {
    return requestEnvelope<McpServerDto>(`/api/v1/mcp-servers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteMcpServer(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/mcp-servers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  testMcpServer(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/mcp-servers/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  },

  getMcpTools(id: string): Promise<Array<Record<string, unknown>>> {
    return requestEnvelope(`/api/v1/mcp-servers/${encodeURIComponent(id)}/tools`);
  },

  createModelProfile(body: Record<string, unknown>): Promise<ModelProfileDto> {
    return requestEnvelope<ModelProfileDto>("/api/v1/model-profiles", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  patchModelProfile(id: string, body: Record<string, unknown>): Promise<ModelProfileDto> {
    return requestEnvelope<ModelProfileDto>(
      `/api/v1/model-profiles/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },

  deleteModelProfile(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/model-profiles/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  testModelProfile(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/model-profiles/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  },

  createSkill(form: FormData): Promise<SkillDto> {
    return requestEnvelope<SkillDto>("/api/v1/skills", {
      method: "POST",
      body: form,
    });
  },

  patchSkill(id: string, body: Record<string, unknown>): Promise<SkillDto> {
    return requestEnvelope<SkillDto>(`/api/v1/skills/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteSkill(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/skills/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  testSkill(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/skills/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  },

  validateSkill(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/skills/${encodeURIComponent(id)}/validate`, {
      method: "POST",
    });
  },

  replaceSkill(id: string, form: FormData): Promise<SkillDto> {
    return requestEnvelope<SkillDto>(`/api/v1/skills/${encodeURIComponent(id)}/replace`, {
      method: "POST",
      body: form,
    });
  },

  getJob(id: string): Promise<JobDto> {
    return requestEnvelope<JobDto>(`/api/v1/jobs/${encodeURIComponent(id)}`);
  },

  cancelJob(id: string): Promise<JobDto> {
    return requestEnvelope<JobDto>(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
  },

  getArtifact(id: string): Promise<ArtifactDto> {
    return requestEnvelope<ArtifactDto>(`/api/v1/artifacts/${encodeURIComponent(id)}`);
  },

  getArtifactPreview(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/artifacts/${encodeURIComponent(id)}/preview`);
  },

  listSessionArtifacts(sessionId: string): Promise<{ artifacts: ArtifactDto[] }> {
    const params = new URLSearchParams({ sessionId });
    return requestEnvelope<{ artifacts: ArtifactDto[] }>(`/api/v1/artifacts?${params.toString()}`);
  },

  promoteArtifact(id: string): Promise<FileAssetRefDto> {
    return requestEnvelope<FileAssetRefDto>(`/api/v1/artifacts/${encodeURIComponent(id)}/promote`, {
      method: "POST",
    });
  },

  async downloadArtifact(id: string): Promise<{ blob: Blob; filename: string }> {
    const response = await requestRaw(`/api/v1/artifacts/${encodeURIComponent(id)}/download`);
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/u.exec(disposition);
    const filename = match?.[1] ?? `artifact-${id}`;
    const blob = await response.blob();
    return { blob, filename };
  },

  listWorkspaceFiles(): Promise<{ files: FileAssetRefDto[] }> {
    return requestEnvelope<{ files: FileAssetRefDto[] }>("/api/v1/files");
  },

  async uploadWorkspaceFiles(files: File[]): Promise<{ files: FileAssetRefDto[] }> {
    const form = new FormData();
    for (const file of files) {
      form.append("file", file);
    }
    return requestEnvelope<{ files: FileAssetRefDto[] }>("/api/v1/files", {
      method: "POST",
      body: form,
    });
  },

  async downloadWorkspaceFile(id: string): Promise<{ blob: Blob; filename: string }> {
    const response = await requestRaw(`/api/v1/files/${encodeURIComponent(id)}/download`);
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/u.exec(disposition);
    const filename = match?.[1] ?? `file-${id}`;
    const blob = await response.blob();
    return { blob, filename };
  },

  deleteWorkspaceFile(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/files/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};

export { ConfigApiError } from "./types";
