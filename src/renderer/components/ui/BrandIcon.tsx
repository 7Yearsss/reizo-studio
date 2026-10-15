import { useState } from 'react';
import { cn } from '../../lib/cn';
import { letterTile, letterTileStyle } from '../skills/tileColor';

export type BuiltinBrandId =
  | 'feishu'
  | 'wecom'
  | 'dingtalk'
  | 'yuque'
  | 'gitee'
  | 'notion'
  | 'gmail'
  | 'github'
  | 'bilibili';

export type BrandIconSize = 'sm' | 'md' | 'lg';

const SIZE_CONFIG: Record<BrandIconSize, { container: string; icon: string }> = {
  sm: { container: 'h-7 w-7 rounded-lg', icon: 'h-4 w-4' },
  md: { container: 'h-9 w-9 rounded-xl', icon: 'h-5 w-5' },
  lg: { container: 'h-11 w-11 rounded-2xl', icon: 'h-6 w-6' },
};

/**
 * Brand-specific background tinting to make the colored logos look integrated and premium
 */
const BRAND_CONTAINER_BG: Record<BuiltinBrandId, string> = {
  feishu: 'bg-[#3370FF]/10 border-[#3370FF]/20',
  wecom: 'bg-[#1875F0]/10 border-[#1875F0]/20',
  dingtalk: 'bg-[#007FFF]/10 border-[#007FFF]/20',
  yuque: 'bg-[#00B96B]/10 border-[#00B96B]/20',
  gitee: 'bg-[#C71D23]/10 border-[#C71D23]/20',
  notion: 'bg-paper-inset border-line',
  gmail: 'bg-[#EA4335]/10 border-[#EA4335]/20',
  github: 'bg-paper-inset border-line',
  bilibili: 'bg-[#00A1D6]/10 border-[#00A1D6]/20',
};

// --- Authentic Vector SVGs for Built-in Services ----------------------------------------------------

/**
 * 飞书 (Feishu / Lark) Official Origami Bird
 */
function FeishuLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 14L24 4L42 14L24 24L6 14Z" fill="#3370FF" />
      <path d="M6 14L24 24V42L6 32V14Z" fill="#00D6B9" />
      <path d="M42 14L24 24V42L42 32V14Z" fill="#1F56D2" />
      <path d="M24 24L33 19L24 38L15 19L24 24Z" fill="#70EDE0" fillOpacity="0.45" />
    </svg>
  );
}

/**
 * 企业微信 (WeCom) Authentic Dual-bubble Logo
 */
function WeComLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Primary blue speech bubble */}
      <path
        d="M26 8C16.059 8 8 15.163 8 24c0 3.328 1.155 6.42 3.14 9.006L9 40l7.854-2.142C19.198 39.296 22.477 40 26 40c9.941 0 18-7.163 18-16S35.941 8 26 8z"
        fill="#1875F0"
      />
      {/* Secondary accent dialog circle with white accents */}
      <circle cx="21" cy="22" r="3.2" fill="#FFFFFF" />
      <circle cx="31" cy="22" r="3.2" fill="#FFFFFF" />
      {/* Small cyan bubble badge on top right */}
      <path
        d="M36 12c-4.418 0-8 3.134-8 7 0 1.547.625 2.977 1.69 4.137L29 27l3.856-1.04C33.86 26.236 34.908 26 36 26c4.418 0 8-3.134 8-7s-3.582-7-8-7z"
        fill="#4E97FF"
      />
    </svg>
  );
}

/**
 * 钉钉 (DingTalk) Authentic Winged Lightning Logo
 */
function DingTalkLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M38.5 7.5L8.5 22.5L21.5 28.5L34 16L24.5 31L35.5 37.5L38.5 7.5Z"
        fill="#007FFF"
      />
      <path
        d="M21.5 28.5V40.5L27 34L21.5 28.5Z"
        fill="#005BC7"
      />
      <path
        d="M34 16L21.5 28.5L35.5 37.5L38.5 7.5L34 16Z"
        fill="#38B2FF"
        fillOpacity="0.85"
      />
    </svg>
  );
}

/**
 * 语雀 (Yuque) Authentic Emerald Sparrow
 */
function YuqueLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="20" fill="#00B96B" />
      <path
        d="M17 17.5C17 15.567 18.567 14 20.5 14H31C31 14 29 18 29 21.5C29 25 31 29 31 29H20.5C18.567 29 17 27.433 17 25.5V17.5Z"
        fill="#FFFFFF"
      />
      <circle cx="23.5" cy="18.5" r="2" fill="#009653" />
      <path
        d="M17 25.5C17 27.433 18.567 29 20.5 29H31L26 34H20.5C16.91 34 14 31.09 14 27.5V23L17 25.5Z"
        fill="#E8FAF1"
      />
    </svg>
  );
}

/**
 * Gitee (码云) Official Simple Icons Emblem in Gitee Red (#C71D23)
 */
function GiteeLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="#C71D23"
      role="img"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.266.592.593v1.482a.594.594 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.266.592.593.592h5.63c.982 0 1.777-.796 1.777-1.778v-2.074a.593.593 0 0 0-.592-.593h-4.445a.593.593 0 0 1-.592-.592V9.48c0-.327.266-.593.592-.593h6.815c.328 0 .593.266.593.593v4.444c0 2.292-1.858 4.149-4.148 4.149H8.593C6.303 18.074 4.445 16.216 4.445 13.926V7.407C4.445 5.118 6.303 3.26 8.593 3.26h8.889c.328 0 .592.266.592.593v1.48z" />
    </svg>
  );
}

/**
 * Notion Official Simple Icons Emblem in Inverted Monolith
 */
function NotionLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      role="img"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.934zm14.337.747c.093.42 0 .84-.42.887l-.934.14v10.032c-.56.327-1.167.514-1.634.514-.794 0-1.027-.28-1.634-1.027l-5.604-8.773v8.54l1.634.373c.093.42-.14.84-.56.84l-4.203.234c-.093-.42.14-.84.56-.887l1.074-.187V9.068l-1.447-.14c-.094-.42.14-.84.607-.887l4.343-.28 5.884 8.96V8.881l-1.354-.14c-.093-.42.14-.84.607-.887z" />
    </svg>
  );
}

/**
 * Google Mail (Gmail) Official 4-Color Envelope Logo
 */
function GmailLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Left blue pillar */}
      <path d="M2 6.5C2 5.12 3.12 4 4.5 4H6v11H2V6.5z" fill="#4285F4" />
      {/* Right green pillar */}
      <path d="M18 4h1.5C20.88 4 22 5.12 22 6.5V15h-4V4z" fill="#34A853" />
      {/* Center top fold (Red) */}
      <path d="M6 4l6 4.5L18 4v2.5l-6 4.5-6-4.5V4z" fill="#EA4335" />
      {/* Left red fold */}
      <path d="M2 15l4-3v6H4.5A2.5 2.5 0 0 1 2 15.5V15z" fill="#C5221F" />
      {/* Right yellow fold */}
      <path d="M22 15l-4-3v6h1.5a2.5 2.5 0 0 0 2.5-2.5V15z" fill="#FBBC05" />
      {/* Center white letter face */}
      <path d="M6 11l6 4.5 6-4.5V18H6v-7z" fill="#EA4335" fillOpacity="0.85" />
    </svg>
  );
}

/**
 * GitHub Official Simple Icons Octocat
 */
function GitHubLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      role="img"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/**
 * Bilibili (哔哩哔哩) Official Simple Icons TV (#00A1D6)
 */
function BilibiliLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="#00A1D6"
      role="img"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M17.813 4.653h.854c1.51.054 2.769.578 3.774 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.264 1.52-3.774 1.56H5.333c-1.51-.04-2.769-.56-3.773-1.56S.036 18.857 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.264-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.08-.08c.27-.267.59-.4.96-.4.356 0 .676.133.96.4l3.28 3.12h7.04l3.28-3.12c.284-.267.604-.4.96-.4.37 0 .69.133.96.4l.08.08c.25.249.374.551.374.907 0 .355-.125.657-.374.906zm-10.747 8.32c.57 0 1.04-.2 1.414-.6.373-.4.56-.88.56-1.44 0-.56-.187-1.04-.56-1.44-.373-.4-.844-.6-1.414-.6-.57 0-1.04.2-1.413.6-.373.4-.56.88-.56 1.44 0 .56.187 1.04.56 1.44.373.4.844.6 1.413.6zm9.867 0c.57 0 1.04-.2 1.413-.6.374-.4.56-.88.56-1.44 0-.56-.186-1.04-.56-1.44-.373-.4-.843-.6-1.413-.6-.57 0-1.04.2-1.414.6-.373.4-.56.88-.56 1.44 0 .56.187 1.04.56 1.44.373.4.844.6 1.414.6z" />
    </svg>
  );
}

