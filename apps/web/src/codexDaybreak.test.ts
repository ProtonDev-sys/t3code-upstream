import type { ServerProviderModel } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  getCodexDaybreakState,
  getCodexDaybreakModelSlugs,
  resolveCodexDaybreakModel,
  withCodexDaybreakSelection,
} from "./codexDaybreak";

function modelWithPrograms(
  programs: ReadonlyArray<string>,
  slug = "gpt-6-sol",
): ServerProviderModel {
  return {
    slug,
    name: "GPT-6 Sol",
    isCustom: false,
    capabilities: {
      optionDescriptors: [
        {
          id: "cyberAccessProgram",
          label: "Daybreak",
          type: "select",
          options: programs.map((id) => ({ id, label: id })),
          currentValue: "standard",
        },
      ],
    },
  };
}

describe("Codex Daybreak options", () => {
  it("does not inherit another model's approved programs for a custom model", () => {
    const models = [modelWithPrograms(["standard", "daybreakBlue"])];
    expect(getCodexDaybreakState(models, "gpt-6.1-sol", undefined)).toEqual({
      enabled: false,
      program: undefined,
      canEnable: false,
    });
  });

  it.each(["daybreakBlue", "daybreakRed"])("offers only the advertised %s program", (program) => {
    const models = [modelWithPrograms(["standard", program])];
    expect(getCodexDaybreakState(models, "gpt-6-sol", undefined)).toEqual({
      enabled: false,
      program,
      canEnable: true,
    });
  });

  it("keeps a revoked selection visible so it can be turned off", () => {
    const models = [modelWithPrograms(["standard"])];
    expect(
      getCodexDaybreakState(models, "gpt-6-sol", [
        { id: "cyberAccessProgram", value: "daybreakBlue" },
      ]),
    ).toEqual({
      enabled: true,
      program: undefined,
      canEnable: false,
    });
  });

  it("preserves other options and explicitly restores standard treatment when turned off", () => {
    const existing = [{ id: "reasoningEffort", value: "high" }];
    const enabled = withCodexDaybreakSelection(existing, "daybreakBlue");
    expect(enabled).toEqual([...existing, { id: "cyberAccessProgram", value: "daybreakBlue" }]);
    expect(withCodexDaybreakSelection(enabled, "standard")).toEqual([
      ...existing,
      { id: "cyberAccessProgram", value: "standard" },
    ]);
    expect(existing).toEqual([{ id: "reasoningEffort", value: "high" }]);
  });

  it("keeps the current eligible model when enabling Daybreak", () => {
    const models = [
      modelWithPrograms(["standard", "daybreakBlue"], "gpt-6-luna"),
      modelWithPrograms(["standard", "daybreakBlue"]),
    ];
    expect(resolveCodexDaybreakModel(models, "gpt-6-sol", undefined)).toEqual({
      model: "gpt-6-sol",
      enabled: false,
      program: "daybreakBlue",
      canEnable: true,
    });
  });

  it("selects an advertised model instead of requesting Daybreak for a custom model", () => {
    const models = [modelWithPrograms(["standard", "daybreakBlue"])];
    expect(resolveCodexDaybreakModel(models, "gpt-6.1-sol", undefined)).toEqual({
      model: "gpt-6-sol",
      enabled: false,
      program: "daybreakBlue",
      canEnable: true,
    });
    expect(resolveCodexDaybreakModel([], "gpt-6.1-sol", undefined).canEnable).toBe(false);
  });

  it.each([undefined, [], [{ id: "cyberAccessProgram", value: "standard" }]])(
    "leaves the full catalog visible when Daybreak is off (%j)",
    (selection) => {
      expect(
        getCodexDaybreakModelSlugs([modelWithPrograms(["standard", "daybreakBlue"])], selection),
      ).toBeUndefined();
    },
  );

  it.each(["daybreakBlue", "daybreakRed"])(
    "filters current, legacy, and custom models by the exact %s program",
    (program) => {
      const otherProgram = program === "daybreakBlue" ? "daybreakRed" : "daybreakBlue";
      const models: ServerProviderModel[] = [
        modelWithPrograms(["standard", program]),
        { ...modelWithPrograms(["standard", program], "older-model"), isLegacy: true },
        modelWithPrograms(["standard", otherProgram], "other-program"),
        modelWithPrograms(["standard"], "standard-only"),
        { slug: "gpt-6.1-sol", name: "GPT-6.1 Sol", isCustom: true, capabilities: {} },
      ];
      expect([
        ...getCodexDaybreakModelSlugs(models, [{ id: "cyberAccessProgram", value: program }])!,
      ]).toEqual(["gpt-6-sol", "older-model"]);
    },
  );

  it("never borrows access from another Codex account", () => {
    const selection = [{ id: "cyberAccessProgram", value: "daybreakBlue" }];
    expect(
      getCodexDaybreakModelSlugs([modelWithPrograms(["standard", "daybreakBlue"])], selection)?.has(
        "gpt-6-sol",
      ),
    ).toBe(true);
    expect(getCodexDaybreakModelSlugs([modelWithPrograms(["standard"])], selection)?.size).toBe(0);
    expect(getCodexDaybreakModelSlugs([], selection)?.size).toBe(0);
  });

  it("restores unfiltered models after a revoked program is turned off", () => {
    const models = [modelWithPrograms(["standard"])];
    const selection = [{ id: "cyberAccessProgram", value: "daybreakBlue" }];
    expect(getCodexDaybreakModelSlugs(models, selection)?.size).toBe(0);
    expect(
      getCodexDaybreakModelSlugs(models, withCodexDaybreakSelection(selection, "standard")),
    ).toBeUndefined();
  });
});
