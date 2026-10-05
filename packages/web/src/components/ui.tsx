import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Button({ variant = "secondary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const styles = {
    primary: "bg-stone-900 text-white shadow-sm hover:bg-stone-800 active:bg-stone-950 disabled:bg-stone-300 disabled:shadow-none",
    secondary: "border border-stone-300 bg-white shadow-sm hover:border-stone-400 hover:bg-stone-50 disabled:text-stone-400 disabled:shadow-none disabled:hover:bg-white",
    ghost: "text-stone-600 hover:bg-stone-100 hover:text-stone-900 disabled:text-stone-300",
  }[variant];
  return <button {...p} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`} />;
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
    <div className={`flex items-start justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-sm ${styles}`} role={tone === "error" ? "alert" : "status"}>
      <div>{children}</div>
      {onClose && (
        <button onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}

/** Site-styled dialog: dimmed backdrop, white card; Escape or a click outside closes it. */
export function Modal({ title, children, onClose, labelId = "modal-title" }: { title: string; children: ReactNode; onClose: () => void; labelId?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-stone-900/40 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby={labelId} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-black/5 bg-white p-5 shadow-[0_24px_60px_-20px_rgba(21,23,26,.45)]" onClick={(e) => e.stopPropagation()}>
        <h2 id={labelId} className="text-lg font-semibold tracking-tight text-stone-900">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

type Ask = { title: string; body?: string; confirm: string; danger?: boolean; onYes: () => void };

/**
 * A styled replacement for window.confirm. Returns [ask, dialog]: render `dialog` once, then
 * call ask({ title, body, confirm, onYes }).
 */
export function useConfirm(): [(a: Ask) => void, ReactNode] {
  const [a, setA] = useState<Ask | null>(null);
  const close = () => setA(null);
  const dialog = a ? (
    <Modal title={a.title} onClose={close} labelId="confirm-title">
      {a.body && <p className="mt-2 text-sm text-stone-600">{a.body}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={close} autoFocus>
          Cancel
        </Button>
        <button
          type="button"
          onClick={() => (a.onYes(), close())}
          className={`rounded-lg px-3.5 py-2 text-sm font-medium text-white shadow-sm ${a.danger ? "bg-red-600 hover:bg-red-700" : "bg-stone-900 hover:bg-stone-800"}`}
        >
          {a.confirm}
        </button>
      </div>
    </Modal>
  ) : null;
  return [setA, dialog];
}
