import assert from "node:assert/strict";
import test from "node:test";

import { askUserTool, taskWriteTool } from "@mastra/core/harness";
import { toStandardSchema } from "@mastra/core/schema";
import { createTool } from "@mastra/core/tools";
import { createSkillTools } from "@mastra/core/workspace";
import { z } from "zod";

import {
  applyToolInputCompatibility,
  buildToolInputCompatibilityInstruction,
} from "../packages/agent-runtime/dist/tools/tool-input-compat.js";

const createTools = () => {
  const searchInputs = [];
  const tools = applyToolInputCompatibility(createSkillTools({
    search: async (query, options) => {
      searchInputs.push({ query, options });
      return [];
    },
  }));
  return { searchInputs, tools };
};

test("tool input instructions require complete arguments and atomic file writes", () => {
  const instruction = buildToolInputCompatibilityInstruction(["write_file", "mkdir"]);

  assert.match(instruction, /Include every required field in the same call/);
  assert.match(instruction, /write_file is atomic/);
  assert.match(instruction, /use mkdir for directories/);
});

test("skill_search accepts explicit array and numeric strings emitted by chat models", async () => {
  const { searchInputs, tools } = createTools();
  const modelInput = {
    query: "知识库 knowledge 查询",
    skillNames: "[\"data-analysis\"]",
    topK: "5",
  };
  const validation = await tools.skill_search.inputSchema["~standard"].validate(modelInput);
  const modelInputSchema = tools.skill_search.inputSchema["~standard"].jsonSchema.input({
    target: "draft-07",
  });

  assert.equal("issues" in validation, false);
  assert.equal(modelInputSchema.properties?.skillNames?.type, "array");
  assert.equal(modelInputSchema.properties?.topK?.type, "number");
  assert.deepEqual(validation.value, {
    query: "知识库 knowledge 查询",
    skillNames: ["data-analysis"],
    topK: 5,
  });
  await tools.skill_search.execute(validation.value, {});
  assert.deepEqual(searchInputs, [{
    query: "知识库 knowledge 查询",
    options: { skillNames: ["data-analysis"], topK: 5 },
  }]);
});

test("skill tools preserve native values and reject ambiguous array strings", async () => {
  const { tools } = createTools();

  assert.deepEqual(
    await tools.skill_search.inputSchema.parseAsync({
      query: "knowledge",
      skillNames: ["data-analysis"],
      topK: 5,
    }),
    { query: "knowledge", skillNames: ["data-analysis"], topK: 5 },
  );
  assert.deepEqual(
    await tools.skill_read.inputSchema.parseAsync({
      skillName: "data-analysis",
      path: "SKILL.md",
      startLine: "1",
      endLine: "5",
    }),
    { skillName: "data-analysis", path: "SKILL.md", startLine: 1, endLine: 5 },
  );

  for (const skillNames of ["data-analysis", "{}", "[1]", "[\"data-analysis\",1]"]) {
    const parsed = await tools.skill_search.inputSchema.safeParseAsync({
      query: "knowledge",
      skillNames,
      topK: "5",
    });
    assert.equal(parsed.success, false, `Expected ${JSON.stringify(skillNames)} to remain invalid`);
  }
});

