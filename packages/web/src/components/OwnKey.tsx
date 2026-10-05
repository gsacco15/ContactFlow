import { useState } from "react";
import { FREE_TIER } from "@cf/core";
import { OWN_KEY_PATTERN, getOwnKey, setOwnKey } from "../lib/ownKey.ts";
import { Banner, Button, Modal } from "./ui.tsx";

const CONSOLE = "https://console.anthropic.com/settings/keys";

/** Paste your own Claude key: unlimited searches, billed to you by Anthropic. Kept in this browser only. */
export function OwnKeyDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(getOwnKey() ?? "");
  const [bad, setBad] = useState(false);
  const had = !!getOwnKey();
  const saveKey = () => {
    const k = value.trim();
    if (!OWN_KEY_PATTERN.test(k)) return setBad(true);
    setOwnKey(k);
    onClose();
  };
  return (
    <Modal title="Use your own Claude key" onClose={onClose} labelId="own-key-title">
        <p className="mt-2 text-sm text-stone-600">
          Unlimited searches, billed to you by Anthropic, usually a few cents per search. Get a key at{" "}
          <a className="font-medium text-stone-900 underline underline-offset-2" href={CONSOLE} target="_blank" rel="noopener noreferrer">
            console.anthropic.com
          </a>{" "}
          → API keys → Create key.
        </p>
        <label className="mt-4 block text-xs font-medium text-stone-500" htmlFor="own-key">
          Claude API key
        </label>
        <input
          id="own-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          value={value}
          onChange={(e) => (setValue(e.target.value), setBad(false))}
          onKeyDown={(e) => e.key === "Enter" && saveKey()}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-data text-sm outline-none focus:border-stone-900"
        />
        {bad && <p className="mt-1 text-xs text-red-600">That doesn’t look like a Claude key (it starts with sk-ant-).</p>}
        <p className="mt-3 text-xs text-stone-500">
          Saved only in this browser. It’s sent with each search to our server, which uses it for that search and never stores it. Remove it any time.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button variant="primary" onClick={saveKey}>Save key</Button>
          {had && (
            <Button variant="ghost" onClick={() => (setOwnKey(undefined), onClose())}>
              Remove key
            </Button>
          )}
          <Button variant="ghost" className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
        </div>
    </Modal>
  );
}

/** Shown when free use runs out: why, and the one-click way on. */
export function LimitBanner({ code, onKey, onClose }: { code: "free_limit" | "daily_budget" | "own_key_rejected"; onKey: () => void; onClose: () => void }) {
  const text = {
    free_limit: `You’ve used today’s free searches (about $${FREE_TIER.perVisitorUsd.toFixed(2)} of lookups). Add your own Claude key to keep going, or come back tomorrow.`,
    daily_budget: "Free searches are used up for today across ContactFlow. Add your own Claude key to keep going, or come back tomorrow.",
    own_key_rejected: "Anthropic didn’t accept your Claude key. Check it, or remove it to use the free searches.",
  }[code];
  return (
    <Banner tone="warn" onClose={onClose}>
      <span>{text}</span>{" "}
      <button onClick={onKey} className="ml-1 font-semibold underline underline-offset-2">
        {code === "own_key_rejected" ? "Fix my key" : "Use my own key"}
      </button>
    </Banner>
  );
}
