import type { ContextPackage } from "../../inventory/context-package.js";
import type { ContextDecision, ContextPlan } from "../../inventory/context-plan.js";
import {
  contextItemExclusivityKey,
  contextItemSourceKind,
  contextItemSourceOwner,
  isShadowContextItem
} from "../../inventory/context-source-metadata.js";
import type { ContextSourcePolicyDecision } from "../../policy/context-source-policy.js";

export type MastraContextCompiledEventPayload = {
  budget: ContextPlan["budget"];
  decisions: ContextDecision[];
  omitted_group_ids: string[];
  omitted_sources: ReturnType<typeof createSourceEventEntries>;
  package_revision: number;
  plan_id: string;
  selected_group_ids: string[];
  selected_sources: ReturnType<typeof createSourceEventEntries>;
  step_number: number;
  token_report: ContextPlan["tokenReport"];
};

export const createMastraContextCompiledEventPayload = (
  contextPackage: ContextPackage,
  plan: ContextPlan
): MastraContextCompiledEventPayload => ({
  package_revision: plan.packageRevision,
  plan_id: plan.planId,
  step_number: plan.stepNumber,
  selected_group_ids: plan.selectedGroupIds,
  omitted_group_ids: plan.omittedGroupIds,
  selected_sources: createSourceEventEntries(contextPackage, new Set(sourceItemIdsForGroups(
    contextPackage,
    new Set(plan.selectedGroupIds),
    new Set(plan.selectedSourceItemIds)
  ))),
  omitted_sources: createSourceEventEntries(contextPackage, new Set([
    ...sourceItemIdsForGroups(contextPackage, new Set(plan.omittedGroupIds), new Set(plan.selectedSourceItemIds)),
    ...plan.omittedSourceItemIds
  ])),
  decisions: plan.decisions,
  token_report: plan.tokenReport,
  budget: plan.budget
});

export const sourcePolicyDecisionsToContextDecisions = (
  decisions: ContextSourcePolicyDecision[]
): ContextDecision[] =>
  decisions.map((decision) => ({
    affectedGroupIds: decision.affectedGroupIds,
    affectedItemIds: decision.affectedItemIds,
    reason: decision.reason,
    strategyId: decision.strategyId,
    tokenSavings: 0
  }));

const createSourceEventEntries = (contextPackage: ContextPackage, itemIds: ReadonlySet<string>) =>
  contextPackage.groups
    .filter((group) => group.kind === "source" && group.itemIds.some((itemId) => itemIds.has(itemId)))
    .map((group) => {
      const items = contextPackage.items.filter((item) =>
        group.itemIds.includes(item.id) && itemIds.has(item.id)
      );
      return {
        group_id: group.id,
        item_count: items.length,
        source_types: unique(items.map((item) => item.sourceType)),
        source_kinds: unique(items.map(contextItemSourceKind).filter(isString)),
        source_owners: unique(items.map(contextItemSourceOwner).filter(isString)),
        exclusivity_keys: unique(items.map(contextItemExclusivityKey).filter(isString)),
        shadow: items.length > 0 && items.every(isShadowContextItem)
      };
    });

const sourceItemIdsForGroups = (
  contextPackage: ContextPackage,
  groupIds: ReadonlySet<string>,
  visibleSourceItemIds: ReadonlySet<string>
): string[] =>
  contextPackage.groups
    .filter((group) => group.kind === "source" && groupIds.has(group.id))
    .flatMap((group) => group.itemIds.filter((itemId) => visibleSourceItemIds.has(itemId)));

const unique = (values: string[]): string[] => [...new Set(values)].sort((left, right) => left.localeCompare(right));

const isString = (value: unknown): value is string => typeof value === "string";
