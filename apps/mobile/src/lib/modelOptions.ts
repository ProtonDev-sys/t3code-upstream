import type { MenuAction } from "@react-native-menu/menu";
import type {
  ModelCapabilities,
  ModelSelection,
  RuntimeMode,
  ServerConfig as T3ServerConfig,
} from "@t3tools/contracts";
import {
  buildExplicitProviderOptionSelectionsFromDescriptors,
  getModelSelectionDaybreakProgram,
  getProviderOptionDescriptors,
  modelSupportsDaybreakProgram,
} from "@t3tools/shared/model";

export type ModelOption = {
  readonly key: string;
  readonly label: string;
  readonly subtitle: string;
  readonly providerKey: string;
  readonly providerLabel: string;
  readonly providerDriver: string;
  readonly supportedRuntimeModes?: ReadonlyArray<RuntimeMode>;
  readonly providerIconUrl?: string | undefined;
  readonly isDefault: boolean;
  readonly isLegacy: boolean;
  readonly isUnavailable?: boolean;
  readonly capabilities: ModelCapabilities | null;
  readonly selection: ModelSelection;
};

export type ProviderGroup = {
  readonly providerKey: string;
  readonly providerLabel: string;
  readonly models: ReadonlyArray<ModelOption>;
};

/** Resolve a model pick before changing any draft, thread, or remembered options. */
export async function resolveModelOptionChange(input: {
  readonly currentSelection: ModelSelection | null;
  readonly option: ModelOption;
  readonly confirmDaybreakOff: () => Promise<boolean>;
}): Promise<ModelOption | null> {
  const program = getModelSelectionDaybreakProgram(input.currentSelection);
  const supportedProgram =
    program && modelSupportsDaybreakProgram(input.option, program) ? program : undefined;
  if (program && !supportedProgram && !(await input.confirmDaybreakOff())) {
    return null;
  }
  const explicitlyOff = input.currentSelection?.options?.some(
    (option) => option.id === "cyberAccessProgram" && option.value === "standard",
  );
  const nextProgram = supportedProgram ?? (program || explicitlyOff ? "standard" : undefined);

  // Daybreak follows the explicit current mode, never a destination's memory.
  // An explicit Off also prevents a prior Codex session mode from resurfacing.
  const options = [
    ...(input.option.selection.options ?? []).filter(
      (option) => option.id !== "cyberAccessProgram",
    ),
    ...(input.option.providerDriver === "codex" && nextProgram
      ? [{ id: "cyberAccessProgram", value: nextProgram }]
      : []),
  ];
  return {
    ...input.option,
    selection: {
      instanceId: input.option.selection.instanceId,
      model: input.option.selection.model,
      ...(options.length > 0 ? { options } : {}),
    },
  };
}

function providerDisplayLabel(provider: {
  readonly displayName?: string | undefined;
  readonly driver: string;
  readonly instanceId: string;
}): string {
  if (provider.displayName) return provider.displayName;
  if (provider.driver === "codex") return "Codex";
  if (provider.driver === "claudeAgent") return "Claude";
  if (provider.driver === "pi") return "Pi";
  return provider.instanceId;
}

function normalizeSelectionOptions(
  selection: ModelSelection,
  capabilities: ModelCapabilities | null,
  providerDriver: string,
): ModelSelection {
  if (!capabilities) {
    return selection;
  }
  const selections = selection.options;
  if (!selections?.length) {
    return { instanceId: selection.instanceId, model: selection.model };
  }
  let options = buildExplicitProviderOptionSelectionsFromDescriptors(
    getProviderOptionDescriptors({
      caps: capabilities,
      selections,
    }),
    selections,
  );
  const explicitOff =
    providerDriver === "codex"
      ? selections.find(
          (option) => option.id === "cyberAccessProgram" && option.value === "standard",
        )
      : undefined;
  if (explicitOff && !options?.some((option) => option.id === "cyberAccessProgram")) {
    options = [...(options ?? []), explicitOff];
  }
  return options
    ? { ...selection, options }
    : {
        instanceId: selection.instanceId,
        model: selection.model,
      };
}

