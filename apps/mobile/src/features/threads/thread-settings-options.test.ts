import {
  getPromptControlledTraits,
  getTraitSelectChange,
} from "@t3tools/client-runtime/model-traits";
import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { selectableChoices } from "./thread-settings-options";

const effortDescriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
    { id: "ultrathink", label: "Ultrathink" },
    { id: "ultracode", label: "Ultracode" },
  ],
  currentValue: "high",
  promptInjectedValues: ["ultrathink"],
};

describe("selectableChoices", () => {
  it.each([
    { programs: [] },
    { programs: ["daybreakRed"] },
    { programs: ["daybreakBlue"] },
    { programs: ["daybreakRed", "daybreakBlue"] },
  ])(
    "keeps Red, Blue, and Off visible with only advertised choices enabled: $programs",
    ({ programs }) => {
      const descriptor = {
        id: "cyberAccessProgram",
        label: "Daybreak",
        type: "select" as const,
        options: [...programs, "standard"].map((id) => ({ id, label: id })),
      };
      expect(
        selectableChoices(descriptor).map(({ id, label, disabled }) => ({ id, label, disabled })),
      ).toEqual([
        { id: "daybreakRed", label: "Red", disabled: !programs.includes("daybreakRed") },
        { id: "daybreakBlue", label: "Blue", disabled: !programs.includes("daybreakBlue") },
        { id: "standard", label: "Off", disabled: false },
      ]);
      expect(descriptor.options).toHaveLength(programs.length + 1);
    },
  );

  it("turns Daybreak Off without changing reasoning or the prompt", () => {
    const descriptor = {
      id: "cyberAccessProgram",
      label: "Daybreak",
      type: "select" as const,
      currentValue: "daybreakBlue",
      options: [
        { id: "daybreakBlue", label: "Blue" },
        { id: "standard", label: "Off", isDefault: true },
      ],
    };
    const descriptors = [effortDescriptor, descriptor];
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, "solve it"), descriptors },
        descriptor,
        "solve it",
        "standard",
      ),
    ).toEqual({
      prompt: "solve it",
      modelOptions: [
        { id: "effort", value: "high" },
        { id: "cyberAccessProgram", value: "standard" },
      ],
    });
  });

  // regression: #21406 bring model controls in line with web
  it("includes prompt-injected and workflow choices in declared order", () => {
    expect(selectableChoices(effortDescriptor).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
      "ultrathink",
      "ultracode",
    ]);
  });
});

describe("prompt-controlled reasoning", () => {
  it("adds Ultrathink to the prompt without persisting an injected option", () => {
    const descriptors = [effortDescriptor];
    const change = getTraitSelectChange(
      { ...getPromptControlledTraits(descriptors, "solve it"), descriptors },
      effortDescriptor,
      "solve it",
      "ultrathink",
    );
    expect(change).toEqual({ prompt: "Ultrathink:\nsolve it" });
    expect(
      getPromptControlledTraits(descriptors, change?.prompt ?? "").ultrathinkPromptControlled,
    ).toBe(true);
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, ""), descriptors },
        effortDescriptor,
        "",
        "ultrathink",
      ),
    ).toEqual({ prompt: "Ultrathink:\n" });
  });

  it("removes the prefix when choosing a regular effort and saves Ultracode as an option", () => {
    const descriptors = [effortDescriptor];
    const prompt = "Ultrathink:\nsolve it";
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, prompt), descriptors },
        effortDescriptor,
        prompt,
        "ultracode",
      ),
    ).toEqual({ prompt: "solve it", modelOptions: [{ id: "effort", value: "ultracode" }] });
  });

  it("keeps body-controlled Ultrathink locked and preserves slash commands", () => {
    const descriptors = [effortDescriptor];
    const prompt = "please ultrathink about this";
    const selected = { ...getPromptControlledTraits(descriptors, prompt), descriptors };
    expect(selected.ultrathinkInBodyText).toBe(true);
    expect(getTraitSelectChange(selected, effortDescriptor, prompt, "low")).toBeNull();
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, "/review"), descriptors },
        effortDescriptor,
        "/review",
        "ultrathink",
      ),
    ).toEqual({ prompt: "/review" });
  });
});
