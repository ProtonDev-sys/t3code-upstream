import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  IsoDateTime,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "../../state/atom-registry";
import {
  composerDraftsAtom,
  createNewTaskDraft,
  getComposerDraftSnapshot,
  modelOptionMemoryAtom,
  setStickyComposerModelSelection,
  stickyComposerModelSelectionAtom,
  updateComposerDraftSettings,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { rememberModelOptions, rememberedModelOptions } from "../../state/use-model-option-memory";
import { NewTaskFlowProvider, useNewTaskFlow } from "./new-task-flow-provider";

const fixture = vi.hoisted(() => ({ projects: [] as ReadonlyArray<EnvironmentProject> }));

vi.mock("../../components/ui/Dialog", () => ({ alert: vi.fn() }));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({ isReady: false, presentation: null }),
}));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => null },
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => fixture.projects,
  useThreadShells: () => [],
  useEnvironmentServerConfig: (environmentId: EnvironmentId) => config(environmentId),
  useServerConfigs: () => new Map(),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: false }),
}));
vi.mock("../../state/queries", () => ({
  useBranches: () => ({ data: { isRepo: true } }),
  useDebouncedValue: (value: string) => value,
  usePaginatedBranches: () => ({ refs: [], data: null, isPending: false }),
}));
vi.mock("../../state/projects", () => ({ projectEnvironment: { openScratch: {} } }));
vi.mock("../../state/vcs", () => ({ vcsEnvironment: { status: () => null } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../state/thread-outbox", () => ({ flattenQueuedThreadMessages: () => [] }));
vi.mock("../../state/use-thread-outbox", () => ({ useThreadOutboxMessages: () => ({}) }));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useSavedRemoteConnections: () => ({ savedConnectionsById: {} }),
  useRemoteConnectionStatus: () => ({ connectedEnvironments: [] }),
}));
vi.mock("../../state/project-grouping", () => ({
  useMobileProjectGroupingSettings: () => ({ sidebarProjectGroupingMode: "workspace" }),
}));
vi.mock("./use-legacy-plan-mode-enabled", () => ({
  useLegacyPlanModeState: () => ({ enabled: true, loaded: true }),
}));
vi.mock("expo-file-system", () => ({
  Directory: class {
    create() {}
  },
  File: class {
    exists = false;
  },
  Paths: { document: { uri: "file:///documents" } },
}));

const ENVIRONMENT_A = EnvironmentId.make("environment-a");
const ENVIRONMENT_B = EnvironmentId.make("environment-b");
const HIGH = { id: "reasoningEffort", value: "high" };
const BLUE = { id: "cyberAccessProgram", value: "daybreakBlue" };
const OFF = { id: "cyberAccessProgram", value: "standard" };
const SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-6-luna",
  options: [HIGH],
};
const PROJECTS: ReadonlyArray<EnvironmentProject> = [ENVIRONMENT_A, ENVIRONMENT_B].map(
  (environmentId) => ({
    environmentId,
    id: ProjectId.make("same-project"),
    title: "T3 Code",
    workspaceRoot: "/work/t3code",
    repositoryIdentity: null,
    defaultModelSelection: SELECTION,
    scripts: [],
    createdAt: "2026-10-23T10:00:00.000Z",
    updatedAt: "2026-10-23T10:00:00.000Z",
  }),
);

function config(environmentId: EnvironmentId) {
  const provider: ServerProvider = {
    instanceId: SELECTION.instanceId,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    checkedAt: IsoDateTime.make("2026-10-23T10:00:00.000Z"),
    auth: { status: "authenticated" },
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: SELECTION.model,
        name: "GPT 6 Luna",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: HIGH.id,
              label: "Reasoning",
              type: "select",
              options: [
                { id: "high", label: "High" },
                { id: "medium", label: "Medium" },
              ],
            },
            ...(environmentId === ENVIRONMENT_B
              ? [
                  {
                    id: BLUE.id,
                    label: "Daybreak",
                    type: "select" as const,
                    options: [
                      { id: "standard", label: "Off" },
                      { id: "daybreakBlue", label: "Blue" },
                    ],
                  },
                ]
              : []),
          ],
        },
      },
    ],
  };
  return { providers: [provider], settings: DEFAULT_SERVER_SETTINGS };
}

