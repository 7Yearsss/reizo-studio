// Adapted for Reizo Studio from Presenton (Apache-2.0). See this vendor directory's LICENSE, NOTICE and UPSTREAM.json for provenance and modifications.
export function cssFontFamilyStack(family: string) {
  const escapedFamily = family
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n\f]/g, " ");
  return `"${escapedFamily || "Arial"}", Helvetica, sans-serif`;
}
