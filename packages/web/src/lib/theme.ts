// Light / dark for the app pages: "auto" follows the device. Stored in this browser only.
import { load, save } from "./storage.ts";

export type Theme = "auto" | "dark" | "light";
const KEY = "cf:theme";

export const getTheme = (): Theme => {
  const t = load<Theme>(KEY);
  return t === "dark" || t === "light" ? t : "auto";
};

export function setTheme(t: Theme) {
  save(KEY, t);
  applyTheme(t);
}

/** html[data-theme] drives the CSS; index.html applies it before first paint to avoid a flash. */
export function applyTheme(t: Theme = getTheme()) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export const NEXT: Record<Theme, Theme> = { auto: "dark", dark: "light", light: "auto" };
