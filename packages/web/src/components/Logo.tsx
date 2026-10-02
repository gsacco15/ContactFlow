/** ContactFlow logo: the app-icon tile (public/logo.svg, "B") + "contactflow" wordmark. */
import { useId } from "react";

export const ACCENT = "#12A87C";

/** The main logo: dark tile, cream flow line, green delivered dot, with soft light and shadow. Same art as public/logo.svg. */
export function AppIcon({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  const u = (n: string) => `url(#${n}${id})`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`tile${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#30353C" /><stop offset=".55" stopColor="#17191D" /><stop offset="1" stopColor="#0C0D10" /></linearGradient>
        <linearGradient id={`rim${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".22" /><stop offset=".25" stopColor="#FFFFFF" stopOpacity="0" /></linearGradient>
        <linearGradient id={`line${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#E4E1DA" /></linearGradient>
        <radialGradient id={`cream${id}`} cx=".35" cy=".3" r=".8"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#D4D0C7" /></radialGradient>
        <radialGradient id={`green${id}`} cx=".33" cy=".28" r=".85"><stop offset="0" stopColor="#5BE6BA" /><stop offset=".55" stopColor="#14A97D" /><stop offset="1" stopColor="#087453" /></radialGradient>
        <filter id={`sh${id}`} x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.4" floodColor="#000" floodOpacity=".55" /></filter>
      </defs>
      <rect width="64" height="64" rx="15" fill={u("tile")} />
      <rect x=".5" y=".5" width="63" height="63" rx="14.5" fill="none" stroke={u("rim")} strokeWidth="1" />
      <g filter={u("sh")}>
        <path d="M44 18 Q20 18 20 32 Q20 46 44 46" fill="none" stroke={u("line")} strokeWidth="7" strokeLinecap="round" />
        <circle cx="20" cy="32" r="6.5" fill={u("cream")} />
        <circle cx="44" cy="46" r="8.5" fill={u("green")} />
      </g>
      <ellipse cx="41.6" cy="42.6" rx="3" ry="1.9" fill="#FFFFFF" opacity=".45" />
    </svg>
  );
}

/** Line-only version of the mark, for large decorative watermarks. */
export function Mark({ size = 22, ink = "#15171A", ground = "#FFFFFF" }: { size?: number; ink?: string; ground?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <path d="M46 16 Q16 16 16 32 Q16 48 46 48" fill="none" stroke={ink} strokeWidth={5} />
      <circle cx="46" cy="16" r="6" fill={ground} stroke={ink} strokeWidth={4} />
      <circle cx="16" cy="32" r="6.5" fill={ink} />
      <circle cx="46" cy="48" r="7.5" fill={ACCENT} />
    </svg>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <AppIcon size={size} />
      <span className="font-logo text-[18px] tracking-[-0.045em] text-stone-900" aria-label="ContactFlow">
        <span className="font-medium">contact</span>
        <span className="font-bold" style={{ color: ACCENT }}>
          flow
        </span>
      </span>
    </span>
  );
}
