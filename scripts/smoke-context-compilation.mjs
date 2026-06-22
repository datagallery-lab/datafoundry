import {
  ContextBudgetProcessor,
  ContextPackageBuilder,
  ContextRunState,
  ModelContextProfileRegistry,
  ProviderPromptGuardProcessor,
  ReductionStrategyRegistry,
  StepContextPlanner,
  createDataAgent,
  createContextItem,
  groupMessagesByTurn
} from "../packages/agent-runtime/dist/index.js";

const identity = { resourceId: "context-smoke-user", sessionId: "context-smoke-session", runId: "context-smoke-run" };
const runState = new ContextRunState(identity);
const builder = new ContextPackageBuilder();
const packageOne = builder.build([
  createContextItem({
    id: "artifact-ref-1",
    sourceType: "sql",
    sourceId: "sql-1",
    groupId: "sql-observation-1",
    visibility: "artifact-ref",
    trust: "tool",
    retention: "reference",
    priority: 10,
    content: { artifact_id: "artifact-1", source: "sql" },
    metadata: { groupKind: "reference" }
  })
], identityToPackageOptions(identity));

runState.merge(packageOne);
runState.merge(packageOne);

if (runState.package.revision !== 2 || runState.package.items.length !== 1) {
  throw new Error("Expected package revisions to increment without duplicating stable context items");
}
if (runState.package.artifactRefs[0]?.artifact_id !== "artifact-1") {
  throw new Error("Expected artifact references to survive package merges");
}

runState.registerObservation(packageOne);
runState.registerObservation(builder.build(packageOne.items, identityToPackageOptions(identity)));
const observationItems = runState.package.items.filter((item) => item.id.endsWith(":artifact-ref-1"));

if (observationItems.length !== 2 || new Set(observationItems.map((item) => item.id)).size !== 2) {
  throw new Error("Expected separate tool observations with local item IDs to remain distinct");
}

const anonymousMessages = [
  createAnonymousMessage("user", "anonymous question"),
  createAnonymousMessage("assistant", "anonymous answer"),
  createAnonymousMessage("user", "current anonymous question"),
  createToolCallMessage(),
  createAnonymousToolResultMessage()
];
const anonymousGroups = groupMessagesByTurn(anonymousMessages);

if (anonymousGroups.length !== 2 || anonymousGroups[0]?.mandatory || !anonymousGroups[1]?.mandatory) {
  throw new Error("Expected only the current anonymous conversation turn to be mandatory");
}
if (anonymousGroups[1]?.members.length !== 3) {
  throw new Error("Expected the current user, tool call, and tool result to remain in one turn");
}

const duplicateAnonymousGroups = groupMessagesByTurn([
  createAnonymousMessage("user", "same content"),
  createAnonymousMessage("user", "same content")
]);
const duplicateAnonymousIds = duplicateAnonymousGroups.map((group) => group.members[0]?.id);

if (new Set(duplicateAnonymousIds).size !== 2) {
  throw new Error("Expected identical anonymous messages to receive distinct occurrence identities");
}

const originalStableId = groupMessagesByTurn([createAnonymousMessage("user", "stable question")])[0]?.members[0]?.id;
const prependedStableId = groupMessagesByTurn([
  createAnonymousMessage("assistant", "unrelated prefix"),
  createAnonymousMessage("user", "stable question")
])[1]?.members[0]?.id;

if (!originalStableId || originalStableId !== prependedStableId) {
  throw new Error("Expected anonymous identity to be independent from its absolute message index");
}

const orphanGroup = groupMessagesByTurn([
  createAnonymousMessage("assistant", "orphan assistant"),
  createAnonymousToolResultMessage()
])[0];

if (!orphanGroup?.mandatory || orphanGroup.members.length !== 2 || orphanGroup.retention !== "active") {
  throw new Error("Expected an orphan trajectory to remain one current mandatory turn");
}

