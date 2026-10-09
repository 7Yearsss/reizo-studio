// Adapted for Reizo Studio from Presenton (Apache-2.0). See this vendor directory's LICENSE, NOTICE and UPSTREAM.json for provenance and modifications.
export type TemplateV2ToolbarBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TemplateV2ToolbarComponentSelection = {
  kind: "component";
  componentIndex: number;
};

export type TemplateV2ToolbarMultiComponentSelection = {
  kind: "multi-component";
  componentIndexes: number[];
};

export type TemplateV2ToolbarElementSelection = {
  kind: "element";
  componentIndex: number;
  elementPath: number[];
};

export type TemplateV2ToolbarSelection =
  | TemplateV2ToolbarComponentSelection
  | TemplateV2ToolbarMultiComponentSelection
  | TemplateV2ToolbarElementSelection
  | null;
