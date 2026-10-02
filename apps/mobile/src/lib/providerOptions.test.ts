import { describe, expect, it } from "vite-plus/test";

import type { ModelCapabilities } from "@t3tools/contracts";
import { getProviderOptionCurrentLabel } from "@t3tools/shared/model";

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

  it("does not offer Daybreak for a model that does not advertise it", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: CODEX_CAPABILITIES,
      selections: [{ id: "cyberAccessProgram", value: "daybreakBlue" }],
    });
    expect(descriptors.some((descriptor) => descriptor.id === "cyberAccessProgram")).toBe(false);
    expect(
      applyProviderOptionSelection(descriptors, {
        id: "cyberAccessProgram",
        value: "daybreakBlue",
      }),
    ).toBeNull();
  });

  it("retains explicit Off when reasoning is edited after choosing an unsupported model", () => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: CODEX_CAPABILITIES,
      selections: [{ id: "cyberAccessProgram", value: "standard" }],
    });
    expect(
      applyProviderOptionSelection(descriptors, { id: "reasoningEffort", value: "high" }, [
        { id: "cyberAccessProgram", value: "standard" },
      ]),
    ).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "default" },
      { id: "cyberAccessProgram", value: "standard" },
    ]);
  });

  it.each([
    [{ id: "daybreakBlue", label: "On" }],
    [{ id: "daybreakRed", label: "On" }],
    [
      { id: "daybreakRed", label: "Red" },
      { id: "daybreakBlue", label: "Blue" },
    ],
  ])("shows advertised Daybreak choices alongside reasoning and tier", (...choices) => {
    const descriptors = resolveProviderOptionDescriptors({
      capabilities: {
        optionDescriptors: [
          ...CODEX_CAPABILITIES.optionDescriptors!,
          {
            id: "cyberAccessProgram",
            label: "Daybreak",
            type: "select",
            options: [
              { id: "automatic", label: "Auto", isDefault: true },
              { id: "standard", label: "Off" },
              ...choices,
            ],
          },
        ],
      },
      selections: [{ id: "reasoningEffort", value: "high" }],
    });
    expect(descriptors.map((descriptor) => descriptor.label)).toEqual([
      "Reasoning",
      "Service Tier",
      "Daybreak",
    ]);
    expect(getProviderOptionCurrentLabel(descriptors[2])).toBe("Auto");
    expect(
      applyProviderOptionSelection(descriptors, { id: "serviceTier", value: "priority" }),
    ).toContainEqual({ id: "cyberAccessProgram", value: "automatic" });
    expect(
      applyProviderOptionSelection(descriptors, {
        id: "cyberAccessProgram",
        value: choices[0]!.id,
      }),
    ).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "default" },
      { id: "cyberAccessProgram", value: choices[0]!.id },
    ]);
  });
});
