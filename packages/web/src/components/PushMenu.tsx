import { useEffect, useRef, useState } from "react";
import { GOOGLE_CLIENT_ID } from "../config.ts";
import { appendNew, createSheet, listSheets, signIn, signedIn, type SheetFile } from "../lib/googleSheets.ts";
import { Button } from "./ui.tsx";

const NEW = "__new";
const LAST = "cf:lastSheet";

/** "Push to…" menu: Google Sheets now, CRMs later. `table` is header + rows, exactly what the table shows. */
export function PushMenu({ table, onExcel, disabled }: { table: () => string[][]; onExcel: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button onClick={() => setOpen(!open)} disabled={disabled} aria-expanded={open}>
        Push to… <span className="text-stone-400">▾</span>
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-80 space-y-3 rounded-xl border border-stone-200 bg-white p-3 text-sm shadow-lg">
          <GoogleSheets table={table} />
          <button
            type="button"
            className="flex w-full items-center justify-between border-t border-stone-100 pt-2 text-left font-medium text-stone-700 hover:text-stone-950"
            onClick={() => {
              onExcel();
              setOpen(false);
            }}
          >
            <span>Excel file</span>
            <span className="text-xs font-normal text-stone-400">.xlsx · a tab per search</span>
          </button>
          <div className="flex items-center justify-between border-t border-stone-100 pt-2 text-stone-400">
            <span>HubSpot &amp; other CRMs</span>
            <span className="text-xs">coming later</span>
          </div>
        </div>
      )}
    </div>
  );
}

function GoogleSheets({ table }: { table: () => string[][] }) {
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(signedIn());
  const [files, setFiles] = useState<SheetFile[]>([]);
  const [target, setTarget] = useState<string>(() => localStorageGet(LAST) ?? NEW);
  const [title, setTitle] = useState(`ContactFlow contacts`);
  const [result, setResult] = useState<{ text: string; url?: string; error?: boolean }>();
  const rows = table().length - 1;

  const run = async <T,>(fn: (t: string) => Promise<T>) => {
    setBusy(true);
    setResult(undefined);
    try {
      const t = await signIn(GOOGLE_CLIENT_ID);
      setConnected(true);
      return await fn(t);
    } catch (e) {
      setResult({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async (t) => {
      const fs = await listSheets(t);
      setFiles(fs);
      if (target !== NEW && !fs.some((f) => f.id === target)) setTarget(NEW);
    });

  useEffect(() => {
    if (connected) connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () =>
    run(async (t) => {
      const file = target === NEW ? await createSheet(t, title.trim() || "ContactFlow contacts") : files.find((f) => f.id === target)!;
      const r = await appendNew(t, file.id, table());
      localStorageSet(LAST, file.id);
      setTarget(file.id);
      if (target === NEW) setFiles([file, ...files]);
      setResult({ text: `Added ${r.added} ${r.added === 1 ? "person" : "people"}${r.skipped ? ` · ${r.skipped} already there` : ""}`, url: file.url });
    });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-medium">
        <SheetsIcon /> Google Sheets
        {connected && <span className="ml-auto text-xs font-normal text-emerald-600">connected</span>}
      </div>
      {!GOOGLE_CLIENT_ID ? (
        <p className="text-xs leading-relaxed text-stone-500">
          Not set up yet: add <code className="rounded bg-stone-100 px-1">VITE_GOOGLE_CLIENT_ID</code> in Vercel (see README → Google Sheets). Until then, use Copy as table and paste into a sheet.
        </p>
      ) : !connected ? (
        <>
          <p className="text-xs text-stone-500">Sign in once. The app can only see sheets it creates — not the rest of your Drive.</p>
          <Button variant="primary" onClick={connect} disabled={busy} className="w-full justify-center">
            {busy ? "Connecting…" : "Connect Google"}
          </Button>
        </>
      ) : (
        <>
          <label className="block text-xs text-stone-500">
            Send to
            <select className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-800" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value={NEW}>New sheet…</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          {target === NEW && (
            <input className="w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="New sheet name" />
          )}
          <Button variant="primary" onClick={send} disabled={busy || rows < 1} className="w-full justify-center">
            {busy ? "Sending…" : `Send ${rows} ${rows === 1 ? "row" : "rows"}`}
          </Button>
          <p className="text-xs text-stone-400">Only people not already in the sheet are added.</p>
        </>
      )}
      {result && (
        <p className={`text-xs ${result.error ? "text-red-600" : "text-emerald-700"}`}>
          {result.text}{" "}
          {result.url && (
            <a href={result.url} target="_blank" rel="noreferrer" className="font-medium underline">
              Open sheet ↗
            </a>
          )}
        </p>
      )}
    </div>
  );
}

function localStorageGet(k: string) {
  try {
    return localStorage.getItem(k) ?? undefined;
  } catch {
    return undefined;
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

const SheetsIcon = () => (
  <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
    <rect x="2" y="1" width="12" height="14" rx="2" fill="#16a34a" />
    <path d="M5 6h6M5 9h6M5 12h6M8 6v6" stroke="#fff" strokeWidth="1.2" />
  </svg>
);
