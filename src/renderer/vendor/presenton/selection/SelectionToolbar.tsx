// Adapted for Reizo Studio from Presenton (Apache-2.0). See this vendor directory's LICENSE, NOTICE and UPSTREAM.json for provenance and modifications.
"use client";

import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { TEMPLATE_V2_ASK_AI_EVENT } from "../events/events";
import {
  TemplateV2LayoutToolbar,
  type TemplateV2SelectionComponentActions,
} from "../layout/LayoutToolbar";
import type { ComponentLayerAction } from "./layering";
import type {
  TemplateV2ChartSelectionToolbarTarget,
  TemplateV2EditorSelectionToolbarTarget,
  TemplateV2SelectionToolbarTarget,
  TemplateV2TableSelectionToolbarTarget,
} from "./toolbarTarget";
import type {
  TemplateV2ToolbarBox,
  TemplateV2ToolbarSelection,
} from "./toolbarTypes";
import type { TemplateV2ToolbarViewportBounds } from "./toolbarPosition";
import type {
  ChartSlideElement,
  TableCellSelection,
  TableSlideElement,
} from "../state/state";
import type { TemplateFontOption } from "../text/local-fonts";
import { ElementToolbar } from "../toolbar/ElementToolbar";
import type { SlideElement } from "../types";
import { TemplateV2MultiSelectionToolbar } from "./MultiSelectionToolbar";

type TemplateV2SelectionToolbarProps = {
  anchorBox: TemplateV2ToolbarBox | null;
  canUngroupComponent: boolean;
  canUngroupLayoutTarget: boolean;
  chartTarget: TemplateV2ChartSelectionToolbarTarget | null;
  componentCount: number;
  editorTarget: TemplateV2EditorSelectionToolbarTarget | null;
  isEditMode: boolean;
  layoutTarget: TemplateV2SelectionToolbarTarget | null;
  position: { left: number; top: number } | null;
  selectedTableCell: TableCellSelection | null;
  selection: TemplateV2ToolbarSelection;
  selectionKey: string;
  tableTarget: TemplateV2TableSelectionToolbarTarget | null;
  targetComponentActions: TemplateV2SelectionComponentActions | null;
  templateFonts?: TemplateFontOption[];
  toolbarBounds: TemplateV2ToolbarViewportBounds | null;
  onChartChange: (element: ChartSlideElement) => void;
  onChartEdit: () => void;
  onInfographicEdit: () => void;
  onEditorChange: (element: SlideElement) => void;
  onImageCropModeChange: (active: boolean) => void;
  onIconEdit: () => void;
  onDeleteSelection: () => void;
  onDuplicateSelection: () => void;
  onLayoutChange: (changes: Record<string, unknown>) => void;
  onLayerAction: (action: ComponentLayerAction) => void;
  onGroupSelection: () => void;
  onTableChange: (element: TableSlideElement) => void;
  onUngroupComponent: () => void;
  onUngroupLayoutTarget: () => void;
};

export function TemplateV2SelectionToolbar({
  anchorBox,
  canUngroupComponent,
  canUngroupLayoutTarget,
  chartTarget,
  componentCount,
  editorTarget,
  isEditMode,
  layoutTarget,
  position,
  selectedTableCell,
  selection,
  selectionKey,
  tableTarget,
  targetComponentActions,
  templateFonts,
  toolbarBounds,
  onChartChange,
  onChartEdit,
  onInfographicEdit,
  onEditorChange,
  onImageCropModeChange,
  onIconEdit,
  onDeleteSelection,
  onDuplicateSelection,
  onLayoutChange,
  onLayerAction,
  onGroupSelection,
  onTableChange,
  onUngroupComponent,
  onUngroupLayoutTarget,
}: TemplateV2SelectionToolbarProps) {
  if (!isEditMode || !anchorBox) return null;
  return (
    <>
      <TemplateV2SelectionToolbarBody
        {...{ anchorBox, canUngroupComponent, canUngroupLayoutTarget, chartTarget, componentCount, editorTarget, isEditMode, layoutTarget, position, selectedTableCell, selection, selectionKey, tableTarget, targetComponentActions, templateFonts, toolbarBounds, onChartChange, onChartEdit, onInfographicEdit, onEditorChange, onImageCropModeChange, onIconEdit, onDeleteSelection, onDuplicateSelection, onLayoutChange, onLayerAction, onGroupSelection, onTableChange, onUngroupComponent, onUngroupLayoutTarget }}
      />
      {selection ? (
        <AskAiPill anchorBox={anchorBox} bounds={toolbarBounds} />
      ) : null}
    </>
  );
}

const ASK_AI_PILL_WIDTH = 76;
const ASK_AI_PILL_HEIGHT = 30;
const ASK_AI_PILL_GAP = 8;

/**
 * Reizo: hands the selection to the chat right where the user is looking,
 * instead of a trip to the workspace header. Sits beside the selection's right
 * edge (the element toolbars anchor at its left), or below it when there is no room.
 */
