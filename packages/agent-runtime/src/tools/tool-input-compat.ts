import { createWorkspaceTools } from "@mastra/core/workspace";
import { z } from "zod";

type JsonSchema = boolean | JsonSchemaObject;

type JsonSchemaObject = {
  $ref?: string;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  items?: JsonSchema | JsonSchema[];
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: string | string[];
  [key: string]: unknown;
};

type NormalizedValue = {
  changed: boolean;
  value: unknown;
};

type StandardValidationResult = {
  issues?: unknown;
  value?: unknown;
};

type StandardSchemaContract = {
  jsonSchema?: {
    input?: (options?: { target?: string }) => unknown;
  };
  validate: (value: unknown) => StandardValidationResult | PromiseLike<StandardValidationResult>;
  vendor: string;
  version: number;
  [key: string]: unknown;
};

type ToolWithInputSchema = {
  inputSchema?: unknown;
};

const compatibleToolInstances = new WeakSet<object>();

export const buildToolInputCompatibilityInstruction = (toolNames: readonly string[]): string => {
  const instruction = "Before every tool call, construct one complete argument object that satisfies the tool's "
    + "advertised JSON Schema. Include every required field in the same call; do not omit payload fields or make "
    + "placeholder calls. Use native JSON arrays, objects, numbers, and booleans when possible.";
  return toolNames.includes("write_file")
    ? instruction
      + " write_file is atomic: always include path and the complete content in the same call. Never call "
      + "write_file only to create a path or directory; use mkdir for directories."
    : instruction;
};

export const applyToolInputCompatibility = <TTools extends Record<string, unknown>>(
  tools: TTools,
): TTools => {
  for (const tool of Object.values(tools)) {
    if (!isRecord(tool) || compatibleToolInstances.has(tool)) {
      continue;
    }
    const typedTool = tool as ToolWithInputSchema;
    const inputSchema = typedTool.inputSchema;
    const standardSchema = standardSchemaContract(inputSchema);
    const jsonSchema = standardSchema ? inputJsonSchema(standardSchema) : undefined;
    if (!standardSchema || jsonSchema === undefined) {
      continue;
    }

    typedTool.inputSchema = inputSchema instanceof z.ZodType
      ? compatibleZodSchema(inputSchema, jsonSchema)
      : compatibleStandardSchema(inputSchema, standardSchema, jsonSchema);
    compatibleToolInstances.add(tool);
  }
  return tools;
};

export const createCompatibleWorkspaceTools = async (
  workspace: Parameters<typeof createWorkspaceTools>[0],
  configContext?: Parameters<typeof createWorkspaceTools>[1],
): Promise<Awaited<ReturnType<typeof createWorkspaceTools>>> =>
  applyToolInputCompatibility(await createWorkspaceTools(workspace, configContext));

const compatibleZodSchema = (
  inputSchema: z.ZodType,
  jsonSchema: JsonSchema,
): z.ZodType => z.preprocess((input) => {
  try {
    if (inputSchema.safeParse(input).success) {
      return input;
    }
  } catch {
    return normalizeJsonSchemaValue(input, jsonSchema, jsonSchema).value;
  }
  return normalizeJsonSchemaValue(input, jsonSchema, jsonSchema).value;
}, inputSchema);

const compatibleStandardSchema = (
  inputSchema: unknown,
  standardSchema: StandardSchemaContract,
  jsonSchema: JsonSchema,
): unknown => ({
  ...(isRecord(inputSchema) ? inputSchema : {}),
  "~standard": {
    ...standardSchema,
    validate: (input: unknown): StandardValidationResult | PromiseLike<StandardValidationResult> => {
      const originalResult = standardSchema.validate(input);
      return isPromiseLike(originalResult)
        ? originalResult.then((result) => validateNormalizedStandardInput(
            input,
            result,
            standardSchema,
            jsonSchema,
          ))
        : validateNormalizedStandardInput(input, originalResult, standardSchema, jsonSchema);
    },
  },
});

