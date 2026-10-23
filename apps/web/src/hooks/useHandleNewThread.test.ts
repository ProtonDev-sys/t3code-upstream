import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type RuntimeMode,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

const testState = vi.hoisted(() => {
  let completeProjectFileRead: (value: null) => void = () => undefined;
  let projectFileRead = Promise.resolve<null>(null);
  let projectRemoved = false;
  let connectedEnvironmentIds = ["environment-primary", "environment-ssh"];
  let targetSettings = {
    defaultThreadEnvMode: "local" as "local" | "worktree" | null,
    newWorktreesStartFromOrigin: false,
    defaultModelSelection: null,
    defaultRuntimeMode: "full-access" as RuntimeMode,
  };
  let storedDraft: {
    readonly draftId: string;
    readonly environmentId: string;
    readonly promotedTo: null;
    readonly threadId: string;
  } | null = null;
  const router = {
    state: {
      location: { href: "/" },
      matches: [{ params: {} }],
    },
    navigate: vi.fn(async (request: { readonly params: { readonly draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
    }),
  };
  const draftStore = {
    getComposerDraft: vi.fn(() => ({})),
    getDraftSessionByLogicalProjectKey: vi.fn(() => storedDraft),
    getDraftSession: vi.fn(() => null),
    getDraftThread: vi.fn(() => null),
    applyStickyState: vi.fn(),
    setDraftThreadContext: vi.fn(),
    setLogicalProjectDraftThreadId: vi.fn(),
    setModelSelection: vi.fn(),
  };
  let activeDraftStore:
    | typeof draftStore
    | ReturnType<typeof import("../composerDraftStore").useComposerDraftStore.getState> =
    draftStore;

  return {
    completeProjectFileRead: (value: null) => completeProjectFileRead(value),
    draftStore,
    getDraftStore: () => activeDraftStore,
    useDraftStore: (store: typeof activeDraftStore) => {
      activeDraftStore = store;
    },
    get projectFileRead() {
      return projectFileRead;
    },
    get projectRemoved() {
      return projectRemoved;
    },
    get connectedEnvironmentIds() {
      return connectedEnvironmentIds;
    },
    disconnect(environmentId: string) {
      connectedEnvironmentIds = connectedEnvironmentIds.filter((id) => id !== environmentId);
    },
    removeProject() {
      projectRemoved = true;
    },
    get targetSettings() {
      return targetSettings;
    },
    reset(
      nextStoredDraft: typeof storedDraft,
      workspaceDefaults = {
        envMode: "local" as "local" | "worktree" | null,
        startFromOrigin: false,
      },
    ) {
      storedDraft = nextStoredDraft;
      activeDraftStore = draftStore;
      projectRemoved = false;
      connectedEnvironmentIds = ["environment-primary", "environment-ssh"];
      targetSettings = {
        defaultThreadEnvMode: workspaceDefaults.envMode,
        newWorktreesStartFromOrigin: workspaceDefaults.startFromOrigin,
        defaultModelSelection: null,
        defaultRuntimeMode: "full-access",
      };
      router.state.location.href = "/";
      router.navigate.mockClear();
      draftStore.setDraftThreadContext.mockClear();
      draftStore.setLogicalProjectDraftThreadId.mockClear();
      projectFileRead = new Promise<null>((resolve) => {
        completeProjectFileRead = resolve;
      });
    },
    router,
  };
});

const testServerConfigs = () =>
  new Map([
    [
      "environment-primary",
      {
        settings: {
          ...testState.targetSettings,
          newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin,
        },
      },
    ],
    ["environment-ssh", { settings: testState.targetSettings }],
  ]);

vi.mock("../rpc/atomRegistry", () => ({
  appAtomRegistry: {
    get: (atom: unknown) =>
      atom === "connected-environment-ids"
        ? testState.connectedEnvironmentIds
        : testServerConfigs(),
  },
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === "primary-settings"
      ? { newWorktreesStartFromOrigin: !testState.targetSettings.newWorktreesStartFromOrigin }
      : testServerConfigs(),
}));
vi.mock("@t3tools/client-runtime/environment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/environment")>()),
  scopedProjectKey: () => "remote-project",
  scopeProjectRef: (environmentId: string, projectId: string) => ({ environmentId, projectId }),
  scopeThreadRef: (environmentId: string, threadId: string) => ({ environmentId, threadId }),
}));
vi.mock("@t3tools/contracts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/contracts")>()),
  DEFAULT_RUNTIME_MODE: "default",
  DEFAULT_SERVER_SETTINGS: {},
}));
vi.mock("@t3tools/shared/projectSettings", () => ({
  resolveProjectSettings: (
    settings: Record<string, unknown>,
    _projectId: unknown,
    _project: unknown,
    projectFile?: { defaultThreadEnvMode?: "local" | "worktree" } | null,
  ) => ({
    settings:
      projectFile === undefined
        ? settings
        : {
            ...settings,
            defaultThreadEnvMode:
              settings.defaultThreadEnvMode ?? projectFile?.defaultThreadEnvMode ?? "local",
          },
    sources: { defaultModelSelection: "environment", defaultThreadEnvMode: "environment" },
    overrides: {},
  }),
  resolveNewThreadEnvMode: (input: {
    projectSettings: { settings: { defaultThreadEnvMode: "local" | "worktree" } };
  }) => input.projectSettings.settings.defaultThreadEnvMode,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => null,
  useRouter: () => testState.router,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
}));
vi.mock("../components/Sidebar.logic", () => ({ orderItemsByPreferredIds: () => [] }));
vi.mock("../composerDraftStore", () => {
  const useComposerDraftStore = Object.assign(() => null, {
    getState: () => testState.getDraftStore(),
  });
  return {
    composerDraftHasUserContent: () => false,
    markPromotedDraftThreadByRef: vi.fn(),
    useComposerDraftStore,
  };
});
vi.mock("../lib/chatThreadActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/chatThreadActions")>()),
  hasExplicitComposerModelSelection: () => false,
  resolveNewThreadModelSelectionOverride: () => null,
}));
vi.mock("../lib/t3ProjectFileDefaults", () => ({
  readT3ProjectFile: () => testState.projectFileRead,
}));
vi.mock("../lib/utils", () => ({
  newDraftId: () => "draft-delayed",
  newThreadId: () => "thread-delayed",
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "remote-project",
  getProjectOrderKey: () => "remote-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../state/entities", () => {
  const project = {
    id: "project-remote",
    environmentId: "environment-ssh",
    workspaceRoot: "/remote/project",
    defaultThreadEnvMode: null,
    defaultModelSelection: null,
  };
  return {
    readProject: () => (testState.projectRemoved ? null : project),
    readProjects: () => (testState.projectRemoved ? [] : [project]),
    readThreadShell: () => null,
    readThreadShells: () => [],
    useProjects: () => [],
    useThread: () => null,
  };
});
vi.mock("../state/presentation", () => ({
  environmentSummaries: { connectedEnvironmentIdsAtom: "connected-environment-ids" },
}));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: {},
  primaryServerSettingsAtom: "primary-settings",
}));
vi.mock("../threadRoutes", () => ({ resolveThreadRouteTarget: () => null }));
vi.mock("../uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "remote-project",
  useUiStateStore: () => [],
}));
vi.mock("./useSettings", () => ({ useClientSettings: () => ({}) }));

