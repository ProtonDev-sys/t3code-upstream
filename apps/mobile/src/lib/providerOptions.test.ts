import { describe, expect, it } from "vite-plus/test";

import type { ModelCapabilities } from "@t3tools/contracts";
import { getCodexDaybreakToggleState } from "@t3tools/shared/model";

import { applyProviderOptionSelection, resolveProviderOptionDescriptors } from "./providerOptions";

const CODEX_CAPABILITIES: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "medium", label: "Medium", isDefault: true },
        { id: "high", label: "High" },
      ],
      currentValue: "medium",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        { id: "priority", label: "Fast" },
      ],
      currentValue: "default",
    },
  ],
};

describe("mobile provider options", () => {
  it("changes reasoning and Daybreak independently using the selected model's descriptors", () => {
    const capabilities: ModelCapabilities = {
      optionDescriptors: [
        ...(CODEX_CAPABILITIES.optionDescriptors ?? []),
        {
          id: "cyberAccessProgram",
          label: "Daybreak",
          type: "select",
          options: [
            { id: "standard", label: "Off", isDefault: true },
            { id: "daybreakBlue", label: "Blue" },
          ],
          currentValue: "standard",
        },
      ],
    };
    const descriptors = resolveProviderOptionDescriptors({
      capabilities,
      selections: [
        { id: "reasoningEffort", value: "high" },
        { id: "cyberAccessProgram", value: "daybreakBlue" },
      ],
    });
    expect(getCodexDaybreakToggleState(descriptors)).toEqual({
      checked: true,
      enabledValue: "daybreakBlue",
    });

    expect(
      applyProviderOptionSelection(descriptors, { id: "reasoningEffort", value: "medium" }),
    ).toEqual([
      { id: "reasoningEffort", value: "medium" },
      { id: "serviceTier", value: "default" },
      { id: "cyberAccessProgram", value: "daybreakBlue" },
    ]);
    const offSelections = applyProviderOptionSelection(descriptors, {
      id: "cyberAccessProgram",
      value: "standard",
    });
    expect(offSelections).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "default" },
      { id: "cyberAccessProgram", value: "standard" },
    ]);
    const offDescriptors = resolveProviderOptionDescriptors({
      capabilities,
      selections: offSelections,
    });
    const toggle = getCodexDaybreakToggleState(offDescriptors);
    expect(toggle).toEqual({ checked: false, enabledValue: "daybreakBlue" });
    if (!toggle) throw new Error("Expected an available Daybreak toggle");
    expect(
      applyProviderOptionSelection(offDescriptors, {
        id: "cyberAccessProgram",
        value: toggle.enabledValue,
      }),
    ).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "default" },
      { id: "cyberAccessProgram", value: "daybreakBlue" },
    ]);
    expect(
      applyProviderOptionSelection(descriptors, { id: "cyberAccessProgram", value: "daybreakRed" }),
    ).toBeNull();

    const withoutAccess = resolveProviderOptionDescriptors({
      capabilities: CODEX_CAPABILITIES,
      selections: [{ id: "cyberAccessProgram", value: "daybreakBlue" }],
    });
    expect(withoutAccess.some((descriptor) => descriptor.id === "cyberAccessProgram")).toBe(false);
    expect(
      applyProviderOptionSelection(withoutAccess, {
        id: "cyberAccessProgram",
        value: "daybreakBlue",
      }),
    ).toBeNull();
  });

  it("updates generic select options without knowing provider-specific ids", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: CODEX_CAPABILITIES,
      selections: undefined,
    });

    expect(
      applyProviderOptionSelection(descriptors, { id: "serviceTier", value: "priority" }),
    ).toEqual([
      { id: "reasoningEffort", value: "medium" },
      { id: "serviceTier", value: "priority" },
    ]);
    // Choices the model doesn't advertise are rejected, not stored.
    expect(
      applyProviderOptionSelection(descriptors, { id: "serviceTier", value: "turbo" }),
    ).toBeNull();
    expect(applyProviderOptionSelection(descriptors, { id: "unknown", value: "high" })).toBeNull();
  });

  it("updates generic boolean options", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: {
        optionDescriptors: [{ id: "fastMode", label: "Fast Mode", type: "boolean" }],
      },
      selections: undefined,
    });

    expect(applyProviderOptionSelection(descriptors, { id: "fastMode", value: true })).toEqual([
      { id: "fastMode", value: true },
    ]);
  });
});
