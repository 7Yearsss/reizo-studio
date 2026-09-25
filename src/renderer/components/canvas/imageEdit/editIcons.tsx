import {
  Box,
  Brush,
  Crop,
  Eraser,
  Expand,
  FlipHorizontal2,
  Grid2x2,
  Grid3x3,
  Lightbulb,
  PenLine,
  Ruler,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Type,
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
  flip: FlipHorizontal2,
  adjust: SlidersHorizontal,
  mosaic: Grid2x2,
  textEdit: Type,
};

export function EditKindIcon({ kind, size = 14 }: { kind: ImageEditKind; size?: number }) {
  const Icon = EDIT_ICONS[kind];
  return <Icon size={size} />;
}
