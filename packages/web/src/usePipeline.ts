import { useEffect, useMemo, useReducer, useRef } from "react";
import {
  ClaudeDecisions, MxVerifier, applyCompany, classifyExtract, estimateCost, rerunCompany, runPipeline,
  type Contact, type Ctx, type ExtractResult, type RunHooks,
} from "@cf/core";
import { ACCESS_TOKEN, BUDGET, EDGE_URL, RATE_LIMIT_RETRY_MS } from "./config.ts";
import { edgeClient, layeredCache } from "./lib/edgeClient.ts";
import { clearLocalCache, load, localCache, remove, save, sessionId } from "./lib/storage.ts";
import { initialState, persistable, reducer, type State } from "./state.ts";

const stateKey = (session: string) => `cf:state:${session}`;
const clone = <T,>(v: T): T => structuredClone(v);

export function usePipeline() {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const session = sessionId();
    return { ...initialState(session), ...load<State>(stateKey(session)), running: false, parsing: false };
  });
  const abort = useRef<AbortController | null>(null);

  // Persist on every change, keyed by session.
  useEffect(() => save(stateKey(state.session), persistable(state)), [state]);

  const client = useMemo(
    () =>
      EDGE_URL
        ? edgeClient({
            url: EDGE_URL,
            session: state.session,
            token: ACCESS_TOKEN || undefined,
            retryDelayMs: RATE_LIMIT_RETRY_MS,
            onRateLimited: (s) => dispatch({ type: "rate_limited", until: Date.now() + s * 1000 }),
          })
        : null,
    [state.session],
  );

  function makeCtx(signal?: AbortSignal): Ctx {
    if (!client) throw new Error("VITE_EDGE_URL is not set");
    const llm: Ctx["llm"] = (req) => client.llm(req, signal);
    const onUsage: Ctx["onUsage"] = (u) =>
      dispatch({
        type: "usage",
        tokens: u.input_tokens + u.output_tokens,
        searches: u.web_search_requests,
        cost: estimateCost(u),
      });
    return {
      llm,
      cache: layeredCache(localCache, client.cache),
      decisions: new ClaudeDecisions({ llm, onUsage }),
      verifier: new MxVerifier(client.mx),
      budget: BUDGET,
      options: { roleFilter: state.roleFilter, nicknames: state.nicknames, usePasteEvidence: state.usePasteEvidence !== false },
      onUsage,
      signal,
    };
  }

  const hooks: RunHooks = {
    onExtract: (ex) => dispatch({ type: "run_start", extracted: ex, limit: BUDGET.maxContacts }),
    onCompany: (company) => dispatch({ type: "company", company: clone(company) }),
    onRow: (contact) => dispatch({ type: "row", contact: clone(contact) }),
  };

  async function parse() {
    dispatch({ type: "parse_start" });
    try {
      const r = await classifyExtract(state.input, makeCtx());
      if (!r.ok || !r.data) throw new Error(r.error ?? "extraction failed");
      dispatch({ type: "parsed", extracted: r.data });
    } catch (e) {
      dispatch({ type: "error", error: (e as Error).message });
    }
  }

  async function run(source?: ExtractResult, opts: { keepRows?: boolean } = {}) {
    abort.current = new AbortController();
    const extracted = source ?? state.extracted;
    try {
      const ctx = makeCtx(abort.current.signal);
      if (!extracted || opts.keepRows) dispatch({ type: "run_start" });
      await runPipeline(extracted ?? state.input, ctx, opts.keepRows ? { ...hooks, onExtract: undefined } : hooks);
      dispatch({ type: "run_end", error: abort.current.signal.aborted ? "stopped" : undefined });
    } catch (e) {
      dispatch({ type: "run_end", error: (e as Error).message });
    }
  }

  /** After a refresh mid-run: run only the rows still pending. */
  function resume() {
    const pending = state.order.map((id) => state.contacts[id]).filter((c) => c?.status === "pending");
    const ids = new Set(pending.map((c) => c.company_id));
    const companies = Object.values(state.companies).filter((c) => ids.has(c.id));
    run({ mode: "people", companies, people: pending, urls: [], notes: "" }, { keepRows: true });
  }

  async function retry(companyId: string, override?: Contact[]) {
    const co = state.companies[companyId];
    if (!co) return;
    const contacts = override ?? state.order.map((id) => state.contacts[id]).filter((c) => c?.company_id === companyId).map(clone);
    dispatch({ type: "run_start" });
    try {
      await rerunCompany(clone(co), contacts, makeCtx(), hooks);
      dispatch({ type: "run_end" });
    } catch (e) {
      dispatch({ type: "run_end", error: (e as Error).message });
    }
  }

  /** Inline name/title edits regenerate that row's candidates. */
  async function editContact(id: string, patch: Partial<Pick<Contact, "first" | "middle" | "last" | "title">>) {
    const c = { ...clone(state.contacts[id]), ...patch };
    if (!c.middle) delete c.middle;
    if (("first" in patch || "last" in patch || "middle" in patch) && c.status !== "pending") {
      await applyCompany(c, state.companies[c.company_id], client ? makeCtx() : ({ options: {} } as Ctx));
    }
    dispatch({ type: "row", contact: c });
  }

  /** Clear a ⚠ flag ("include anyway") and look the company up again with that person in. */
  async function include(id: string) {
    const c = state.contacts[id];
    if (!c) return;
    const contacts = state.order
      .map((x) => state.contacts[x])
      .filter((x) => x?.company_id === c.company_id)
      .map((x) => {
        const y = clone(x);
        if (y.id === id) y.keep = true;
        return y;
      });
    dispatch({ type: "row", contact: contacts.find((x) => x.id === id)! });
    await retry(c.company_id, contacts);
  }

  function stop() {
    abort.current?.abort();
  }

  function clear() {
    stop();
    remove(stateKey(state.session));
    clearLocalCache();
    remove("cf:session");
    dispatch({ type: "clear", session: sessionId() });
  }

  return { state, dispatch, parse, run, resume, retry, include, stop, clear, editContact, configured: !!client };
}

export type Pipeline = ReturnType<typeof usePipeline>;
