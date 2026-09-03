# SprintBrain Memory: authoritative implementation plan

**Targets**: v3.1.0, the architecture actually in production.
**Supersedes**: the v2.168.0-era draft of this file, revised 2026-08-27 after the architecture
review in `docs/MEMORY_ARCHITECTURE_REVIEW.md`. That review's three blockers are accepted and
are now enforced as principles below.
**Status**: K0 to K3 and P1 shipped. P2 (candidate generation) is next. Nothing shipped needs undoing.

---

## 1. Product vision

SprintBrain is becoming an **LLM-independent external memory and context layer**.

> The user owns their knowledge. SprintBrain stores and organises it, retrieves what is
> relevant, builds the optimal context, and makes that context available to any AI through
> MCP or an API.

MCP is the access protocol. It is not the product. The product is the retrieval and context
layer underneath it, and it must remain useful when the next protocol replaces MCP.

Concretely:

```
User knowledge (memory items, snippets, prompts, documents)
   → SprintBrain retrieval
   → Context Builder
   → MCP / API
   → ChatGPT, Claude, Gemini, Cursor, or whatever comes next
```

---

## 2. Non-negotiable principles

These are architectural constraints, not preferences. A change that violates one of them is
wrong even if it ships faster.

### P-1. One knowledge ecosystem, and prompts are not context

Memory items and snippets live in **one retrieval and context architecture**. Prompts live in
the same product and share its vocabulary, but they are **not** retrieval candidates.

- No parallel snippet knowledge store is created.
- **Snippet bodies stay in `snippets`.** That table is the only place a snippet body exists.
- **Prompt data stays in `prompts`.** Same rule.
- **Prompts are excluded from the context surface.** A prompt is an instruction you run, not
  background knowledge to inject. Putting one into a model's context competes with the live
  instruction, and a model given two sets of instructions follows neither reliably. The failure
  is silent and looks like the model being unpredictable.
- The exclusion is **structural, not a flag**. Prompts are absent from the view rather than
  present and filtered off, because a filter invites someone to flip it.
- Prompts stay fully reachable **as prompts**: the prompt library, the ⌘K picker and the
  existing prompt trigger are unaffected.
- Memory is the shared **context layer**, not a replacement database. It does not absorb the
  library; it reads across it.

### P-2. Single selection authority

- **SQL may generate candidates.** Filter, coarse-rank, fuse, return ids and scores.
- **`app/src/lib/memory/engine.ts` is the authoritative selector.** Deduplication, token
  budgeting, eviction and final ordering happen there and nowhere else.
- **No third ranking implementation.** Two exist today (`engine.ts` and its gated extension
  twin) and that is the ceiling.
- `scripts/check-memory-parity.js` must stay meaningful. Every new selection behaviour gains
  fixtures in the same commit that introduces it.

### P-3. Authorization by composition

- **No third authorization model.** Two exist: the folder ACL for snippets and prompts, and
  personal ownership for memory. That is the ceiling.
- Snippets, prompts and memory are **not** forced into a shared ACL. Each source keeps its own.
- Retrieval **never bypasses and never replaces** source-level authorization. It inherits it.
- `security_invoker = true` views are the sanctioned mechanism for that inheritance.

### P-4. MCP authentication is its own phase

- The `auth.uid()` gap on the token path (see §5.4) is handled in **one isolated,
  independently testable and independently revertible phase**.
- Search and retrieval work **must not** modify the folder authorization system as a side
  effect.
- The safeguards that came out of the 2026-08-05 outage stay exactly as they are: no access
  helper on a hot read path, no recursive CTE in a per-row policy, denormalized `user_id` on
  link tables.

### P-5. Additive evolution

Every phase is additive and revertible. Existing function signatures, tool names and table
shapes are extended beside, never reshaped, because deployed MCP clients and a shipped
extension depend on them.

---

## 3. What exists at v3.1.0

Verified against the live database and the working tree.

