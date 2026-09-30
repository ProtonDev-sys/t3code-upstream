import type { ProviderOptionSelection, ServerProviderModel } from "@t3tools/contracts";

export function getCodexDaybreakState(
  models: ReadonlyArray<ServerProviderModel>,
  model: string,
  selections: ReadonlyArray<ProviderOptionSelection> | undefined,
) {
  const descriptor = models
    .find((candidate) => candidate.slug === model)
    ?.capabilities?.optionDescriptors?.find((option) => option.id === "cyberAccessProgram");
  const selectedProgram = selections?.find((option) => option.id === "cyberAccessProgram")?.value;
  const programs =
    descriptor?.type === "select" ? descriptor.options.map((option) => option.id) : [];
  const daybreakPrograms = programs.filter(
    (value) => value === "daybreakBlue" || value === "daybreakRed",
  );
  const program =
    daybreakPrograms.find((value) => value === selectedProgram) ?? daybreakPrograms[0];
  return {
    enabled: program !== undefined && program === selectedProgram,
    program,
    canEnable: program !== undefined && programs.includes("standard"),
  };
}

export function withCodexDaybreakSelection(
  selections: ReadonlyArray<ProviderOptionSelection> | undefined,
  program: string,
): ReadonlyArray<ProviderOptionSelection> {
  return [
    ...(selections ?? []).filter((option) => option.id !== "cyberAccessProgram"),
    { id: "cyberAccessProgram", value: program },
  ];
}

export function resolveCodexDaybreakModel(
  models: ReadonlyArray<ServerProviderModel>,
  model: string,
  selections: ReadonlyArray<ProviderOptionSelection> | undefined,
) {
  const currentState = getCodexDaybreakState(models, model, selections);
  if (currentState.canEnable) return { model, ...currentState };
  for (const candidate of models) {
    const state = getCodexDaybreakState([candidate], candidate.slug, selections);
    if (state.canEnable) return { model: candidate.slug, ...state };
  }
  return { model, ...currentState };
}

export function getCodexDaybreakModelSlugs(
  models: ReadonlyArray<ServerProviderModel>,
  selections: ReadonlyArray<ProviderOptionSelection> | undefined,
): ReadonlySet<string> | undefined {
  const selectedProgram = selections?.find((option) => option.id === "cyberAccessProgram")?.value;
  if (selectedProgram !== "daybreakBlue" && selectedProgram !== "daybreakRed") return undefined;
  const slugs = new Set(
    models
      .filter((model) => {
        const state = getCodexDaybreakState([model], model.slug, selections);
        return state.canEnable && state.program === selectedProgram;
      })
      .map((model) => model.slug),
  );
  return slugs.size > 0 ? slugs : undefined;
}
