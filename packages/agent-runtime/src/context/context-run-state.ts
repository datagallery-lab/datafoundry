import type { ContextPackage } from "./context-package.js";
import { ContextPackageBuilder } from "./context-package-builder.js";
import type { ContextPlan } from "./step-context-planner.js";
import type { ContextItem } from "./tool-result-adapter.js";

export type ContextRunIdentity = {
  resourceId: string;
  sessionId: string;
  runId: string;
};

export class ContextRunState {
  private readonly builder = new ContextPackageBuilder();
  private currentPackage: ContextPackage;
  private readonly recordedPlans: ContextPlan[] = [];

  constructor(readonly identity: ContextRunIdentity) {
    this.currentPackage = this.builder.build([], {
      resourceId: identity.resourceId,
      sessionId: identity.sessionId,
      runId: identity.runId
    });
  }

  get package(): ContextPackage {
    return this.currentPackage;
  }

  get plans(): readonly ContextPlan[] {
    return this.recordedPlans;
  }

  merge(contextPackage: ContextPackage): ContextPackage {
    const items = mergeItems(this.currentPackage.items, contextPackage.items);
    this.currentPackage = this.builder.build(items, {
      packageId: this.currentPackage.packageId,
      revision: this.currentPackage.revision + 1,
      resourceId: this.identity.resourceId,
      sessionId: this.identity.sessionId,
      runId: this.identity.runId
    });
    return this.currentPackage;
  }

  registerObservation(contextPackage: ContextPackage): ContextPackage {
    const namespacedItems = contextPackage.items.map((item) => ({
      ...item,
      id: `${contextPackage.packageId}:${item.id}`,
      groupId: `${contextPackage.packageId}:${item.groupId}`
    }));
    const observationPackage = this.builder.build(namespacedItems, {
      resourceId: this.identity.resourceId,
      sessionId: this.identity.sessionId,
      runId: this.identity.runId
    });
    return this.merge(observationPackage);
  }

  recordPlan(plan: ContextPlan): void {
    this.recordedPlans.push(plan);
  }
}

const mergeItems = (existing: ContextItem[], incoming: ContextItem[]): ContextItem[] => {
  const items = new Map(existing.map((item) => [item.id, item]));

  for (const item of incoming) {
    const previous = items.get(item.id);
    if (!previous || previous.contentHash !== item.contentHash) {
      items.set(item.id, item);
    }
  }

  return [...items.values()];
};
