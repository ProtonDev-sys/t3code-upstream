import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexReplay from "effect-codex-app-server/replay";
import * as CodexSchema from "effect-codex-app-server/schema";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { resolveCodexCyberAccessProgram } from "./CodexDaybreak.ts";

const selection = (value?: string | boolean, model = "gpt-test"): ModelSelection => ({
  instanceId: ProviderInstanceId.make("codex-personal"),
  model,
  ...(value === undefined ? {} : { options: [{ id: "cyberAccessProgram", value }] }),
});
const catalogModel = (
  cyber?: ReadonlyArray<CodexSchema.V2ModelListResponse__CyberAccessProgram>,
): CodexSchema.V2ModelListResponse__Model => ({
  id: "gpt-test",
  model: "gpt-test",
  displayName: "Test model",
  description: "Test model",
  hidden: false,
  isDefault: true,
  defaultReasoningEffort: "medium",
  supportedReasoningEfforts: [],
  ...(cyber === undefined ? {} : { availableAccessPrograms: { cyber } }),
});
const replay = (entries: ReadonlyArray<CodexReplay.CodexAppServerReplayEntry>) =>
  CodexReplay.layerReplay({
    provider: "codex",
    protocol: "codex.app-server",
    version: "0.159.0",
    scenario: "daybreak-selection",
    entries,
  });
const modelPage = (
  models: ReadonlyArray<CodexSchema.V2ModelListResponse__Model>,
  id = 1,
  cursor?: string,
  nextCursor: string | null = null,
): ReadonlyArray<CodexReplay.CodexAppServerReplayEntry> => [
  {
    type: "expect_outbound",
    frame: { id, method: "model/list", params: cursor ? { cursor } : {} },
  },
  { type: "emit_inbound", frame: { id, result: { data: models, nextCursor } } },
];

it.effect(
  "preserves native omission for Auto and unspecified options without catalogue requests",
  () =>
    Effect.gen(function* () {
      const client = yield* CodexClient.CodexAppServerClient;
      assert.isUndefined(yield* resolveCodexCyberAccessProgram(client, selection()));
      assert.isUndefined(yield* resolveCodexCyberAccessProgram(client, selection("automatic")));
      assert.equal(
        yield* resolveCodexCyberAccessProgram(client, selection("standard")),
        "standard",
      );
    }).pipe(Effect.provide(replay([]))),
);

it.effect("forwards each enabled program only when this account/model advertises it", () =>
  Effect.gen(function* () {
    const client = yield* CodexClient.CodexAppServerClient;
    assert.equal(
      yield* resolveCodexCyberAccessProgram(client, selection("daybreakBlue")),
      "daybreakBlue",
    );
    assert.equal(
      yield* resolveCodexCyberAccessProgram(client, selection("daybreakRed")),
      "daybreakRed",
    );
  }).pipe(
    Effect.provide(
      replay([
        ...modelPage([catalogModel(["standard", "daybreakBlue"])]),
        ...modelPage([catalogModel(["standard", "daybreakRed"])], 2),
      ]),
    ),
  ),
);

it.effect("finds advertised access on subsequent catalogue pages", () =>
  Effect.gen(function* () {
    const client = yield* CodexClient.CodexAppServerClient;
    assert.equal(
      yield* resolveCodexCyberAccessProgram(client, selection("daybreakBlue")),
      "daybreakBlue",
    );
  }).pipe(
    Effect.provide(
      replay([
        ...modelPage([], 1, undefined, "next-page"),
        ...modelPage([catalogModel(["daybreakBlue"])], 2, "next-page"),
      ]),
    ),
  ),
);

it.effect("does not reuse access after an account's catalogue changes", () =>
  Effect.gen(function* () {
    const client = yield* CodexClient.CodexAppServerClient;
    assert.equal(
      yield* resolveCodexCyberAccessProgram(client, selection("daybreakBlue")),
      "daybreakBlue",
    );
    const result = yield* resolveCodexCyberAccessProgram(client, selection("daybreakBlue")).pipe(
      Effect.result,
    );
    assert.isTrue(Result.isFailure(result));
    if (Result.isFailure(result)) {
      assert.equal(result.failure._tag, "CodexDaybreakUnavailableError");
      assert.include(result.failure.message, "Select Off");
    }
  }).pipe(
    Effect.provide(
      replay([
        ...modelPage([catalogModel(["daybreakBlue"])]),
        ...modelPage([catalogModel(["standard"])], 2),
      ]),
    ),
  ),
);

for (const [name, models, model] of [
  ["missing access metadata", [catalogModel()], "gpt-test"],
  ["another enabled program", [catalogModel(["daybreakRed"])], "gpt-test"],
  ["another model", [catalogModel(["daybreakBlue"])], "custom-model"],
] as const) {
  it.effect(`rejects Daybreak for ${name}`, () =>
    Effect.gen(function* () {
      const client = yield* CodexClient.CodexAppServerClient;
      const result = yield* resolveCodexCyberAccessProgram(
        client,
        selection("daybreakBlue", model),
      ).pipe(Effect.result);
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result))
        assert.equal(result.failure._tag, "CodexDaybreakUnavailableError");
    }).pipe(Effect.provide(replay(modelPage(models)))),
  );
}

for (const value of ["unknown-program", true]) {
  it.effect(`rejects malformed program ${value} without a catalogue request`, () =>
    Effect.gen(function* () {
      const client = yield* CodexClient.CodexAppServerClient;
      const result = yield* resolveCodexCyberAccessProgram(client, selection(value)).pipe(
        Effect.result,
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result))
        assert.equal(result.failure._tag, "CodexDaybreakUnavailableError");
    }).pipe(Effect.provide(replay([]))),
  );
}
