import { useEffect, useMemo, useReducer, useRef } from "react";
import {
  ClaudeDecisions, JevDecisions, MxVerifier, applyCompany, classifyExtract, estimateCost, judgeFit, rerunCompany, runPipeline,
  type Contact, type Ctx, type DecisionProvider, type ExtractResult, type RunHooks,
} from "@cf/core";
import { ACCESS_TOKEN, BUDGET, EDGE_URL, RATE_LIMIT_RETRY_MS } from "./config.ts";
import { edgeClient, layeredCache } from "./lib/edgeClient.ts";
import { clearLocalCache, load, localCache, remove, save, sessionId } from "./lib/storage.ts";
import { initialState, migrate, persistable, reducer, searchLabel, type State } from "./state.ts";

const stateKey = (session: string) => `cf:state:${session}`;
const clone = <T,>(v: T): T => structuredClone(v);

export function usePipeline() {
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const session = sessionId();
    return migrate({ ...initialState(session), ...load<State>(stateKey(session)), running: false, parsing: false });
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

  // Use Jev for decisions when the edge function has a TypeSafe key; otherwise Claude (Haiku).
  useEffect(() => {
    client?.health().then((h: any) => dispatch({ type: "judge", name: h?.jev ? "jev" : "claude" }), () => {});
  }, [client]);

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
      decisions: decisionsFor(llm, onUsage),
      verifier: new MxVerifier(client.mx),
      site: client.site,
      shadow: client.shadow,
      evidence: client.evidence,
      budget: BUDGET,
      options: {
        roleFilter: state.roleFilter,
        nicknames: state.nicknames,
        usePasteEvidence: state.usePasteEvidence !== false,
        skipIrrelevant: state.skipIrrelevant !== false,
        siteMode: siteModeFromUrl(),
        evidenceMode: modeFromUrl("evidence"),
      },
      onUsage,
      signal,
    };
  }

  const hooks: RunHooks = {
    onCompany: (company) => dispatch({ type: "company", company: clone(company) }),
    onRow: (contact) => dispatch({ type: "row", contact: clone(contact) }),
  };

  function decisionsFor(llm: Ctx["llm"], onUsage: Ctx["onUsage"]): DecisionProvider {
    const claude = new ClaudeDecisions({ llm, onUsage });
    if (state.judge !== "jev" || !client) return claude;
    const jev = new JevDecisions(client.jev, onUsage);
    // If Jev is unavailable mid-run, the same question goes to Claude instead.
    return {
      name: "jev",
      calibrated: true,
      score: (c, q) => jev.score(c, q).catch(() => claude.score(c, q)),
      scoreMany: (items, q) => jev.scoreMany(items, q).catch(() => claude.scoreMany(items, q)),
      classify: (l, c) => jev.classify(l, c).catch(() => claude.classify(l, c)),
      choose: (o, c) => jev.choose(o, c).catch(() => claude.choose(o, c)),
    };
  }

  /** Judge everyone in the parsed list against "Looking for" (skips people already judged for it). */
  async function judge(ex: ExtractResult, ctx: Ctx) {
    if (!state.roleFilter.trim() || !ex.people.length) return;
    dispatch({ type: "judging", on: true });
    const names = Object.fromEntries(ex.companies.map((c) => [c.id, c.name]));
    await judgeFit(ex.people, state.roleFilter, ctx.decisions, (c) => names[c.company_id]).catch(() => {});
    dispatch({ type: "judging", on: false });
  }

  async function recheck() {
    if (!state.extracted) return;
    const ex = clone(state.extracted);
    await judge(ex, makeCtx());
    dispatch({ type: "edit_extract", extracted: ex });
  }

  async function parse() {
    dispatch({ type: "parse_start" });
    try {
      const ctx = makeCtx();
      // Same text as last time (any edit to the paste clears this): reuse that read — no cost.
      let ex = state.extracted ? clone(state.extracted) : undefined;
      if (!ex) {
        const r = await classifyExtract(state.input, ctx);
        if (!r.ok || !r.data) throw new Error(r.error ?? "extraction failed");
        ex = r.data;
      }
      await judge(ex, ctx);
      dispatch({ type: "parsed", extracted: ex });
    } catch (e) {
      dispatch({ type: "error", error: (e as Error).message });
    }
  }

  /** Run the preview (or the raw paste) as a new search; its results are added to the list. */
  async function run(source?: ExtractResult, opts: { keepRows?: boolean } = {}) {
    abort.current = new AbortController();
    try {
      const ctx = makeCtx(abort.current.signal);
      if (opts.keepRows && source) {
        dispatch({ type: "run_start" });
        await runPipeline(source, ctx, hooks);
      } else {
        dispatch({ type: "run_start" });
        let ex = source ?? state.extracted;
        if (!ex) {
          const r = await classifyExtract(state.input, ctx);
          if (!r.ok || !r.data) throw new Error(r.error ?? "extraction failed");
          ex = r.data;
        }
        // People already in the list with an email are kept as they are — no second lookup.
        // (Only while their company still has its domain — otherwise look them up again to repair it.)
        const done = (id: string) => state.contacts[id]?.status === "ok" && !!state.companies[state.contacts[id].company_id]?.domain;
        const skip = ex.people.filter((p) => done(p.id)).map((p) => p.id);
        // A company pasted without names whose people are already in the list: reuse them, don't search again.
        const listed = Object.values(state.contacts).filter((c) => done(c.id));
        const reuse = ex.companies.filter((c) => !ex!.people.some((p) => p.company_id === c.id)).flatMap((c) => listed.filter((x) => x.company_id === c.id).map((x) => x.id));
        const search = { id: `s${Date.now().toString(36)}`, label: searchLabel(ex), want: state.roleFilter.trim(), at: new Date().toISOString(), cost: 0 };
        dispatch({ type: "run_start", extracted: ex, limit: BUDGET.maxContacts, search, skip, reuse });
        const people = ex.people.filter((p) => !skip.includes(p.id));
        // Companies whose people are all already done need nothing new.
        const finished = new Set([...ex.people.filter((p) => skip.includes(p.id)), ...reuse.map((id) => state.contacts[id])].map((p) => p.company_id));
        const companies = ex.companies.filter((c) => !finished.has(c.id) || people.some((p) => p.company_id === c.id));
        await runPipeline({ ...ex, people, companies }, ctx, hooks);
      }
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

  return { state, dispatch, parse, recheck, run, resume, retry, include, stop, clear, editContact, configured: !!client };
}

export type Pipeline = ReturnType<typeof usePipeline>;

/** Testing switch: ?site=on (use a proven website format, skip the search), ?site=shadow, ?site=off. */
function siteModeFromUrl(): "off" | "shadow" | "on" | undefined {
  return modeFromUrl("site");
}

/** ?site=… / ?evidence=… — on, shadow or off for this browser only (testing). */
function modeFromUrl(key: "site" | "evidence"): "off" | "shadow" | "on" | undefined {
  try {
    const v = new URLSearchParams(window.location.search).get(key);
    return v === "on" || v === "shadow" || v === "off" ? v : undefined;
  } catch {
    return undefined;
  }
}
