/** Minimal offset-preserving XML reader for OOXML parts. Offsets let export splice untouched source verbatim. */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text node when name === '#text'. */
  text?: string;
  start: number; openEnd: number; closeStart: number; end: number;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[body] ?? match;
  });
}
export function escapeXml(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], start: 0, openEnd: 0, closeStart: xml.length, end: xml.length };
  const stack: XmlNode[] = [root];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) break;
    if (lt > i) {
      const text = xml.slice(i, lt);
      if (text.trim() || top.name !== '#root') top.children.push({ name: '#text', attrs: {}, children: [], text: decodeEntities(text), start: i, openEnd: lt, closeStart: lt, end: lt });
    }
    if (xml.startsWith('<!--', lt)) { const end = xml.indexOf('-->', lt); if (end < 0) throw new Error('XML 注释未闭合'); i = end + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt); if (end < 0) throw new Error('XML CDATA 未闭合');
      top.children.push({ name: '#text', attrs: {}, children: [], text: xml.slice(lt + 9, end), start: lt, openEnd: end + 3, closeStart: end + 3, end: end + 3 }); i = end + 3; continue;
    }
    if (xml.startsWith('<?', lt)) { const end = xml.indexOf('?>', lt); if (end < 0) throw new Error('XML 声明未闭合'); i = end + 2; continue; }
    if (xml.startsWith('<!', lt)) { const end = xml.indexOf('>', lt); if (end < 0) throw new Error('XML DOCTYPE 未闭合'); i = end + 1; continue; }
    if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt); if (end < 0) throw new Error('XML 结束标签未闭合');
      const name = xml.slice(lt + 2, end).trim();
      const node = stack.pop();
      if (!node || node.name !== name || stack.length === 0) throw new Error(`XML 标签不匹配：${name}`);
      node.closeStart = lt; node.end = end + 1; i = end + 1; continue;
    }
    // Opening tag; find the closing '>' that is not inside a quoted attribute value.
    let j = lt + 1; let quote = '';
    for (; j < xml.length; j++) {
      const ch = xml[j];
      if (quote) { if (ch === quote) quote = ''; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') break;
    }
    if (j >= xml.length) throw new Error('XML 标签未闭合');
    const selfClosing = xml[j - 1] === '/';
    const inner = xml.slice(lt + 1, selfClosing ? j - 1 : j);
    const nameMatch = /^[^\s/>]+/.exec(inner); if (!nameMatch) throw new Error('XML 标签名无效');
    const attrs: Record<string, string> = {};
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let m: RegExpExecArray | null;
    const attrText = inner.slice(nameMatch[0].length);
    while ((m = attrRe.exec(attrText))) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
    const node: XmlNode = { name: nameMatch[0], attrs, children: [], start: lt, openEnd: j + 1, closeStart: selfClosing ? j + 1 : -1, end: selfClosing ? j + 1 : -1 };
    top.children.push(node);
    if (!selfClosing) stack.push(node);
    i = j + 1;
  }
  if (stack.length !== 1) throw new Error('XML 结构不完整');
  return root;
}

export const elements = (node: XmlNode): XmlNode[] => node.children.filter((child) => child.name !== '#text');
export const child = (node: XmlNode | undefined, name: string): XmlNode | undefined => node?.children.find((c) => c.name === name);
export const childrenNamed = (node: XmlNode | undefined, name: string): XmlNode[] => node?.children.filter((c) => c.name === name) ?? [];
export const attr = (node: XmlNode | undefined, name: string): string | undefined => node?.attrs[name];
export function textOf(node: XmlNode): string { return node.name === '#text' ? node.text ?? '' : node.children.map(textOf).join(''); }
export function find(node: XmlNode, name: string): XmlNode | undefined {
  for (const c of node.children) { if (c.name === name) return c; const hit = find(c, name); if (hit) return hit; }
  return undefined;
}
/** OOXML on/off property: present without val, or val not in the false set, means on. */
export function onOff(node: XmlNode | undefined): boolean | undefined {
  if (!node) return undefined;
  const value = node.attrs['w:val'];
  return !(value === '0' || value === 'false' || value === 'off');
}