| Layer | Location | State |
| --- | --- | --- |
| Memory storage | `memory_spaces`, `memory_shards`, `memory_shard_versions`, `memory_audit_log` | Applied, RLS on, least-privilege grants verified by probe |
| Tagging | `labels` + `memory_shard_labels` | One vocabulary already shared with snippets and prompts |
| Retrieval phases | `memory_steps`, `memory_step_labels` | Label requirements plus a token budget |
| Selection engine | `app/src/lib/memory/engine.ts` | Pure, zero imports, ranking + budget + LRU eviction |
| Extension twin | `extension/shared/memory-pack.js` | Strict subset, one-shot, no eviction |
| Parity gate | `scripts/check-memory-parity.js` | 10 fixtures + token estimator, in CI |
| MCP server | `services/mcp-memory/` | stdio, 6 read-only tools, PAT auth, scopes, rate limit |
| Token surface | `memory_mcp_manifest / _index / _bodies` | `anon`-granted, identity from token alone |
| Extension pill | `extension/content/memory-picker.js` | Pushes context into a chat composer |
| Chat capture | `extension/content/chat-capture.js`, `shared/memory-chunk.js` | Pulls a transcript into a space |
| Dashboard | `/memory`, `/memory/:spaceId` | Spaces, items, trash, restore |
| Snippet library | `snippets` (108 rows in production) | Folder ACL, org and team scopes |
| Prompt library | `prompts` | Same folder ACL |

**Shipped phases** (renamed from the old S-numbering to avoid confusion with the new plan):

| Phase | Version | What |
| --- | --- | --- |
| K0 | 2.170.0 | CI runs the parity gate on Node 22; `check-version.js` covers 5 stamps |
| K1 | 2.171.0 | Spaces, kinds, metadata, content hash, soft delete, versions, audit, token scopes, rate limiting |
| K2 | 2.172.0 | `/memory` dashboard |
| K3 | 3.1.0 | Chat capture from ChatGPT and Claude, shared chunker |

**Foundations to preserve unchanged.** `engine.ts` and its zero-import constraint (it compiles
into the dashboard bundle and the standalone MCP server, and is mirrored by hand into the
extension). The parity gate. The index/body split, which is the economic core: listing costs
names and summaries, bodies are fetched only for what a budget admits. The token contract: no
identity parameter, a wrong token returns zero rows.

---

## 4. Architecture

```
        writes stay where they already are
   ┌──────────────────────────────────────────────┐
   │  snippets              memory_shards         │  each keeps its own
   │  (folder ACL)          (personal RLS)        │  table, RLS and writers
   └──────────────────────────────────────────────┘
                        │  projected, never copied
                        ▼
   ┌──────────────────────────────────────────────┐
   │  app.knowledge_index                          │  VIEW, security_invoker = true
   │  kind, source_id, title, summary, body,       │  no storage, no second
   │  tokens, label_ids, updated_at, owner_id      │  source of truth
   └──────────────────────────────────────────────┘

   prompts ──► NOT in the view. Instructions, not context (P-1).
               Reached through the prompt library, never injected.
                        │  SQL: filter + coarse rank + RRF → ids and scores
                        ▼
   ┌──────────────────────────────────────────────┐
   │  engine.ts                                    │  TS: dedup → budget →
   │  the single selection authority               │  deterministic order
   └──────────────────────────────────────────────┘
                        │
                        ▼
              Context package
        │              │              │
      MCP          dashboard       extension
```

### 4.1 One retrieval surface, composed not merged

`app.knowledge_index` is a **read-only view** projecting the two **context** sources, snippets
and memory items, into a common retrieval shape. Writes never pass through it. Every row keeps
exactly one home. Prompts are deliberately not projected: see P-1.

Why a view rather than a unified table: migrating snippets into memory storage
would mean duplicated storage, a broken extension expansion path (`content.js` reads snippets
from a `chrome.storage` cache, and a network call cannot enter the keystroke path), broken
Notion sync, and a rewrite of the folder ACL. That is the rewrite trap and P-1 forbids it.

**`security_invoker = true` is the mechanism, not a detail.** A Postgres view defaults to the
owner's rights, which would bypass the underlying RLS. With `security_invoker` set, each source
table's own policy applies to the caller. Authorization is therefore **composed**: the
retrieval layer never decides access, it inherits whatever the caller could already see.
Deny-by-default is preserved structurally rather than by a rule someone has to remember. This
is how P-3 is satisfied without a third ACL.

### 4.2 The SQL / TypeScript line

Drawn once, never crossed:

| Side | Owns | Never does |
| --- | --- | --- |
| **SQL** | Filtering by space, kind, labels, ACL. Full-text, trigram and metadata ranking. RRF fusion. Returns ids and scores | Bodies, token budgeting, deduplication, eviction |
| **`engine.ts`** | Deduplication, token budget, eviction, deterministic final order, the package | Access decisions, text search |

