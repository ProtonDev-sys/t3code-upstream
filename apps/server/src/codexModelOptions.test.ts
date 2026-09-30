import { assert, it } from "@effect/vitest";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import {
  getCodexCyberAccessProgramOptionValue,
  getCodexServiceTierOptionValue,
} from "./codexModelOptions.ts";

it("only forwards explicit valid cyber access programs", () => {
  for (const program of ["standard", "daybreakBlue", "daybreakRed"]) {
    const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-6-sol", [
      { id: "cyberAccessProgram", value: program },
    ]);
    assert.equal(getCodexCyberAccessProgramOptionValue(selection), program);
  }
  for (const program of ["daybreak_blue", "unapproved", ""]) {
    const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-6-sol", [
      { id: "cyberAccessProgram", value: program },
    ]);
    assert.equal(getCodexCyberAccessProgramOptionValue(selection), undefined);
  }
  assert.equal(getCodexCyberAccessProgramOptionValue(undefined), undefined);
  assert.equal(getCodexCyberAccessProgramOptionValue(null), undefined);
});

it("returns the selected Codex service tier id", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.5", [
    { id: "serviceTier", value: "flex" },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "flex");
});

it("keeps legacy persisted fast mode selections working", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "fastMode", value: true },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "fast");
});
