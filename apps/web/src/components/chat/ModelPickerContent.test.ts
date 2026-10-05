import {
  ANTIGRAVITY_DEFAULT_MODEL,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  adjacentModelPickerProvider,
  resolveModelPickerSelectedModel,
  shouldIncludeModelPickerOption,
  shouldOfferModelPickerSetup,
  modelPickerDaybreakPrograms,
  modelPickerSelection,
} from "./ModelPickerContent";

function entry(status: ServerProvider["status"], driver = "opencode") {
  return deriveProviderInstanceEntries([
    {
      instanceId: ProviderInstanceId.make(`${driver}_work`),
      driver: ProviderDriverKind.make(driver),
      enabled: true,
      installed: true,
      version: null,
      status,
      auth: { status: "authenticated" },
      checkedAt: "2026-08-28T00:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
    },
  ])[0]!;
}

describe("Daybreak picker mode", () => {
  const luna = {
    instanceId: ProviderInstanceId.make("codex_work"),
    model: "luna",
    daybreakPrograms: ["daybreakBlue"],
  };

  it("offers only the current account's programs in eligible Codex views or Favorites", () => {
    const models = [
      { instanceId: luna.instanceId, slug: "luna", daybreakPrograms: ["daybreakBlue"] },
      { instanceId: luna.instanceId, slug: "astra" },
      { instanceId: ProviderInstanceId.make("claude"), slug: "fable" },
    ];
    const favorites = new Set([`${luna.instanceId}:luna`]);
    expect(modelPickerDaybreakPrograms(models, luna.instanceId, favorites)).toEqual([
      "daybreakBlue",
    ]);
    expect(modelPickerDaybreakPrograms(models, "favorites", favorites)).toEqual(["daybreakBlue"]);
    expect(
      modelPickerDaybreakPrograms(models, ProviderInstanceId.make("claude"), favorites),
    ).toEqual([]);
    expect(modelPickerDaybreakPrograms(models, "favorites", new Set())).toEqual([]);
    expect(
      modelPickerDaybreakPrograms(
        [
          ...models,
          { instanceId: luna.instanceId, slug: "sol", daybreakPrograms: ["daybreakRed"] },
        ],
        luna.instanceId,
        favorites,
      ),
    ).toEqual(["daybreakBlue", "daybreakRed"]);
    const otherAccount = [
      ...models,
      {
        instanceId: ProviderInstanceId.make("codex_red"),
        slug: "sol",
        daybreakPrograms: ["daybreakRed"],
      },
    ];
    expect(modelPickerDaybreakPrograms(otherAccount, luna.instanceId, favorites)).toEqual([
      "daybreakBlue",
    ]);
    expect(modelPickerDaybreakPrograms(otherAccount, luna.instanceId, favorites, true)).toEqual([
      "daybreakBlue",
      "daybreakRed",
    ]);
    expect(
      modelPickerDaybreakPrograms(
        [{ ...models[0]!, daybreakPrograms: ["daybreakBlue", "daybreakRed"] }],
        "favorites",
        favorites,
      ),
    ).toEqual(["daybreakBlue", "daybreakRed"]);
  });

  it("sets the native program only in the chosen selection, retaining reasoning", () => {
    const current = {
      instanceId: luna.instanceId,
      model: "luna",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "cyberAccessProgram", value: "standard" },
      ],
    };
    const selected = modelPickerSelection(luna, current, "daybreakBlue");
    expect(selected).toEqual({
      ...current,
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "cyberAccessProgram", value: "daybreakBlue" },
      ],
    });
    expect(current.options[1]?.value).toBe("standard");
    expect(
      modelPickerSelection(
        { ...luna, model: "astra", daybreakPrograms: undefined },
        current,
        "daybreakBlue",
      ),
    ).toBeNull();
    expect(modelPickerSelection(luna, selected, "standard")).toEqual(current);
    expect(modelPickerSelection(luna, current, "daybreakRed")).toBeNull();
    const both = { ...luna, daybreakPrograms: ["daybreakBlue", "daybreakRed"] };
    const red = modelPickerSelection(both, selected, "daybreakRed");
    expect(red?.options).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "cyberAccessProgram", value: "daybreakRed" },
    ]);
    expect(modelPickerSelection(both, red, "daybreakBlue")).toEqual(selected);
    expect(modelPickerSelection(both, red, undefined)).toBe(red);
  });
});

