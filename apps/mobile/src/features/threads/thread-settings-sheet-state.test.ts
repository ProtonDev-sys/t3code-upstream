import { afterEach, beforeEach, describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import {
  EnvironmentId,
  ProviderInstanceId,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import { getProviderOptionDescriptors } from "@t3tools/shared/model";

import type { ModelOption } from "../../lib/modelOptions";
import { appAtomRegistry } from "../../state/atom-registry";
import { modelOptionMemoryAtom } from "../../state/use-composer-drafts";
import {
  rememberModelOptions,
  rememberedModelOptions,
  withRememberedModelOptions,
} from "../../state/use-model-option-memory";
import {
  canCommitPendingModel,
  pendingModelAfterPress,
  refreshPendingModel,
} from "./thread-settings-sheet-state";

const ENVIRONMENT = EnvironmentId.make("environment-1");

function modelOption(
  model: string,
  options: ReadonlyArray<ProviderOptionSelection> = [],
): ModelOption {
  return {
    key: `codex:${model}`,
    label: model,
    subtitle: "",
    providerKey: "codex",
    providerLabel: "Codex",
    providerDriver: "codex",
    isDefault: false,
    isLegacy: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "effort",
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
    },
    selection: {
      instanceId: ProviderInstanceId.make("codex"),
      model,
      options,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  appAtomRegistry.set(modelOptionMemoryAtom, {});
});

describe("thread settings sheet state", () => {
  it("refreshes catalog metadata when the staged model is pressed again", () => {
    const pending = modelOption("gpt-next", [{ id: "effort", value: "high" }]);
    const refreshed = { ...modelOption("gpt-next"), capabilities: null, label: "Updated" };

    expect(
      pendingModelAfterPress({ current: pending, pressed: refreshed, pressedIsApplied: false }),
    ).toEqual({ ...refreshed, selection: pending.selection });
  });

  it.each([
    { programs: ["daybreakBlue"] },
    { programs: ["daybreakRed"] },
    { programs: [] },
    { programs: undefined },
  ])(
    "drops revoked staged Daybreak access while preserving unrelated options: $programs",
    ({ programs }) => {
      const options = [
        { id: "effort", value: "high" },
        { id: "cyberAccessProgram", value: "daybreakBlue" },
      ];
      const pending = modelOption("gpt-next", options);
      const refreshed = {
        ...pending,
        capabilities:
          programs === undefined
            ? null
            : {
                optionDescriptors: [
                  {
                    id: "cyberAccessProgram",
                    label: "Daybreak",
                    type: "select" as const,
                    options: [...programs, "standard"].map((id) => ({ id, label: id })),
                  },
                ],
              },
      };
      const result = refreshPendingModel(pending, [
        { providerKey: "codex", providerLabel: "Codex", models: [refreshed] },
      ]);

      expect(result.capabilities).toBe(refreshed.capabilities);
      expect(result.selection.options).toEqual(
        programs?.includes("daybreakBlue") ? options : [{ id: "effort", value: "high" }],
      );
      expect(pending.selection.options).toEqual(options);
    },
  );

  it("does not restore a staged Daybreak selection after access returns", () => {
    const pending = modelOption("gpt-next", [{ id: "cyberAccessProgram", value: "daybreakBlue" }]);
    const refreshed = {
      ...pending,
      capabilities: {
        optionDescriptors: [
          {
            id: "cyberAccessProgram",
            label: "Daybreak",
            type: "select" as const,
            options: [{ id: "daybreakBlue", label: "Blue" }],
          },
        ],
      },
    };
    const revoked = refreshPendingModel(pending, []);
    expect(canCommitPendingModel(revoked, [])).toBe(false);
    const restored = refreshPendingModel(revoked, [
      { providerKey: "codex", providerLabel: "Codex", models: [refreshed] },
    ]);
    expect(restored.selection.options ?? []).toEqual([]);
  });

  it("keeps remembered choices unchanged while staging and refreshing a model", () => {
    const remembered = [{ id: "cyberAccessProgram", value: "daybreakBlue" }];
    rememberModelOptions("codex", "gpt-other", remembered, ENVIRONMENT);
    const pending = pendingModelAfterPress({
      current: null,
      pressed: modelOption("gpt-other"),
      pressedIsApplied: false,
      restoreSelection: (selection) => withRememberedModelOptions(selection, ENVIRONMENT),
    })!;
    expect(refreshPendingModel(pending, []).selection.options ?? []).toEqual([]);
    expect(rememberedModelOptions("codex", "gpt-other", ENVIRONMENT)).toEqual(remembered);
    expect(
      pendingModelAfterPress({ current: pending, pressed: pending, pressedIsApplied: true }),
    ).toBeNull();
    expect(rememberedModelOptions("codex", "gpt-other", ENVIRONMENT)).toEqual(remembered);
  });

  it("clears remembered Daybreak choices when the saved selection has no options", () => {
    rememberModelOptions(
      "codex",
      "gpt-next",
      [{ id: "cyberAccessProgram", value: "daybreakBlue" }],
      ENVIRONMENT,
    );
    rememberModelOptions("codex", "gpt-next", [], ENVIRONMENT);
    expect(
      withRememberedModelOptions(modelOption("gpt-next").selection, ENVIRONMENT).options,
    ).toEqual([]);
  });

  it("preserves in-progress edits when the staged model is pressed again", () => {
    rememberModelOptions("codex", "gpt-next", [{ id: "effort", value: "medium" }], ENVIRONMENT);
    const pending = modelOption("gpt-next", [{ id: "effort", value: "high" }]);

    expect(
      pendingModelAfterPress({
        current: pending,
        pressed: modelOption("gpt-next"),
        pressedIsApplied: false,
        restoreSelection: (selection) => withRememberedModelOptions(selection, ENVIRONMENT),
      })?.selection.options,
    ).toEqual([{ id: "effort", value: "high" }]);
  });

  it("previews remembered options before Save when switching models", () => {
    const remembered = [
      { id: "effort", value: "high" },
      { id: "serviceTier", value: "priority" },
    ];
    rememberModelOptions("codex", "gpt-other", remembered, ENVIRONMENT);
    const pressed = modelOption("gpt-other");

    const pending = pendingModelAfterPress({
      current: modelOption("gpt-next"),
      pressed,
      pressedIsApplied: false,
      restoreSelection: (selection) => withRememberedModelOptions(selection, ENVIRONMENT),
    });

    expect(pending?.selection).toEqual({ ...pressed.selection, options: remembered });
    const preview = getProviderOptionDescriptors({
      caps: pressed.capabilities!,
      selections: pending?.selection.options,
    });
    expect(preview.map(({ id, currentValue }) => ({ id, value: currentValue }))).toEqual(
      remembered,
    );
    expect(pending?.selection).toEqual(withRememberedModelOptions(pressed.selection, ENVIRONMENT));
  });

  it("keeps catalog defaults for scheduled-task picks even when options are remembered", () => {
    rememberModelOptions(
      "codex",
      "gpt-other",
      [
        { id: "effort", value: "high" },
        { id: "serviceTier", value: "priority" },
      ],
      ENVIRONMENT,
    );
    const pressed = modelOption("gpt-other");

    const pending = pendingModelAfterPress({
      current: modelOption("gpt-next"),
      pressed,
      pressedIsApplied: false,
    });

    expect(pending?.selection).toEqual(pressed.selection);
    const preview = getProviderOptionDescriptors({
      caps: pressed.capabilities!,
      selections: pending?.selection.options,
    });
    expect(preview.map(({ id, currentValue }) => ({ id, value: currentValue }))).toEqual([
      { id: "effort", value: "medium" },
      { id: "serviceTier", value: "default" },
    ]);
  });

  // regression: #16816 sync model favorites and visibility across clients
  it("cannot select a hidden model exposed only for visibility management", () => {
    const pending = modelOption("gpt-next");
    expect(
      canCommitPendingModel(pending, [
        { providerKey: "codex", providerLabel: "Codex", models: [{ ...pending, isHidden: true }] },
      ]),
    ).toBe(false);
  });

  it("cannot save a staged model after sign-out removes it from the catalog", () => {
    const pending = modelOption("gemini-native");
    const group = { providerKey: "codex", providerLabel: "Codex", models: [pending] };

    expect(canCommitPendingModel(pending, [group])).toBe(true);
    expect(canCommitPendingModel(pending, [])).toBe(false);
    expect(
      canCommitPendingModel(pending, [
        {
          ...group,
          models: [{ ...pending, isUnavailable: true }],
        },
      ]),
    ).toBe(false);
  });
});