Fusion is **Reciprocal Rank Fusion** (`score = Σ 1/(k + rank_i)`, k = 60) rather than weighted
score blending, because a `ts_rank` and a trigram similarity are not comparable numbers and RRF
needs no normalisation between arms. It also degrades cleanly: with an arm returning nothing,
the ranking stays stable.

The parity gate covers the TypeScript side. Candidate generation is covered by SQL fixtures.
Ranking never straddles the two, which is what keeps P-2 enforceable rather than aspirational.

### 4.3 Steps are a saved retrieval profile

`memory_steps` is not a second retrieval mechanism. A step is a **saved, label-scoped query
with a budget**.

`buildContext()` is the single entry point. A step supplies its labels and budget as the
filter; a free-text query supplies text. `memory_enter_step` is reimplemented on top of
`buildContext` and keeps its existing tool name, shape and fixtures. Two entry points to keep
in agreement becomes one.

### 4.4 How snippets participate, and why prompts do not

Snippets join through the view, with their existing semantics intact and nothing copied:

| Kind | Title | Body | Summary | Notes |
| --- | --- | --- | --- | --- |
| `snippet` | `snippets.title` | `snippets.body` | First line of the body | Stays trigger-expandable. The extension expansion path is untouched |
| `memory` | `memory_shards.name` | `memory_shards.body` | `memory_shards.summary` | Already the right shape |

**Prompts are not a kind here.** They stay in `prompts`, keep their folder ACL, their labels,
their trigger and their place in the dashboard. What they do not do is enter a context package.
The distinction is worth stating precisely, because both are user-authored text:

- A **snippet** is something the user says. As context it tells a model what the user knows or
  how they phrase things, which is what context is for.
- A **prompt** is something the user tells a model to do. As context it competes with the live
  instruction rather than informing it.

Finding the right prompt is a real problem, but it is **prompt discovery**, not context
building, and it already has a home in the ⌘K picker and `intentEngine.ts`. See §10.

Multilingual snippets carry `bodies` as a JSONB map. The view projects the row's primary `body`;
per-language retrieval is a FUTURE capability (§10), not a v1 requirement.

---

## 5. Data model

### 5.1 Add now

| Object | Type | Why |
| --- | --- | --- |
| `app.knowledge_index` | VIEW, `security_invoker = true` | The single retrieval surface. No storage, no migration, no second source of truth |

### 5.2 Add with the phase that needs it

| Object | Phase | Why |
| --- | --- | --- |
| `memory_shards.search_tsv`, `pg_trgm`, `unaccent` | P2 | Candidate generation. A generated column, no new table |
| `memory_documents`, `memory_shards.source_id` / `chunk_index` | D1 | A document is a source; its chunks are shards |
| `memory_grants` | G1 | **One** explicit grant table. Replaces the `memory_space_shares` design in the superseded plan, which would have been a third sharing model |
| `memory_embeddings` | E1 | Only after the vendor decision in §11 |

### 5.3 Explicitly do not add

- **A `knowledge_objects` table.** That is unified storage, and it is the rewrite P-1 forbids.
- **A second tag vocabulary.** `labels` already spans snippets, prompts and memory. Prompts
  being outside the *retrieval* surface does not put them outside the *tagging* one.
- **Per-kind retrieval functions.** One view, one builder.
- **A materialised copy of the view.** It would reintroduce a second source of truth and, worse,
  a copy that RLS does not follow. See R4 for what to do if performance demands it.

### 5.4 The `auth.uid()` gap, stated precisely

`memory_mcp_*` works because memory rows are gated on a flat `user_id` that the definer function
compares against a manually resolved id. `app.can_read_folder()` calls `auth.uid()` internally,
which is **null on the token path**. A token-authenticated function therefore cannot reuse it,
and cannot read snippets or prompts.

Two options, and P-4 dictates the sequencing rather than the choice:

1. Parameterise `app.can_read_folder(folder, uid)`. Correct end state, but it touches the helper
   behind every snippet read in the product, and that path caused a multi-hour outage on
   2026-08-05.
2. **Ship retrieval to the JWT surfaces first** (dashboard, extension), where `auth.uid()`
   exists and the folder ACL already works, and extend the token path afterwards.

The plan does both, in that order, as P5 then P6. P6 is isolated and revertible.

---

## 6. Contracts

### 6.1 Candidate generation

