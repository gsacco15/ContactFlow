// The visitor's own Claude API key: kept in this browser only, sent with each request so the edge
// function can use it for that request (never stored or logged on the server).
import { load, save } from "./storage.ts";

const KEY = "cf:anthropic-key";
export const OWN_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,}$/;

export const getOwnKey = (): string | undefined => {
  const k = load<string>(KEY);
  return typeof k === "string" && OWN_KEY_PATTERN.test(k) ? k : undefined;
};
export const setOwnKey = (k: string | undefined) => save(KEY, k ?? null);