function setup() {
  const runtime = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = runtime.IS_REACT_ACT_ENVIRONMENT;
  runtime.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  fixture.projects = PROJECTS;
  appAtomRegistry.set(composerDraftsAtom, {});
  appAtomRegistry.set(modelOptionMemoryAtom, {});
  appAtomRegistry.set(stickyComposerModelSelectionAtom, null);
  return {
    [Symbol.dispose]() {
      appAtomRegistry.set(composerDraftsAtom, {});
      appAtomRegistry.set(modelOptionMemoryAtom, {});
      appAtomRegistry.set(stickyComposerModelSelectionAtom, null);
      vi.clearAllTimers();
      vi.useRealTimers();
      runtime.IS_REACT_ACT_ENVIRONMENT = previous;
    },
  };
}

async function mount() {
  await waitForComposerDraftsLoaded();
  const root = createRoot(document.createElement("div"));
  let current: ReturnType<typeof useNewTaskFlow>;
  function Probe() {
    const flow = useNewTaskFlow();
    useLayoutEffect(() => {
      current = flow;
    });
    return null;
  }
  await act(async () =>
    root.render(
      <RegistryContext.Provider value={appAtomRegistry}>
        <NewTaskFlowProvider>
          <Probe />
        </NewTaskFlowProvider>
      </RegistryContext.Provider>,
    ),
  );
  return {
    get flow() {
      return current;
    },
    [Symbol.dispose]() {
      act(() => root.unmount());
    },
  };
}

