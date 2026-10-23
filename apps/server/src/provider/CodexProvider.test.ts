import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CodexSettings, type ModelCapabilities } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as CodexSchema from "effect-codex-app-server/schema";

import {
  applyPreferredCodexDefaultModel,
  checkCodexProviderStatus,
  makePendingCodexProvider,
  mapCodexModelCapabilities,
} from "./CodexProvider.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

function codexModel(overrides: Partial<CodexSchema.V2ModelListResponse__Model> = {}) {
  return {
    defaultReasoningEffort: "medium",
    description: "Test model",
    displayName: "GPT Test",
    hidden: false,
    id: "gpt-test",
    isDefault: true,
    model: "gpt-test",
    supportedReasoningEfforts: [],
    ...overrides,
  } satisfies CodexSchema.V2ModelListResponse__Model;
}

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
    availableAccessPrograms: { cyber: ["daybreakRed"] },
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
    {
      id: "cyberAccessProgram",
      label: "Daybreak",
      type: "select",
      options: [{ id: "daybreakRed", label: "Red" }],
    },
  ]);
});

it("labels only advertised Daybreak programs and defaults to Off when available", () => {
  const capabilities = mapCodexModelCapabilities(
    codexModel({ availableAccessPrograms: { cyber: ["daybreakRed", "standard", "daybreakBlue"] } }),
  );

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "cyberAccessProgram",
      label: "Daybreak",
      type: "select",
      options: [
        { id: "daybreakRed", label: "Red" },
        { id: "standard", label: "Off", isDefault: true },
        { id: "daybreakBlue", label: "Blue" },
      ],
      currentValue: "standard",
    },
  ]);
});

it("does not invent Off or a default for a Blue-only catalog", () => {
  const capabilities = mapCodexModelCapabilities(
    codexModel({ availableAccessPrograms: { cyber: ["daybreakBlue"] } }),
  );

  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "cyberAccessProgram",
      label: "Daybreak",
      type: "select",
      options: [{ id: "daybreakBlue", label: "Blue" }],
    },
  ]);
});

it("retains standard-only access so saved Off can still be validated", () => {
  const capabilities = mapCodexModelCapabilities(
    codexModel({ availableAccessPrograms: { cyber: ["standard"] } }),
  );
  assert.deepStrictEqual(capabilities.optionDescriptors, [
    {
      id: "cyberAccessProgram",
      label: "Daybreak",
      type: "select",
      options: [{ id: "standard", label: "Off", isDefault: true }],
      currentValue: "standard",
    },
  ]);
});

it.each([undefined, null, { cyber: [] }] as const)(
  "omits Daybreak when access metadata has no Daybreak program: %j",
  (availableAccessPrograms) => {
    const capabilities = mapCodexModelCapabilities(
      codexModel(availableAccessPrograms === undefined ? {} : { availableAccessPrograms }),
    );

    assert.deepStrictEqual(capabilities.optionDescriptors, []);
  },
);

it.effect("strips explicit custom access before a live catalog is available", () =>
  Effect.gen(function* () {
    const defaultCapabilities = mapCodexModelCapabilities(
      codexModel({ additionalSpeedTiers: ["fast"] }),
    );
    const capabilities = mapCodexModelCapabilities(
      codexModel({
        additionalSpeedTiers: ["fast"],
        availableAccessPrograms: { cyber: ["standard", "daybreakRed"] },
      }),
    );
    const provider = yield* makePendingCodexProvider(
      decodeCodexSettings({
        customModels: [{ slug: "custom", capabilities }, "bare-custom"],
      }),
    );

    assert.deepStrictEqual(provider.models[0]?.capabilities, defaultCapabilities);
    assert.strictEqual(provider.models[1]?.capabilities, null);
    assert.strictEqual(capabilities.optionDescriptors?.length, 2);
  }),
);

it.effect("preserves renamed catalog access without granting it to custom models", () =>
  Effect.gen(function* () {
    const defaultCapabilities = mapCodexModelCapabilities(
      codexModel({ additionalSpeedTiers: ["fast"] }),
    );
    const capabilities = mapCodexModelCapabilities(
      codexModel({
        additionalSpeedTiers: ["fast"],
        availableAccessPrograms: { cyber: ["standard", "daybreakBlue", "daybreakRed"] },
      }),
    );
    const customOption = {
      id: "customOption",
      label: "Custom",
      type: "boolean",
      currentValue: true,
    } as const;
    const customCapabilities = {
      optionDescriptors: [
        customOption,
        {
          id: "cyberAccessProgram",
          label: "Daybreak",
          type: "select",
          options: [{ id: "daybreakRed", label: "Red" }],
        },
      ],
    } satisfies ModelCapabilities;
    const provider = yield* checkCodexProviderStatus(
      decodeCodexSettings({
        customModels: [
          { slug: "gpt-test", name: "Renamed catalog model", capabilities: customCapabilities },
          "bare-custom",
          { slug: "explicit-custom", capabilities: customCapabilities },
        ],
      }),
      () =>
        Effect.succeed({
          account: {
            account: { type: "chatgpt", email: "test@example.com", planType: "pro" },
            requiresOpenaiAuth: true,
          },
          version: "1.0.0",
          models: [{ slug: "gpt-test", name: "GPT Test", isCustom: false, capabilities }],
          skills: [],
        }),
    );

    assert.deepStrictEqual(provider.models, [
      { slug: "gpt-test", name: "Renamed catalog model", isCustom: false, capabilities },
      {
        slug: "bare-custom",
        name: "bare-custom",
        isCustom: true,
        capabilities: defaultCapabilities,
      },
      {
        slug: "explicit-custom",
        name: "explicit-custom",
        isCustom: true,
        capabilities: { optionDescriptors: [customOption] },
      },
    ]);
    assert.strictEqual(capabilities.optionDescriptors?.length, 2);
    assert.strictEqual(customCapabilities.optionDescriptors.length, 2);
  }).pipe(Effect.provide(NodeServices.layer)),
);

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

it("ignores custom models that shadow a preferred slug", () => {
  const models = applyPreferredCodexDefaultModel([
    { slug: "gpt-5.6-sol", name: "gpt-5.6-sol", isCustom: true, capabilities: null },
    { slug: "gpt-5.4", name: "GPT-5.4", isCustom: false, isDefault: true, capabilities: null },
  ]);

  assert.deepStrictEqual(models.find((model) => model.isDefault)?.slug, "gpt-5.4");
});
