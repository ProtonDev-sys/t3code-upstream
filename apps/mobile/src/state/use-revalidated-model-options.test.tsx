import {
  EnvironmentId,
  IsoDateTime,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ProviderOptionSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { act, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "./atom-registry";
import * as ComposerDrafts from "./use-composer-drafts";
import {
  rememberModelOptions,
  rememberedModelOptions,
  withRememberedModelOptions,
} from "./use-model-option-memory";
import { useRevalidatedModelOptions } from "./use-revalidated-model-options";

const ENVIRONMENT_A = EnvironmentId.make("environment-a");
const ENVIRONMENT_B = EnvironmentId.make("environment-b");

const INITIAL_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex_work"),
  model: "gpt-next",
  options: [
    { id: "effort", value: "high" },
    { id: "cyberAccessProgram", value: "daybreakBlue" },
    { id: "otherOption", value: true },
  ],
};

function provider(programs: ReadonlyArray<string>): ServerProvider {
  return {
    instanceId: INITIAL_SELECTION.instanceId,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    checkedAt: IsoDateTime.make("2026-10-23T10:00:00.000Z"),
    auth: { status: "authenticated" },
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: INITIAL_SELECTION.model,
        name: "GPT Next",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "cyberAccessProgram",
              label: "Daybreak",
              type: "select",
              options: [...programs, "standard"].map((id) => ({ id, label: id })),
            },
          ],
        },
      },
    ],
  };
}

function setup(loaded: Promise<void> = Promise.resolve()) {
  const runtime = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = runtime.IS_REACT_ACT_ENVIRONMENT;
  runtime.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  const waitForDrafts = vi
    .spyOn(ComposerDrafts, "waitForComposerDraftsLoaded")
    .mockReturnValue(loaded);
  appAtomRegistry.set(ComposerDrafts.modelOptionMemoryAtom, {});
  return {
    [Symbol.dispose]() {
      appAtomRegistry.set(ComposerDrafts.modelOptionMemoryAtom, {});
      waitForDrafts.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
      runtime.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    },
  };
}

function mount(initial: ModelSelection = INITIAL_SELECTION) {
  const root = createRoot(document.createElement("div"));
  let applied = initial;
  let restoreSelection: ((selection: ModelSelection) => void) | null = null;
  const updates = vi.fn();
  function Composer(props: {
    readonly provider: ServerProvider | null | undefined;
    readonly environmentId: EnvironmentId | null;
  }) {
    const [selection, setSelection] = useState(initial);
    useLayoutEffect(() => {
      applied = selection;
      restoreSelection = setSelection;
    }, [selection]);
    useRevalidatedModelOptions({
      ownerKey: `${props.environmentId}:thread`,
      environmentId: props.environmentId,
      selection,
      provider: props.provider,
      onUpdateSelection(next) {
        updates(next);
        setSelection(next);
      },
    });
    return null;
  }
  return {
    updates,
    applied: () => applied,
    async render(
      provider: ServerProvider | null | undefined,
      environmentId: EnvironmentId | null = ENVIRONMENT_A,
    ) {
      await act(async () =>
        root.render(<Composer provider={provider} environmentId={environmentId} />),
      );
    },
    restore(selection: ModelSelection) {
      act(() => restoreSelection!(selection));
    },
    [Symbol.dispose]() {
      act(() => root.unmount());
    },
  };
}

