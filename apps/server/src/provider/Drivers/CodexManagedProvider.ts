import {
  ProviderDriverKind,
  ProviderSetupError,
  TextGenerationError,
  type CodexSettings,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import { ChildProcessSpawner } from "effect/process";
import { makeCodexTextGeneration } from "../../textGeneration/CodexTextGeneration.ts";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { chatGptModels } from "../CodexChatGptModels.ts";
import { makeCodexManagedRuntime, type CodexEffectiveRuntime } from "../CodexManagedRuntime.ts";
import { ProviderDriverError } from "../Errors.ts";
import { createCodexAdapterV2 } from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import {
  checkCodexProviderStatus,
  makePendingCodexProvider,
  probeCodexSkillsForCwd,
} from "../CodexProvider.ts";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import {
  type ProviderDriverCreateInput,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { codexContinuationIdentity } from "./CodexHomeLayout.ts";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";
import { HttpClient } from "effect/http";
const DRIVER = ProviderDriverKind.make("codex");

export const makeManagedCodexProvider = Effect.fn("makeManagedCodexProvider")(function* (
  input: ProviderDriverCreateInput<CodexSettings>,
) {
  const { instanceId, enabled, displayName, accentColor, config } = input;
  const http = yield* HttpClient.HttpClient;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const host = yield* ProviderHost.ProviderHost;
  const runtime = yield* makeCodexManagedRuntime({
    instanceId,
    enabled,
    config,
    environment: yield* mergeProviderInstanceEnvironment(input.environment),
  });
  const continuationIdentity = codexContinuationIdentity(runtime.homeLayout);
  const stamp = withInstanceIdentity({
    instanceId,
    driverKind: DRIVER,
    displayName,
    accentColor,
    continuationGroupKey: continuationIdentity.continuationKey,
  });
  const setup = { canAuthenticate: true, canInstall: true };
  const runtimePaths = {
    homePath: runtime.homeLayout.sharedHomePath,
    shadowHomePath: runtime.homeLayout.mode === "authOverlay" ? runtime.homePath : null,
  };
  const pending = makePendingCodexProvider({ ...config, enabled, customModels: [] }).pipe(
    Effect.map((draft) =>
      stamp({
        ...draft,
        models: [],
        setup,
        runtimePaths,
      }),
    ),
  );
  const checkedModels = yield* Ref.make<
    { readonly revision: string; readonly models: ReadonlyArray<ServerProviderModel> } | undefined
  >(undefined);
  const check = Effect.gen(function* () {
    const base = yield* pending;
    if (!enabled) {
      yield* Ref.set(checkedModels, undefined);
      return base;
    }
    const executable = yield* runtime.installation.resolve().pipe(Effect.option);
    if (Option.isNone(executable)) {
      yield* Ref.set(checkedModels, undefined);
      return {
        ...base,
        installed: false,
        models: [],
        message: "Set up Codex to get started.",
        auth: { status: "unauthenticated" as const },
      };
    }
    const saved = yield* runtime.auth.read.pipe(Effect.orElseSucceed(() => Option.none()));
    if (Option.isSome(saved) && !saved.value.scopes.includes("chatgpt.tokens.use.direct")) {
      yield* Ref.set(checkedModels, undefined);
      return {
        ...base,
        installed: true,
        version: executable.value.version,
        models: [],
        message:
          "Signed in with ChatGPT, but token sharing is disabled. Sign in again and enable token sharing, or use another provider.",
        auth: {
          status: "unauthenticated" as const,
          label: "ChatGPT",
          ...(saved.value.email?.trim() ? { email: saved.value.email.trim() } : {}),
        },
      };
    }
    if (Option.isNone(saved)) {
      yield* Ref.set(checkedModels, undefined);
      return {
        ...base,
        installed: true,
        version: executable.value.version,
        models: [],
        message: "Sign in with ChatGPT to use Codex.",
        auth: { status: "unauthenticated" as const },
      };
    }
    const usageLimits = {
      checkedAt: base.checkedAt,
      windows: [],
      unavailable: {
        reason: "unsupported" as const,
        message:
          "ChatGPT tracks subscription usage across connected apps. Open Usage settings with the account you connected to Codex.",
      },
      externalUsage: { label: "ChatGPT usage", url: "https://chatgpt.com/#settings/Usage" },
    };
    const managedAuth = {
      subscriptionSharing: true,
      profileId: saved.value.clientId,
      status: "authenticated" as const,
      type: "chatgpt",
      label: "ChatGPT",
      ...(saved.value.email?.trim() ? { email: saved.value.email.trim() } : {}),
    };
    const attemptedRevision = yield* runtime.auth.profileKey(saved.value);
    return yield* runtime.auth.controller.withAccess!(runtime.resolve).pipe(
      Effect.flatMap((effective) =>
        Effect.gen(function* () {
          const draft = yield* checkCodexProviderStatus(
            effective.config,
            undefined,
            effective.environment,
            managedAuth,
          );
          const credentials = yield* runtime.auth.access;
          // Another server can replace the saved profile while the native probe runs.
          // Never send that account's token with the launch profile's catalog labels.
          if (
            (yield* runtime.auth.profileKey(credentials)) !== effective.revision ||
            attemptedRevision !== effective.revision
          )
            return yield* new ProviderSetupError({
              instanceId,
              operation: "models",
              detail: "The ChatGPT connection changed while checking Codex. Retry.",
            });
          const models = yield* chatGptModels(credentials.accessToken, draft.models).pipe(
            Effect.provideService(HttpClient.HttpClient, http),
          );
          return { draft: { ...draft, models }, revision: effective.revision };
        }),
      ),
      Effect.flatMap(({ draft, revision }) => {
        const checked = stamp({
          ...draft,
          auth: managedAuth,
          version: draft.version ?? executable.value.version,
          usageLimits,
          models: draft.models.map((model) => ({
            ...model,
            ...(model.capabilities
              ? {
                  capabilities: {
                    ...model.capabilities,
                    optionDescriptors: (model.capabilities.optionDescriptors ?? []).filter(
                      (option) => option.id !== "serviceTier",
                    ),
                  },
                }
              : {}),
          })),
          setup,
          runtimePaths,
          ...(draft.slashCommands
            ? {
                slashCommands: draft.slashCommands.filter((command) => command.name !== "feedback"),
              }
            : {}),
        });
        // Keep the models and the runtime that produced them together: the published
        // snapshot can still belong to the previous account while a refresh runs.
        return Ref.set(checkedModels, { revision, models: checked.models }).pipe(
          Effect.as(checked),
        );
      }),
      Effect.catch(() =>
        runtime.auth.read.pipe(
          Effect.orElseSucceed(() => Option.none()),
          // Remember the attempted profile so ordinary turns do not repeat failed
          // probes, while an account that replaced it still gets its own check.
          Effect.tap(() => Ref.set(checkedModels, { revision: attemptedRevision, models: [] })),
          Effect.map((current) => ({
            ...base,
            installed: true,
            version: executable.value.version,
            models: [],
            auth: {
              status:
                Option.isSome(current) && current.value.scopes.includes("chatgpt.tokens.use.direct")
                  ? ("authenticated" as const)
                  : ("unauthenticated" as const),
              label: "ChatGPT",
              ...(Option.isSome(current) &&
              current.value.scopes.includes("chatgpt.tokens.use.direct")
                ? { subscriptionSharing: true, profileId: current.value.clientId }
                : {}),
              ...(Option.isSome(current) && current.value.email?.trim()
                ? { email: current.value.email.trim() }
                : {}),
            },
            ...(Option.isSome(current) && current.value.scopes.includes("chatgpt.tokens.use.direct")
              ? { usageLimits }
              : {}),
            message: "Could not check Codex right now. Retry, or reconnect in provider settings.",
          })),
        ),
      ),
      Effect.scoped,
    );
  }).pipe(
    Effect.onError(() => Ref.set(checkedModels, undefined)),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
  );
  const snapshot = yield* makeManagedServerProvider({
    resolveMaintenance: () => Effect.succeed({ provider: DRIVER, packageName: null, update: null }),
    getSettings: host.settings.get,
    streamSettings: host.settings.changes,
    haveSettingsChanged: () => false,
    initialSnapshot: () => pending,
    checkProvider: check,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ProviderDriverError({
          driver: DRIVER,
          instanceId,
          detail: "Could not prepare managed Codex.",
          cause,
        }),
    ),
  );
  const modelsLock = yield* Semaphore.make(1);
  const modelsForRuntime = Effect.fn("CodexManagedProvider.modelsForRuntime")(
    function* (effective: CodexEffectiveRuntime | undefined) {
      if (effective === undefined) return [];
      let checked = yield* Ref.get(checkedModels);
      if (checked?.revision !== effective.revision) {
        yield* snapshot.refresh;
        checked = yield* Ref.get(checkedModels);
      }
      return checked?.revision === effective.revision ? checked.models : [];
    },
    (effect) => modelsLock.withPermit(effect),
  );
  yield* runtime.auth.controller.subscribe("managed-codex-snapshot").pipe(
    Stream.filter((state) => ["idle", "succeeded", "failed", "cancelled"].includes(state.phase)),
    // Sign-out closes the scope of an in-flight probe, which fails that refresh
    // with an interrupt. Keep listening so the sign-out's own idle still refreshes.
    Stream.runForEach(() => snapshot.refresh.pipe(Effect.ignoreCause({ log: true }))),
    Effect.forkScoped,
  );
  const resolveRuntime = runtime.auth.controller.withAccess!(runtime.resolve);
  // Launch settings bind the refresh command to the signed-in profile. The registry
  // already wraps openSession in withAccess, so resolve without re-entering it.
  const orchestrationAdapter = yield* createCodexAdapterV2(input, {
    models: modelsForRuntime,
    onUsageLimits: (update) => snapshot.applyUsageLimits(update),
    resolveRuntime: runtime.resolve,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ProviderDriverError({
          driver: DRIVER,
          instanceId,
          detail: "Failed to build Codex orchestration adapter.",
          cause,
        }),
    ),
  );
  const nativeGeneration = yield* makeCodexTextGeneration(
    config,
    undefined,
    snapshot.getSnapshot.pipe(Effect.map((value) => value.models)),
    resolveRuntime,
  );
  const protect = <A>(operation: string, effect: Effect.Effect<A, TextGenerationError>) =>
    runtime.auth.controller.withAccess!(effect).pipe(
      Effect.scoped,
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: "detail" in cause ? cause.detail : "Codex text generation failed.",
          }),
      ),
    );
  const textGeneration: ProviderInstance["textGeneration"] = {
    generateCommitMessage: (value) =>
      protect("generateCommitMessage", nativeGeneration.generateCommitMessage(value)),
    generatePrContent: (value) =>
      protect("generatePrContent", nativeGeneration.generatePrContent(value)),
    generateBranchName: (value) =>
      protect("generateBranchName", nativeGeneration.generateBranchName(value)),
    generateThreadTitle: (value) =>
      protect("generateThreadTitle", nativeGeneration.generateThreadTitle(value)),
    generateReviewGuide: (value) =>
      protect("generateReviewGuide", nativeGeneration.generateReviewGuide(value)),
  };
  return {
    instanceId,
    driverKind: DRIVER,
    continuationIdentity,
    displayName,
    accentColor,
    enabled,
    snapshot,
    orchestrationAdapter,
    textGeneration,
    auth: runtime.auth.controller,
    snapshotForCwd: (cwd: string) =>
      enabled
        ? resolveRuntime.pipe(
            Effect.matchEffect({
              // Signed out or not set up, there is nothing to scan with and the
              // machine snapshot's empty inventory says as much. Otherwise the
              // runtime failed for a signed-in account (a token refresh or
              // reconnect) or before the first check, and the scan failed.
              onFailure: (cause) =>
                snapshot.getSnapshot.pipe(
                  Effect.filterOrFail(
                    (machine) => machine.auth.status === "unauthenticated",
                    () => cause,
                  ),
                ),
              onSuccess: (effective) =>
                probeCodexSkillsForCwd({
                  binaryPath: effective.config.binaryPath,
                  homePath: effective.config.homePath,
                  launchArgs: effective.config.launchArgs,
                  cwd,
                  environment: effective.environment,
                }).pipe(
                  Effect.flatMap((skills) =>
                    snapshot.getSnapshot.pipe(Effect.map((draft) => ({ ...draft, skills }))),
                  ),
                ),
            }),
            Effect.scoped,
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            // Fail rather than return the machine snapshot: the registry
            // publishes any returned snapshot as this workspace's inventory.
            Effect.mapError(
              (cause) =>
                new ProviderDriverError({
                  driver: DRIVER,
                  instanceId,
                  detail: `Failed to probe Codex skills for '${cwd}'`,
                  cause,
                }),
            ),
          )
        : snapshot.getSnapshot,
  } satisfies ProviderInstance;
});
