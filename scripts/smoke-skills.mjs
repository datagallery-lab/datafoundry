import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildSkillResourcePayload,
  materializeSkillPackages,
  parseSkillPackage,
  selectSkillsForRun
} from "../packages/skills/dist/index.js";
import { LocalFileAssetService } from "../packages/files/dist/index.js";
import {
  createToolObservationBoundary,
  ToolObservationDispatcher
} from "../packages/agent-runtime/dist/testing.js";
import { createMetadataStore } from "../packages/metadata/dist/index.js";

const root = mkdtempSync(join(tmpdir(), "open-data-agent-skills-smoke-"));
const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
const fileAssetService = new LocalFileAssetService(metadataStore, { storageRoot: join(root, "files") });

const userId = "dev-user";
const workspaceId = "default";
const packageBody = Buffer.from(`---
name: sql-analysis-smoke
description: Use for SQL analysis smoke tests.
version: 1.0.0
tags:
  - data-analysis
  - sql
allowed-tools:
  - inspect_schema
  - run_sql_readonly
---
Inspect schema first, then run read-only SQL.
`, "utf8");

const parsed = await parseSkillPackage({
  content: packageBody,
  filename: "SKILL.md",
  mimeType: "text/markdown"
});
assert.equal(parsed.name, "sql-analysis-smoke");
assert.deepEqual(parsed.allowedTools, ["inspect_schema", "run_sql_readonly"]);

const packageRef = fileAssetService.createRef({
  user_id: userId,
  workspace_id: workspaceId,
  filename: "SKILL.md",
  content: packageBody,
  declared_mime_type: "text/markdown",
  source: "upload",
  metadata: { kind: "skill-package" }
});
const resource = metadataStore.configResources.upsert({
  id: "sql-analysis-smoke",
  workspace_id: workspaceId,
  user_id: userId,
  kind: "skill",
  name: parsed.name,
  description: parsed.description,
  payload: buildSkillResourcePayload({
    packageFileRefId: packageRef.ref.id,
    parsed
  }),
  default_enabled: true,
  status: "valid"
});

const selection = selectSkillsForRun({
  metadataStore,
  runConfig: {
    enabledSkillIds: [],
    skillIds: [],
    skillMode: "auto",
    skillPolicy: {
      deniedToolNames: [],
      maxSkills: 5,
      requireUserInvocable: true,
      strictSkillTools: false
    },
    skillTags: []
  },
  userId,
  userInput: "analyze data with sql",
  workspaceId
});
assert.equal(selection.selectedSkills[0]?.id, resource.id);
assert.equal(selection.effectiveToolPolicy.mergeStrategy, "union");
assert.equal(selection.effectiveToolPolicy.allowedTools?.includes("run_sql_readonly"), true);

const materialized = await materializeSkillPackages({
  fileAssetService,
  runDir: join(root, "workspace"),
  skills: selection.selectedSkills,
  userId,
  workspaceId
});
assert.equal(materialized[0]?.path, "skills/sql-analysis-smoke");
const materializedSkillPath = join(root, "workspace", "skills", "sql-analysis-smoke", "SKILL.md");
assert.equal(existsSync(materializedSkillPath), true);
assert.equal(readFileSync(materializedSkillPath, "utf8").includes("Inspect schema first"), true);

const builtinPackageBody = Buffer.from(`---
name: builtin-data-analysis
description: Use for builtin data analysis smoke tests.
version: 1.0.0
tags:
  - data
  - analysis
  - sql
allowed-tools:
  - inspect_schema
  - run_sql_readonly
---
Explore schema, run read-only SQL, validate results, and present evidence-backed findings.
`, "utf8");
const builtinParsed = await parseSkillPackage({
  content: builtinPackageBody,
  filename: "SKILL.md",
  mimeType: "text/markdown"
});
const builtinPackageRef = fileAssetService.createRef({
  user_id: userId,
  workspace_id: workspaceId,
  filename: "SKILL.md",
  content: builtinPackageBody,
  declared_mime_type: "text/markdown",
  source: "upload",
  metadata: { builtin: true, kind: "skill-package" }
});
const builtinResource = metadataStore.configResources.upsert({
  id: "builtin-data-analysis",
  workspace_id: workspaceId,
  user_id: userId,
  kind: "skill",
  name: builtinParsed.name,
  description: builtinParsed.description,
  payload: {
    ...buildSkillResourcePayload({
      fields: { packageSource: "builtin://builtin-data-analysis" },
      packageFileRefId: builtinPackageRef.ref.id,
      parsed: builtinParsed
    }),
    builtinSource: "builtin://builtin-data-analysis"
  },
  builtin: true,
  default_enabled: false,
  status: "valid"
});
const builtinSelection = selectSkillsForRun({
  metadataStore,
  runConfig: {
    activeSkillId: "builtin-data-analysis",
    enabledSkillIds: ["builtin-data-analysis"],
    skillIds: [],
    skillMode: "selected",
    skillPolicy: {
      deniedToolNames: [],
      maxSkills: 5,
      requireUserInvocable: true,
      strictSkillTools: false
    },
    skillTags: []
  },
  userId,
  userInput: "用 SQL 分析数据",
  workspaceId
});
assert.equal(builtinSelection.selectedSkills[0]?.id, builtinResource.id);
const builtinMaterialized = await materializeSkillPackages({
  fileAssetService,
  runDir: join(root, "builtin-workspace"),
  skills: builtinSelection.selectedSkills,
  userId,
  workspaceId
});
assert.equal(builtinMaterialized[0]?.path, "skills/builtin-data-analysis");
const builtinSkillPath = join(root, "builtin-workspace", "skills", "builtin-data-analysis", "SKILL.md");
assert.equal(existsSync(builtinSkillPath), true);
assert.equal(readFileSync(builtinSkillPath, "utf8").includes("Explore schema, run read-only SQL"), true);

const boundary = createToolObservationBoundary({
  identity: {
    resourceId: userId,
    runId: "skill-smoke-run",
    sessionId: "skill-smoke-session"
  }
});
const dispatcher = new ToolObservationDispatcher(boundary.packager, {
  modelName: "skill-smoke-model",
  resourceId: userId,
  runId: "skill-smoke-run",
  sessionId: "skill-smoke-session"
});
const contextPackage = dispatcher.dispatch("skill", {
  name: "sql-analysis-smoke",
  content: "Inspect schema first, then run read-only SQL."
});
assert.equal(contextPackage.items.some((item) => item.sourceType === "skill-activation"), true);

metadataStore.close();
console.log(
  "Skills smoke OK: package parsing, FileAsset ref, user/builtin selection, materialization, context adapter"
);
