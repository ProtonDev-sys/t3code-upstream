import { assert, it } from "@effect/vitest";

import {
  appendCustomCodexModels,
  applyPreferredCodexDefaultModel,
  mapCodexModelCapabilities,
} from "./CodexProvider.ts";

const DAYBREAK_TEST_MODEL = {
  additionalSpeedTiers: [],
  defaultReasoningEffort: "medium",
  description: "Test model",
  displayName: "GPT Test",
  hidden: false,
  id: "gpt-test",
  isDefault: true,
  model: "gpt-test",
  supportedReasoningEfforts: [],
};

it("only offers Daybreak programs advertised for the account and model", () => {
  for (const program of ["daybreakBlue", "daybreakRed"] as const) {
    const capabilities = mapCodexModelCapabilities({
      ...DAYBREAK_TEST_MODEL,
      availableAccessPrograms: { cyber: ["standard", program] },
    });
    assert.deepStrictEqual(capabilities.optionDescriptors, [
      {
        id: "cyberAccessProgram",
        label: "Daybreak",
        type: "select",
        options: [
          { id: "standard", label: "Off", isDefault: true },
          { id: program, label: program === "daybreakBlue" ? "Blue" : "Red" },
        ],
        currentValue: "standard",
      },
    ]);
  }
  for (const availableAccessPrograms of [undefined, null, { cyber: ["standard"] as const }]) {
    assert.deepStrictEqual(
      mapCodexModelCapabilities({
        ...DAYBREAK_TEST_MODEL,
        ...(availableAccessPrograms === undefined ? {} : { availableAccessPrograms }),
      }).optionDescriptors,
      [],
    );
  }
});

it("offers both approved Daybreak programs without selecting one by default", () => {
  const capabilities = mapCodexModelCapabilities({
    ...DAYBREAK_TEST_MODEL,
    availableAccessPrograms: { cyber: ["standard", "daybreakBlue", "daybreakRed"] },
  });
  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "cyberAccessProgram",
      label: "Daybreak",
      type: "select",
      options: [
        { id: "standard", label: "Off", isDefault: true },
        { id: "daybreakBlue", label: "Blue" },
        { id: "daybreakRed", label: "Red" },
      ],
      currentValue: "standard",
    },
  ]);
});

it("does not expose Daybreak without an advertised way to turn it off", () => {
  for (const program of ["daybreakBlue", "daybreakRed"] as const) {
    const capabilities = mapCodexModelCapabilities({
      ...DAYBREAK_TEST_MODEL,
      availableAccessPrograms: { cyber: [program] },
    });
    assert.deepStrictEqual(capabilities.optionDescriptors, []);
  }
});

it("does not lend a model's Daybreak approval to bare custom models", () => {
  const capabilities = mapCodexModelCapabilities({
    ...DAYBREAK_TEST_MODEL,
    supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
    availableAccessPrograms: { cyber: ["standard", "daybreakBlue"] },
  });
  const models = appendCustomCodexModels(
    [{ slug: "gpt-test", name: "GPT Test", isCustom: false, capabilities }],
    ["custom-model"],
  );

  assert.deepStrictEqual(
    models[0]?.capabilities?.optionDescriptors?.map((descriptor) => descriptor.id),
    ["reasoningEffort", "cyberAccessProgram"],
  );
  assert.deepStrictEqual(models[1]?.capabilities?.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "medium", label: "Medium", isDefault: true }],
      currentValue: "medium",
    },
  ]);
});

it("maps current Codex model capability fields", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: [],
    defaultReasoningEffort: "super-high",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    defaultServiceTier: "flex",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "Lower latency responses.",
      },
      {
        id: "flex",
        name: "Flex",
        description: "Lower-cost asynchronous routing.",
      },
    ],
    supportedReasoningEfforts: [
      {
        description: "Maximum reasoning",
        reasoningEffort: "super-high",
      },
    ],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [{ id: "super-high", label: "super-high", isDefault: true }],
      currentValue: "super-high",
    },
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard" },
        {
          id: "priority",
          label: "Fast",
          description: "Lower latency responses.",
        },
        {
          id: "flex",
          label: "Flex",
          description: "Lower-cost asynchronous routing.",
          isDefault: true,
        },
      ],
      currentValue: "flex",
    },
  ]);
});

it("uses standard routing when the catalog has no default service tier", () => {
  const capabilities = mapCodexModelCapabilities({
    additionalSpeedTiers: ["fast"],
    defaultReasoningEffort: "medium",
    defaultServiceTier: null,
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    serviceTiers: [
      {
        id: "priority",
        name: "Fast",
        description: "1.5x speed, increased usage",
      },
      {
        id: "ultrafast",
        name: "Ultrafast",
        description: "The fastest available responses for latency-sensitive work.",
      },
    ],
    supportedReasoningEfforts: [],
  });

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "serviceTier",
      label: "Service Tier",
      type: "select",
      options: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "1.5x speed, increased usage",
        },
        {
          id: "ultrafast",
          label: "Ultrafast",
          description: "Even faster, more expensive",
        },
      ],
      currentValue: "default",
    },
  ]);
});

it("marks the most preferred available model as default", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, isDefault: model.isDefault })),
    [
      { slug: "gpt-5.6-terra", isDefault: true },
      { slug: "gpt-5.4", isDefault: undefined },
    ],
  );
});

it("prefers sol over terra when both are available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-terra", name: "GPT-5.6-Terra", isCustom: false, capabilities: null },
    { slug: "gpt-5.6-sol", name: "GPT-5.6-Sol", isCustom: false, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.6-sol");
});

it("ranks qualified Codex models while preserving their wire ids", () => {
  const models = applyPreferredCodexDefaultModel([
    {
      slug: "openai.gpt-5.6-luna",
      name: "Luna",
      isCustom: false,
      isDefault: true,
      capabilities: null,
    },
    { slug: "openai.gpt-5.6-sol", name: "Sol", isCustom: false, capabilities: null },
  ]);
  assert.deepStrictEqual(
    models.filter((model) => model.isDefault).map((model) => model.slug),
    ["openai.gpt-5.6-sol"],
  );
});

it("keeps Codex's own default when no preferred model is available", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.5", name: "GPT-5.5", isCustom: false, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});
