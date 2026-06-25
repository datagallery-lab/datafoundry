import { describe, expect, it } from "vitest";
import {
  artifactToneForType,
  statusTone,
  stepKindTone,
} from "../ui-tokens";

describe("data-task UI tokens", () => {
  it("maps data step kinds to semantic tone classes", () => {
    expect(stepKindTone("inspect")).toMatchObject({
      text: "text-step-inspect",
      bg: "bg-step-inspect/10",
      border: "border-step-inspect/30",
      bar: "bg-step-inspect",
    });
    expect(stepKindTone("knowledge").text).toBe("text-step-knowledge");
    expect(stepKindTone("other").text).toBe("text-muted");
  });

  it("maps artifact types to visual metadata", () => {
    expect(artifactToneForType("dataset")).toMatchObject({
      icon: "▦",
      label: "dataset",
      text: "text-step-query",
    });
    expect(artifactToneForType("file")).toMatchObject({
      icon: "□",
      label: "file",
    });
  });

  it("maps status kinds to semantic surface classes", () => {
    expect(statusTone("success")).toContain("step-success");
    expect(statusTone("error")).toContain("step-error");
    expect(statusTone("muted")).toContain("border-border");
  });
});