describe("shouldIncludeModelPickerOption", () => {
  it.each(["ready", "error"] as const)(
    "never offers the internal Antigravity default marker as a model when %s",
    (status) => {
      const providerEntry = entry(status, "antigravity");
      expect(
        shouldIncludeModelPickerOption({
          entry: providerEntry,
          option: {
            slug: ANTIGRAVITY_DEFAULT_MODEL,
            name: ANTIGRAVITY_DEFAULT_MODEL,
            isUnavailable: true,
          },
          activeInstanceId: providerEntry.instanceId,
          activeModel: ANTIGRAVITY_DEFAULT_MODEL,
        }),
      ).toBe(false);
    },
  );

  it.each([
    ["opencode", "error"],
    ["opencode", "warning"],
    ["antigravity", "error"],
    ["antigravity", "warning"],
  ] as const)(
    "keeps only the active synthetic %s row when the provider status is %s",
    (driver, status) => {
      const providerEntry = entry(status, driver);
      const activeInstanceId = providerEntry.instanceId;
      const activeModel = "missing-model";

      expect(
        shouldIncludeModelPickerOption({
          entry: providerEntry,
          option: {
            slug: activeModel,
            name: activeModel,
            isUnavailable: true,
          },
          activeInstanceId,
          activeModel,
        }),
      ).toBe(true);
      expect(
        shouldIncludeModelPickerOption({
          entry: providerEntry,
          option: { slug: "stale/model", name: "Stale model" },
          activeInstanceId,
          activeModel,
        }),
      ).toBe(false);
      expect(
        shouldIncludeModelPickerOption({
          entry: providerEntry,
          option: {
            slug: "other/missing",
            name: "Other missing",
            isUnavailable: true,
          },
          activeInstanceId,
          activeModel,
        }),
      ).toBe(false);
      expect(
        shouldIncludeModelPickerOption({
          entry: providerEntry,
          option: { slug: activeModel, name: activeModel, isUnavailable: true },
          activeInstanceId: ProviderInstanceId.make(`${driver}_personal`),
          activeModel,
        }),
      ).toBe(false);
    },
  );
});

describe("resolveModelPickerSelectedModel", () => {
  it("follows the catalog default for the marker but keeps an explicit native model", () => {
    const driverKind = ProviderDriverKind.make("antigravity");
    const previousOptions = [
      { slug: "gemini-fast", name: "Gemini Fast", aliases: [ANTIGRAVITY_DEFAULT_MODEL] },
      { slug: "gemini-pro", name: "Gemini Pro" },
    ];
    const nextOptions = [
      { slug: "gemini-fast", name: "Gemini Fast" },
      { slug: "gemini-pro", name: "Gemini Pro", aliases: [ANTIGRAVITY_DEFAULT_MODEL] },
    ];

    expect(
      resolveModelPickerSelectedModel({
        driverKind,
        model: ANTIGRAVITY_DEFAULT_MODEL,
        options: previousOptions,
      })?.slug,
    ).toBe("gemini-fast");
    expect(
      resolveModelPickerSelectedModel({
        driverKind,
        model: ANTIGRAVITY_DEFAULT_MODEL,
        options: nextOptions,
      })?.slug,
    ).toBe("gemini-pro");
    expect(
      resolveModelPickerSelectedModel({
        driverKind,
        model: "gemini-fast",
        options: nextOptions,
      })?.slug,
    ).toBe("gemini-fast");
  });

  it("does not guess the default from the first model in a catalog", () => {
    expect(
      resolveModelPickerSelectedModel({
        driverKind: ProviderDriverKind.make("antigravity"),
        model: ANTIGRAVITY_DEFAULT_MODEL,
        options: [{ slug: "gemini-fast", name: "Gemini Fast" }],
      }),
    ).toBeUndefined();
  });
});