describe("new-task environment model options", () => {
  it("restores Blue after A → B → A → B with identical project, provider and model IDs", async () => {
    using _setup = setup();
    using composer = await mount();
    const draftKey = composer.flow.draftKey!;
    act(() => composer.flow.setPrompt("keep this draft"));
    act(() => composer.flow.selectEnvironment(ENVIRONMENT_B));
    act(() => composer.flow.setSelectedModelOptions([HIGH, BLUE]));
    expect(composer.flow.selectedModel?.options).toEqual([HIGH, BLUE]);

    act(() => composer.flow.selectEnvironment(ENVIRONMENT_A));
    expect(composer.flow.selectedModel?.options).toEqual([HIGH]);
    expect(rememberedModelOptions(SELECTION.instanceId, SELECTION.model, ENVIRONMENT_B)).toEqual([
      HIGH,
      BLUE,
    ]);
    act(() => composer.flow.selectEnvironment(ENVIRONMENT_B));

    expect(composer.flow.draftKey).toBe(draftKey);
    expect(composer.flow.prompt).toBe("keep this draft");
    expect(composer.flow.selectedModel?.options).toEqual([HIGH, BLUE]);
    expect(getComposerDraftSnapshot(draftKey).modelSelection?.options).toEqual([HIGH, BLUE]);
  });

  it("restores destination memory for a fresh draft after another environment cleaned sticky options", async () => {
    using _setup = setup();
    fixture.projects = PROJECTS.map((project) => ({ ...project, defaultModelSelection: null }));
    rememberModelOptions(SELECTION.instanceId, SELECTION.model, [HIGH, BLUE], ENVIRONMENT_B);
    setStickyComposerModelSelection({ ...SELECTION, options: [HIGH, BLUE] });
    using composer = await mount();
    act(() => composer.flow.selectEnvironment(ENVIRONMENT_B));
    expect(composer.flow.selectedModel?.options).toEqual([HIGH, BLUE]);
    const draftKey = createNewTaskDraft({
      environmentId: ENVIRONMENT_B,
      projectId: PROJECTS[1]!.id,
    });
    act(() => {
      composer.flow.openDraft(draftKey);
    });
    expect(composer.flow.selectedModel?.options).toEqual([HIGH, BLUE]);
  });

  it("keeps a fresh draft's project default ahead of older remembered options", async () => {
    using _setup = setup();
    fixture.projects = [
      {
        ...PROJECTS[1]!,
        defaultModelSelection: { ...SELECTION, options: [HIGH, BLUE] },
      },
    ];
    rememberModelOptions(
      SELECTION.instanceId,
      SELECTION.model,
      [{ id: HIGH.id, value: "medium" }, OFF],
      ENVIRONMENT_B,
    );
    using composer = await mount();
    expect(composer.flow.selectedModel?.options).toEqual([HIGH, BLUE]);
  });

  it("does not inherit an unowned global sticky Daybreak choice in a fresh draft", async () => {
    using _setup = setup();
    fixture.projects = [{ ...PROJECTS[1]!, defaultModelSelection: null }];
    setStickyComposerModelSelection({ ...SELECTION, options: [HIGH, BLUE] });
    using composer = await mount();
    expect(composer.flow.selectedEnvironmentId).toBe(ENVIRONMENT_B);
    expect(composer.flow.selectedModel?.options).toEqual([HIGH]);
  });

  it("keeps a saved Off choice when returning to its environment", async () => {
    using _setup = setup();
    using composer = await mount();
    act(() => composer.flow.selectEnvironment(ENVIRONMENT_B));
    act(() => composer.flow.setSelectedModelOptions([HIGH, BLUE]));
    act(() => composer.flow.setSelectedModelOptions([HIGH, OFF]));
    act(() => composer.flow.selectEnvironment(ENVIRONMENT_A));
    expect(composer.flow.selectedModel?.options).toEqual([HIGH]);
    act(() => composer.flow.selectEnvironment(ENVIRONMENT_B));
    expect(composer.flow.selectedModel?.options).toEqual([HIGH, OFF]);
  });

  it.each([
    { options: [] },
    { options: [OFF] },
    { options: [{ id: "reasoningEffort", value: "medium" }, OFF] },
  ])("keeps saved draft options ahead of older remembered Blue: $options", async ({ options }) => {
    using _setup = setup();
    using composer = await mount();
    rememberModelOptions(SELECTION.instanceId, SELECTION.model, [HIGH, BLUE], ENVIRONMENT_B);
    const draftKey = createNewTaskDraft({
      environmentId: ENVIRONMENT_B,
      projectId: PROJECTS[1]!.id,
    });
    updateComposerDraftSettings(draftKey, { modelSelection: { ...SELECTION, options } });
    act(() => {
      composer.flow.openDraft(draftKey);
    });
    expect(composer.flow.selectedModel?.options).toEqual(options);
    act(() => {
      composer.flow.setProject(PROJECTS[1]!);
    });
    expect(composer.flow.selectedModel?.options).toEqual(options);
  });

  it.each([
    { remembered: undefined, expected: [HIGH] },
    { remembered: [], expected: [] },
    { remembered: [HIGH, OFF], expected: [HIGH, OFF] },
  ])("uses the destination's choice on remap: $remembered", async ({ remembered, expected }) => {
    using _setup = setup();
    using composer = await mount();
    act(() => composer.flow.setSelectedModelOptions([HIGH, BLUE]));
    if (remembered) {
      rememberModelOptions(SELECTION.instanceId, SELECTION.model, remembered, ENVIRONMENT_B);
      // Empty memories are meaningful even when this environment has no earlier choice.
      if (remembered.length === 0) {
        appAtomRegistry.set(modelOptionMemoryAtom, {
          ...appAtomRegistry.get(modelOptionMemoryAtom),
          [JSON.stringify([ENVIRONMENT_B, SELECTION.instanceId])]: { [SELECTION.model]: [] },
        });
      }
    }
    act(() => composer.flow.selectEnvironment(ENVIRONMENT_B));
    expect(composer.flow.selectedModel?.options).toEqual(expected);
  });
});