`app.knowledge_search(p_query, p_kinds, p_space_ids, p_label_ids, p_limit)`

`p_kinds` accepts `'snippet'` and `'memory'`. There is no prompt kind to request, because the
view holds none (P-1).

Returns `(kind, source_id, title, summary, tokens, rank, matched_arms)`. **No bodies.** A
result list costs names and summaries, which is the same economy the shard index already
establishes and the reason listing scales.

Metadata filters apply inside every arm rather than after fusion, so a filtered search does not
return a short list because the filter ran last.

### 6.2 Context Builder

```ts
export interface ContextRequest {
  budget: number;
  candidates: readonly ContextCandidate[];  // ranked by knowledge_search or a step
  dedupe: boolean;
}

export interface ContextPackage {
  items: Array<{ kind: string; id: string; title: string; body: string; tokens: number }>;
  usedTokens: number;
  budget: number;
  droppedForBudget: SkippedItem[];
  deduped: Array<{ id: string; mergedInto: string; reason: 'exact' | 'near' }>;
  sources: Array<{ kind: string; count: number }>;
}
```

Deduplication runs twice: **exact** on `content_hash` (cheap, catches re-imports and chunk
overlap), then **near** by trigram similarity **within the candidate set only**, because an
all-pairs comparison over a library does not scale and is not needed. Collapsed ids are
reported, never silently dropped.

Determinism is a hard requirement: identical candidates and budget always produce an identical
package. An agent that gets different context for the same query on a rerun is not debuggable.

### 6.3 MCP surface

One server, one tool vocabulary. Existing tools keep their names and shapes.

| Tool | Scope | Phase | Notes |
| --- | --- | --- | --- |
| `memory_steps`, `memory_index`, `memory_enter_step`, `memory_attach`, `memory_detach`, `memory_state` | read | shipped | Unchanged. `memory_enter_step` is reimplemented on `buildContext` |
| `search_knowledge` | read | P4 | Wraps `knowledge_search`. Summaries, never bodies |
| `build_context` | read | P4 | Query or step, plus a budget |
| `save_memory` | **write** | W1 | Requires a `write`-scoped token |
| `export_space` | read | IO1 | Logged to the audit trail |

Unchanged server-side rules: no tool accepts a user id, identity comes from the token alone, a
wrong token returns zero rows, and the rate limit is enforced at the single resolver so it
applies to every tool including ones added later.

---

## 7. Security posture

| Requirement | Mechanism |
| --- | --- |
| Deny-by-default | RLS on every table; the view composes it via `security_invoker` and can only narrow |
| No third ACL | Folder ACL for snippets and prompts, personal for memory, nothing else (P-3) |
| No raw secret exfiltration | `memory_tokens` is outside the export surface entirely; only SHA-256 hashes stored; plaintext returned once |
| GDPR deletion | `memory_purge_space()` / `memory_purge_all()` hard-delete rows, versions, embeddings, chunks and storage objects, leaving a content-free tombstone |
| Audit | Append-only `memory_audit_log`, no bodies, exports recorded |
| Rate limiting | Fixed window on `memory_tokens`, enforced in `app.memory_resolve_token` |
| Outage safeguards | No access helper on a hot read path, no recursive CTE in a per-row policy, denormalized `user_id` on link tables |

Two things this plan does **not** claim: it is not end-to-end encrypted (bodies are readable by
the database, and client-side encryption would make server-side search impossible), and enabling
embeddings would send body text to a third party, which is why E1 is opt-in per space and
default off.

---

## 8. Phases

Every phase is independently shippable and independently revertible.

### P1. Knowledge view  ✅ shipped v3.4.0
- **Objective**: one read surface over snippets and memory items. Prompts are excluded (P-1).
- **Affects**: one migration creating `app.knowledge_index`.
- **Database**: view only, `security_invoker = true`. No table changes.
- **Tests**: cross-account probe proving the view exposes nothing the caller could not already
  read; a per-kind projection probe; a probe confirming a shared-folder snippet appears for a
  teammate and not for an outsider.
- **Accept**: two accounts see disjoint rows. Per-kind counts match the underlying tables for
  the owner. `security_invoker` confirmed set on the applied view. **A probe asserts the view
  returns zero rows of kind `prompt` and that `prompts` is absent from its definition**, so the
  exclusion is enforced by the schema rather than by reviewer attention.