test("global compatibility also normalizes Standard Schema MCP tool inputs", async () => {
  const calls = [];
  const inputSchema = toStandardSchema({
    type: "object",
    properties: {
      count: { type: "integer" },
      enabled: { type: "boolean" },
      names: { type: "array", items: { type: "string" } },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            count: { type: "integer" },
            enabled: { type: "boolean" },
          },
          required: ["count", "enabled"],
          additionalProperties: false,
        },
      },
      config: {
        type: "object",
        properties: {
          count: { type: "integer" },
          enabled: { type: "boolean" },
        },
        required: ["count", "enabled"],
        additionalProperties: false,
      },
      pattern: {
        anyOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
      },
    },
    required: ["count", "enabled", "tasks", "config", "pattern"],
    additionalProperties: false,
  });
  const tools = applyToolInputCompatibility({
    mcp_probe: createTool({
      id: "mcp_probe",
      description: "MCP compatibility probe",
      inputSchema,
      execute: async (input) => {
        calls.push(input);
        return input;
      },
    }),
  });
  applyToolInputCompatibility(tools);
  const validation = await tools.mcp_probe.inputSchema["~standard"].validate({
    count: "5",
    enabled: "false",
    names: "",
    tasks: "[{\"count\":\"2\",\"enabled\":\"true\"}]",
    config: "{\"count\":\"3\",\"enabled\":\"false\"}",
    pattern: "[\"*.ts\"]",
  });
  const modelInputSchema = tools.mcp_probe.inputSchema["~standard"].jsonSchema.input({
    target: "draft-07",
  });

  assert.equal("issues" in validation, false);
  assert.equal(modelInputSchema.properties?.count?.type, "integer");
  assert.equal(modelInputSchema.properties?.names?.type, "array");
  assert.equal(modelInputSchema.properties?.config?.type, "object");
  assert.deepEqual(validation.value, {
    count: 5,
    enabled: false,
    tasks: [{ count: 2, enabled: true }],
    config: { count: 3, enabled: false },
    pattern: "[\"*.ts\"]",
  });
  await tools.mcp_probe.execute(validation.value, {});
  assert.deepEqual(calls, [validation.value]);

  for (const input of [
    {
      count: "05",
      enabled: "false",
      tasks: "[]",
      config: "{\"count\":\"3\",\"enabled\":\"false\"}",
      pattern: "*.ts",
    },
    {
      count: "5",
      enabled: "yes",
      tasks: "[]",
      config: "{\"count\":\"3\",\"enabled\":\"false\"}",
      pattern: "*.ts",
    },
    {
      count: "5",
      enabled: "false",
      tasks: "{}",
      config: "{\"count\":\"3\",\"enabled\":\"false\"}",
      pattern: "*.ts",
    },
    { count: "5", enabled: "false", tasks: "[]", config: "[]", pattern: "*.ts" },
  ]) {
    const invalid = await tools.mcp_probe.inputSchema["~standard"].validate(input);
    assert.equal("issues" in invalid, true, `Expected ${JSON.stringify(input)} to remain invalid`);
  }
});

test("global compatibility covers knowledge and task collaboration tool schemas", async () => {
  const tools = applyToolInputCompatibility({
    ask_user: askUserTool,
    retrieve_knowledge: createTool({
      id: "retrieve_knowledge",
      description: "Knowledge compatibility probe",
      inputSchema: z.object({
        collection_id: z.string().min(1),
        query: z.string().min(1),
        top_k: z.number().int().min(1).max(20).optional(),
      }),
      execute: async (input) => input,
    }),
    task_write: taskWriteTool,
  });
  const askUserValidation = await tools.ask_user.inputSchema["~standard"].validate({
    question: "Choose a source",
    options: "[{\"label\":\"Primary\",\"description\":\"Use the primary source\"}]",
  });
  const knowledgeValidation = await tools.retrieve_knowledge.inputSchema["~standard"].validate({
    collection_id: "knowledge-1",
    query: "revenue",
    top_k: "5",
  });
  const taskWriteValidation = await tools.task_write.inputSchema["~standard"].validate({
    tasks: "[{\"content\":\"Inspect schema\",\"status\":\"pending\",\"activeForm\":\"Inspecting schema\"}]",
  });

  assert.equal("issues" in askUserValidation, false);
  assert.equal("issues" in knowledgeValidation, false);
  assert.equal("issues" in taskWriteValidation, false);
  assert.deepEqual(askUserValidation.value, {
    question: "Choose a source",
    options: [{ label: "Primary", description: "Use the primary source" }],
  });
  assert.deepEqual(knowledgeValidation.value, {
    collection_id: "knowledge-1",
    query: "revenue",
    top_k: 5,
  });
  assert.deepEqual(taskWriteValidation.value, {
    tasks: [{
      content: "Inspect schema",
      status: "pending",
      activeForm: "Inspecting schema",
    }],
  });

  const invalidKnowledge = await tools.retrieve_knowledge.inputSchema.safeParseAsync({
    collection_id: "knowledge-1",
    query: "revenue",
    top_k: "1e3",
  });
  const invalidTaskWrite = await tools.task_write.inputSchema.safeParseAsync({ tasks: "" });
  assert.equal(invalidKnowledge.success, false);
  assert.equal(invalidTaskWrite.success, false);
});
