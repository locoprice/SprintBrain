# Memory as a zero-friction context layer: design

**Status**: design for approval. No code. Extends `docs/MEMORY_002_PLAN.md`; every principle
there (one knowledge layer, single selection authority, composed authorization, prompts are
not context) still binds.
**Objective**: capture → store → understand → retrieve → inject, with injection as the
priority and the user never copying anything by hand.

---

## 0. The one idea everything else follows from

**The draft in the composer is the retrieval query.**

Today the user must pick a step before context appears, and the step must have been
configured in SQL. That is agent orchestration, not a human writing a message. Replace it:
whatever the user has typed so far is sent to `knowledge_search`, the engine builds a
package inside a budget, and the user sees it before it goes in. No step, no tagging, no
copy-paste. Steps survive as saved profiles for agents (MCP), where a workflow phase is a
real thing.

Everything below is that idea plus the minimum around it.

---

## 1. Recommended architecture

```
 CAPTURE                        STORE               UNDERSTAND
 selection / page / chat  ──►  memory_save_shard ──► deterministic at write:
 (context menu, shortcut,       (one write path,     source, title, host, first-line
  popup card)                    versions, audit)    summary, content_hash, near-dup
                                                     async, opt-in, never blocking:
                                                     labels (suggest-labels fn), summary
                                      │
                                      ▼
 RETRIEVE                     app.knowledge_index (security_invoker)   ✅ shipped P1
 draft text ─────────────►    public.knowledge_search (FTS+trigram+RRF) ✅ shipped P2
                                      │  ids, scores, summaries. Never bodies.
                                      ▼
 SELECT                       engine.ts buildContext()                  P3
                              dedup → budget → deterministic order
                              (parity-gated twin in memory-pack.js)
                                      │
                                      ▼
 INJECT                       memory-inject.js (browser)   |   build_context (MCP)
                              preview → accept → delimited block   same package, two renderers
```

What is **not** in this diagram, on purpose:

- No new tables. Capture writes `memory_shards` through `memory_save_shard`, which already
  versions and audits. Enrichment fields go in `metadata` (capped jsonb, already there).
- No LLM in the synchronous path anywhere. Capture is instant; retrieval is SQL; selection is
  pure TypeScript. An LLM is only ever an optional async enrichment.
- No send-button hooking. The competitor merges context at send time by hooking each site's
  send action, which breaks on every redesign. We insert visible text through the composer's
  own inserter, which the picker already does on 8 hosts with a structural fallback.
- No third ranking implementation. SQL generates candidates, `engine.ts` selects, the
  extension twin mirrors it under the parity gate. The injection engine is a **renderer** of
  `buildContext`'s output, not a second selector.

---

## 2. Ideal UX flow

### Capture (target: under two seconds, no popup required)

| Source | Gesture | What happens |
| --- | --- | --- |
| Selected text on any page | Right-click → **Save to Memory**, or `Ctrl+Shift+S` | Saved to the default space with source URL, page title, host. Toast: "Saved to Memory · Undo" |
| A whole chat (ChatGPT, Claude) | Popup card (exists, K3) | Transcript chunked into the chosen space |
| A page | Popup → **Save this page** | Readable body extracted, chunked like a transcript, one source per chunk |
| A document | Dashboard upload (D1) | Chunked, `source_id` on every chunk |
| A screenshot | **Later.** Needs vision to become text. Stored as a document until then | |

The default is **save first, organise never**. Space selection is one optional click in the
toast, not a modal. Labels are never asked for at capture; they arrive async if enabled.

**Deterministic enrichment at write** (instant, no network beyond the save itself):
`source_url`, `source_title`, `host`, `captured_at`, `kind`, first non-empty line as summary,
`content_hash`. If the hash already exists the toast says "Already in Memory" and links to it
instead of saving a duplicate.

**Async enrichment, opt-in per space, never blocking**: label suggestions through the existing
`suggest-labels` Edge Function, an LLM summary replacing the first-line one. The user turns
this on knowing text leaves the machine, the same posture as embeddings.

### Inject (target: one keystroke to preview, one to accept)

1. User is typing in ChatGPT. A small **Memory pill** sits by the composer (the existing
   floating pill, re-purposed).
2. They press `Ctrl+Shift+M` (or click the pill). The draft is read from the composer.
3. A preview panel opens anchored to the pill, in under 300 ms:

   ```
   Memory · 3 items · 640 / 2,000 tokens          [budget ▾] [refresh]
   ☑ pricing-rules        How a quote is built          210t   (memory)
   ☑ house-style          How replies should read       190t   (memory)
   ☑ Cancellation policy  Ciao {guest_name}, ...        240t   (snippet)
   ☐ 2 more matched but did not fit                     [show]
   [Insert 3]                                           [Esc]
   ```
   Every row: checkbox, name, summary, tokens, kind. Uncheck to drop. `refresh` re-runs
   retrieval against the current draft.
