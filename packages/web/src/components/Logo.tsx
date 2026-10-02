/** ContactFlow logo (direction B1): pipeline mark + "contactflow" wordmark. */
export const ACCENT = "#12A87C";

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
      <Mark size={size} />
      <span className="font-logo text-[18px] tracking-[-0.045em] text-stone-900" aria-label="ContactFlow">
        <span className="font-medium">contact</span>
        <span className="font-bold" style={{ color: ACCENT }}>
          flow
        </span>
      </span>
    </span>
  );
}
