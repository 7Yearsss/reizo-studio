/** Reizo's bundled Lucide icons; no remote icon-search service. */
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArrowRight, Award, BookOpen, Briefcase, Calendar, ChartColumn, Check, Clock, Cloud, Code, Flag, Globe, Heart, Home, Lightbulb, Mail, Rocket, Shield, Star, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
const choices = { ArrowRight, Award, BookOpen, Briefcase, Calendar, ChartColumn, Check, Clock, Cloud, Code, Flag, Globe, Heart, Home, Lightbulb, Mail, Rocket, Shield, Star, Users };
export default function IconsEditor({ onClose, onIconChange }: { icon_prompt?: string[] | null; currentIconUrl?: string; onClose?(): void; onIconChange?(url: string, query?: string): void }) {
  const [query, setQuery] = useState('');
  return <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}><DialogContent><DialogHeader><DialogTitle>选择图标</DialogTitle><DialogDescription>图标以可缩放 SVG 保存在演示稿中。</DialogDescription></DialogHeader>
    <Input aria-label="搜索图标" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索图标名称" />
    <div className="grid grid-cols-5 gap-2">{Object.entries(choices).filter(([name]) => name.toLowerCase().includes(query.toLowerCase())).map(([name, Icon]) => <Button variant="outline" aria-label={name} title={name} key={name} onClick={() => { const svg = renderToStaticMarkup(<Icon xmlns="http://www.w3.org/2000/svg" color="#222222" width={96} height={96} />); onIconChange?.(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, name); onClose?.(); }}><Icon /></Button>)}</div>
  </DialogContent></Dialog>;
}
