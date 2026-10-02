// "Send to Google Sheets" — runs entirely in the browser with the user's own Google sign-in.
// Scope drive.file: the app can only see spreadsheets it created (or the user opened with it),
// never the rest of their Drive. No server, no stored refresh token.

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE = "https://www.googleapis.com/drive/v3/files";

declare global {
  interface Window {
    google?: any;
  }
}

let gis: Promise<void> | undefined;
function loadGis(): Promise<void> {
  gis ??= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => {
      gis = undefined;
      fail(new Error("Could not load Google sign-in"));
    };
    document.head.appendChild(s);
  });
  return gis;
}

let token: { value: string; expires: number } | undefined;

/** Access token from a Google popup (re-used until it expires). */
export async function signIn(clientId: string): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  await loadGis();
  return new Promise((ok, fail) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r: any) => {
        if (r.error) return fail(new Error(r.error_description ?? r.error));
        token = { value: r.access_token, expires: Date.now() + Number(r.expires_in ?? 3600) * 1000 };
        ok(token.value);
      },
      error_callback: (e: any) => fail(new Error(e?.message ?? e?.type ?? "Google sign-in was closed")),
    });
    client.requestAccessToken({ prompt: token ? "" : "consent" });
  });
}

export const signedIn = () => !!token && token.expires > Date.now() + 60_000;

async function api(t: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${t}`, "content-type": "application/json", ...init.headers } });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) token = undefined;
  if (!r.ok) throw new Error(`Google ${r.status}: ${data?.error?.message ?? "request failed"}`);
  return data;
}

export type SheetFile = { id: string; name: string; url: string; modified: string };

/** Spreadsheets this app can see (the ones it created). */
export async function listSheets(t: string): Promise<SheetFile[]> {
  const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  const d = await api(t, `${DRIVE}?q=${q}&orderBy=modifiedTime desc&pageSize=20&fields=files(id,name,webViewLink,modifiedTime)`);
  return (d.files ?? []).map((f: any) => ({ id: f.id, name: f.name, url: f.webViewLink, modified: f.modifiedTime }));
}

export async function createSheet(t: string, title: string): Promise<SheetFile> {
  const d = await api(t, SHEETS, {
    method: "POST",
    body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: "Contacts", gridProperties: { frozenRowCount: 1 } } }] }),
  });
  return { id: d.spreadsheetId, name: title, url: d.spreadsheetUrl, modified: new Date().toISOString() };
}

const KEY_COLS = ["first", "last", "company"];
const keyOf = (row: string[], idx: number[]) => idx.map((i) => (row[i] ?? "").trim().toLowerCase()).join("|");

/**
 * Append only the people not already in the sheet (same first + last + company).
 * Rows follow the sheet's existing header, so older sheets with fewer columns still line up.
 */
export async function appendNew(t: string, sheetId: string, table: string[][]): Promise<{ added: number; skipped: number }> {
  const meta = await api(t, `${SHEETS}/${sheetId}?fields=sheets.properties.title`);
  const tab: string = meta.sheets?.[0]?.properties?.title ?? "Sheet1";
  const range = `'${tab.replace(/'/g, "''")}'`;
  const existing: string[][] = (await api(t, `${SHEETS}/${sheetId}/values/${encodeURIComponent(range)}`)).values ?? [];
  const [ours, ...rows] = table;
  const header = existing[0]?.length ? existing[0] : ours;
  const pos = (cols: string[], name: string) => cols.indexOf(name);
  const seen = new Set(existing.slice(1).map((r) => keyOf(r, KEY_COLS.map((k) => pos(header, k)))));
  const fresh = rows.filter((r) => !seen.has(keyOf(r, KEY_COLS.map((k) => pos(ours, k)))));
  const out = fresh.map((r) => header.map((h) => (pos(ours, h) >= 0 ? r[pos(ours, h)] : "")));
  const values = existing[0]?.length ? out : [header, ...out];
  if (values.length) {
    await api(t, `${SHEETS}/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ values }),
    });
  }
  return { added: fresh.length, skipped: rows.length - fresh.length };
}
