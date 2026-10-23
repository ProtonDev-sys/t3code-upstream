import * as CodexInstallation from "../CodexInstallation.ts";
import * as CodexManagedTokenBroker from "../CodexManagedTokenBroker.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodePath from "node:path";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as CodexClient from "effect-codex-app-server/client";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as ResetCreditCoordinator from "../resetCreditCoordinator.ts";
import * as ProviderLatestVersions from "@t3tools/provider-core/server/ProviderLatestVersions";
import * as McpProviderSessions from "@t3tools/provider-core/server/McpProviderSessions";
import * as ProviderEventLoggers from "@t3tools/provider-core/server/ProviderEventLoggers";
import * as ModelManifest from "../ModelManifest.ts";
import {
  createProviderVersionAdvisory,
  resolveLatestProviderVersion,
} from "@t3tools/provider-core/server/maintenanceResolver";
import { CodexDriver } from "./CodexDriver.ts";
import * as CodexAdapterV2 from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as ProviderCredentialStore from "../ProviderCredentialStore.ts";
import * as ProviderHostLive from "../ProviderHostLive.ts";

const layerDeps = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-codex-driver-maintenance-",
}).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(IdAllocator.layer),
  Layer.provideMerge(McpProviderSessions.layer),
  Layer.provideMerge(
    Layer.mock(CodexAdapterV2.CodexAppServerClientFactory)({
      open: () => Effect.die("Maintenance resolution must not open a Codex session"),
    }),
  ),
  Layer.provideMerge(
    Layer.mock(CodexInstallation.CodexInstallation)({
      managedDirectory: "unused-managed-installation",
    }),
  ),
  Layer.provideMerge(Layer.mock(ServerSecretStore.ServerSecretStore)({})),
  Layer.provideMerge(
    Layer.mock(CodexManagedTokenBroker.CodexManagedTokenBroker)({
      endpoint: Effect.succeed("unused-private-pipe"),
      awaitIdle: Effect.void,
    }),
  ),
  Layer.provideMerge(
    Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("00000000-0000-4000-8000-000000000001")),
    }),
  ),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(ModelManifest.layerTest),
  Layer.provideMerge(ResetCreditCoordinator.layerTest),
  Layer.provideMerge(
    Layer.mock(BackgroundPolicy.BackgroundPolicy)({
      shouldRunScopeWork: () => Effect.succeed(false),
    }),
  ),
  Layer.provideMerge(
    Layer.succeed(
      ProviderEventLoggers.ProviderEventLoggers,
      ProviderEventLoggers.NoOpProviderEventLoggers,
    ),
  ),
  Layer.provideMerge(ProviderLatestVersions.layer),
  Layer.provideMerge(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("Disabled Codex must not make an HTTP request")),
    ),
  ),
);
const layerTest = ProviderHostLive.layer.pipe(Layer.provideMerge(layerDeps));

// The `#!/bin/sh` stub below cannot be resolved as an executable on Windows.
const windowsHost = HostProcess.Platform.defaultValue() === "win32";

const noSpawn = ChildProcessSpawner.make(() =>
  Effect.die("Disabled Codex must not spawn a process"),
);
const encodeCredentials = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeProbeRequest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ id: Schema.optionalKey(Schema.Number), method: Schema.String }),
  ),
);