describe("applied mobile model options", () => {
  it("keeps another environment's remembered Daybreak choice through revocation and restore", async () => {
    using _setup = setup();
    const original = INITIAL_SELECTION.options!;
    const otherOptions = [
      { id: "effort", value: "medium" },
      { id: "cyberAccessProgram", value: "daybreakBlue" },
    ];
    rememberModelOptions(
      INITIAL_SELECTION.instanceId,
      INITIAL_SELECTION.model,
      original,
      ENVIRONMENT_A,
    );
    expect(
      withRememberedModelOptions({ ...INITIAL_SELECTION, options: [] }, ENVIRONMENT_B).options,
    ).toEqual([]);
    rememberModelOptions(
      INITIAL_SELECTION.instanceId,
      INITIAL_SELECTION.model,
      otherOptions,
      ENVIRONMENT_B,
    );
    using composer = mount({ ...INITIAL_SELECTION, options: [] });
    await composer.render(provider([]), ENVIRONMENT_B);

    expect(
      rememberedModelOptions(INITIAL_SELECTION.instanceId, INITIAL_SELECTION.model, ENVIRONMENT_A),
    ).toEqual(original);
    expect(
      rememberedModelOptions(INITIAL_SELECTION.instanceId, INITIAL_SELECTION.model, ENVIRONMENT_B),
    ).toEqual([{ id: "effort", value: "medium" }]);
    const restored = withRememberedModelOptions(
      { ...INITIAL_SELECTION, options: [] },
      ENVIRONMENT_A,
    );
    using freshComposer = mount(restored);
    await freshComposer.render(provider(["daybreakBlue"]), ENVIRONMENT_A);
    expect(freshComposer.applied().options).toEqual(original);
    expect(freshComposer.updates).not.toHaveBeenCalled();
    expect(composer.updates).not.toHaveBeenCalled();
  });

  it("does not clean applied or remembered choices without a known environment", async () => {
    using _setup = setup();
    rememberModelOptions(
      INITIAL_SELECTION.instanceId,
      INITIAL_SELECTION.model,
      INITIAL_SELECTION.options!,
      ENVIRONMENT_A,
    );
    using composer = mount();
    await composer.render(provider([]), null);
    expect(composer.applied()).toBe(INITIAL_SELECTION);
    expect(composer.updates).not.toHaveBeenCalled();
    expect(
      rememberedModelOptions(INITIAL_SELECTION.instanceId, INITIAL_SELECTION.model, ENVIRONMENT_A),
    ).toEqual(INITIAL_SELECTION.options);
  });

  it.each([{ programs: ["daybreakRed"] }, { programs: [] }])(
    "persists applied revocation with no settings sheet mounted: $programs",
    async ({ programs }) => {
      using _setup = setup();
      const original = INITIAL_SELECTION.options!;
      rememberModelOptions(
        INITIAL_SELECTION.instanceId,
        INITIAL_SELECTION.model,
        original,
        ENVIRONMENT_A,
      );
      const otherAccount = ProviderInstanceId.make("codex_personal");
      rememberModelOptions(otherAccount, INITIAL_SELECTION.model, original, ENVIRONMENT_A);
      rememberModelOptions(INITIAL_SELECTION.instanceId, "gpt-other", original, ENVIRONMENT_A);
      using composer = mount();
      await composer.render(provider(["daybreakBlue"]));
      expect(composer.updates).not.toHaveBeenCalled();

      const revoked = provider(programs);
      await composer.render(revoked);

      const expected = original.filter((option) => option.id !== "cyberAccessProgram");
      expect(composer.applied().options).toEqual(expected);
      expect(
        rememberedModelOptions(
          INITIAL_SELECTION.instanceId,
          INITIAL_SELECTION.model,
          ENVIRONMENT_A,
        ),
      ).toEqual(expected);
      expect(rememberedModelOptions(otherAccount, INITIAL_SELECTION.model, ENVIRONMENT_A)).toEqual(
        original,
      );
      expect(
        rememberedModelOptions(INITIAL_SELECTION.instanceId, "gpt-other", ENVIRONMENT_A),
      ).toEqual(original);
      expect(composer.updates).toHaveBeenCalledOnce();
      await composer.render(revoked);
      await composer.render(provider(["daybreakBlue"]));
      expect(composer.updates).toHaveBeenCalledOnce();
      expect(composer.applied().options).toEqual(expected);
      expect(withRememberedModelOptions(INITIAL_SELECTION, ENVIRONMENT_A).options).toEqual(
        expected,
      );
    },
  );

  it("clears remembered access when revocation leaves no options", async () => {
    using _setup = setup();
    const selection = {
      ...INITIAL_SELECTION,
      options: [{ id: "cyberAccessProgram", value: "daybreakBlue" }],
    };
    rememberModelOptions(selection.instanceId, selection.model, selection.options, ENVIRONMENT_A);
    using composer = mount(selection);
    await composer.render(provider([]));
    expect(composer.applied().options ?? []).toEqual([]);
    expect(withRememberedModelOptions(selection, ENVIRONMENT_A).options).toEqual([]);
  });

  it.each(["daybreakBlue", "daybreakRed", "standard"])(
    "preserves newer remembered choices while revoking the applied model: %s",
    async (program) => {
      using _setup = setup();
      const remembered = [
        { id: "effort", value: "medium" },
        { id: "serviceTier", value: "priority" },
        { id: "cyberAccessProgram", value: program },
      ];
      rememberModelOptions(
        INITIAL_SELECTION.instanceId,
        INITIAL_SELECTION.model,
        remembered,
        ENVIRONMENT_A,
      );
      using composer = mount();
      await composer.render(provider(["daybreakRed"]));
      expect(
        rememberedModelOptions(
          INITIAL_SELECTION.instanceId,
          INITIAL_SELECTION.model,
          ENVIRONMENT_A,
        ),
      ).toEqual(
        program === "daybreakBlue"
          ? remembered.filter((option) => option.id !== "cyberAccessProgram")
          : remembered,
      );
    },
  );

  it("cleans remembered revocation even when the applied selection is already Off", async () => {
    using _setup = setup();
    rememberModelOptions(
      INITIAL_SELECTION.instanceId,
      INITIAL_SELECTION.model,
      [{ id: "cyberAccessProgram", value: "daybreakBlue" }],
      ENVIRONMENT_A,
    );
    using composer = mount({ ...INITIAL_SELECTION, options: [] });
    await composer.render(provider([]));
    expect(
      rememberedModelOptions(INITIAL_SELECTION.instanceId, INITIAL_SELECTION.model, ENVIRONMENT_A),
    ).toEqual([]);
    expect(composer.updates).not.toHaveBeenCalled();
  });

  it("keeps explicit Off when its raw capability is hidden from the UI", async () => {
    using _setup = setup();
    const options: ReadonlyArray<ProviderOptionSelection> = [
      { id: "cyberAccessProgram", value: "standard" },
    ];
    using composer = mount({ ...INITIAL_SELECTION, options });
    await composer.render(provider([]));
    expect(composer.applied().options).toBe(options);
    expect(composer.updates).not.toHaveBeenCalled();
  });

  it("waits for the selected account and model without changing options while unavailable", async () => {
    using _setup = setup();
    const current = provider([]);
    using composer = mount();
    for (const unavailable of [
      undefined,
      null,
      { ...current, instanceId: ProviderInstanceId.make("codex_other") },
      { ...current, driver: ProviderDriverKind.make("claudeAgent") },
      { ...current, installed: false },
      { ...current, auth: { status: "unauthenticated" } },
      { ...current, availability: "unavailable" },
      { ...current, models: [{ ...current.models[0]!, slug: "gpt-other" }] },
    ] as const) {
      await composer.render(unavailable);
      expect(composer.applied()).toBe(INITIAL_SELECTION);
      expect(composer.updates).not.toHaveBeenCalled();
    }
    await composer.render(current);
    expect(composer.updates).toHaveBeenCalledOnce();
    expect(
      rememberedModelOptions(INITIAL_SELECTION.instanceId, INITIAL_SELECTION.model, ENVIRONMENT_A),
    ).toBeUndefined();
  });

  it("waits for draft hydration before writing a cleaned model", async () => {
    const loaded = Promise.withResolvers<void>();
    using _setup = setup(loaded.promise);
    using composer = mount();
    await composer.render(provider([]));
    expect(composer.updates).not.toHaveBeenCalled();

    const restored: ModelSelection = {
      ...INITIAL_SELECTION,
      options: [{ id: "effort", value: "medium" }],
    };
    composer.restore(restored);
    await act(async () => loaded.resolve());
    expect(composer.applied()).toBe(restored);
    expect(composer.updates).not.toHaveBeenCalled();
  });

  it("does not write settings when draft hydration fails", async () => {
    const loaded = Promise.withResolvers<void>();
    using _setup = setup(loaded.promise);
    using composer = mount();
    await composer.render(provider([]));
    await act(async () => loaded.reject(new Error("Drafts could not be loaded")));
    expect(composer.applied()).toBe(INITIAL_SELECTION);
    expect(composer.updates).not.toHaveBeenCalled();
  });
});
