import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type ModelSelection, type ServerConfig } from "@t3tools/contracts";

import {
  buildModelOptions,
  groupByProvider,
  isModelSelectionUnavailable,
  resolveDefaultableModelSelection,
  resolveModelOptionChange,
  resolveNewTaskModelSelection,
  resolveSelectableModelSelection,
  type ModelOption,
} from "./modelOptions";

describe("mobile model options", () => {
  it("groups models by provider and flags legacy entries", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "gpt-5.6-sol",
              name: "GPT-5.6 Sol",
              isCustom: false,
              capabilities: null,
            },
            {
              slug: "gpt-5.4",
              name: "GPT-5.4",
              isCustom: false,
              isLegacy: true,
              capabilities: null,
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    expect(groupByProvider(buildModelOptions(config, null))).toMatchObject([
      {
        providerKey: "codex",
        providerLabel: "Codex",
        models: [
          { key: "codex:gpt-5.6-sol", label: "GPT-5.6 Sol", subtitle: "", isLegacy: false },
          { key: "codex:gpt-5.4", label: "GPT-5.4", isLegacy: true },
        ],
      },
    ]);
  });

  it("carries configured ACP identity into model and provider catalogs", () => {
    const iconUrl = "https://cdn.agentclientprotocol.com/registry/v1/latest/antigravity-acp.svg";
    const config = {
      providers: [
        {
          instanceId: "acpRegistry_antigravity",
          driver: "acpRegistry",
          displayName: "Antigravity",
          iconUrl,
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "default",
              name: "Default",
              isCustom: false,
              capabilities: null,
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const [group] = groupByProvider(buildModelOptions(config, null));

    expect(group).toMatchObject({
      providerKey: "acpRegistry_antigravity",
      providerLabel: "Antigravity",
      models: [
        {
          providerDriver: "acpRegistry",
          providerIconUrl: iconUrl,
        },
      ],
    });
  });

  it("distinguishes same-name OpenCode models without changing their routing", () => {
    const sources = [
      { id: "anthropic", label: "Anthropic" },
      { id: "github-copilot", label: "GitHub Copilot" },
      { id: "opencode", label: "OpenCode Zen" },
    ];
    const config = {
      providers: [
        {
          instanceId: "opencode_work",
          driver: "opencode",
          displayName: "OpenCode Work",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: sources.map((source) => ({
            slug: `${source.id}/claude-fable-5`,
            name: "Claude Fable 5",
            subProvider: source.label,
            isCustom: false,
            capabilities: null,
          })),
        },
      ],
    } as unknown as ServerConfig;
    const selection = {
      instanceId: ProviderInstanceId.make("opencode_work"),
      model: "github-copilot/claude-fable-5",
    };

    const options = buildModelOptions(config, selection);

    expect(options).toMatchObject(
      sources.map((source) => ({
        key: `opencode_work:${source.id}/claude-fable-5`,
        label: "Claude Fable 5",
        subtitle: source.label,
        providerLabel: "OpenCode Work",
        selection: {
          instanceId: "opencode_work",
          model: `${source.id}/claude-fable-5`,
        },
      })),
    );
    expect(groupByProvider(options)).toEqual([
      { providerKey: "opencode_work", providerLabel: "OpenCode Work", models: options },
    ]);
  });

  it("does not materialize catalog defaults for missing stored options", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "gpt-test",
              name: "GPT Test",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
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
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const [option] = buildModelOptions(config, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-test",
    });

    expect(option?.capabilities?.optionDescriptors?.[0]?.id).toBe("serviceTier");
    expect(option?.selection.options).toBeUndefined();

    const [emptyOption] = buildModelOptions(config, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-test",
      options: [],
    });
    expect(emptyOption?.selection).toEqual(option?.selection);

    const [explicitOption] = buildModelOptions(config, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-test",
      options: [{ id: "serviceTier", value: "priority" }],
    });
    expect(explicitOption?.selection.options).toEqual([{ id: "serviceTier", value: "priority" }]);
  });

  it("limits existing threads to their provider while new tasks keep every provider", () => {
    const providers = ["codex", "claudeAgent"].map((instanceId) => ({
      instanceId,
      driver: instanceId,
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models: [{ slug: "test", name: instanceId, capabilities: null }],
    }));
    const config = { providers } as unknown as ServerConfig;
    const selection = { instanceId: ProviderInstanceId.make("codex"), model: "test" };

    expect(buildModelOptions(config, selection).map((option) => option.providerKey)).toEqual([
      "codex",
      "claudeAgent",
    ]);
    expect(buildModelOptions(config, selection, selection.instanceId)).toEqual(
      buildModelOptions(config, selection).filter((option) => option.providerKey === "codex"),
    );
  });

  it.each(["disabled", "unavailable", "missing"] as const)(
    "retains the selected %s provider's fallback in a filtered catalog",
    (state) => {
      const selection = {
        instanceId: ProviderInstanceId.make("google_work"),
        model: "saved-model",
        options: [{ id: "native-option", value: "saved-choice" }],
      };
      const provider = {
        instanceId: selection.instanceId,
        driver: "antigravity",
        displayName: "Google Work",
        enabled: state !== "disabled",
        installed: true,
        availability: state === "unavailable" ? "unavailable" : "available",
        auth: { status: "authenticated" },
        models: [{ slug: selection.model, name: "Saved model", capabilities: null }],
      };
      const config = {
        providers: state === "missing" ? [] : [provider],
        settings: { providerInstances: { google_work: { driver: "antigravity" } } },
      } as unknown as ServerConfig;
      const options = buildModelOptions(config, selection, selection.instanceId);
      expect(options).toEqual(buildModelOptions(config, selection));
      expect(options).toHaveLength(1);
      expect(options[0]).toMatchObject({ selection, isUnavailable: true });
    },
  );

  it("rejects stored selections whose provider is not usable", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [],
        },
        {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          enabled: false,
          installed: true,
          auth: { status: "authenticated" },
          models: [],
        },
      ],
    } as unknown as ServerConfig;

    const usable = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
    };
    const disabled = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-5",
    };
    const removed = {
      instanceId: ProviderInstanceId.make("codex_personal"),
      model: "gpt-5.6-sol",
    };

    expect(resolveSelectableModelSelection(config, usable)).toBe(usable);
    expect(resolveSelectableModelSelection(config, disabled)).toBeNull();
    expect(resolveSelectableModelSelection(config, removed)).toBeNull();
    expect(isModelSelectionUnavailable(config, disabled)).toBe(false);
    // An offline environment has no config to validate.
    expect(resolveSelectableModelSelection(null, disabled)).toBe(disabled);
  });

  describe("Antigravity selections", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("google_work"),
      model: "gemini-3.1-pro-high",
      options: [{ id: "native-option", value: "saved/opaque-choice" }],
    };
    const model = {
      slug: selection.model,
      name: "Gemini 3.1 Pro High",
      subProvider: "Google",
      isCustom: false,
      isDefault: true,
      isLegacy: true,
      capabilities: {
        optionDescriptors: [
          {
            id: "native-option",
            label: "Native option",
            type: "select",
            options: [{ id: "current/default", label: "Default", isDefault: true }],
            currentValue: "current/default",
          },
        ],
      },
    };
    const config = {
      providers: [
        {
          instanceId: selection.instanceId,
          driver: "antigravity",
          displayName: "Google Work",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [model],
        },
      ],
    } as unknown as ServerConfig;

    it.each([
      ["disabled", { enabled: false }],
      ["uninstalled", { installed: false }],
      ["signed out", { auth: { status: "unauthenticated" } }],
      ["unavailable", { availability: "unavailable" }],
    ] as const)("keeps a %s provider's selection and known model details", (_state, update) => {
      const unavailableConfig = {
        ...config,
        providers: config.providers.map((provider) => ({ ...provider, ...update })),
      };

      expect(resolveSelectableModelSelection(unavailableConfig, selection)).toBe(selection);
      expect(resolveDefaultableModelSelection(unavailableConfig, selection)).toBe(selection);
      expect(isModelSelectionUnavailable(unavailableConfig, selection)).toBe(true);
      expect(buildModelOptions(unavailableConfig, null)).toEqual([]);
      const [option] = buildModelOptions(unavailableConfig, selection);
      expect(option).toMatchObject({
        key: `google_work:${selection.model}`,
        label: model.name,
        subtitle: "Google",
        providerKey: "google_work",
        providerLabel: "Google Work",
        providerDriver: "antigravity",
        isDefault: false,
        isLegacy: true,
        isUnavailable: true,
        capabilities: model.capabilities,
      });
      expect(option?.selection).toBe(selection);
    });

    it("keeps an exact selection when its model leaves and returns to the catalog", () => {
      const changedConfig = {
        ...config,
        providers: config.providers.map((provider) => ({
          ...provider,
          models: provider.models.map((model) => ({ ...model, slug: "gemini-3.1-pro-low" })),
        })),
      };

      expect(resolveDefaultableModelSelection(changedConfig, selection)).toBe(selection);
      expect(isModelSelectionUnavailable(changedConfig, selection)).toBe(true);
      const options = buildModelOptions(changedConfig, selection);
      const missing = options.find((option) => option.selection.model === selection.model);
      expect(missing).toMatchObject({
        label: selection.model,
        providerLabel: "Google Work",
        providerDriver: "antigravity",
        isUnavailable: true,
        capabilities: null,
      });
      expect(missing?.selection).toBe(selection);
      expect(
        resolveNewTaskModelSelection({
          draftSelection: null,
          projectDefaultSelection: resolveDefaultableModelSelection(changedConfig, selection),
          stickySelection: null,
          modelOptions: options,
        }),
      ).toBe(selection);

      const [restored] = buildModelOptions(config, selection);
      expect(isModelSelectionUnavailable(config, selection)).toBe(false);
      expect(restored?.isUnavailable).not.toBe(true);
      expect(restored?.selection).toBe(selection);
      expect(resolveDefaultableModelSelection(config, selection)).toBe(selection);
      expect(buildModelOptions(config, null)[0]?.selection.options).toBeUndefined();
    });

    it("uses configured instance metadata when provider status is missing", () => {
      const missingStatusConfig = {
        providers: [],
        settings: {
          providerInstances: {
            [selection.instanceId]: { driver: "antigravity", displayName: "Google Work" },
          },
        },
      } as unknown as ServerConfig;

      expect(resolveDefaultableModelSelection(missingStatusConfig, selection)).toBe(selection);
      expect(isModelSelectionUnavailable(missingStatusConfig, selection)).toBe(true);
      expect(buildModelOptions(missingStatusConfig, selection)).toMatchObject([
        {
          providerDriver: "antigravity",
          providerLabel: "Google Work",
          isUnavailable: true,
          selection,
        },
      ]);
    });

    it("keeps offline selections without assuming that an unknown instance is Antigravity", () => {
      const unknownConfig = { ...config, providers: [] };

      expect(resolveDefaultableModelSelection(null, selection)).toBe(selection);
      expect(isModelSelectionUnavailable(null, selection)).toBe(false);
      expect(buildModelOptions(null, selection)[0]?.selection).toBe(selection);
      expect(buildModelOptions(null, selection)[0]?.isUnavailable).not.toBe(true);
      expect(isModelSelectionUnavailable(unknownConfig, selection)).toBe(false);
      expect(resolveSelectableModelSelection(unknownConfig, selection)).toBeNull();
    });
  });

  it("keeps legacy models out of implicit defaults", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            { slug: "gpt-5.6-sol", name: "GPT-5.6 Sol", isCustom: false, capabilities: null },
            {
              slug: "gpt-5.4",
              name: "GPT-5.4",
              isCustom: false,
              isLegacy: true,
              capabilities: null,
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const current = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" };
    const legacy = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

    expect(resolveDefaultableModelSelection(config, current)).toBe(current);
    // A legacy last-used selection falls through to the provider default.
    expect(resolveDefaultableModelSelection(config, legacy)).toBeNull();
    // Offline: nothing to validate against, selection passes through.
    expect(resolveDefaultableModelSelection(null, legacy)).toBe(legacy);
  });

  it("resolves new tasks from draft, project, sticky, then provider defaults", () => {
    const draft = { instanceId: ProviderInstanceId.make("codex"), model: "draft" };
    const project = { instanceId: ProviderInstanceId.make("codex"), model: "project" };
    const sticky = { instanceId: ProviderInstanceId.make("codex"), model: "sticky" };
    const providerDefault = {
      selection: { instanceId: ProviderInstanceId.make("codex"), model: "default" },
      isDefault: true,
    } as ModelOption;
    const resolve = (
      draftSelection: ModelSelection | null,
      projectDefaultSelection: ModelSelection | null,
      stickySelection: ModelSelection | null,
    ) =>
      resolveNewTaskModelSelection({
        draftSelection,
        projectDefaultSelection,
        stickySelection,
        modelOptions: [providerDefault],
      });

    expect(resolve(draft, project, sticky)).toBe(draft);
    expect(resolve(null, project, sticky)).toBe(project);
    expect(resolve(null, null, sticky)).toBe(sticky);
    expect(resolve(null, null, null)).toBe(providerDefault.selection);

    const unavailable = { ...providerDefault, isUnavailable: true };
    expect(
      resolveNewTaskModelSelection({
        draftSelection: null,
        projectDefaultSelection: null,
        stickySelection: null,
        modelOptions: [unavailable],
      }),
    ).toBeNull();
  });
});

