// @vitest-environment jsdom
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  readConfirmDialogState,
  registerConfirmDialogHost,
  resetConfirmDialogForTests,
  respondToConfirmDialog,
} from "./confirmDialog";
import { confirmDaybreakModelSelection } from "./daybreakModelSelection";

const work = ProviderInstanceId.make("codex_work");
const personal = ProviderInstanceId.make("codex_personal");

function provider(
  instanceId: ProviderInstanceId,
  programs: ReadonlyArray<"daybreakRed" | "daybreakBlue">,
): ServerProvider {
  return {
    instanceId,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-10-02T00:00:00.000Z",
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "model-a",
        name: "Model A",
        isCustom: false,
        capabilities: {
          optionDescriptors:
            programs.length > 0
              ? [
                  {
                    id: "cyberAccessProgram",
                    label: "Daybreak",
                    type: "select",
                    currentValue: "standard",
                    options: [
                      { id: "standard", label: "Off", isDefault: true },
                      ...programs.map((id) => ({ id, label: id })),
                    ],
                  },
                ]
              : [],
        },
      },
    ],
  };
}

function selection(
  instanceId: ProviderInstanceId,
  value?: "daybreakRed" | "daybreakBlue" | "standard" | "automatic",
): ModelSelection {
  return {
    instanceId,
    model: "model-a",
    ...(value ? { options: [{ id: "cyberAccessProgram", value }] } : {}),
  };
}

describe("Daybreak model changes", () => {
  beforeEach(() => {
    resetConfirmDialogForTests();
    registerConfirmDialogHost();
  });

  it("keeps the current selection untouched until Cancel or OK is chosen", async () => {
    const current = selection(work, "daybreakRed");
    const next = selection(personal);
    const pending = confirmDaybreakModelSelection({
      currentSelection: current,
      nextSelection: next,
      providers: [provider(work, ["daybreakRed"]), provider(personal, [])],
    });
    expect(readConfirmDialogState()).toMatchObject({
      status: "confirming",
      confirmLabel: "OK",
      message: expect.stringContaining("Switching will turn Daybreak off"),
    });
    expect(current.options).toEqual([{ id: "cyberAccessProgram", value: "daybreakRed" }]);
    expect(next.options).toBeUndefined();
    respondToConfirmDialog(false);
    expect(await pending).toBeNull();
    expect(current).toEqual(selection(work, "daybreakRed"));
  });

  it("OK changes to the requested model with explicit Off and preserves other target traits", async () => {
    const pending = confirmDaybreakModelSelection({
      currentSelection: selection(work, "daybreakRed"),
      nextSelection: {
        instanceId: work,
        model: "other-model",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "cyberAccessProgram", value: "daybreakBlue" },
        ],
      },
      providers: [provider(work, ["daybreakRed"])],
    });
    respondToConfirmDialog(true);
    expect(await pending).toEqual({
      instanceId: work,
      model: "other-model",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "cyberAccessProgram", value: "standard" },
      ],
    });
  });

  it("does not borrow support from another account with the same model slug", async () => {
    const pending = confirmDaybreakModelSelection({
      currentSelection: selection(work, "daybreakRed"),
      nextSelection: selection(personal),
      providers: [provider(work, ["daybreakRed"]), provider(personal, ["daybreakBlue"])],
    });
    expect(readConfirmDialogState().status).toBe("confirming");
    respondToConfirmDialog(true);
    expect(await pending).toEqual(selection(personal, "standard"));
  });

  it.each(["daybreakRed", "daybreakBlue"] as const)(
    "preserves %s only when the destination account advertises it",
    async (program) => {
      const next = await confirmDaybreakModelSelection({
        currentSelection: selection(work, program),
        nextSelection: selection(personal),
        providers: [provider(personal, [program])],
      });
      expect(next).toEqual(selection(personal, program));
      expect(readConfirmDialogState().status).toBe("idle");
    },
  );

  it("does not turn Daybreak on from a target model's remembered options", async () => {
    const next = await confirmDaybreakModelSelection({
      currentSelection: selection(work, "standard"),
      nextSelection: selection(work, "daybreakBlue"),
      providers: [provider(work, ["daybreakBlue"])],
    });
    expect(next).toEqual(selection(work, "standard"));
    expect(readConfirmDialogState().status).toBe("idle");
  });

  it.each([undefined, "automatic"] as const)(
    "ignores remembered target Daybreak while the current choice is %s",
    async (value) => {
      const next = await confirmDaybreakModelSelection({
        currentSelection: selection(work, value),
        nextSelection: selection(personal, "daybreakBlue"),
        providers: [provider(personal, ["daybreakBlue"])],
      });
      expect(next).toEqual(selection(personal, "automatic"));
      expect(readConfirmDialogState().status).toBe("idle");
    },
  );

  it("clears the Codex-only option when switching to another provider", async () => {
    const destination = {
      ...provider(personal, []),
      driver: ProviderDriverKind.make("claudeAgent"),
    };
    const pending = confirmDaybreakModelSelection({
      currentSelection: selection(work, "daybreakBlue"),
      nextSelection: selection(personal),
      providers: [destination],
    });
    respondToConfirmDialog(true);
    expect(await pending).toEqual(selection(personal));
  });

  it("preserves automatic behavior on ordinary Codex model changes", async () => {
    const next = selection(personal);
    expect(
      await confirmDaybreakModelSelection({
        currentSelection: selection(work),
        nextSelection: next,
        providers: [provider(personal, [])],
      }),
    ).toEqual(selection(personal, "automatic"));
    expect(readConfirmDialogState().status).toBe("idle");
  });
});
