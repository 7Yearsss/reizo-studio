import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export default function EditPanelCard({
  className,
  children,
  style,
}: {
  className?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn(
        'flex items-stretch gap-5 rounded-2xl border border-line bg-paper-raised/95 p-5 text-ink shadow-2xl backdrop-blur-xl',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}
