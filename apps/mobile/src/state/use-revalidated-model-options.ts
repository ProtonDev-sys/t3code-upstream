import type { EnvironmentId, ModelSelection, ServerProvider } from "@t3tools/contracts";
import { sanitizeDaybreakModelSelection } from "@t3tools/shared/model";
import { useEffect, useEffectEvent, useState } from "react";

import { waitForComposerDraftsLoaded } from "./use-composer-drafts";
import { rememberModelOptions, rememberedModelOptions } from "./use-model-option-memory";

export function useRevalidatedModelOptions(input: {
  readonly ownerKey: string | null;
  readonly environmentId: EnvironmentId | null;
  readonly selection: ModelSelection | null;
  readonly provider: ServerProvider | null | undefined;
  readonly onUpdateSelection: (selection: ModelSelection) => void;
}) {
  const onUpdateSelection = useEffectEvent(input.onUpdateSelection);
  const { ownerKey, environmentId, selection, provider } = input;
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    void waitForComposerDraftsLoaded().then(
      () => {
        if (active) setDraftsLoaded(true);
      },
      () => {
        // The loader reports failures; leave saved drafts untouched when it cannot hydrate.
      },
    );
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (
      !draftsLoaded ||
      !ownerKey ||
      !environmentId ||
      !selection ||
      provider?.instanceId !== selection.instanceId ||
      provider.driver !== "codex" ||
      !provider.installed ||
      provider.auth.status === "unauthenticated" ||
      provider.availability === "unavailable"
    ) {
      return;
    }
    // Only the owning account's loaded catalog can revoke an applied choice.
    const model = provider.models.find((model) => model.slug === selection.model);
    if (!model) return;
    const remembered = rememberedModelOptions(selection.instanceId, selection.model, environmentId);
    if (remembered) {
      const previous = { ...selection, options: remembered };
      const next = sanitizeDaybreakModelSelection(previous, model.capabilities);
      if (next !== previous) {
        rememberModelOptions(next.instanceId, next.model, next.options ?? [], environmentId);
      }
    }
    const next = sanitizeDaybreakModelSelection(selection, model.capabilities);
    if (next !== selection) onUpdateSelection(next);
  }, [draftsLoaded, ownerKey, environmentId, selection, provider]);
}
