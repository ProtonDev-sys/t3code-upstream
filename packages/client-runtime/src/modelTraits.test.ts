import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, type ProviderOptionDescriptor } from "@t3tools/contracts";
import {
  buildTraitsTriggerDisplay,
  getPromptControlledTraits,
  getTraitSelectChange,
} from "./modelTraits.ts";

function select(
  id: string,
  currentValue: string,
  options: ReadonlyArray<{ id: string; label: string }>,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  return { id, label: id, type: "select", currentValue, options };
}

const reasoning = select("reasoningEffort", "high", [{ id: "high", label: "High" }]);
const speed = select("serviceTier", "priority", [{ id: "priority", label: "Fast" }]);
const daybreak = select("cyberAccessProgram", "daybreakBlue", [
  { id: "standard", label: "Off" },
  { id: "daybreakBlue", label: "Blue" },
  { id: "daybreakRed", label: "Red" },
]);

describe("Daybreak traits", () => {
  it.each([
    ["standard", "Off"],
    ["daybreakBlue", "Blue"],
    ["daybreakRed", "Red"],
  ])("keeps %s distinct from reasoning and speed", (currentValue, label) => {
    const input = {
      provider: ProviderDriverKind.make("codex"),
      descriptors: [reasoning, speed, { ...daybreak, currentValue }],
      primarySelectDescriptorId: reasoning.id,
      ultrathinkPromptControlled: false,
    };
    expect(buildTraitsTriggerDisplay(input).label).toBe(`High Fast · Daybreak ${label}`);
    expect(buildTraitsTriggerDisplay({ ...input, allowDaybreak: false }).label).toBe("High Fast");
  });

  it("keeps an unresolved Daybreak control discoverable without relabeling generic providers", () => {
    const input = {
      provider: ProviderDriverKind.make("codex"),
      descriptors: [{ ...daybreak, currentValue: undefined }],
      primarySelectDescriptorId: null,
      ultrathinkPromptControlled: false,
    };
    expect(buildTraitsTriggerDisplay(input).label).toBe("Daybreak");
    expect(
      buildTraitsTriggerDisplay({
        ...input,
        provider: ProviderDriverKind.make("claudeAgent"),
        descriptors: [daybreak],
        allowDaybreak: false,
      }).label,
    ).toBe("Blue");
  });

  it("preserves reasoning and speed when changing the access program", () => {
    const descriptors = [reasoning, speed, daybreak];
    const selected = { ...getPromptControlledTraits(descriptors, "Investigate"), descriptors };
    expect(getTraitSelectChange(selected, daybreak, "Investigate", "daybreakRed")).toEqual({
      prompt: "Investigate",
      modelOptions: [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "priority" },
        { id: "cyberAccessProgram", value: "daybreakRed" },
      ],
    });
  });

  it("rejects a revoked choice rather than serializing an unavailable access program", () => {
    const revoked = {
      ...daybreak,
      currentValue: "standard",
      options: [{ id: "standard", label: "Off" }],
    };
    const descriptors = [reasoning, speed, revoked];
    const selected = { ...getPromptControlledTraits(descriptors, "Investigate"), descriptors };
    expect(getTraitSelectChange(selected, revoked, "Investigate", "daybreakBlue")).toBeNull();
    expect(getTraitSelectChange(selected, revoked, "Investigate", "standard")).toEqual({
      prompt: "Investigate",
      modelOptions: [
        { id: "reasoningEffort", value: "high" },
        { id: "serviceTier", value: "priority" },
        { id: "cyberAccessProgram", value: "standard" },
      ],
    });
  });
});