function AskAiPill({
  anchorBox,
  bounds,
}: {
  anchorBox: TemplateV2ToolbarBox;
  bounds: TemplateV2ToolbarViewportBounds | null;
}) {
  if (!bounds || typeof document === "undefined") return null;
  const scale = (bounds.right - bounds.left) / 1280;
  const right = bounds.left + (anchorBox.x + anchorBox.width) * scale;
  const top = bounds.top + anchorBox.y * scale;
  const bottom = bounds.top + (anchorBox.y + anchorBox.height) * scale;
  const besideFits =
    right + ASK_AI_PILL_GAP + ASK_AI_PILL_WIDTH <= bounds.right;
  const left = besideFits
    ? right + ASK_AI_PILL_GAP
    : Math.max(bounds.left, right - ASK_AI_PILL_WIDTH);
  const pillTop = besideFits
    ? Math.max(bounds.top, top)
    : Math.min(bounds.bottom - ASK_AI_PILL_HEIGHT, bottom + ASK_AI_PILL_GAP);
  return createPortal(
    <button
      type="button"
      data-inline-edit-ignore="true"
      data-template-v2-floating-toolbar="true"
      title="把选中的元素交给 AI（Ctrl+L）"
      aria-keyshortcuts="Control+L Meta+L"
      className="fixed z-[10000] inline-flex items-center justify-center gap-1 rounded-full bg-[#6847F4] px-3 text-[12px] font-semibold text-white shadow-[0_6px_18px_rgba(16,24,40,0.18)] transition-colors hover:bg-[#5838DE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A5AF8] focus-visible:ring-offset-2"
      style={{ left, top: pillTop, width: ASK_AI_PILL_WIDTH, height: ASK_AI_PILL_HEIGHT }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() =>
        window.dispatchEvent(new CustomEvent(TEMPLATE_V2_ASK_AI_EVENT))
      }
    >
      <Sparkles aria-hidden="true" className="size-3.5" strokeWidth={2} />
      问 AI
    </button>,
    document.body,
  );
}

function TemplateV2SelectionToolbarBody({
  anchorBox,
  canUngroupComponent,
  canUngroupLayoutTarget,
  chartTarget,
  componentCount,
  editorTarget,
  layoutTarget,
  position,
  selectedTableCell,
  selection,
  selectionKey,
  tableTarget,
  targetComponentActions,
  templateFonts,
  toolbarBounds,
  onChartChange,
  onChartEdit,
  onInfographicEdit,
  onEditorChange,
  onImageCropModeChange,
  onIconEdit,
  onDeleteSelection,
  onDuplicateSelection,
  onLayoutChange,
  onLayerAction,
  onGroupSelection,
  onTableChange,
  onUngroupComponent,
  onUngroupLayoutTarget,
}: TemplateV2SelectionToolbarProps & { anchorBox: TemplateV2ToolbarBox }) {
  if (selection?.kind === "multi-component") {
    return (
      <TemplateV2MultiSelectionToolbar
        count={selection.componentIndexes.length}
        position={position}
        onGroup={onGroupSelection}
      />
    );
  }

  const componentActions =
    selection?.kind === "component"
      ? {
          canUngroup: canUngroupComponent,
          componentCount,
          componentIndex: selection.componentIndex,
          onDelete: onDeleteSelection,
          onDuplicate: onDuplicateSelection,
          onLayerAction,
          onUngroup: onUngroupComponent,
      }
      : targetComponentActions;

  if (editorTarget && componentActions) {
    return (
      <ElementToolbar
        element={editorTarget.element}
        index={editorTarget.selection.componentIndex}
        anchorBox={anchorBox}
        path={selectionKey}
        scale={1}
        componentActions={componentActions}
        selectedTableCell={null}
        templateFonts={templateFonts}
        onChange={(_index, element) => onEditorChange(element)}
        onImageCropModeChange={onImageCropModeChange}
        onEditIcon={onIconEdit}
        onEditImage={() => undefined}
      />
    );
  }

  return (
    <TemplateV2LayoutToolbar
      key={selectionKey}
      box={anchorBox}
      element={
        layoutTarget?.element ??
        chartTarget?.element ??
        tableTarget?.element ??
        null
      }
      position={position ?? undefined}
      bounds={toolbarBounds}
      componentActions={componentActions}
      onChartChange={chartTarget ? onChartChange : undefined}
      onChartEdit={chartTarget ? onChartEdit : undefined}
      onInfographicEdit={layoutTarget ? onInfographicEdit : undefined}
      onChange={layoutTarget ? onLayoutChange : undefined}
      onTableChange={tableTarget ? onTableChange : undefined}
      selectedTableCell={selectedTableCell}
      ungroupAction={
        canUngroupLayoutTarget
          ? {
              canUngroup: true,
              onUngroup: onUngroupLayoutTarget,
            }
          : null
      }
    />
  );
}
