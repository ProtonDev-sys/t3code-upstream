import type { ModelSelection } from "@t3tools/contracts";
import * as CodexSchema from "effect-codex-app-server/schema";
import * as Schema from "effect/Schema";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";

const isCodexCyberAccessProgram = Schema.is(CodexSchema.V2TurnStartParams__CyberAccessProgram);

export function getCodexCyberAccessProgramOptionValue(
  modelSelection: ModelSelection | null | undefined,
): CodexSchema.V2TurnStartParams__CyberAccessProgram | undefined {
  const value = getModelSelectionStringOptionValue(modelSelection, "cyberAccessProgram");
  return isCodexCyberAccessProgram(value) ? value : undefined;
}

export function getCodexServiceTierOptionValue(
  modelSelection: ModelSelection | null | undefined,
): string | undefined {
  return (
    getModelSelectionStringOptionValue(modelSelection, "serviceTier") ??
    (getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true ? "fast" : undefined)
  );
}