/** Whether a known Antigravity selection needs setup or a different model. */
export function isModelSelectionUnavailable(
  config: T3ServerConfig | null | undefined,
  selection: ModelSelection | null | undefined,
): boolean {
  if (!config || !selection) {
    return false;
  }
  const provider = config.providers.find(
    (candidate) => candidate.instanceId === selection.instanceId,
  );
  const driver =
    provider?.driver ?? config.settings?.providerInstances[selection.instanceId]?.driver;
  return (
    driver === "antigravity" &&
    (!provider ||
      !provider.enabled ||
      !provider.installed ||
      provider.auth.status === "unauthenticated" ||
      provider.availability === "unavailable" ||
      !provider.models.some((model) => model.slug === selection.model))
  );
}

/**
 * Keep Antigravity selections when setup or catalog changes make them
 * unavailable. Other providers fall through to the server default when they
 * are disabled, missing, or signed out. Without config, keep stored selections.
 */
export function resolveSelectableModelSelection(
  config: T3ServerConfig | null | undefined,
  selection: ModelSelection | null,
): ModelSelection | null {
  if (!selection || !config) {
    return selection;
  }
  const provider = config.providers.find(
    (candidate) => candidate.instanceId === selection.instanceId,
  );
  const driver =
    provider?.driver ?? config.settings?.providerInstances[selection.instanceId]?.driver;
  if (driver === "antigravity") {
    return selection;
  }
  return provider &&
    provider.enabled &&
    provider.installed &&
    provider.auth.status !== "unauthenticated"
    ? selection
    : null;
}

/**
 * Reject legacy models for implicit defaults, except Antigravity selections,
 * which must not silently change after a catalog update. Explicit picks in
 * the settings sheet are unaffected.
 */
export function resolveDefaultableModelSelection(
  config: T3ServerConfig | null | undefined,
  selection: ModelSelection | null,
): ModelSelection | null {
  const usable = resolveSelectableModelSelection(config, selection);
  if (!usable || !config) {
    return usable;
  }
  const provider = config.providers.find((candidate) => candidate.instanceId === usable.instanceId);
  const model = provider?.models.find((candidate) => candidate.slug === usable.model);
  return provider?.driver !== "antigravity" && model?.isLegacy === true ? null : usable;
}

export function resolveNewTaskModelSelection(input: {
  readonly draftSelection: ModelSelection | null;
  readonly projectDefaultSelection: ModelSelection | null;
  readonly stickySelection: ModelSelection | null;
  readonly modelOptions: ReadonlyArray<ModelOption>;
}): ModelSelection | null {
  return (
    input.draftSelection ??
    input.projectDefaultSelection ??
    input.stickySelection ??
    input.modelOptions.find((option) => option.isDefault && !option.isUnavailable)?.selection ??
    input.modelOptions.find((option) => !option.isUnavailable)?.selection ??
    null
  );
}

