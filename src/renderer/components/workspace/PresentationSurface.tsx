import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { TemplateV2KonvaSlide } from '../../vendor/presenton/surface/TemplateV2KonvaSlide';
import type { PresentationLayout, PresentationSlide } from '../../../shared/presentationContent';
export interface PresentationEditingApi { flush(): void; getLayout(): PresentationLayout }
export default function PresentationSurface({ slide, index = 0, editable = false, onChange, editingApiRef, historyCommand, prepare }: {
  slide: PresentationSlide; index?: number; editable?: boolean; onChange?(layout: PresentationLayout): void;
  editingApiRef?: MutableRefObject<PresentationEditingApi | null>; historyCommand?: { action: 'undo' | 'redo'; token: number };
  prepare?(layout: PresentationLayout): PresentationLayout;
}) {
  const host = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(480);
  useEffect(() => { const element = host.current; if (!element) return; const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width)); observer.observe(element); return () => observer.disconnect(); }, []);
  const scale = Math.max(0.06, width / 1280);
  return <div ref={host} className="w-full" style={{ height: width * 720 / 1280 }}><div style={{ width: 1280, height: 720, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
    <TemplateV2KonvaSlide layout={slide.layout} isEditMode={editable} slideId={slide.id} slideIndex={index} displayScale={scale} onLayoutChange={onChange} prepareLayout={prepare} editingApiRef={editingApiRef} historyCommand={historyCommand} enableViewportCulling={!editable} />
  </div></div>;
}
