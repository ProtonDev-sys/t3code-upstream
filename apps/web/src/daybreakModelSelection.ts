import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import {
  getModelSelectionDaybreakProgram,
  modelSupportsDaybreakProgram,
} from "@t3tools/shared/model";

import { ensureLocalApi } from "./localApi";

/** Resolve a model/account change before mutating either the draft or its remembered options. */
export async function confirmDaybreakModelSelection(input: {
  currentSelection: ModelSelection | null | undefined;
  nextSelection: ModelSelection;
  providers: ReadonlyArray<ServerProvider>;
}): Promise<ModelSelection | null> {
  const { currentSelection, nextSelection, providers } = input;
  const program = getModelSelectionDaybreakProgram(currentSelection);
  const provider = providers.find((entry) => entry.instanceId === nextSelection.instanceId);
  const model = provider?.models.find((entry) => entry.slug === nextSelection.model);
  const isCodex = provider?.driver === "codex";
  const supported =
    isCodex && program !== undefined && modelSupportsDaybreakProgram(model, program);
  if (program && !supported) {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `${model?.name ?? nextSelection.model} does not support Daybreak ${program === "daybreakRed" ? "Red" : "Blue"} on this account. Switching will turn Daybreak off.\n\nContinue?`,
      { confirmLabel: "OK" },
    );
    if (!confirmed) return null;
  }

  // Daybreak follows the current explicit choice, never a different model's
  // remembered traits. Auto is an internal sentinel so sticky state does not
  // restore old choices; dispatch omits it to preserve the provider default.
  const options = (nextSelection.options ?? []).filter(
    (option) => option.id !== "cyberAccessProgram",
  );
  const explicitlyOff = currentSelection?.options?.some(
    (option) => option.id === "cyberAccessProgram" && option.value === "standard",
  );
  if (isCodex) {
    return {
      ...nextSelection,
      options: [
        ...options,
        {
          id: "cyberAccessProgram",
          value: supported ? program : program || explicitlyOff ? "standard" : "automatic",
        },
      ],
    };
  }
  const { options: _previousOptions, ...selection } = nextSelection;
  return options.length > 0 ? { ...selection, options } : selection;
}
