import type { ModelSelection } from "@t3tools/contracts";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexSchema from "effect-codex-app-server/schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

class CodexDaybreakUnavailableError extends Schema.TaggedError<CodexDaybreakUnavailableError>()(
  "CodexDaybreakUnavailableError",
  {
    model: Schema.String,
    requestedProgram: Schema.Unknown,
  },
) {
  override get message(): string {
    return `The selected Daybreak option is not available for ${this.model} on this Codex account. Select Off or refresh the available models.`;
  }
}

const isCyberAccessProgram = Schema.is(CodexSchema.V2TurnStartParams__CyberAccessProgram);

/** Validate against the active app-server, never another account's cached catalogue. */
export const resolveCodexCyberAccessProgram = Effect.fn("resolveCodexCyberAccessProgram")(
  function* (
    client: Pick<CodexClient.CodexAppServerClient["Service"], "request">,
    selection: ModelSelection,
  ) {
    const requestedProgram = selection.options?.find(
      (option) => option.id === "cyberAccessProgram",
    )?.value;
    // Auto is a T3-only option: preserve Codex's native automatic behavior by omission.
    if (requestedProgram === undefined || requestedProgram === "automatic") return undefined;
    if (requestedProgram === "standard") return requestedProgram;

    const unavailable = new CodexDaybreakUnavailableError({
      model: selection.model,
      requestedProgram,
    });
    if (!isCyberAccessProgram(requestedProgram)) return yield* unavailable;

    let cursor: string | null | undefined;
    do {
      const response: CodexSchema.V2ModelListResponse = yield* client.request(
        "model/list",
        cursor ? { cursor } : {},
      );
      const model = response.data.find((model) => model.model === selection.model);
      if (model) {
        if (model.availableAccessPrograms?.cyber.includes(requestedProgram)) {
          return requestedProgram;
        }
        return yield* unavailable;
      }
      cursor = response.nextCursor;
    } while (cursor);
    return yield* unavailable;
  },
);
