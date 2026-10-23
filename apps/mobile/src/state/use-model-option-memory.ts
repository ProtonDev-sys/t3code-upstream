import type { EnvironmentId, ProviderOptionSelection } from "@t3tools/contracts";
import { appAtomRegistry } from "./atom-registry";
import {
  modelOptionMemoryAtom,
  schedulePersistComposerState,
  type ModelOptionMemoryState,
} from "./use-composer-drafts";

function recordModelOptionsInState(
  state: ModelOptionMemoryState,
  key: string,
  model: string,
  options: ReadonlyArray<ProviderOptionSelection>,
): ModelOptionMemoryState {
  return {
    ...state,
    [key]: {
      ...(state[key] ?? {}),
      [model]: options,
    },
  };
}

export function rememberModelOptions(
  instanceId: string,
  model: string,
  options: ReadonlyArray<ProviderOptionSelection>,
  environmentId: EnvironmentId | null,
): void {
  if (
    !environmentId ||
    (options.length === 0 && rememberedModelOptions(instanceId, model, environmentId) === undefined)
  ) {
    return;
  }
  const current = appAtomRegistry.get(modelOptionMemoryAtom);
  const next = recordModelOptionsInState(
    current,
    JSON.stringify([environmentId, instanceId]),
    model,
    options,
  );
  if (next !== current) {
    appAtomRegistry.set(modelOptionMemoryAtom, next);
    schedulePersistComposerState();
  }
}

export function rememberedModelOptions(
  instanceId: string,
  model: string,
  environmentId: EnvironmentId | null,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  if (!environmentId) return undefined;
  const state = appAtomRegistry.get(modelOptionMemoryAtom);
  const scoped = state[JSON.stringify([environmentId, instanceId])]?.[model];
  if (scoped !== undefined) return scoped;
  // Legacy memory has no environment owner, so only unrelated preferences can be reused.
  return state[instanceId]?.[model]?.filter((option) => option.id !== "cyberAccessProgram");
}

export function withRememberedModelOptions<
  T extends {
    readonly instanceId: string;
    readonly model: string;
    readonly options?: ReadonlyArray<ProviderOptionSelection>;
  },
>(selection: T, environmentId: EnvironmentId | null): T {
  const remembered = rememberedModelOptions(selection.instanceId, selection.model, environmentId);
  if (
    remembered === undefined ||
    JSON.stringify(remembered) === JSON.stringify(selection.options ?? [])
  ) {
    return selection;
  }
  return { ...selection, options: remembered };
}