4. **Insert** writes a delimited block above the draft through the composer's own inserter:

   ```
   ⟦ SprintBrain context · 3 items ⟧
   ## pricing-rules
   Totals round to the nearest whole unit. Card payments carry 3%.
   ## house-style
   Short sentences. No filler.
   ## Cancellation policy
   ...
   ⟦ end ⟧

   <the user's draft, untouched>
   ```
5. The pill shows **"3 injected"**. Clicking it offers **Remove** (strips exactly the
   delimited block, nothing else) and **Undo** (the picker's existing undo).
6. The user sends. Nothing else happens.

**Quiet mode (opt-in, second iteration)**: after the user pauses typing for ~800 ms, retrieval
runs silently and the pill shows a count badge, "3". Nothing is inserted until they act.
This is "quietly provides the right knowledge" without ever putting words in the box
unasked. Auto-insertion is deliberately not offered: text appearing in a message the user
did not put there is the one failure that destroys trust in a tool like this.

### Claude Code and other MCP clients

Same package, different renderer. `build_context(query, budget)` returns what the preview
panel shows, and the agent decides. `memory_enter_step` keeps working for agents that want
phase-based context.

---

## 3. Memory Injection Engine

### 3.1 Contract

One function, already specified in the plan (P3), used by both renderers:

```ts
buildContext({ candidates, budget, dedupe: true }) → ContextPackage
```

`candidates` come from `knowledge_search(draft, kinds, labels, containers, limit=40)`.
`ContextPackage` carries `items`, `usedTokens`, `budget`, `droppedForBudget`, `deduped`,
`sources`. The preview panel is a direct rendering of that object. Nothing is computed in
the panel.

### 3.2 Environment detection

Reuse the picker's `HOSTS` table and structural fallback. Per host, two things are stored:
the composer selectors (exist) and a **default budget**:

| Host | Default budget | Why |
| --- | --- | --- |
| ChatGPT | 2,000 | Long context, but a wall of text above the prompt reads badly |
| Claude | 4,000 | Handles long context well |
| Gemini, Grok, Perplexity, DeepSeek, Copilot | 2,000 | Conservative until measured |
| Unknown editable | 1,500 | The fallback should be modest |

The user can override per host from the pill. Stored in `chrome.storage.sync` alongside
the other extension preferences.

### 3.3 Retrieval

- **Query**: the composer draft, trimmed to its last 600 characters (the current thought,
  not the whole message). Empty draft → the pill offers pinned items only and says so.
- **Candidates**: `knowledge_search` over both kinds, limit 40. Snippets are included by
  default; prompts are structurally absent (P-1).
- **Relevance floor**: candidates below an RRF score of `1/(60+15)` (rank 15 in a single
  arm, or worse) are dropped before budgeting. A deterministic threshold, not a heuristic,
  and the reason "irrelevant content" does not reach the panel.
- **Already injected**: if the composer already contains a `⟦ SprintBrain context` block,
  its item ids are excluded from the new candidate set, so refresh appends rather than
  duplicates.

### 3.4 Ranking and prioritisation, in order

1. Pinned items (always, budget permitting; overrun reported, never silent).
2. RRF score from `knowledge_search`.
3. Recency as tiebreak.

No new rule. This is `rankForStep`'s contract with the score coming from search instead of
label weights.

### 3.5 Deduplication

Two passes, both in `engine.ts`, both parity-gated:

- **Exact**: same `content_hash` collapses. Catches a chat saved twice and a snippet that was
  also captured as a memory item.
- **Near**: within the candidate set only, trigram similarity above 0.85 collapses to the
  higher-ranked item. Bounded to the set because all-pairs over a library does not scale.

Collapsed ids are listed in the panel under "merged", not hidden.

### 3.6 Compression

Deterministic, in this order, and the panel says which applied:

1. Full body, if it fits.
2. **Summary only**, if the body does not fit but the summary does. The row shows "summary"
   and can be expanded by the user, who then decides whether it is worth the tokens.
3. Dropped, listed under "did not fit".

An LLM summary is the async enrichment from §2, not a step in the injection path. If it
exists it is simply a better summary; the engine does not know or care where it came from.

### 3.7 The injected block

```
⟦ SprintBrain context · N items ⟧
## <name>
<body or summary>
...
⟦ end ⟧
```

The markers are unusual characters on purpose: the remove action finds the block by them
and strips exactly that range. Bodies are inserted verbatim. Nothing is rewritten.

### 3.8 Controls

| Control | Where | Effect |
| --- | --- | --- |
| `Ctrl+Shift+M` | anywhere on a supported host | Open preview for the current draft |
| Checkbox per row | panel | Include or exclude before insert |
| Budget menu | panel | Override this host's budget |
| Refresh | panel | Re-run against the current draft |
| Insert | panel | Write the block |
| Remove | pill, after insert | Strip the block |
| Undo | pill, after insert | Restore the composer exactly (existing) |
| `Esc` | panel | Close, nothing inserted |

### 3.9 Speed budget

- Shortcut to panel open: under 300 ms. One `knowledge_search` call (ids and summaries,
  no bodies) plus `buildContext` in the content script.
- Insert: one `memory_mcp_bodies`-style fetch for only the checked ids, then the write.
- Nothing is fetched that is not about to be shown or inserted. This is the index/body
  split from MEMORY-001 doing what it was built for.

### 3.10 What is deliberately not built

- No auto-insertion. Ever.
- No send-time merging.
- No LLM call in the injection path.
- No per-message "AI rewrite" of the context. Bodies go in as written.
- No inference of "the user's current task" beyond the draft text. The draft is the task.

---

## 4. Priority features

Ranked by impact per unit of work. The first three are the product.

| # | Feature | Why it is here | Depends on |
| --- | --- | --- | --- |
| 1 | **Draft-as-query injection with preview** | Removes the step dependency and the copy-paste. The entire objective | P3 |
| 2 | **Save selection: context menu + shortcut** | The fastest capture path, no popup, no new permission | nothing |
| 3 | **Delimited block, Remove, Undo** | Trust. The user can always see and reverse what was added | 1 |
| 4 | **Per-host budgets** | The same package is too long for ChatGPT and fine for Claude | 1 |
| 5 | **Exact-duplicate refusal at capture** | "Already in Memory" beats a second copy every time | nothing (`content_hash` exists) |
| 6 | **Summary-only compression** | Keeps a relevant item in the package when its body will not fit | 1 |
| 7 | **Quiet-mode badge** | The "right moment" without the risk of unasked text | 1 |
| 8 | **Save this page** | Second most common capture after selection | K3's chunker |
| 9 | **Async label suggestions** | Tags without asking, using a function that already exists | 2 |
| 10 | Documents, screenshots, LLM summaries, semantic arm | Real, later, each with a decision attached | D1, vendor |

---

## 5. Recommended implementation roadmap

Slices are independently shippable. Numbers continue `docs/MEMORY_002_PLAN.md`.

| Slice | Objective | Touches | Gate |
| --- | --- | --- | --- |
| **P3** | `buildContext()` in `engine.ts`; dedup, budget, relevance floor, summary-only compression; twin in `memory-pack.js`; parity fixtures | `engine.ts`, `memory-pack.js`, `check-memory-parity.js` | Parity green with new fixtures; determinism over 100 runs |
| **I1** | Injection v1: shortcut, draft-as-query, preview panel, delimited block, Remove, Undo, per-host budgets | `manifest.json` (commands), new `content/memory-inject.js` replacing the step flow in `memory-picker.js`, `background.js` (one handler calling `knowledge_search`) | Panel opens under 300 ms on ChatGPT and Claude; Remove strips exactly the block |
| **C1** | Capture v1: context menu on `selection`, `Ctrl+Shift+S`, deterministic enrichment into `metadata`, exact-dup refusal, toast with Undo and space picker | `background.js`, `content.js` (toast), `manifest.json` | Selection saved in under 2 s with source and title; second save of the same text refused |
| **I2** | Quiet-mode badge, opt-in, debounced | `memory-inject.js`, popup preference | No insertion ever happens without a click |
| **C2** | Save this page (readable extraction, chunked) | popup card, `chat-capture.js` generalised to `page-capture` | A long article chunks under the cap with one source per chunk |
| **P4** | MCP `search_knowledge` and `build_context` on the same engine | `services/mcp-memory/` | Same package the panel shows, from a real client |
| **E1** | Async enrichment: label suggestions, LLM summary, opt-in per space | Edge Function call from `background.js`, space setting | Capture latency unchanged; enrichment visible within a minute |
| later | Documents (D1), screenshots, semantic arm (vendor-gated), language detection twin | | |

**Dependencies**: P3 first, because I1 and P4 render its output. C1 has no dependencies and
can ship alongside P3. I2 and C2 follow I1 and C1 respectively. E1 last, because it is the
only slice that sends text off the machine.

**What changes in the existing plan**: `memory-picker.js`'s step flow is superseded by I1
for humans and kept for MCP agents. Nothing else in the plan moves.

---

## 6. Risks specific to this design

| Risk | Mitigation |
| --- | --- |
| Composer selectors rot (the picker's known weakness) | The structural fallback stays; the panel degrades to "copy block" when no composer is found, so injection is never fully lost |
| A long draft makes a bad query | Last 600 characters only; the panel's refresh lets the user re-run after editing |
| Users inject too much | Default budgets are conservative, the panel shows the token total before insert, and summary-only compression is preferred to dropping |
| Deterministic enrichment is thin | It is honest. Title, source, hash and first line are what a human would type anyway. LLM enrichment is additive and opt-in |
| A second twin (language detection) | Not built. Language stays a dashboard-side or async concern until it earns a parity gate |