describe("mobile Daybreak model changes", () => {
  function option(
    instanceId: string,
    model: string,
    programs: ReadonlyArray<"daybreakBlue" | "daybreakRed"> = [],
  ): ModelOption {
    return {
      key: `${instanceId}:${model}`,
      label: model,
      subtitle: "",
      providerKey: instanceId,
      providerLabel: instanceId,
      providerDriver: "codex",
      isDefault: false,
      isLegacy: false,
      capabilities: {
        optionDescriptors: programs.length
          ? [
              {
                id: "cyberAccessProgram",
                label: "Daybreak",
                type: "select",
                options: [
                  { id: "automatic", label: "Auto", isDefault: true },
                  { id: "standard", label: "Off" },
                  ...programs.map((id) => ({ id, label: id })),
                ],
              },
            ]
          : [],
      },
      selection: {
        instanceId: ProviderInstanceId.make(instanceId),
        model,
        options: [{ id: "reasoningEffort", value: "high" }],
      },
    };
  }

  const current: ModelSelection = {
    instanceId: ProviderInstanceId.make("codex-work"),
    model: "gpt-current",
    options: [
      { id: "reasoningEffort", value: "medium" },
      { id: "serviceTier", value: "priority" },
      { id: "cyberAccessProgram", value: "daybreakBlue" },
    ],
  };

  it("keeps both capable and incapable models in the catalog while Daybreak is enabled", () => {
    const capable = option("codex-work", "gpt-current", ["daybreakBlue"]);
    const incapable = option("codex-work", "gpt-other");
    const config = {
      providers: [
        {
          instanceId: current.instanceId,
          driver: "codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [capable, incapable].map((entry) => ({
            slug: entry.selection.model,
            name: entry.label,
            isCustom: false,
            capabilities: entry.capabilities,
          })),
        },
      ],
    } as unknown as ServerConfig;

    expect(buildModelOptions(config, current).map((entry) => entry.selection.model)).toEqual([
      "gpt-current",
      "gpt-other",
    ]);
    expect(buildModelOptions(config, null).map((entry) => entry.selection.options)).toEqual([
      undefined,
      undefined,
    ]);
    const resumed = buildModelOptions(config, {
      instanceId: current.instanceId,
      model: current.model,
    });
    expect(resumed[0]?.selection.options).toBeUndefined();
    const explicitlyOff = buildModelOptions(config, {
      instanceId: current.instanceId,
      model: "gpt-other",
      options: [{ id: "cyberAccessProgram", value: "standard" }],
    });
    expect(explicitlyOff[1]?.selection.options).toEqual([
      { id: "cyberAccessProgram", value: "standard" },
    ]);
  });

  it("Cancel preserves the complete current selection without staging the destination", async () => {
    const original = structuredClone(current);
    const destination = option("codex-work", "gpt-unsupported");
    let selected = current;
    const next = await resolveModelOptionChange({
      currentSelection: selected,
      option: destination,
      confirmDaybreakOff: async () => false,
    });
    if (next) selected = next.selection;

    expect(next).toBeNull();
    expect(selected).toBe(current);
    expect(current).toEqual(original);
    expect(destination.selection.options).toEqual([{ id: "reasoningEffort", value: "high" }]);
  });

  it("OK switches models and explicitly turns Daybreak off while retaining other destination options", async () => {
    const next = await resolveModelOptionChange({
      currentSelection: current,
      option: option("codex-work", "gpt-unsupported"),
      confirmDaybreakOff: async () => true,
    });

    expect(next?.selection).toEqual({
      instanceId: ProviderInstanceId.make("codex-work"),
      model: "gpt-unsupported",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "cyberAccessProgram", value: "standard" },
      ],
    });
  });

  it("checks the destination account even when the model slug is unchanged", async () => {
    expect(
      await resolveModelOptionChange({
        currentSelection: current,
        option: option("codex-personal", current.model),
        confirmDaybreakOff: async () => false,
      }),
    ).toBeNull();
  });

  it.each(["daybreakBlue", "daybreakRed"] as const)(
    "preserves %s only when the destination account and model advertise it",
    async (program) => {
      const next = await resolveModelOptionChange({
        currentSelection: { ...current, options: [{ id: "cyberAccessProgram", value: program }] },
        option: option("codex-personal", "gpt-other", [program]),
        confirmDaybreakOff: async () => {
          throw new Error("A supported program must not require confirmation");
        },
      });
      expect(next?.selection).toEqual({
        instanceId: ProviderInstanceId.make("codex-personal"),
        model: "gpt-other",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "cyberAccessProgram", value: program },
        ],
      });
    },
  );

  it("does not silently replace Blue with Red on a Red-only destination", async () => {
    const next = await resolveModelOptionChange({
      currentSelection: current,
      option: option("codex-work", "gpt-red", ["daybreakRed"]),
      confirmDaybreakOff: async () => true,
    });
    expect(next?.selection.options).toContainEqual({ id: "cyberAccessProgram", value: "standard" });
  });

  it.each([
    {
      label: "Off",
      value: "standard",
      expected: [{ id: "cyberAccessProgram", value: "standard" }],
    },
    { label: "Auto", value: "automatic", expected: [] },
    { label: "unset", value: undefined, expected: [] },
  ])(
    "does not restore remembered Daybreak while the current mode is $label",
    async ({ value, expected }) => {
      const destination = option("codex-work", "gpt-other", ["daybreakBlue"]);
      const next = await resolveModelOptionChange({
        currentSelection: {
          ...current,
          options: value ? [{ id: "cyberAccessProgram", value }] : [],
        },
        option: {
          ...destination,
          selection: {
            ...destination.selection,
            options: [
              ...destination.selection.options!,
              { id: "cyberAccessProgram", value: "daybreakBlue" },
            ],
          },
        },
        confirmDaybreakOff: async () => {
          throw new Error("An inactive Daybreak program does not need confirmation");
        },
      });
      expect(next?.selection.options).toEqual([
        { id: "reasoningEffort", value: "high" },
        ...expected,
      ]);
    },
  );

  it("clears the provider-specific option when switching away from Codex", async () => {
    const destination = option("claude", "claude-model");
    const next = await resolveModelOptionChange({
      currentSelection: current,
      option: { ...destination, providerDriver: "claudeAgent" },
      confirmDaybreakOff: async () => true,
    });
    expect(next?.selection.options).toEqual([{ id: "reasoningEffort", value: "high" }]);
  });

  it("checks capability loss again when committing the same staged model", async () => {
    const destination = option("codex-work", current.model);
    expect(
      await resolveModelOptionChange({
        currentSelection: current,
        option: { ...destination, selection: current },
        confirmDaybreakOff: async () => false,
      }),
    ).toBeNull();
  });
});
