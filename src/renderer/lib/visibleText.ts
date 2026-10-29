const SKIPPED = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE']);

/** The text a reader can see under `root`: like textContent, minus <style>/<script> bodies and other non-rendered nodes. */
export function visibleText(root: Node): string {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode(node) {
      for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
        if (SKIPPED.has(el.tagName)) return 2; // FILTER_REJECT
      }
      return 1; // FILTER_ACCEPT
    },
  });
  let out = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) out += node.nodeValue ?? '';
  return out;
}