const assistantTailGroups = groupMessagesByTurn([
  createAnonymousMessage("user", "user starts the turn"),
  createAnonymousMessage("assistant", "assistant remains in the user turn")
]);

if (assistantTailGroups.length !== 1 || assistantTailGroups[0]?.members.length !== 2) {
  throw new Error("Expected a trailing assistant message to remain in its preceding user turn");
}

assertThrows(
  () => groupMessagesByTurn([createMessage("duplicate-id", "user", "one"), createMessage("duplicate-id", "user", "two")]),
  "CONTEXT_DUPLICATE_MESSAGE_ID"
);

const alignmentState = new ContextRunState({ ...identity, runId: "context-alignment-run" });
const alignmentProcessor = new ContextBudgetProcessor({
  emitter: { emit: () => undefined },
  modelName: "context-smoke-model",
  runState: alignmentState
});
alignmentProcessor.processInputStep({
  messages: anonymousMessages,
  systemMessages: [],
  tools: {},
  stepNumber: 0
});
const inventoryTurnIds = new Set(
  alignmentState.package.groups.filter((group) => group.kind === "turn").map((group) => group.id)
);
const plannedTurnIds = new Set(alignmentState.plans[0]?.selectedGroupIds ?? []);

if (inventoryTurnIds.size !== plannedTurnIds.size || [...inventoryTurnIds].some((id) => !plannedTurnIds.has(id))) {
  throw new Error("Expected processor inventory group IDs to align with planner group IDs");
}

const profileRegistry = new ModelContextProfileRegistry({
  defaultProfile: {
    id: "context-smoke-small",
    modelPattern: "*",
    contextWindow: 420,
    outputReserve: 40,
    safetyMargin: 20,
    messageOverhead: 4,
    toolSchemaOverhead: 8
  }
});
const events = [];
const processor = new ContextBudgetProcessor({
  emitter: { emit: (event) => events.push(event) },
  modelName: "context-smoke-model",
  planner: new StepContextPlanner({ profileRegistry }),
  runState
});
const messages = [
  createMessage("old-user", "user", "old question ".repeat(120)),
  createMessage("old-assistant", "assistant", "old response ".repeat(80)),
  createMessage("current-user", "user", "current question"),
  createMessage("current-assistant", "assistant", "current response"),
  createToolResultMessage("current-tool-result")
];
const processorResult = processor.processInputStep({
  messages,
  systemMessages: [{ role: "system", content: "read-only data agent" }],
  tools: {},
  stepNumber: 1
});

if (!processorResult?.messages || processorResult.messages.some((message) => message.id === "old-user")) {
  throw new Error("Expected the default reduction strategy to omit the complete oldest turn");
}
if (!processorResult.messages.some((message) => message.id === "current-user")) {
  throw new Error("Expected the mandatory current turn to remain selected");
}
if (!processorResult.messages.some((message) => message.id === "current-tool-result")) {
  throw new Error("Expected the active tool result to remain atomic with its current turn");
}
if (!events.some((event) => event.name === "context.compiled")) {
  throw new Error("Expected context compilation to emit a bounded AG-UI CUSTOM audit event");
}

const customRegistry = new ReductionStrategyRegistry();
customRegistry.register({
  id: "custom-history-policy",
  propose: (state) => state.groups
    .filter((group) => !group.mandatory && state.selectedGroupIds.has(group.id))
    .map((group) => ({
      strategyId: "custom-history-policy",
      removeGroupIds: [group.id],
      expectedTokenSavings: group.tokenCost,
      qualityLoss: 0,
      reason: "custom policy selected this group"
    }))
});
const customPlanner = new StepContextPlanner({
  profileRegistry,
  strategyRegistry: customRegistry,
  registerDefaultStrategies: false
});
const customResult = customPlanner.plan({
  contextPackage: runState.package,
  stepNumber: 2,
  systemMessages: [],
  tools: {},
  messages,
  modelName: "context-smoke-model"
});