const normalizeJsonSchemaValue = (
  value: unknown,
  schema: JsonSchema,
  rootSchema: JsonSchema,
  optional = false,
): NormalizedValue => {
  const resolvedSchema = resolveSchema(schema, rootSchema);
  if (typeof value === "string" && !schemaAllowsType(resolvedSchema, "string", rootSchema)) {
    const stringValue = value.trim();
    if (schemaAllowsType(resolvedSchema, "boolean", rootSchema)) {
      const normalizedBoolean = normalizeExplicitBoolean(value);
      return {
        changed: typeof normalizedBoolean === "boolean",
        value: normalizedBoolean,
      };
    }
    if (
      schemaAllowsType(resolvedSchema, "number", rootSchema)
      || schemaAllowsType(resolvedSchema, "integer", rootSchema)
    ) {
      const normalizedNumber = normalizeExplicitNumber(value);
      return {
        changed: typeof normalizedNumber === "number",
        value: normalizedNumber,
      };
    }
    if (schemaAllowsType(resolvedSchema, "array", rootSchema)) {
      if (optional && stringValue === "") {
        return { changed: true, value: undefined };
      }
      const parsed = parseJsonContainer(stringValue, Array.isArray);
      if (parsed !== undefined) {
        const normalized = normalizeJsonSchemaValue(parsed, resolvedSchema, rootSchema);
        return { changed: true, value: normalized.value };
      }
    }
    if (schemaAllowsType(resolvedSchema, "object", rootSchema)) {
      if (optional && stringValue === "") {
        return { changed: true, value: undefined };
      }
      const parsed = parseJsonContainer(stringValue, isRecord);
      if (parsed !== undefined) {
        const normalized = normalizeJsonSchemaValue(parsed, resolvedSchema, rootSchema);
        return { changed: true, value: normalized.value };
      }
    }
    return { changed: false, value };
  }

  if (Array.isArray(value) && schemaAllowsType(resolvedSchema, "array", rootSchema)) {
    const arraySchema = schemaForType(resolvedSchema, "array", rootSchema);
    const itemSchema = isRecord(arraySchema) && !Array.isArray(arraySchema.items)
      ? arraySchema.items
      : undefined;
    if (itemSchema === undefined) {
      return { changed: false, value };
    }
    let changed = false;
    const normalizedItems = value.map((item) => {
      const normalized = normalizeJsonSchemaValue(item, itemSchema, rootSchema);
      changed ||= normalized.changed;
      return normalized.value;
    });
    return { changed, value: changed ? normalizedItems : value };
  }

  if (isRecord(value) && schemaAllowsType(resolvedSchema, "object", rootSchema)) {
    const objectSchemas = schemasForObject(resolvedSchema, rootSchema);
    const properties: Record<string, JsonSchema> = Object.assign(
      {},
      ...objectSchemas.map((candidate) => candidate.properties ?? {}),
    );
    const required = new Set(objectSchemas.flatMap((candidate) => candidate.required ?? []));
    let changed = false;
    const normalizedObject: Record<string, unknown> = { ...value };
    for (const [field, fieldSchema] of Object.entries(properties)) {
      if (!(field in value)) {
        continue;
      }
      const normalized = normalizeJsonSchemaValue(value[field], fieldSchema, rootSchema, !required.has(field));
      if (!normalized.changed) {
        continue;
      }
      changed = true;
      if (normalized.value === undefined && !required.has(field)) {
        delete normalizedObject[field];
      } else {
        normalizedObject[field] = normalized.value;
      }
    }
    return { changed, value: changed ? normalizedObject : value };
  }

  return { changed: false, value };
};

const schemaAllowsType = (
  schema: JsonSchema,
  expectedType: string,
  rootSchema: JsonSchema,
): boolean => {
  const resolvedSchema = resolveSchema(schema, rootSchema);
  if (resolvedSchema === true) {
    return true;
  }
  if (resolvedSchema === false) {
    return false;
  }
  const declaredTypes = Array.isArray(resolvedSchema.type)
    ? resolvedSchema.type
    : resolvedSchema.type
      ? [resolvedSchema.type]
      : [];
  if (
    declaredTypes.includes(expectedType)
    || (expectedType === "number" && declaredTypes.includes("integer"))
  ) {
    return true;
  }
  if (expectedType === "object" && declaredTypes.length === 0 && resolvedSchema.properties) {
    return true;
  }
  if (expectedType === "array" && declaredTypes.length === 0 && resolvedSchema.items) {
    return true;
  }
  const alternatives = [...(resolvedSchema.anyOf ?? []), ...(resolvedSchema.oneOf ?? [])];
  if (alternatives.some((candidate) => schemaAllowsType(candidate, expectedType, rootSchema))) {
    return true;
  }
  return (resolvedSchema.allOf ?? []).some((candidate) =>
    schemaAllowsType(candidate, expectedType, rootSchema));
};

