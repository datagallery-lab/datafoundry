"use client";

import { useCallback, useEffect, useState } from "react";
import {
  applyBackendCapabilities,
  configApi,
  ConfigApiError,
  getRuntimeCapabilities,
  itemToCreateBody,
  itemToPatchBody,
  mergeItemFromDto,
  workspaceConfigDtoToStore,
} from "../../../lib/config-api";
import type { JobDto, RunDefaultsDto } from "../../../lib/config-api";
import {
  createWorkspaceConfigItem,
  defaultWorkspaceConfig,
  setLiveBackendCapabilities,
  setLiveDatasourceTypes,
  setLiveMentionSupport,
  setLivePendingCapabilities,
  type WorkspaceConfigItem,
  type WorkspaceConfigKind,
  type WorkspaceConfigStore,
} from "../data-task-state";

export type WorkspaceApiState = {
  workspaceConfig: WorkspaceConfigStore;
  runDefaults: RunDefaultsDto | null;
  loading: boolean;
  error: string | null;
  capabilitiesReady: boolean;
};

export type WorkspaceApiActions = {
  refresh: () => Promise<void>;
  patchLocalItem: (
    kind: WorkspaceConfigKind,
    itemId: string,
    patch: Partial<
      Pick<WorkspaceConfigItem, "name" | "description" | "enabled" | "settings">
    >,
  ) => void;
  createItem: (
    kind: WorkspaceConfigKind,
    item: WorkspaceConfigItem,
    skillFile?: File,
  ) => Promise<string>;
  updateItem: (
    kind: WorkspaceConfigKind,
    item: WorkspaceConfigItem,
    previous?: WorkspaceConfigItem,
  ) => Promise<void>;
  deleteItem: (kind: WorkspaceConfigKind, itemId: string) => Promise<void>;
  testItem: (kind: WorkspaceConfigKind, itemId: string) => Promise<Record<string, unknown>>;
  introspectDatasource: (itemId: string) => Promise<JobDto>;
  reindexKnowledgeBase: (itemId: string) => Promise<JobDto>;
  uploadKnowledgeFile: (itemId: string, file: File) => Promise<void>;
  replaceSkillPackage: (itemId: string, file: File) => Promise<void>;
  validateSkill: (itemId: string) => Promise<void>;
  pollJob: (
    jobId: string,
    onUpdate?: (job: JobDto) => void,
  ) => Promise<JobDto>;
  cancelJob: (jobId: string) => Promise<JobDto>;
};

function mentionSupportFromCapabilities(): Record<
  "db" | "kb" | "mcp" | "skill",
  boolean
