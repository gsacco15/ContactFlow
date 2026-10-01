import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({ variant = "secondary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const styles = {
    primary: "bg-stone-900 text-white hover:bg-stone-700 disabled:bg-stone-300",
    secondary: "border border-stone-300 bg-white hover:bg-stone-100 disabled:text-stone-400 disabled:hover:bg-white",
    ghost: "text-stone-600 hover:bg-stone-100 hover:text-stone-900 disabled:text-stone-300",
  }[variant];
  return <button {...p} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`} />;
}

export function Pill({ tone = "stone", children, title }: { tone?: "stone" | "green" | "amber" | "red" | "blue"; children: ReactNode; title?: string }) {
  const tones = {
    stone: "bg-stone-100 text-stone-600",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
    red: "bg-red-50 text-red-700 ring-red-600/20",
    blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ring-stone-200 ${tones}`}>
      {children}
    </span>
  );
}

export function LinkIcon({ href, title }: { href?: string; title?: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" title={title ?? href} className="text-stone-400 hover:text-sky-600" onClick={(e) => e.stopPropagation()}>
      <svg viewBox="0 0 20 20" fill="currentColor" className="inline size-3.5" aria-hidden>
        <path d="M11 3a1 1 0 1 0 0 2h2.59l-6.3 6.3a1 1 0 1 0 1.42 1.4L15 6.42V9a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-5Z" />
        <path d="M5 5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3a1 1 0 1 0-2 0v3H5V7h3a1 1 0 0 0 0-2H5Z" />
      </svg>
      <span className="sr-only">source</span>
    </a>
  );
}

export function Banner({ tone, children, onClose }: { tone: "info" | "warn" | "error"; children: ReactNode; onClose?: () => void }) {
  const styles = { info: "bg-sky-50 text-sky-900 border-sky-200", warn: "bg-amber-50 text-amber-900 border-amber-200", error: "bg-red-50 text-red-900 border-red-200" }[tone];
  return (
    <div className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${styles}`} role={tone === "error" ? "alert" : "status"}>
      <div>{children}</div>
      {onClose && (
        <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