import { useNewThreadHandler } from "./useHandleNewThread";

describe.each([
  ["new", null],
  [
    "reusable",
    {
      draftId: "draft-existing",
      environmentId: "environment-ssh",
      promotedTo: null,
      threadId: "thread-existing",
    },
  ],
])("useNewThreadHandler with a %s draft", (_, draft) => {
  it("abandons a delayed draft open when the user navigates elsewhere", async () => {
    testState.reset(draft);
    const openThread = useNewThreadHandler();
    const pendingOpen = openThread(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.router.state.location.href = "/usage";
    testState.completeProjectFileRead(null);
    await pendingOpen;

    expect(testState.router.state.location.href).toBe("/usage");
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });

  it("abandons a delayed draft open when the project is removed meanwhile", async () => {
    testState.reset(draft);
    const pendingOpen = useNewThreadHandler()(
      { environmentId: "environment-ssh", projectId: "project-remote" } as never,
      { replace: true },
    );

    testState.removeProject();
    testState.completeProjectFileRead(null);

    await expect(pendingOpen).resolves.toBeNull();
    expect(testState.router.navigate).not.toHaveBeenCalled();
    expect(testState.draftStore.setLogicalProjectDraftThreadId).not.toHaveBeenCalled();
  });
});

describe("useNewThreadHandler", () => {
  it("applies the destination's remembered Daybreak when reusing an implicit draft from another environment", async () => {
    testState.reset(null);
    const { useComposerDraftStore, DraftId } =
      await vi.importActual<typeof import("../composerDraftStore")>("../composerDraftStore");
    useComposerDraftStore.setState(useComposerDraftStore.getInitialState(), true);
    onTestFinished(() => {
      useComposerDraftStore.setState(useComposerDraftStore.getInitialState(), true);
      testState.reset(null);
    });
    const store = useComposerDraftStore.getState();
    const sourceEnvironment = EnvironmentId.make("environment-primary");
    const destinationEnvironment = EnvironmentId.make("environment-ssh");
    const instanceId = ProviderInstanceId.make("codex");
    for (const [environmentId, value] of [
      [sourceEnvironment, "daybreakBlue"],
      [destinationEnvironment, "daybreakRed"],
    ] as const) {
      store.setProviderModelOptions(
        scopeThreadRef(environmentId, ThreadId.make("remembered-thread")),
        ProviderDriverKind.make("codex"),
        [{ id: "cyberAccessProgram", value }],
        { instanceId, model: "gpt-5.4", persistSticky: true },
      );
    }
    const draftId = DraftId.make("reused-draft");
    store.setLogicalProjectDraftThreadId(
      "remote-project",
      {
        environmentId: sourceEnvironment,
        projectId: ProjectId.make("project-source"),
      },
      draftId,
    );
    store.applyStickyState(draftId);
    expect(store.getComposerDraft(draftId)?.modelSelectionByProvider[instanceId]?.options).toEqual([
      { id: "cyberAccessProgram", value: "daybreakBlue" },
    ]);
    testState.useDraftStore(store);

    await useNewThreadHandler()({
      environmentId: destinationEnvironment,
      projectId: ProjectId.make("project-remote"),
    });

    expect(store.getDraftSession(draftId)?.environmentId).toBe(destinationEnvironment);
    expect(store.getComposerDraft(draftId)?.modelSelectionByProvider[instanceId]?.options).toEqual([
      { id: "cyberAccessProgram", value: "daybreakRed" },
    ]);
  });

  it("opens the draft without waiting on a project file from an offline machine", async () => {
    testState.reset(null, { envMode: null, startFromOrigin: false });
    testState.disconnect("environment-ssh");

    const opened = await useNewThreadHandler()({
      environmentId: "environment-ssh",
      projectId: "project-remote",
    } as never);

    expect(opened).toEqual({ draftId: "draft-delayed", threadId: "thread-delayed" });
    expect(testState.router.navigate).toHaveBeenCalledOnce();
  });
});