> {
  const runtime = getRuntimeCapabilities();
  return {
    db: true,
    kb: runtime.knowledge,
    mcp: runtime.mcp,
    skill: runtime.skills,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function useWorkspaceConfigApi(): WorkspaceApiState & WorkspaceApiActions {
  const [workspaceConfig, setWorkspaceConfig] = useState<WorkspaceConfigStore>(
    defaultWorkspaceConfig,
  );
  const [runDefaults, setRunDefaults] = useState<RunDefaultsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capabilitiesReady, setCapabilitiesReady] = useState(false);

  const applyCapabilities = useCallback(async () => {
    const caps = await configApi.getCapabilities();
    const mapped = applyBackendCapabilities(caps);
    setLiveBackendCapabilities(mapped);
    setLivePendingCapabilities({
      "datasource.fieldMasking": caps["datasource.fieldMasking"] ?? false,
      "datasource.introspectionPolicy": caps["datasource.introspectionPolicy"] ?? false,
      "datasource.samplePolicy": caps["datasource.samplePolicy"] ?? false,
      "kb.chunking": caps["kb.chunking"] ?? false,
      "kb.citationPolicy": caps["kb.citationPolicy"] ?? false,
      "kb.scope": caps["kb.scope"] ?? false,
      "llm.advancedSampling": caps["llm.advancedSampling"] ?? false,
      "mcp.stdio": caps["mcp.stdio"] ?? false,
      "mcp.toolPolicy": caps["mcp.toolPolicy"] ?? false,
      "skill.resourceBinding": caps["skill.resourceBinding"] ?? false,
    });
    setLiveMentionSupport(mentionSupportFromCapabilities());
    setCapabilitiesReady(true);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await applyCapabilities();
      const [workspace, defaults, datasourceTypes] = await Promise.all([
        configApi.getWorkspaceConfig(),
        configApi.getRunDefaults(),
        configApi.listDatasourceTypes(),
      ]);
      setLiveDatasourceTypes(datasourceTypes);
      setWorkspaceConfig(workspaceConfigDtoToStore(workspace));
      setRunDefaults(defaults);
    } catch (err) {
      const message =
        err instanceof ConfigApiError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "加载工作区配置失败";
      setError(message);
      setWorkspaceConfig(defaultWorkspaceConfig());
    } finally {
      setLoading(false);
    }
  }, [applyCapabilities]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const replaceItemInStore = useCallback(
    (kind: WorkspaceConfigKind, item: WorkspaceConfigItem) => {
      setWorkspaceConfig((current) => ({
        ...current,
        [kind]: current[kind].map((entry) => (entry.id === item.id ? item : entry)),
      }));
    },
    [],
  );

  const formatConfigActionError = useCallback((err: unknown): Error => {
    if (err instanceof ConfigApiError) {
      if (err.code === "SECRET_MASTER_KEY_REQUIRED") {
        return new Error(
          "服务端未配置 SECRET_MASTER_KEY，无法保存 API Key。请在 .env 中设置后重启 API。",
        );
      }
      if (
        err.code === "RESOURCE_NOT_FOUND" ||
        err.message.includes("CONFIG_RESOURCE_NOT_FOUND")
      ) {
        return new Error(
          "该配置在后端不存在，请确认已点击「创建」且保存成功后再使用。",
        );
      }
    }
    return err instanceof Error ? err : new Error("配置操作失败");
  }, []);

  const createItem = useCallback(
    async (
      kind: WorkspaceConfigKind,
      item: WorkspaceConfigItem,
      skillFile?: File,
    ): Promise<string> => {
      try {
        if (kind === "skill") {
          if (!skillFile) {
            throw new Error("Skill 创建需要上传 SKILL.md 或 .zip 包");
          }
          const form = new FormData();
          form.append("file", skillFile);
          form.append("id", item.id);
          form.append("name", item.name);
          if (item.description.trim()) form.append("description", item.description);
          form.append("defaultEnabled", String(item.enabled));
          const created = await configApi.createSkill(form);
          const mapped = mergeItemFromDto(kind, item, created);
          setWorkspaceConfig((current) => ({
            ...current,
            skill: [...current.skill, mapped],
          }));
          return mapped.id;
        }

        const body = itemToCreateBody(kind, item);
        let createdId = item.id;
        if (kind === "db") {
          const created = await configApi.createDatasource(body);
          createdId = created.id;
          setWorkspaceConfig((current) => ({
            ...current,
            db: [...current.db, mergeItemFromDto(kind, item, created)],
          }));
        } else if (kind === "kb") {
          const created = await configApi.createKnowledgeBase(body);
          createdId = created.id;
          setWorkspaceConfig((current) => ({
            ...current,
            kb: [...current.kb, mergeItemFromDto(kind, item, created)],
          }));
        } else if (kind === "mcp") {
          const created = await configApi.createMcpServer(body);
          createdId = created.id;
          setWorkspaceConfig((current) => ({
            ...current,
            mcp: [...current.mcp, mergeItemFromDto(kind, item, created)],
          }));
        } else if (kind === "llm") {
          const created = await configApi.createModelProfile(body);
          createdId = created.id;
          setWorkspaceConfig((current) => ({
            ...current,
            llm: [...current.llm, mergeItemFromDto(kind, item, created)],
          }));
        }
        return createdId;
      } catch (err) {
        throw formatConfigActionError(err);
      }
    },
    [formatConfigActionError],
  );

  const updateItem = useCallback(
    async (
      kind: WorkspaceConfigKind,
      item: WorkspaceConfigItem,
      previous?: WorkspaceConfigItem,
    ): Promise<void> => {
      const body = itemToPatchBody(kind, item, previous);
      try {
        if (kind === "db") {
          const updated = await configApi.patchDatasource(item.id, body);
          replaceItemInStore(kind, mergeItemFromDto(kind, item, updated));
          return;
        }
        if (kind === "kb") {
          const updated = await configApi.patchKnowledgeBase(item.id, body);
          replaceItemInStore(kind, mergeItemFromDto(kind, item, updated));
          return;
        }
        if (kind === "mcp") {
          const updated = await configApi.patchMcpServer(item.id, body);
          replaceItemInStore(kind, mergeItemFromDto(kind, item, updated));
          return;
        }
        if (kind === "llm") {
          const updated = await configApi.patchModelProfile(item.id, body);
          replaceItemInStore(kind, mergeItemFromDto(kind, item, updated));
          return;
        }
        if (kind === "skill") {
          const updated = await configApi.patchSkill(item.id, body);
          replaceItemInStore(kind, mergeItemFromDto(kind, item, updated));
        }
      } catch (err) {
        if (err instanceof ConfigApiError && err.code === "REVISION_CONFLICT") {
          await refresh();
          throw new Error("配置已被其他操作更新，已刷新最新版本，请重试。");
        }
        if (
          err instanceof ConfigApiError &&
          (err.code === "RESOURCE_NOT_FOUND" ||
            err.message.includes("CONFIG_RESOURCE_NOT_FOUND"))
        ) {
          await refresh();
          throw new Error(
            "该配置在后端不存在（可能未成功创建或服务已重启），已刷新列表，请重新创建。",
          );
        }
        if (err instanceof ConfigApiError && err.code === "SECRET_MASTER_KEY_REQUIRED") {
          throw new Error(
            "服务端未配置 SECRET_MASTER_KEY，无法保存 API Key。请在 .env 中设置后重启 API。",
          );
        }
        throw err;
      }
    },
    [refresh, replaceItemInStore],
  );

  const deleteItem = useCallback(
    async (kind: WorkspaceConfigKind, itemId: string): Promise<void> => {
      if (kind === "db") await configApi.deleteDatasource(itemId);
      else if (kind === "kb") await configApi.deleteKnowledgeBase(itemId);
      else if (kind === "mcp") await configApi.deleteMcpServer(itemId);
      else if (kind === "llm") await configApi.deleteModelProfile(itemId);
      else if (kind === "skill") await configApi.deleteSkill(itemId);

      setWorkspaceConfig((current) => ({
        ...current,
        [kind]: current[kind].filter((item) => item.id !== itemId),
      }));
    },
    [],
  );

  const testItem = useCallback(
    async (kind: WorkspaceConfigKind, itemId: string): Promise<Record<string, unknown>> => {
      let result: Record<string, unknown>;
      if (kind === "db") result = await configApi.testDatasource(itemId);
      else if (kind === "kb") result = await configApi.testKnowledgeBase(itemId);
      else if (kind === "mcp") result = await configApi.testMcpServer(itemId);
      else if (kind === "llm") result = await configApi.testModelProfile(itemId);
      else result = await configApi.testSkill(itemId);

      await refresh();
      return result;
    },
    [refresh],
  );

  const introspectDatasource = useCallback(async (itemId: string): Promise<JobDto> => {
    return configApi.introspectDatasource(itemId);
  }, []);

  const reindexKnowledgeBase = useCallback(async (itemId: string): Promise<JobDto> => {
    return configApi.reindexKnowledgeBase(itemId);
  }, []);

  const uploadKnowledgeFile = useCallback(async (itemId: string, file: File): Promise<void> => {
    await configApi.uploadKnowledgeFile(itemId, file);
    await refresh();
  }, [refresh]);

  const replaceSkillPackage = useCallback(async (itemId: string, file: File): Promise<void> => {
    const form = new FormData();
    form.append("file", file);
    const updated = await configApi.replaceSkill(itemId, form);
    setWorkspaceConfig((current) => ({
      ...current,
      skill: current.skill.map((item) =>
        item.id === itemId ? mergeItemFromDto("skill", item, updated) : item,
      ),
    }));
  }, []);

  const validateSkill = useCallback(async (itemId: string): Promise<void> => {
    await configApi.validateSkill(itemId);
    await refresh();
  }, [refresh]);

  const pollJob = useCallback(
    async (jobId: string, onUpdate?: (job: JobDto) => void): Promise<JobDto> => {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const job = await configApi.getJob(jobId);
        onUpdate?.(job);
        if (
          job.status === "completed" ||
          job.status === "failed" ||
          job.status === "canceled"
        ) {
          return job;
        }
        await sleep(500);
      }
      throw new Error("任务超时，请稍后在任务列表中查看状态。");
    },
    [],
  );

  const cancelJob = useCallback(async (jobId: string): Promise<JobDto> => {
    return configApi.cancelJob(jobId);
  }, []);

  const patchLocalItem = useCallback(
    (
      kind: WorkspaceConfigKind,
      itemId: string,
      patch: Partial<
        Pick<WorkspaceConfigItem, "name" | "description" | "enabled" | "settings">
      >,
    ) => {
      setWorkspaceConfig((current) => ({
        ...current,
        [kind]: current[kind].map((item) => {
          if (item.id !== itemId) return item;
          return {
            ...item,
            ...patch,
            settings: patch.settings
              ? { ...item.settings, ...patch.settings }
              : item.settings,
          };
        }),
      }));
    },
    [],
  );

  return {
    workspaceConfig,
    runDefaults,
    loading,
    error,
    capabilitiesReady,
    refresh,
    patchLocalItem,
    createItem,
    updateItem,
    deleteItem,
    testItem,
    introspectDatasource,
    reindexKnowledgeBase,
    uploadKnowledgeFile,
    replaceSkillPackage,
    validateSkill,
    pollJob,
    cancelJob,
  };
}

export function createDraftWorkspaceItem(
  kind: WorkspaceConfigKind,
  name: string,
  description: string,
): WorkspaceConfigItem {
  return createWorkspaceConfigItem(kind, name, description);
}