it.layer(layerTest)("CodexDriver", (it) => {
  const checkManagedAccount = (
    replacementTiming:
      | "unchanged"
      | "during-probe"
      | "before-open"
      | "failed-refresh"
      | "concurrent-first-turns",
  ) =>
    Effect.gen(function* () {
      const checkAccess = replacementTiming !== "unchanged";
      const sameIdentity =
        replacementTiming === "before-open" || replacementTiming === "failed-refresh";
      const instanceId = ProviderInstanceId.make("restored-managed-account");
      const credentials = new Map<string, Uint8Array>();
      const catalogTokens: Array<string | undefined> = [];
      const probeEntered = yield* Deferred.make<void>();
      const resumeProbe = yield* Deferred.make<void>();
      const catalogEntered = yield* Deferred.make<void>();
      const resumeCatalog = yield* Deferred.make<void>();
      let concurrentLookups = false;
      const secrets = ServerSecretStore.ServerSecretStore.of({
        get: (key) => Effect.sync(() => Option.fromUndefinedOr(credentials.get(key))),
        set: (key, value) =>
          Effect.sync(() => {
            credentials.set(key, value);
          }),
        remove: (key) =>
          Effect.sync(() => {
            credentials.delete(key);
          }),
        create: () => Effect.die("unused"),
        getOrCreateRandom: () => Effect.die("unused"),
      });
      yield* Effect.gen(function* () {
        const store = yield* ProviderCredentialStore.make("codex-chatgpt", instanceId);
        const json = yield* encodeCredentials({
          clientId: "oaiapp_test",
          accessToken: "dummy-owned-access",
          refreshToken: "dummy-refresh",
          expiresAt: Number.MAX_SAFE_INTEGER,
          earliestRefreshAt: null,
          scopes: ["chatgpt.tokens.use.direct"],
          subject: "test-user",
          email: "account@example.test",
        });
        yield* store.set(new TextEncoder().encode(json));
        const replacement = yield* encodeCredentials({
          clientId: sameIdentity ? "oaiapp_test" : "oaiapp_replacement",
          subject: "replacement-user",
          email: sameIdentity ? "account@example.test" : "replacement@example.test",
          accessToken: "replacement-access",
          refreshToken: "replacement-refresh",
          expiresAt: Number.MAX_SAFE_INTEGER,
          earliestRefreshAt: null,
          scopes: ["chatgpt.tokens.use.direct"],
        });
        const replaceAccount = store.set(new TextEncoder().encode(replacement)).pipe(Effect.orDie);
        const executable = {
          executablePath: "/user/bin/codex",
          managedVersionDirectory: null,
          source: "local" as const,
          version: "0.156.1",
        };
        const installation = yield* CodexInstallation.CodexInstallation;
        const serverConfig = yield* ServerConfig.ServerConfig;
        const sharedHome = NodePath.join(serverConfig.stateDir, "shared-codex-home");
        const launches: Array<
          Parameters<CodexAdapterV2.CodexAppServerClientFactoryShape["open"]>[0]
        > = [];
        const nativeRequests: Array<{ readonly method: string; readonly params: unknown }> = [];
        let accountReplaced = false;
        let modelProbes = 0;
        const modelSpawner = ChildProcessSpawner.make(() =>
          Effect.gen(function* () {
            modelProbes += 1;
            const responses = yield* Queue.unbounded<string>();
            yield* Effect.addFinalizer(() => Queue.shutdown(responses));
            const results = new Map<string, unknown>([
              [
                "initialize",
                {
                  codexHome: sharedHome,
                  platformFamily: "unix",
                  platformOs: "linux",
                  userAgent: "codex/0.156.1",
                },
              ],
              ["account/read", { account: null, requiresOpenaiAuth: false }],
              ["skills/list", { data: [] }],
              ["config/read", { config: {}, origins: {} }],
              [
                "model/list",
                {
                  data: [
                    {
                      id: "gpt-5.4",
                      model: "gpt-5.4",
                      displayName: "GPT-5.4",
                      description: "Test model",
                      hidden: false,
                      isDefault: true,
                      defaultReasoningEffort: "medium",
                      supportedReasoningEfforts: [],
                      availableAccessPrograms: {
                        cyber: [accountReplaced ? "daybreakBlue" : "daybreakRed"],
                      },
                    },
                  ],
                },
              ],
            ]);
            const decoder = new TextDecoder();
            let buffer = "";
            if (replacementTiming === "during-probe" && modelProbes === 1) {
              yield* Deferred.succeed(probeEntered, undefined);
              yield* Deferred.await(resumeProbe);
            }
            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(1),
              exitCode: Effect.never,
              isRunning: Effect.succeed(true),
              kill: () => Effect.void,
              unref: Effect.succeed(Effect.void),
              stdin: Sink.forEach((chunk: Uint8Array) =>
                Effect.gen(function* () {
                  const lines = (buffer + decoder.decode(chunk, { stream: true })).split("\n");
                  buffer = lines.pop()!;
                  for (const line of lines) {
                    const request = decodeProbeRequest(line);
                    if (request.id === undefined) continue;
                    expect(results.has(request.method)).toBe(true);
                    const response = yield* encodeCredentials({
                      id: request.id,
                      result: results.get(request.method),
                    });
                    yield* Queue.offer(responses, `${response}\n`);
                  }
                }).pipe(Effect.orDie),
              ),
              stdout: Stream.fromQueue(responses).pipe(Stream.encodeText),
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
            });
          }),
        );

        let interruptedChecks = 0;
        let failAcquire = false;
        const startupChecksInterrupted = yield* Deferred.make<void>();
        const acquire = () =>
          Effect.suspend(() => {
            if (failAcquire)
              return Effect.fail(
                new CodexInstallation.CodexInstallationError({
                  operation: "acquire",
                  detail: "The fixture runtime is unavailable",
                }),
              );
            if (interruptedChecks === 2) return Effect.succeed(executable);
            interruptedChecks += 1;
            return (
              interruptedChecks === 2
                ? Deferred.succeed(startupChecksInterrupted, undefined)
                : Effect.void
            ).pipe(Effect.andThen(Effect.interrupt));
          });
        const instance = yield* CodexDriver.create({
          instanceId,
          displayName: "Restored account",
          enabled: true,
          environment: [{ name: "OPENAI_API_KEY", value: "ambient-key", sensitive: true }],
          config: { ...CodexDriver.defaultConfig(), setupMode: "managed", homePath: sharedHome },
        }).pipe(
          Effect.provideService(
            CodexAdapterV2.CodexAppServerClientFactory,
            CodexAdapterV2.CodexAppServerClientFactory.of({
              open: (launch) =>
                Effect.gen(function* () {
                  launches.push(launch);
                  if (!checkAccess)
                    return yield* Effect.die("The fixture stops after recording the launch");
                  return yield* CodexClient.CodexAppServerClient.pipe(
                    Effect.provide(
                      Layer.mock(CodexClient.CodexAppServerClient)({
                        raw: {
                          notifications: Stream.empty,
                          requests: Stream.empty,
                          request: () => Effect.die("unused"),
                          notify: () => Effect.die("unused"),
                          respond: () => Effect.die("unused"),
                          respondError: () => Effect.die("unused"),
                        },
                        request: (method, params) =>
                          Effect.sync(() => nativeRequests.push({ method, params })).pipe(
                            Effect.andThen(
                              Effect.die("The fixture stops after recording the native request"),
                            ),
                          ),
                        handleServerRequest: () => Effect.void,
                        handleServerNotification: () => Effect.void,
                        handleUnknownServerRequest: () => Effect.void,
                        handleUnknownServerNotification: () => Effect.void,
                      }),
                    ),
                  );
                }),
            }),
          ),
          Effect.provideService(
            CodexInstallation.CodexInstallation,
            CodexInstallation.CodexInstallation.of({
              ...installation,
              managedDirectory: "unused-managed-installation",
              resolve: () => Effect.succeed(executable),
              acquire,
            }),
          ),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            checkAccess
              ? modelSpawner
              : ChildProcessSpawner.make(() =>
                  Effect.gen(function* () {
                    return yield* PlatformError.badArgument({
                      module: "ChildProcessSpawner",
                      method: "spawn",
                      description: "The fixture app-server is unavailable",
                    });
                  }),
                ),
          ),
        );
        const observedAccount = yield* Deferred.make<void>();
        const disconnected = yield* instance.snapshot.streamChanges.pipe(
          Stream.tap((provider) =>
            provider.auth.status === "authenticated"
              ? Deferred.succeed(observedAccount, undefined).pipe(Effect.asVoid)
              : Effect.void,
          ),
          Stream.filter((provider) => provider.auth.status === "unauthenticated"),
          Stream.runHead,
          Effect.forkScoped,
        );
        yield* Deferred.await(startupChecksInterrupted);
        const restored = yield* Effect.gen(function* () {
          if (replacementTiming === "concurrent-first-turns") {
            return yield* instance.snapshot.getSnapshot;
          }
          const refresh = yield* instance.snapshot.refresh.pipe(Effect.forkChild);
          if (replacementTiming === "during-probe") {
            yield* Deferred.await(probeEntered);
            yield* replaceAccount;
            accountReplaced = true;
            yield* Deferred.succeed(resumeProbe, undefined);
          }
          return yield* Fiber.join(refresh);
        });
        if (replacementTiming === "during-probe") {
          expect(catalogTokens).toEqual([]);
          expect(restored.models).toEqual([]);
          expect(restored.auth.email).toBe("replacement@example.test");
          expect(restored.auth.profileId).toBe("oaiapp_replacement");
        } else if (replacementTiming !== "concurrent-first-turns") {
          expect(catalogTokens).toEqual(["Bearer dummy-owned-access"]);
          expect(restored.auth.email).toBe("account@example.test");
          expect(restored.runtimePaths?.homePath).toBe(sharedHome);
          expect(restored.runtimePaths?.shadowHomePath).toContain(
            `providers/codex/${instanceId}/shadow`,
          );
        }
        if (checkAccess) {
          const now = yield* DateTime.now;
          const threadId = ThreadId.make("managed-daybreak-thread");
          const providerSessionId = ProviderSessionId.make("managed-daybreak-session");
          const providerThread: ProviderAdapter.ProviderAdapterV2TurnInput["providerThread"] = {
            id: ProviderThreadId.make("managed-daybreak-provider-thread"),
            driver: CodexDriver.driverKind,
            providerInstanceId: instanceId,
            providerSessionId,
            appThreadId: threadId,
            ownerNodeId: null,
            nativeThreadRef: {
              driver: CodexDriver.driverKind,
              nativeId: "native-managed-thread",
              strength: "strong",
            },
            nativeConversationHeadRef: null,
            status: "idle",
            firstRunOrdinal: null,
            lastRunOrdinal: null,
            handoffIds: [],
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
          };
          const open = (program: "daybreakRed" | "daybreakBlue" | undefined) =>
            Effect.gen(function* () {
              const modelSelection = {
                instanceId,
                model: "gpt-5.4",
                ...(program === undefined
                  ? {}
                  : { options: [{ id: "cyberAccessProgram", value: program }] }),
              };
              const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
                runtimeMode: "full-access",
                interactionMode: "default",
                cwd: serverConfig.stateDir,
              });
              const session = yield* instance.orchestrationAdapter.openSession({
                threadId,
                providerSessionId,
                modelSelection,
                runtimePolicy,
              });
              return { session, modelSelection, runtimePolicy };
            });
          const start = (
            program: "daybreakRed" | "daybreakBlue" | undefined,
            opened?: Effect.Success<ReturnType<typeof open>>,
          ) =>
            Effect.gen(function* () {
              const { session, modelSelection, runtimePolicy } = opened ?? (yield* open(program));
              return yield* session.startTurn({
                appThread: {
                  createdBy: "user",
                  creationSource: "web",
                  id: threadId,
                  projectId: ProjectId.make("managed-daybreak-project"),
                  title: "Managed Daybreak",
                  providerInstanceId: instanceId,
                  modelSelection,
                  runtimeMode: "full-access",
                  interactionMode: "default",
                  branch: null,
                  worktreePath: null,
                  activeProviderThreadId: providerThread.id,
                  lineage: {
                    parentThreadId: null,
                    relationshipToParent: null,
                    rootThreadId: threadId,
                  },
                  forkedFrom: null,
                  createdAt: now,
                  updatedAt: now,
                  archivedAt: null,
                  settledOverride: null,
                  settledAt: null,
                  lastVisitedAt: null,
                  deletedAt: null,
                },
                threadId,
                runId: RunId.make("managed-daybreak-run"),
                runOrdinal: 1,
                providerTurnOrdinal: 1,
                attemptId: RunAttemptId.make("managed-daybreak-attempt"),
                rootNodeId: NodeId.make("managed-daybreak-node"),
                providerThread,
                message: {
                  createdBy: "user",
                  creationSource: "web",
                  messageId: MessageId.make("managed-daybreak-message"),
                  text: "test",
                  attachments: [],
                },
                modelSelection,
                runtimePolicy,
              });
            }).pipe(Effect.scoped, Effect.exit);
          const concurrentStarts = (program: "daybreakRed") =>
            Effect.gen(function* () {
              const sessions = yield* Effect.all([open(program), open(program), open(program)], {
                concurrency: "unbounded",
              });
              concurrentLookups = true;
              const first = yield* start(program, sessions[0]).pipe(
                Effect.forkChild({ startImmediately: true }),
              );
              yield* Deferred.await(catalogEntered);
              const others = yield* Effect.forEach(sessions.slice(1), (session) =>
                start(program, session).pipe(Effect.forkChild({ startImmediately: true })),
              );
              yield* Deferred.succeed(resumeCatalog, undefined);
              return yield* Effect.forEach([first, ...others], Fiber.join);
            });
          if (replacementTiming === "during-probe") {
            yield* start("daybreakBlue");
            yield* start("daybreakBlue");
            expect(nativeRequests).toHaveLength(2);
            for (const request of nativeRequests) {
              expect(request).toMatchObject({
                method: "turn/start",
                params: { cyberAccessProgram: "daybreakBlue" },
              });
            }
            expect(modelProbes).toBe(2);
            expect(catalogTokens).toEqual(["Bearer replacement-access"]);
            return;
          }
          if (replacementTiming === "concurrent-first-turns") {
            yield* concurrentStarts("daybreakRed");
            expect(modelProbes).toBe(1);
            expect(catalogTokens).toEqual(["Bearer dummy-owned-access"]);
            expect(nativeRequests).toHaveLength(3);
            for (const request of nativeRequests) {
              expect(request).toMatchObject({
                method: "turn/start",
                params: { cyberAccessProgram: "daybreakRed" },
              });
            }
            return;
          }
          expect(restored.models[0]?.capabilities?.optionDescriptors).toEqual([
            {
              id: "cyberAccessProgram",
              label: "Daybreak",
              type: "select",
              options: [{ id: "daybreakRed", label: "Red" }],
            },
          ]);
          yield* start("daybreakRed");
          yield* start("daybreakRed");
          expect(nativeRequests.map((request) => request.method)).toEqual([
            "turn/start",
            "turn/start",
          ]);
          expect(modelProbes).toBe(1);
          expect(catalogTokens).toEqual(["Bearer dummy-owned-access"]);

          yield* replaceAccount;
          accountReplaced = true;
          // The second account intentionally shares the visible identity and client ID.
          // Only the runtime revision distinguishes its Daybreak access.
          expect((yield* instance.snapshot.getSnapshot).models).toEqual(restored.models);
          const rejectedTurns = yield* concurrentStarts("daybreakRed");
          for (const rejected of rejectedTurns) {
            expect(Exit.isFailure(rejected)).toBe(true);
            expect(
              Exit.isFailure(rejected) ? Cause.squash(rejected.cause) : undefined,
            ).toMatchObject({
              cause: {
                detail: expect.stringContaining("selected Daybreak option is no longer available"),
              },
            });
          }
          expect(nativeRequests).toHaveLength(2);
          expect(modelProbes).toBe(2);
          expect(catalogTokens).toEqual(["Bearer dummy-owned-access", "Bearer replacement-access"]);
          if (replacementTiming === "before-open") {
            yield* start("daybreakRed");
            expect(nativeRequests).toHaveLength(2);
            yield* start("daybreakBlue");
            expect(nativeRequests).toHaveLength(3);
            expect(nativeRequests[2]).toMatchObject({
              method: "turn/start",
              params: { cyberAccessProgram: "daybreakBlue" },
            });
            expect(modelProbes).toBe(2);
            expect(catalogTokens).toHaveLength(2);
          } else {
            yield* start(undefined);
            yield* start(undefined);
            expect(nativeRequests).toHaveLength(4);
            for (const request of nativeRequests.slice(2)) {
              expect(request.method).toBe("turn/start");
              expect(request.params).not.toHaveProperty("cyberAccessProgram");
            }
            expect(modelProbes).toBe(2);
            expect(catalogTokens).toHaveLength(2);
          }
          return;
        }
        // The fixture app-server cannot start, so the workspace scan fails
        // instead of passing the machine snapshot off as the workspace's skills.
        const scan = yield* instance.snapshotForCwd!(serverConfig.stateDir).pipe(Effect.exit);
        expect(Exit.isFailure(scan)).toBe(true);
        // The account is still signed in, so a runtime that cannot start is a
        // failed scan too, not the machine snapshot's inventory.
        failAcquire = true;
        const runtimeScan = yield* instance.snapshotForCwd!(serverConfig.stateDir).pipe(
          Effect.exit,
        );
        failAcquire = false;
        expect(Exit.isFailure(runtimeScan)).toBe(true);
        yield* Deferred.await(observedAccount);

        const threadId = ThreadId.make("managed-account-thread");
        yield* instance.orchestrationAdapter
          .openSession({
            threadId,
            providerSessionId: ProviderSessionId.make("managed-account-session"),
            modelSelection: { instanceId, model: "gpt-5.4" },
            runtimePolicy: ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
              runtimeMode: "full-access",
              interactionMode: "default",
              cwd: serverConfig.stateDir,
            }),
          })
          .pipe(Effect.scoped, Effect.exit);
        expect(launches).toHaveLength(1);
        const launch = launches[0]!;
        expect(launch.settings.binaryPath).toBe(executable.executablePath);
        expect(launch.settings.launchArgs).toContain("openai_token_sharing");
        expect(launch.environment.ACCESS_TOKEN).toBeUndefined();
        expect(launch.settings.launchArgs).toContain("__managed-chatgpt-token");
        expect(launch.settings.launchArgs).not.toContain("dummy-owned-access");
        expect(launch.environment.OPENAI_API_KEY).toBeUndefined();
        expect(launch.environment.CODEX_HOME).toBe(launch.settings.homePath);
        const before = yield* instance.auth!.subscribe("test-owner").pipe(Stream.runHead);
        expect(Option.getOrThrow(before).phase).toBe("idle");
        yield* instance.auth!.logout(Effect.void);
        const after = Option.getOrThrow(yield* Fiber.join(disconnected));
        expect(after.auth.status).toBe("unauthenticated");
        expect(after.auth.email).toBeUndefined();
        expect(after.installed).toBe(true);
        expect(after.models).toEqual([]);
        expect(Option.isNone(yield* store.get)).toBe(true);
        // Signed out, there is no runtime to scan with, so the machine
        // snapshot's empty inventory stands instead of a failed scan.
        const signedOutScan = yield* instance.snapshotForCwd!(serverConfig.stateDir);
        expect(signedOutScan.skills).toEqual([]);
      }).pipe(
        Effect.provideService(ServerSecretStore.ServerSecretStore, secrets),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.gen(function* () {
              expect([
                "https://auth.openai.com/.well-known/openid-configuration",
                "https://auth.openai.com/revoke",
                "https://api.openai.com/v1/models",
              ]).toContain(request.url);
              if (request.url.endsWith("/models")) {
                catalogTokens.push(request.headers.authorization);
                if (concurrentLookups) {
                  yield* Deferred.succeed(catalogEntered, undefined);
                  yield* Deferred.await(resumeCatalog);
                }
                return HttpClientResponse.fromWeb(
                  request,
                  replacementTiming === "failed-refresh" &&
                    request.headers.authorization === "Bearer replacement-access"
                    ? new Response(null, { status: 503 })
                    : Response.json({
                        models: checkAccess
                          ? [{ slug: "gpt-5.4", display_name: "GPT-5.4", visibility: "list" }]
                          : [],
                      }),
                );
              }
              return HttpClientResponse.fromWeb(
                request,
                request.url.endsWith("/revoke")
                  ? new Response(null, { status: 200 })
                  : Response.json({
                      issuer: "https://auth.openai.com",
                      authorization_endpoint: "https://auth.openai.com/api/accounts/authorize",
                      token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
                      jwks_uri: "https://auth.openai.com/jwks",
                      revocation_endpoint: "https://auth.openai.com/revoke",
                    }),
              );
            }),
          ),
        ),
      );
    }).pipe(Effect.scoped);
  // regression: a sign-in that replaces the account mid-probe must not label the old
  // account's catalog with the new identity.
  it.effect.each(["unchanged", "during-probe"] as const)(
    "managed catalog keeps its account label and token together: %s",
    checkManagedAccount,
  );
  it.effect.each(["before-open", "failed-refresh"] as const)(
    "validates managed Daybreak access against the resolved account revision: %s",
    checkManagedAccount,
  );
  it.effect("coalesces managed catalog checks for concurrent first turns", () =>
    checkManagedAccount("concurrent-first-turns"),
  );

  it.effect.skipIf(windowsHost)(
    "runs the standalone updater against the shared home, not the shadow home",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs
          .makeTempDirectoryScoped({ prefix: "t3-codex-driver-" })
          .pipe(Effect.flatMap((directory) => fs.realPath(directory)));
        const sharedHome = NodePath.join(tempDir, "codex-home");
        const shadowHome = NodePath.join(tempDir, "codex-shadow");
        const binaryPath = NodePath.join(sharedHome, "packages", "standalone", "bin", "codex");
        yield* fs.makeDirectory(NodePath.dirname(binaryPath), { recursive: true });
        yield* fs.writeFileString(binaryPath, "#!/bin/sh\n");
        yield* fs.chmod(binaryPath, 0o755);

        const instance = yield* CodexDriver.create({
          instanceId: ProviderInstanceId.make("codex-shadow"),
          displayName: "Codex test",
          enabled: false,
          environment: [],
          config: {
            ...CodexDriver.defaultConfig(),
            binaryPath,
            homePath: sharedHome,
            shadowHomePath: shadowHome,
          },
        });

        const capabilities = yield* instance.snapshot.resolveMaintenance();
        expect(capabilities.update).toMatchObject({
          executable: binaryPath,
          args: ["update"],
          lockKey: "codex-native",
          env: { CODEX_HOME: sharedHome },
        });
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, noSpawn),
        Effect.scoped,
      ),
  );

  for (const fixture of [
    {
      name: "leaves mise npm-backend installations manual-only",
      installSegments: ["mise", "installs", "npm-openai-codex", "0.110.0"],
      npmOwned: false,
    },
    {
      name: "leaves mise tool aliases backed by npm manual-only",
      installSegments: ["mise", "installs", "codex", "0.110.0"],
      npmOwned: false,
    },
    {
      name: "keeps npm updates for globals in a mise Node installation",
      installSegments: ["mise", "installs", "node", "24.0.0"],
      npmOwned: true,
    },
    {
      name: "keeps npm updates for ordinary global installations",
      installSegments: ["npm-global"],
      npmOwned: true,
    },
  ] as const) {
    it.effect.skipIf(windowsHost)(fixture.name, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs
          .makeTempDirectoryScoped({ prefix: "t3-codex-installer-" })
          .pipe(Effect.flatMap((directory) => fs.realPath(directory)));
        const installPath = NodePath.join(tempDir, ...fixture.installSegments);
        const realBinaryPath = NodePath.join(
          installPath,
          "lib",
          "node_modules",
          "@openai",
          "codex",
          "bin",
          "codex.js",
        );
        const binaryPath = NodePath.join(tempDir, "bin", "codex");
        yield* fs.makeDirectory(NodePath.dirname(realBinaryPath), { recursive: true });
        yield* fs.makeDirectory(NodePath.dirname(binaryPath), { recursive: true });
        yield* fs.writeFileString(realBinaryPath, "#!/bin/sh\n");
        yield* fs.chmod(realBinaryPath, 0o755);
        yield* fs.symlink(realBinaryPath, binaryPath);

        const instance = yield* CodexDriver.create({
          instanceId: ProviderInstanceId.make("codex-installer"),
          displayName: "Codex installer test",
          enabled: false,
          environment: [],
          config: {
            ...CodexDriver.defaultConfig(),
            binaryPath,
            homePath: NodePath.join(tempDir, "codex-home"),
          },
        });

        const update = (yield* instance.snapshot.resolveMaintenance()).update;
        if (fixture.npmOwned) {
          expect(update).toMatchObject({
            executable: "npm",
            args: [
              "install",
              "-g",
              "--prefix",
              installPath,
              "--allow-scripts=@openai/codex",
              "@openai/codex@latest",
            ],
          });
        } else {
          expect(update).toBeNull();
        }
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, noSpawn),
        Effect.scoped,
      ),
    );
  }

  for (const {} of ["direct", "wrapper"] as const) {
  }

  it.effect.each([
    {
      name: "conventional shim",
      dataRoot: "mise",
      commandName: "codex",
      version: "0.153.4",
      nodeFirst: false,
    },
    {
      name: "custom data directory",
      dataRoot: "custom-tool-data",
      commandName: "codex",
      version: "0.153.4",
      nodeFirst: false,
    },
    {
      name: "renamed configured command",
      dataRoot: "mise",
      commandName: "custom-codex",
      version: "0.153.4",
      nodeFirst: false,
    },
    {
      name: "outdated provider",
      dataRoot: "mise",
      commandName: "codex",
      version: "0.153.3",
      nodeFirst: false,
    },
    {
      name: "npm before shim",
      dataRoot: "mise",
      commandName: "codex",
      version: "0.153.4",
      nodeFirst: true,
    },
  ])(
    "does not mistake Homebrew mise for Codex's installer: $name",
    (fixture) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tempDir = yield* fs
          .makeTempDirectoryScoped({ prefix: "t3-codex-mise-shim-" })
          .pipe(Effect.flatMap((directory) => fs.realPath(directory)));
        const brewPrefix = NodePath.join(tempDir, "homebrew");
        const brewPath = NodePath.join(brewPrefix, "bin", "brew");
        const misePath = NodePath.join(brewPrefix, "Cellar", "mise", "2026.9.1", "bin", "mise");
        const shimDir = NodePath.join(tempDir, fixture.dataRoot, "shims");
        const npmPrefix = NodePath.join(tempDir, "mise", "installs", "node", "24.13.0");
        const npmBin = NodePath.join(npmPrefix, "bin");
        const npmEntry = NodePath.join(
          npmPrefix,
          "lib",
          "node_modules",
          "@openai",
          "codex",
          "bin",
          "codex.js",
        );
        for (const file of [brewPath, misePath, npmEntry]) {
          yield* fs.makeDirectory(NodePath.dirname(file), { recursive: true });
          yield* fs.writeFileString(file, "#!/bin/sh\n");
          yield* fs.chmod(file, 0o755);
        }
        yield* fs.makeDirectory(shimDir, { recursive: true });
        yield* fs.makeDirectory(npmBin, { recursive: true });
        yield* fs.symlink(misePath, NodePath.join(shimDir, fixture.commandName));
        yield* fs.symlink(npmEntry, NodePath.join(npmBin, fixture.commandName));
        const lookupPath = [
          ...(fixture.nodeFirst ? [npmBin, shimDir] : [shimDir, npmBin]),
          NodePath.dirname(brewPath),
        ].join(NodePath.delimiter);
        const probes: Array<ReadonlyArray<string>> = [];
        const metadataSpawner = ChildProcessSpawner.make((command) => {
          if (!ChildProcess.isStandardCommand(command) || command.command !== brewPath) {
            return Effect.die("Provider resolution must not execute a provider or updater");
          }
          probes.push(command.args);
          const stdout =
            command.args[0] === "--prefix"
              ? brewPrefix
              : JSON.stringify({ formulae: [{ versions: { stable: "2026.9.1" } }] });
          return Effect.succeed(
            ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(1),
              exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              unref: Effect.succeed(Effect.void),
              stdin: Sink.drain,
              stdout: Stream.encodeText(Stream.make(stdout)),
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
            }),
          );
        });
        const instance = yield* CodexDriver.create({
          instanceId: ProviderInstanceId.make("codex-mise-shim"),
          displayName: "Codex shim test",
          enabled: false,
          environment: [{ name: "PATH", value: lookupPath, sensitive: false }],
          config: {
            ...CodexDriver.defaultConfig(),
            binaryPath: fixture.commandName,
            homePath: NodePath.join(tempDir, "codex-home"),
          },
        }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, metadataSpawner));
        const capabilities = yield* instance.snapshot.resolveMaintenance();
        const latestVersion = yield* resolveLatestProviderVersion(capabilities).pipe(
          Effect.provideServiceEffect(
            ProviderLatestVersions.ProviderLatestVersions,
            ProviderLatestVersions.make([["@openai/codex", "0.153.4"]]),
          ),
        );
        expect(probes).toEqual([]);
        expect(latestVersion).toBe("0.153.4");
        expect(
          createProviderVersionAdvisory({
            driver: CodexDriver.driverKind,
            currentVersion: fixture.version,
            latestVersion,
            maintenanceCapabilities: capabilities,
          }),
        ).toMatchObject({
          status: fixture.version === "0.153.4" ? "current" : "behind_latest",
          currentVersion: fixture.version,
          latestVersion: "0.153.4",
          canUpdate: fixture.nodeFirst,
        });
        if (fixture.nodeFirst) {
          expect(capabilities.update).toMatchObject({
            executable: "npm",
            args: expect.arrayContaining([
              "--prefix",
              yield* fs.realPath(npmPrefix),
              "@openai/codex@latest",
            ]),
          });
        } else {
          expect(capabilities.update).toBeNull();
        }
      }).pipe(Effect.scoped),
    { skip: windowsHost },
  );
});