if (customResult.plan.decisions[0]?.strategyId !== "custom-history-policy") {
  throw new Error("Expected a custom reduction strategy to work without modifying the planner");
}

const guardEvents = [];
const guard = new ProviderPromptGuardProcessor({
  emitter: { emit: (event) => guardEvents.push(event) },
  modelName: "context-smoke-model",
  profileRegistry
});
assertThrows(
  () => guard.processLLMRequest({
    prompt: [{ role: "user", content: [{ type: "text", text: "large prompt ".repeat(300) }] }],
    stepNumber: 3,
    abort: (reason) => {
      throw new Error(reason);
    }
  }),
  "CONTEXT_FINAL_PROMPT_EXCEEDS_BUDGET"
);

if (!guardEvents.some((event) => event.name === "context.prompt-verified")) {
  throw new Error("Expected the provider prompt guard to emit verification metrics before aborting");
}

const configuredAgent = createDataAgent({
  dataGateway: {},
  emitter: { emit: () => undefined },
  modelProvider: {
    kind: "mastra-router",
    model_name: "context-smoke/model",
    model: { id: "context-smoke/model", url: "http://127.0.0.1:1", apiKey: "unused" }
  },
  runContext: {
    user_id: identity.resourceId,
    session_id: identity.sessionId,
    run_id: identity.runId,
    user_input: "context smoke",
    chat_mode: "smoke",
    selected_datasource_id: "context-smoke-source",
    model_name: "context-smoke/model"
  },
  messages: [
    { id: "activity-message", role: "activity", activityType: "test", content: {}, replace: true },
    { id: "user-message", role: "user", content: "context smoke" }
  ]
});
const configuredProcessors = await configuredAgent.agent.listConfiguredInputProcessors();
const configuredProcessorIds = configuredProcessors.map((entry) => entry.id);

if (!configuredProcessorIds.includes("context-budget") || !configuredProcessorIds.includes("provider-prompt-guard")) {
  throw new Error(`Expected Mastra context processors, got ${configuredProcessorIds.join(",")}`);
}
if (configuredAgent.governedMessages.some((message) => message.role === "activity")) {
  throw new Error("Expected ingress governance to remove AG-UI activity messages before Mastra conversion");
}

console.log(
  `Context compilation smoke OK: revision=${runState.package.revision}, plans=${runState.plans.length}, processors=${configuredProcessorIds.length}`
);

function createMessage(id, role, text) {
  return { id, role, content: { format: 2, parts: [{ type: "text", text }] }, createdAt: new Date() };
}

function createAnonymousMessage(role, text) {
  return { role, content: { format: 2, parts: [{ type: "text", text }] }, createdAt: new Date() };
}

function createToolCallMessage() {
  return {
    role: "assistant",
    content: {
      format: 2,
      parts: [{
        type: "tool-invocation",
        toolInvocation: { state: "call", toolCallId: "anonymous-tool-call", toolName: "inspect_schema", args: {} }
      }]
    },
    createdAt: new Date()
  };
}

function createAnonymousToolResultMessage() {
  return {
    role: "user",
    content: {
      format: 2,
      parts: [{
        type: "tool-invocation",
        toolInvocation: {
          state: "result",
          toolCallId: "anonymous-tool-call",
          toolName: "inspect_schema",
          result: {}
        }
      }]
    },
    createdAt: new Date()
  };
}

function createToolResultMessage(id) {
  return {
    id,
    role: "user",
    content: {
      format: 2,
      parts: [{
        type: "tool-invocation",
        toolInvocation: { state: "result", toolCallId: "tool-call-1", toolName: "inspect_schema", result: {} }
      }]
    },
    createdAt: new Date()
  };
}

function identityToPackageOptions(value) {
  return { resourceId: value.resourceId, sessionId: value.sessionId, runId: value.runId };
}

function assertThrows(callback, expectedMessage) {
  try {
    callback();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expectedMessage)) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected error containing: ${expectedMessage}`);
}