const BUILTIN_LOGOS: Record<BuiltinBrandId, React.FC<{ className?: string }>> = {
  feishu: FeishuLogo,
  wecom: WeComLogo,
  dingtalk: DingTalkLogo,
  yuque: YuqueLogo,
  gitee: GiteeLogo,
  notion: NotionLogo,
  gmail: GmailLogo,
  github: GitHubLogo,
  bilibili: BilibiliLogo,
};

// --- Dynamic Simple Icons Component -----------------------------------------------------------------

export interface SimpleIconProps {
  /** Simple Icons slug (e.g. 'gitee', 'slack', 'discord', 'gitlab', 'linear') */
  slug: string;
  /** Name used for fallback letter tile */
  name?: string;
  /** Optional hex color without # (defaults to brand's official color on Simple Icons CDN) */
  colorHex?: string;
  className?: string;
}

/**
 * Loads and renders an official colored SVG from simple-icons CDN with deterministic letter tile fallback
 */
export function SimpleIcon({ slug, name, colorHex, className }: SimpleIconProps) {
  const [errored, setErrored] = useState(false);
  const normalizedSlug = slug.toLowerCase().trim();

  // If slug matches a built-in vector, use the zero-latency embedded SVG!
  if (normalizedSlug in BUILTIN_LOGOS) {
    const Component = BUILTIN_LOGOS[normalizedSlug as BuiltinBrandId];
    return <Component className={className} />;
  }

  const displayName = name || slug;
  const { letter, hue } = letterTile(displayName);
  const tileStyle = letterTileStyle(hue);

  if (errored) {
    return (
      <div
        className={cn('flex items-center justify-center font-semibold select-none', className)}
        style={tileStyle}
      >
        {letter}
      </div>
    );
  }

  const cdnUrl = colorHex
    ? `https://cdn.simpleicons.org/${normalizedSlug}/${colorHex.replace('#', '')}`
    : `https://cdn.simpleicons.org/${normalizedSlug}`;

  return (
    <img
      src={cdnUrl}
      alt={displayName}
      onError={() => setErrored(true)}
      className={cn('object-contain select-none', className)}
      loading="lazy"
    />
  );
}

// --- BrandIcon Main Component -----------------------------------------------------------------------

export interface BrandIconProps {
  /** Builtin brand ID or simple-icons slug */
  brand?: BuiltinBrandId | string;
  /** Optional display name (used if fallback needed) */
  name?: string;
  /** Size preset (default: 'md' = 36x36) */
  size?: BrandIconSize;
  /** Container custom classes */
  className?: string;
  /** Override icon inner sizing/styles */
  iconClassName?: string;
  /** Whether to hide the rounded background container and render only the raw SVG */
  bare?: boolean;
}

/**
 * Authentic, colored brand logo icon for Reizo Studio integrations and catalog.
 * Supports domestic platforms (Feishu, WeCom, DingTalk, Yuque, Gitee) and international services.
 */
export function BrandIcon({
  brand,
  name,
  size = 'md',
  className,
  iconClassName,
  bare = false,
}: BrandIconProps) {
  const sizeConfig = SIZE_CONFIG[size] || SIZE_CONFIG.md;
  const brandKey = (brand || '').toLowerCase().trim();

  const isBuiltin = brandKey in BUILTIN_LOGOS;
  const builtinId = isBuiltin ? (brandKey as BuiltinBrandId) : null;

  const containerBg = builtinId ? BRAND_CONTAINER_BG[builtinId] : 'bg-paper-inset border-line';
  const innerClass = cn(sizeConfig.icon, iconClassName);

  const renderIcon = () => {
    if (builtinId) {
      const LogoComponent = BUILTIN_LOGOS[builtinId];
      return <LogoComponent className={innerClass} />;
    }
    if (brandKey) {
      return <SimpleIcon slug={brandKey} name={name} className={innerClass} />;
    }
    const displayName = name || '?';
    const { letter, hue } = letterTile(displayName);
    return (
      <div
        className={cn('flex items-center justify-center font-semibold select-none', innerClass)}
        style={letterTileStyle(hue)}
      >
        {letter}
      </div>
    );
  };

  if (bare) {
    return <div className={cn('inline-flex items-center justify-center', className)}>{renderIcon()}</div>;
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center border shadow-xs transition-transform duration-150',
        sizeConfig.container,
        containerBg,
        className,
      )}
      aria-hidden="true"
    >
      {renderIcon()}
    </div>
  );
}

export default BrandIcon;
