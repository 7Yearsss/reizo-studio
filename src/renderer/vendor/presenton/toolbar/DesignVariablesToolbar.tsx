// Adapted for Reizo Studio from Presenton (Apache-2.0). See this vendor directory's LICENSE, NOTICE and UPSTREAM.json for provenance and modifications.
import type { SlideElement } from "../types";
import {
  applyDesignVariableOption,
  designVariableNameLabel,
  designVariableOptionLabel,
  selectedDesignVariableOptionIndex,
} from "../model/design-variables";
import { inlineStyles } from "./inlineStyles";
import {
  FloatingToolbar,
  type FloatingToolbarBox,
} from "./FloatingToolbar";

export function DesignVariablesToolbar({
  anchorBox,
  element,
  index,
  scale,
  onChange,
}: {
  anchorBox?: FloatingToolbarBox | null;
  element: SlideElement;
  index: number;
  scale: number;
  onChange: (index: number, element: SlideElement) => void;
}) {
  const variables = element.design_variables ?? [];
  if (variables.length === 0) return null;

  return (
    <FloatingToolbar
      anchorBox={
        anchorBox ?? {
          x: (element.position?.x ?? 0) * scale,
          y: (element.position?.y ?? 0) * scale,
          width: (element.size?.width ?? 1) * scale,
          height: (element.size?.height ?? 1) * scale,
        }
      }
      fallbackWidth={160}
      style={inlineStyles.toolbar}
    >
      {variables.map((variable) => {
        const selectedIndex = selectedDesignVariableOptionIndex(element, variable);
        const label = designVariableNameLabel(variable.name);
        return (
          <select
            key={variable.name}
            aria-label={label}
            title={label}
            value={selectedIndex >= 0 ? String(selectedIndex) : ""}
            onChange={(event) => {
              const optionIndex = Number(event.target.value);
              const option = variable.options[optionIndex];
              onChange(
                index,
                applyDesignVariableOption(element, variable, option),
              );
            }}
            style={{ ...inlineStyles.select, minWidth: 118 }}
          >
            <option value="" disabled>
              {label}
            </option>
            {variable.options.map((option, optionIndex) => (
              <option key={optionIndex} value={optionIndex}>
                {designVariableOptionLabel(option)}
              </option>
            ))}
          </select>
        );
      })}
    </FloatingToolbar>
  );
}