### P2. Candidate generation
- **Objective**: `app.knowledge_search()` returning ranked ids and scores, no bodies.
- **Affects**: migration; `pg_trgm` and `unaccent` installed; `search_tsv` on `memory_shards`.
- **Database**: extensions, one generated column, GIN indexes.
- **Tests**: SQL fixtures for accent insensitivity, typo tolerance, label and kind filters,
  empty query, and a filtered search returning a full-length list.
- **Accept**: sane ranking on a seeded fixture; no body column in the result shape; `index_advisor`
  run and its findings recorded.

### P3. Context Builder in the engine
- **Objective**: `buildContext()` beside `enterStep()`; dedup and budget in one place.
- **Affects**: `app/src/lib/memory/engine.ts`, `extension/shared/memory-pack.js`,
  `scripts/check-memory-parity.js`.
- **Database**: none.
- **Tests**: new parity fixtures for dedup (exact and near) and budget; a determinism test over
  repeated runs; existing `enterStep` fixtures unchanged and still green.
- **Accept**: parity gate green including the new fixtures. `enterStep` reimplemented on
  `buildContext` with identical observable behaviour.

### P4. Surfaces read the new path
- **Objective**: MCP tools and the dashboard preview panel use candidate generation plus builder.
- **Affects**: `services/mcp-memory/`, a dashboard route, the memory API module.
- **Database**: none.
- **Tests**: `search_knowledge` and `build_context` exercised from a real MCP client; the preview
  shows attached, dropped and deduplicated items with token accounting.
- **Accept**: every existing `memory_*` tool unchanged in name and shape.

### P5. Snippets on the JWT surfaces
- **Objective**: search and context across both kinds where `auth.uid()` exists.
- **Affects**: dashboard, extension pill.
- **Database**: none. The view already covers it.
- **Tests**: a shared-folder snippet appears for a teammate and not an outsider; a personal
  memory item never crosses accounts; **no prompt appears in any context package**.
- **Accept**: folder ACL semantics identical to querying `snippets` directly.

### P6. Token-path parity  ⚠ isolated
- **Objective**: parameterise the folder ACL so token-authenticated calls can reach snippets.
- **Affects**: the ACL helper migration, `memory_mcp_*`.
- **Database**: `app.can_read_folder(text, uuid)`, with the existing one-argument signature kept
  as a wrapper delegating to it.
- **Tests**: **every existing snippet and prompt RLS probe re-run unchanged**, plus token-path
  equivalents of each.
- **Accept**: no behaviour change for any JWT caller. **This phase is reverted on any regression,
  never patched forward.** It ships alone, with nothing else in the release.

### Independent phases

### D1. Documents
- **Objective**: private bucket, upload, chunking into shards.
- **Affects**: migration (`memory_documents`, `source_id`, `chunk_index`), storage policies,
  dashboard upload target, reuses `extension/shared/memory-chunk.js`.
- **Database**: one new table, two columns, one bucket.
- **Tests**: a 200 KB file uploads and every chunk stays under the body cap; the chunker check
  extended for the document path.
- **Accept**: chunks carry provenance; deleting a document removes its chunks.

### H1. Version history panel
- **Objective**: surface the versions K1 already writes.
- **Affects**: dashboard only.
- **Database**: none.
- **Tests**: editing twice shows v1 and v2; restore writes v3 rather than mutating history.
- **Accept**: restore is an append, never an edit.

### IO1. Import and export
- **Objective**: JSON, Markdown, CSV, TXT and the SBMF archive (§9).
- **Affects**: a new client library, dashboard actions, `export_space` MCP tool.
- **Database**: none.
- **Tests**: round-trip asserts byte-identical bodies and preserved label associations.
- **Accept**: exports are audited; tokens never appear in any export.

### W1. MCP writes
- **Objective**: `save_memory` over MCP.
- **Affects**: `services/mcp-memory/`, one definer RPC.
- **Database**: `memory_mcp_save`, deriving identity from the token and requiring `write` scope.
- **Tests**: a read-only token is refused indistinguishably from an unknown token; the rate
  limit raises `PT429`.
- **Accept**: no tool accepts a user id.

### G1. Grants and purge
- **Objective**: GDPR purge, plus **one** explicit grant model if sharing is wanted.
- **Affects**: migration, access-control UI.
- **Database**: `memory_grants` (single table, explicit rows, no inherited stamp).
- **Tests**: purge removes every referencing row and storage object; a revoked grant leaves no
  residual access.
