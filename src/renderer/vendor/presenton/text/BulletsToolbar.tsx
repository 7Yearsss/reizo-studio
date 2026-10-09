// Adapted for Reizo Studio from Presenton (Apache-2.0). See this vendor directory's LICENSE, NOTICE and UPSTREAM.json for provenance and modifications.
import type { TemplateFontOption } from "./local-fonts";
import type { Marker } from "../types";
import {
  rawTextListRunsForEditor,
  setRawTextListRunsContent,
} from "./template-v2-text";
import type { TextSelectionRange } from "./text-runs";
import type { BulletsSlideElement, TextSlideElement } from "../state/state";
import { TextToolbar } from "./TextToolbar";
import type { ComponentActionsMenuActions } from "../selection/ComponentActionsMenu";

export function BulletsToolbar({
  element,
  index,
  anchorBox,
  scale,
  componentActions,
  selectionRange,
  templateFonts,
  onChange,
}: {
  element: BulletsSlideElement;
  index: number;
  anchorBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  scale: number;
  componentActions?: ComponentActionsMenuActions | null;
  selectionRange?: TextSelectionRange | null;
  templateFonts?: TemplateFontOption[];
  onChange: (index: number, element: BulletsSlideElement) => void;
}) {
  const marker = readMarker(element.marker);
  const textElement: TextSlideElement = {
    ...element,
    type: "text",
    runs: rawTextListRunsForEditor(element),
  };

  const updateMarker = (nextMarker: Marker) => {
    onChange(index, {
      ...element,
      marker: nextMarker,
    });
  };

  const updateTextElement = (
    _index: number,
    nextTextElement: TextSlideElement,
  ) => {
    const nextListElement = setRawTextListRunsContent(
      {
        ...element,
        font: nextTextElement.font,
      },
      nextTextElement.runs,
    ) as BulletsSlideElement;
    onChange(index, nextListElement);
  };

  return (
    <TextToolbar
      element={textElement}
      index={index}
      anchorBox={anchorBox}
      scale={scale}
      componentActions={componentActions}
      disableAlignment
      listMarker={marker}
      selectionRange={selectionRange}
      templateFonts={templateFonts}
      onChange={updateTextElement}
      onListMarkerChange={updateMarker}
    />
  );
}

function readMarker(value: unknown): Marker {
  return value === "number" || value === "none" ? value : "bullet";
}
