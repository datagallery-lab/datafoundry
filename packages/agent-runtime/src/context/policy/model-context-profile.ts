import { CONTEXT_MAX_TOKENS } from "../inventory/context-limits.js";

export type ModelContextProfile = {
  id: string;
  modelPattern: string;
  contextWindow: number;
  outputReserve: number;
  safetyMargin: number;
  messageOverhead: number;
  toolSchemaOverhead: number;
};

export type ModelContextProfileRegistryOptions = {
  defaultProfile?: ModelContextProfile;
  profiles?: ModelContextProfile[];
};

const DEFAULT_PROFILE: ModelContextProfile = {
  id: "conservative-default",
  modelPattern: "*",
  contextWindow: CONTEXT_MAX_TOKENS,
  outputReserve: 4096,
  safetyMargin: 2048,
  messageOverhead: 4,
  toolSchemaOverhead: 32
};

export class ModelContextProfileRegistry {
  private readonly defaultProfile: ModelContextProfile;
  private readonly profiles: ModelContextProfile[];

  constructor(options: ModelContextProfileRegistryOptions = {}) {
    this.defaultProfile = options.defaultProfile ?? DEFAULT_PROFILE;
    this.profiles = [...(options.profiles ?? [])];
  }

  resolve(modelName?: string): ModelContextProfile {
    const normalized = modelName?.toLowerCase() ?? "";
    return this.profiles.find(
      (profile) => normalized.includes(profile.modelPattern.toLowerCase())
    ) ?? this.defaultProfile;
  }
}