- **Accept**: revoking removes access completely, with no `organization_id`-style stamp left
  behind. If sharing is deferred, the purge half still ships.

### E1. Semantic arm  ⚠ decision-gated
- **Objective**: pgvector as a fourth RRF arm, per-space opt-in, default off.
- **Blocked on**: the vendor decision in §11.
- **Accept**: turning embeddings off deletes the vectors; the UI names the vendor before any
  text leaves.

### 8.1 Dependencies

```
P1 ──► P2 ──► P3 ──► P4 ──► P5 ──► P6 (isolated, ships alone)
                      │
                      └──► W1
P2 ──────────────────────► E1 (also gated on the vendor decision)

D1   independent
H1   independent
IO1  independent
G1   after P5 (proves composition works before adding grants)
```

### 8.2 What can run in parallel

| Safe in parallel | Why |
| --- | --- |
| **D1 with P1 to P4** | Different tables and code paths. D1 touches storage and chunking; P1 to P4 touch retrieval |
| **H1 with anything** | Dashboard-only, reads a table that already exists |
| **IO1 with anything up to P4** | Client-side over existing APIs |
| **Never parallel: P6** | It ships alone. The ACL blast radius covers every snippet read |
| **Never parallel: two migrations at once** | One session applying DDL at a time, by coordination |

---

## 9. SBMF archive format

Line-delimited, checksummed, streamable, and secret-free by construction.

```
SBMF/1
{"type":"header","space":{...},"exported_at":"…","counts":{…},"checksum_alg":"sha256"}
{"type":"label","ref":"l1","name":"reference","color":"azure"}
{"type":"item","ref":"i1","kind":"fact","name":"…","body":"…","labels":["l1"],"content_hash":"…"}
{"type":"version","item":"i1","version":1,"body":"…","created_at":"…"}
{"type":"footer","items":42,"sha256":"<over every preceding line>"}
```

- **Refs, not ids.** An archive carries no database uuid, so importing elsewhere cannot collide
  or reveal authorship.
- **Never exported**: `memory_tokens`, audit entries, embeddings, user ids. Tokens are not
  redacted out; they are not in the export surface at all. Redaction heuristics fail quietly,
  absence does not.
- **Round trip is a test, not a claim.**
- Exports cover memory items. Snippets and prompts have their own existing export paths and are
  not duplicated here.

---

## 10. FUTURE capabilities

Deliberately **not** implemented now. Listed so the architecture stays open to them, and so
nobody builds them speculatively.

| Capability | Why deferred | What keeps it possible |
| --- | --- | --- |
| **Memory decay** | No evidence yet about what ages badly | `updated_at`, `created_at` and the audit trail are already recorded per item |
| **Contradiction detection** | Needs semantic comparison and a resolution UX; both are large | `content_hash` and versioning give a factual base; the near-dedup pass is the natural hook |
| **Confidence scoring** | Nothing produces a trustworthy score today | `metadata` is free-form and capped; a score is an additive key |
| **Automatic extraction** | Deciding what is worth remembering without asking is the hard part, and getting it wrong pollutes the library | Chat capture already provides the transport; extraction would sit in front of it |
| **Per-language retrieval** | `bodies` is a JSONB map and the ranking implications are unexplored | The view can gain a language column without a table change |
| **Cross-space dedup** | Only matters at volume nobody has yet | `content_hash` is indexed per user, not per space |
| **Write-back to snippets from memory** | Would create a second writer for `snippets` | Forbidden by P-1 unless the plan is revised |
| **Prompt recommendation** | A real problem, but it is discovery rather than context injection, and conflating the two is what P-1 forbids | `intentEngine.ts` already classifies prompts and ⌘K is the surface. It would rank prompts **for the user to pick**, never inject one into a package |

None of these require a schema change to become possible later. That is the test each had to
pass to be listed rather than designed.

---

## 11. Open decisions

1. **Embedding vendor**, or no semantic arm at all. E1 is blocked on this and nothing else is.
   Candidates: Voyage `voyage-3` (1024 dimensions, the provider Anthropic documents) or OpenAI
   `text-embedding-3-small` (1536). Either way the model name is stored per row so a change is a
   backfill rather than a corruption.
2. **Whether memory sharing is wanted at all.** G1 assumes it might be. If team memory is not a
   product goal, G1 reduces to the purge half and `memory_grants` is never created, which is
   strictly simpler.