const schemaForType = (
  schema: JsonSchema,
  expectedType: string,
  rootSchema: JsonSchema,
): JsonSchema => {
  const resolvedSchema = resolveSchema(schema, rootSchema);
  if (!isRecord(resolvedSchema)) {
    return resolvedSchema;
  }
  const alternatives = [
    ...(resolvedSchema.anyOf ?? []),
    ...(resolvedSchema.oneOf ?? []),
    ...(resolvedSchema.allOf ?? []),
  ];
  return alternatives.find((candidate) => schemaAllowsType(candidate, expectedType, rootSchema))
    ?? resolvedSchema;
};

const schemasForObject = (
  schema: JsonSchema,
  rootSchema: JsonSchema,
): JsonSchemaObject[] => {
  const resolvedSchema = resolveSchema(schema, rootSchema);
  if (!isRecord(resolvedSchema)) {
    return [];
  }
  const matchingAlternatives = [...(resolvedSchema.anyOf ?? []), ...(resolvedSchema.oneOf ?? [])]
    .filter((candidate) => schemaAllowsType(candidate, "object", rootSchema))
    .flatMap((candidate) => schemasForObject(candidate, rootSchema));
  const allOfSchemas = (resolvedSchema.allOf ?? [])
    .filter((candidate) => schemaAllowsType(candidate, "object", rootSchema))
    .flatMap((candidate) => schemasForObject(candidate, rootSchema));
  return [resolvedSchema, ...matchingAlternatives, ...allOfSchemas];
};

const resolveSchema = (schema: JsonSchema, rootSchema: JsonSchema): JsonSchema => {
  if (!isRecord(schema) || !schema.$ref?.startsWith("#/")) {
    return schema;
  }
  let current: unknown = rootSchema;
  for (const rawSegment of schema.$ref.slice(2).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isRecord(current) || !(segment in current)) {
      return schema;
    }
    current = current[segment];
  }
  return isJsonSchema(current) ? current : schema;
};

const inputJsonSchema = (standardSchema: StandardSchemaContract): JsonSchema | undefined => {
  try {
    const schema = standardSchema.jsonSchema?.input?.({ target: "draft-07" });
    return isJsonSchema(schema) ? schema : undefined;
  } catch {
    return undefined;
  }
};

const standardSchemaContract = (schema: unknown): StandardSchemaContract | undefined => {
  if (!isRecord(schema)) {
    return undefined;
  }
  const standard = schema["~standard"];
  if (!isRecord(standard) || typeof standard.validate !== "function") {
    return undefined;
  }
  return standard as StandardSchemaContract;
};

const hasValidationIssues = (result: StandardValidationResult): boolean =>
  "issues" in result && result.issues !== undefined;

const normalizeExplicitBoolean = (value: string): boolean | string => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return value;
};

const normalizeExplicitNumber = (value: string): number | string => {
  const normalized = value.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    return value;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : value;
};

const parseJsonContainer = <T>(
  value: string,
  predicate: (parsed: unknown) => parsed is T,
): T | undefined => {
  try {
    const parsed: unknown = JSON.parse(value);
    return predicate(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const validateNormalizedStandardInput = (
  input: unknown,
  originalResult: StandardValidationResult,
  standardSchema: StandardSchemaContract,
  jsonSchema: JsonSchema,
): StandardValidationResult | PromiseLike<StandardValidationResult> => {
  if (!hasValidationIssues(originalResult)) {
    return originalResult;
  }
  const normalized = normalizeJsonSchemaValue(input, jsonSchema, jsonSchema);
  return normalized.changed
    ? standardSchema.validate(normalized.value)
    : originalResult;
};

const isPromiseLike = (
  value: StandardValidationResult | PromiseLike<StandardValidationResult>,
): value is PromiseLike<StandardValidationResult> =>
  isRecord(value) && typeof (value as { then?: unknown }).then === "function";

const isJsonSchema = (value: unknown): value is JsonSchema =>
  typeof value === "boolean" || isRecord(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
