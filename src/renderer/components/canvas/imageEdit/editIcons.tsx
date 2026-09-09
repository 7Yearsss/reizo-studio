import {
  Box,
  Brush,
  Crop,
  Eraser,
  Expand,
  Grid3x3,
  Lightbulb,
  PenLine,
  Ruler,
  Scissors,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { ImageEditKind } from '../../../../shared/canvasImageEdit';

export const EDIT_ICONS: Record<ImageEditKind, LucideIcon> = {
  crop: Crop,
  multiAngle: Box,
  inpaint: Brush,
  relight: Lightbulb,
  outpaint: Expand,
  erase: Eraser,
  annotate: PenLine,
  enhance: Sparkles,
  resize: Ruler,
  matting: Scissors,
  split: Grid3x3,
};

export function EditKindIcon({ kind, size = 14 }: { kind: ImageEditKind; size?: number }) {
  const Icon = EDIT_ICONS[kind];
  return <Icon size={size} />;
}