export function buildModelOptions(
  config: T3ServerConfig | null | undefined,
  fallbackModelSelection: ModelSelection | null,
  providerInstanceId?: ModelSelection["instanceId"],
): ReadonlyArray<ModelOption> {
  const options = new Map<string, ModelOption>();

  for (const provider of config?.providers ?? []) {
    if (
      (providerInstanceId !== undefined && provider.instanceId !== providerInstanceId) ||
      !provider.enabled ||
      !provider.installed ||
      provider.auth.status === "unauthenticated" ||
      (provider.driver === "antigravity" && provider.availability === "unavailable")
    ) {
      continue;
    }

    const providerLabel = providerDisplayLabel(provider);
    for (const model of provider.models) {
      const key = `${provider.instanceId}:${model.slug}`;
      options.set(key, {
        key,
        label: model.name,
        subtitle: model.subProvider ?? "",
        providerKey: provider.instanceId,
        providerLabel,
        providerDriver: provider.driver,
        ...(provider.supportedRuntimeModes === undefined
          ? {}
          : { supportedRuntimeModes: provider.supportedRuntimeModes }),
        ...(provider.iconUrl ? { providerIconUrl: provider.iconUrl } : {}),
        isDefault: model.isDefault === true,
        isLegacy: model.isLegacy === true,
        capabilities: model.capabilities,
        selection: normalizeSelectionOptions(
          {
            instanceId: provider.instanceId,
            model: model.slug,
          },
          model.capabilities,
          provider.driver,
        ),
      });
    }
  }

  if (
    fallbackModelSelection &&
    (providerInstanceId === undefined || fallbackModelSelection.instanceId === providerInstanceId)
  ) {
    const key = `${fallbackModelSelection.instanceId}:${fallbackModelSelection.model}`;
    const existing = options.get(key);
    if (existing) {
      options.set(key, {
        ...existing,
        selection:
          existing.providerDriver === "antigravity"
            ? fallbackModelSelection
            : normalizeSelectionOptions(
                fallbackModelSelection,
                existing.capabilities,
                existing.providerDriver,
              ),
      });
    } else {
      const provider = config?.providers.find(
        (candidate) => candidate.instanceId === fallbackModelSelection.instanceId,
      );
      const instanceConfig = config?.settings?.providerInstances[fallbackModelSelection.instanceId];
      const model = provider?.models.find(
        (candidate) => candidate.slug === fallbackModelSelection.model,
      );
      const providerDriver =
        provider?.driver ?? instanceConfig?.driver ?? fallbackModelSelection.instanceId;
      const providerLabel = providerDisplayLabel({
        driver: providerDriver,
        displayName: provider?.displayName ?? instanceConfig?.displayName,
        instanceId: fallbackModelSelection.instanceId,
      });
      options.set(key, {
        key,
        label: model?.name ?? fallbackModelSelection.model,
        subtitle: model?.subProvider ?? "",
        providerKey: fallbackModelSelection.instanceId,
        providerLabel,
        providerDriver,
        isDefault: false,
        isLegacy: model?.isLegacy === true,
        ...(isModelSelectionUnavailable(config, fallbackModelSelection)
          ? { isUnavailable: true }
          : {}),
        capabilities: model?.capabilities ?? null,
        selection: fallbackModelSelection,
      });
    }
  }

  return [...options.values()];
}

export function groupByProvider(options: ReadonlyArray<ModelOption>): ReadonlyArray<ProviderGroup> {
  const groups = new Map<string, { providerLabel: string; models: ModelOption[] }>();
  for (const option of options) {
    const existing = groups.get(option.providerKey);
    if (existing) {
      existing.models.push(option);
    } else {
      groups.set(option.providerKey, {
        providerLabel: option.providerLabel,
        models: [option],
      });
    }
  }

  return [...groups.entries()].map(([providerKey, group]) => ({
    providerKey,
    providerLabel: group.providerLabel,
    models: group.models,
  }));
}

function modelMenuAction(option: ModelOption, selectedModel: ModelSelection | null): MenuAction {
  return {
    id: `model:${option.key}`,
    title: option.label,
    state:
      option.selection.instanceId === selectedModel?.instanceId &&
      option.selection.model === selectedModel.model
        ? "on"
        : undefined,
  };
}

export function buildModelMenuActions(
  groups: ReadonlyArray<ProviderGroup>,
  selectedModel: ModelSelection | null,
): MenuAction[] {
  return groups.flatMap((group) => {
    const currentModels = group.models.filter((model) => !model.isLegacy);
    const legacyModels = group.models.filter((model) => model.isLegacy);
    const selected = group.models.find(
      (model) =>
        model.selection.instanceId === selectedModel?.instanceId &&
        model.selection.model === selectedModel.model,
    );

    return [
      ...(currentModels.length > 0
        ? [
            {
              id: `provider:${group.providerKey}`,
              title: group.providerLabel,
              subtitle: selected && !selected.isLegacy ? selected.label : undefined,
              subactions: currentModels.map((option) => modelMenuAction(option, selectedModel)),
            },
          ]
        : []),
      ...(legacyModels.length > 0
        ? [
            {
              id: `legacy-models:${group.providerKey}`,
              title: `${group.providerLabel} legacy models`,
              subtitle: selected?.isLegacy ? selected.label : undefined,
              subactions: legacyModels.map((option) => modelMenuAction(option, selectedModel)),
            },
          ]
        : []),
    ];
  });
}
