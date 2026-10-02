import type { ProviderOptionDescriptor, ProviderOptionSelection } from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getCodexDaybreakToggleState,
} from "@t3tools/shared/model";
import { Switch } from "../ui/switch";

/** Edits Daybreak alongside the selected model without changing the model or its catalog. */
export function CodexDaybreakToggle(props: {
  descriptors: ReadonlyArray<ProviderOptionDescriptor>;
  disabled?: boolean;
  onOptionsChange: (options: ReadonlyArray<ProviderOptionSelection> | undefined) => void;
}) {
  const state = getCodexDaybreakToggleState(props.descriptors);
  if (!state) return null;
  return (
    <label className="flex items-center justify-between gap-4 border-t px-3 py-2 text-xs">
      <span>Daybreak</span>
      <Switch
        size="sm"
        aria-label="Daybreak"
        checked={state.checked}
        disabled={props.disabled}
        onCheckedChange={(checked) => {
          const descriptors = props.descriptors.map((descriptor) =>
            descriptor.id === "cyberAccessProgram" && descriptor.type === "select"
              ? { ...descriptor, currentValue: checked ? state.enabledValue : "standard" }
              : descriptor,
          );
          props.onOptionsChange(buildProviderOptionSelectionsFromDescriptors(descriptors));
        }}
      />
    </label>
  );
}
