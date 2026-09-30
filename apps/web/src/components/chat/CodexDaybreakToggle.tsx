import {
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ScopedThreadRef,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { ShieldCheckIcon } from "lucide-react";
import { resolveCodexDaybreakModel, withCodexDaybreakSelection } from "../../codexDaybreak";
import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function CodexDaybreakToggle(props: {
  instanceId: ProviderInstanceId;
  model: string;
  models: ReadonlyArray<ServerProviderModel>;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  accountLabel?: string;
  threadRef?: ScopedThreadRef;
  draftId?: DraftId;
  disabled?: boolean;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onModelChange: (model: string) => void;
}) {
  const setProviderModelOptions = useComposerDraftStore((store) => store.setProviderModelOptions);
  const { enabled, program, canEnable, model } = resolveCodexDaybreakModel(
    props.models,
    props.model,
    props.modelOptions,
  );
  const target = props.threadRef ?? props.draftId;
  const modelDisabledReason = props.getModelDisabledReason?.(props.instanceId, model);
  if (!canEnable) return null;
  const label = `Daybreak ${program === "daybreakRed" ? "Red" : "Blue"}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<div className="flex items-center justify-between gap-4 border-t px-3 py-2" />}
      >
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
          {label}
          {props.accountLabel ? <span className="truncate">· {props.accountLabel}</span> : null}
        </span>
        <Switch
          size="sm"
          aria-label={props.accountLabel ? `${label} · ${props.accountLabel}` : label}
          checked={enabled}
          disabled={props.disabled || !target || (!enabled && !!modelDisabledReason)}
          onCheckedChange={(checked) => {
            const nextProgram = checked ? program : "standard";
            if (!target || !nextProgram) return;
            if (checked) props.onModelChange(model);
            setProviderModelOptions(
              target,
              ProviderDriverKind.make("codex"),
              withCodexDaybreakSelection(props.modelOptions, nextProgram),
              { instanceId: props.instanceId, model, persistSticky: true },
            );
          }}
        />
      </TooltipTrigger>
      <TooltipPopup side="top">
        {modelDisabledReason ??
          `Only models supporting Daybreak ${program === "daybreakRed" ? "Red" : "Blue"} for this Codex account are shown while enabled. Enabling selects ${model}. Approved access is required; some requests remain limited.`}
      </TooltipPopup>
    </Tooltip>
  );
}