3. **Per-space storage quota** for D1. Suggested default: 25 MB per space, 5 MB per file.
4. ~~Whether prompts should be retrievable as context.~~ **Decided 2026-08-27: they are not.**
   Prompts are instructions, not knowledge. They are excluded from the view structurally rather
   than behind a filter. See P-1 and §4.4.

---

## 12. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **R1. A third ranking implementation** | High | The SQL/TS line in §4.2, enforced by extending the parity gate in P3, before P4 consumes it |
| **R2. A third ACL** | High | P-3. `memory_space_shares` from the superseded plan is replaced by a single `memory_grants`, or dropped entirely |
| **R3. Folder ACL regression** | High | P6 ships alone, re-runs every existing probe unchanged, and is reverted rather than patched on any regression |
| **R4. View performance** | Medium | A two-way union running each source's policy per query, one arm lighter than planned since prompts are excluded. Measure in P2 with `index_advisor`. If it degrades, the fix is narrowing the projection or per-kind pre-filtering, **never** a materialised copy that RLS does not follow |
| **R5. Overengineering** | Medium | §10 exists to keep speculative features out. One view, one builder, three concrete kinds |
| **R6. Breaking the extension** | Medium | The pill and the expansion path stay independent of retrieval. No change touching `content.js` keystroke handling is in scope |
| **R7. Source-of-truth drift** | Low while §4.1 holds | The view has no storage, so drift is structurally impossible. It becomes real the moment anyone caches it (see R4) |
| **R8. Parallel sessions** | Medium | One migration at a time; check `origin/develop` before claiming a version |

---

## 13. History

**Superseded plan.** The first version of this file targeted v2.168.0 and planned slices S0 to
S10. S0 to S2 shipped (now K0 to K2), chat capture shipped outside the slice list (K3), and the
remainder was rewritten on 2026-08-27 after the architecture review found three blockers:

1. The plan **never mentioned snippets or prompts**, so following it would have built a second
   knowledge system beside the existing library. Fixed by P-1 and the knowledge view.
2. **S6 and S7 together created a third, ungated ranking implementation**, splitting ranking
   across SQL and TypeScript with only the TypeScript half parity-gated. Fixed by P-2 and §4.2.
3. **S9 proposed a third authorization model** (`memory_space_shares`). Fixed by P-3 and a
   single `memory_grants`, or by dropping sharing.

**Prompts ruled out of context, 2026-08-27.** The review left this open and proposed shipping
prompts behind a default-off filter. That was the wrong shape. Prompts are instructions, and a
model given both a live instruction and a stored one follows neither reliably, so the failure
would be silent and would present as the model behaving unpredictably. They are now excluded
from the view structurally, leaving no filter to flip, and P1 carries a probe that fails if a
prompt ever appears. Prompt discovery stays a separate, legitimate problem with its own
existing home (§10).

**Findings from building K0 to K3, still load-bearing:**

- **Supabase default privileges grant ALL on new `public` tables to `authenticated`, and a GRANT
  is additive.** Both memory migrations wrote grant lists that took nothing away. Nothing was
  exposed, because RLS refuses any command with no policy, but the defence-in-depth layer was
  missing. **Every new table must REVOKE before it GRANTs.** P2, D1 and G1 each add tables.
- **Restoring from trash can collide.** Name uniqueness is a partial index on `deleted_at is
  null`, so trashing frees a name. Any new restore path needs the collision handled.
- **`memory_save_shard` is the only write path that keeps history.** It appends the version and
  the audit row in one transaction under a `FOR UPDATE` lock. Never write `memory_shards`
  directly from a client.
- **The popup's `supaFetch` resolves with the raw `Response` and resolves on HTTP errors.**
  Callers must check `r.ok` explicitly or a failed write reports success.
- **`execute_sql` honours explicit `BEGIN ... ROLLBACK`**, so write probes can run against
  production and undo themselves. Temp tables do not survive between calls.

**K3, chat capture, outside the original slice list.** The popup shows a "Save this chat" card on
a supported thread and writes the transcript into a chosen space as `conversation` items.
ChatGPT and Claude only, because those are the two whose markup was read directly; a message
thread has no structural fallback the way a composer does, so unrecognised pages show nothing
rather than guessing. The chunker is shared with D1 by design. **Not verified: the selectors
against the live sites**, which needs a logged-in session and is the part most likely to rot.