describe("shouldOfferModelPickerSetup", () => {
  const availableModel = { slug: "gemini-3.1-pro", name: "Gemini 3.1 Pro" };

  it("offers setup before an Antigravity account has models", () => {
    expect(shouldOfferModelPickerSetup(entry("error", "antigravity"), [])).toBe(true);
  });

  it("offers setup after sign-out even if a model remains cached", () => {
    const providerEntry = entry("ready", "antigravity");
    expect(
      shouldOfferModelPickerSetup(
        {
          ...providerEntry,
          snapshot: { ...providerEntry.snapshot, auth: { status: "unauthenticated" } },
        },
        [availableModel],
      ),
    ).toBe(true);
  });

  it("offers setup when the only model is an unavailable saved selection", () => {
    expect(
      shouldOfferModelPickerSetup(entry("ready", "antigravity"), [
        { ...availableModel, isUnavailable: true },
      ]),
    ).toBe(true);
  });

  it("does not offer setup for a ready account with available models", () => {
    expect(shouldOfferModelPickerSetup(entry("ready", "antigravity"), [availableModel])).toBe(
      false,
    );
  });

  it("does not restore a disabled provider while its status snapshot is stale", () => {
    expect(
      shouldOfferModelPickerSetup({ ...entry("error", "antigravity"), enabled: false }, []),
    ).toBe(false);
  });

  it("keeps providers without integrated setup on their existing path", () => {
    expect(shouldOfferModelPickerSetup(entry("error", "codex"), [])).toBe(false);
  });

  it("uses the environment's setup capability for other drivers", () => {
    const providerEntry = entry("error", "custom_driver");
    expect(
      shouldOfferModelPickerSetup(
        {
          ...providerEntry,
          snapshot: {
            ...providerEntry.snapshot,
            setup: { canAuthenticate: true, canInstall: false },
          },
        },
        [],
      ),
    ).toBe(true);
  });
});

describe("adjacentModelPickerProvider", () => {
  const codex = entry("ready", "codex");
  const claude = entry("ready", "claudeAgent");
  const unavailable = entry("error");
  const input = {
    entries: [codex, unavailable, claude],
    disabledInstanceIds: undefined,
    selectableUnavailableInstanceIds: undefined,
  };

  it("wraps through favorites and ready instances, skipping unavailable providers", () => {
    expect(
      adjacentModelPickerProvider({ ...input, selectedInstanceId: codex.instanceId, direction: 1 }),
    ).toBe(claude.instanceId);
    expect(
      adjacentModelPickerProvider({ ...input, selectedInstanceId: "favorites", direction: -1 }),
    ).toBe(claude.instanceId);
    expect(
      adjacentModelPickerProvider({
        ...input,
        selectedInstanceId: claude.instanceId,
        direction: 1,
      }),
    ).toBe("favorites");
  });

  it("keeps thread locks and the selected unavailable catalog", () => {
    expect(
      adjacentModelPickerProvider({
        ...input,
        disabledInstanceIds: new Set([claude.instanceId]),
        selectedInstanceId: codex.instanceId,
        direction: 1,
      }),
    ).toBe("favorites");
    expect(
      adjacentModelPickerProvider({
        ...input,
        selectableUnavailableInstanceIds: new Set([unavailable.instanceId]),
        selectedInstanceId: codex.instanceId,
        direction: 1,
      }),
    ).toBe(unavailable.instanceId);
  });

  it("handles an empty catalog and a removed selection in either direction", () => {
    expect(
      adjacentModelPickerProvider({
        ...input,
        entries: [],
        selectedInstanceId: codex.instanceId,
        direction: -1,
      }),
    ).toBe("favorites");
    expect(
      adjacentModelPickerProvider({
        ...input,
        selectedInstanceId: unavailable.instanceId,
        direction: 1,
      }),
    ).toBe("favorites");
    expect(
      adjacentModelPickerProvider({
        ...input,
        selectedInstanceId: unavailable.instanceId,
        direction: -1,
      }),
    ).toBe(claude.instanceId);
  });
});
