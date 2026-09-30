import type { ModelSelection } from "@t3tools/contracts";
import type { V2TurnStartParams__CyberAccessProgram } from "effect-codex-app-server/schema";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";

export function getCodexCyberAccessProgramOptionValue(
  modelSelection: ModelSelection | null | undefined,
): V2TurnStartParams__CyberAccessProgram | undefined {
  const value = getModelSelectionStringOptionValue(modelSelection, "cyberAccessProgram");
  return value === "standard" || value === "daybreakBlue" || value === "daybreakRed"
    ? value
    : undefined;
}

export function getCodexServiceTierOptionValue(
  modelSelection: ModelSelection | null | undefined,
): string | undefined {
  return (
    getModelSelectionStringOptionValue(modelSelection, "serviceTier") ??
    (getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true ? "fast" : undefined)
  );
}
