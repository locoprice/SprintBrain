# SprintBrain Memory: architecture review

**Scope**: review only. No production code, migrations, endpoints or schema changes were made.
**Reviewed**: 2026-08-27, against the live database and the working tree.
**Verdict**: see the end. Short version: the foundation is sound and must be kept, but
`MEMORY_002_PLAN.md` needs revision before S3, because as written it would build exactly the
duplication the strategic rule forbids.

> **Correction to the brief.** The review target is not v2.168.0. Since that version the repo
> has shipped S0 (v2.170.0), S1 (v2.171.0), S2 (v2.172.0), a release merge to v3.0.0, and chat
> capture (v3.1.0). The memory layer already has spaces, kinds, versioning, an audit log,
> token scopes, rate limiting and a dashboard. What follows reviews **v3.1.0**.

---

## 1. Current state

### 1.1 What exists

| Layer | Where | State |
| --- | --- | --- |
| Memory storage | `memory_spaces`, `memory_shards`, `memory_shard_versions`, `memory_audit_log` | Applied, RLS on, least-privilege grants verified |
| Tagging | `labels` + `memory_shard_labels` | Shared vocabulary with snippets and prompts |
| Retrieval phases | `memory_steps`, `memory_step_labels` | Label requirements plus a token budget per step |
| Selection engine | `app/src/lib/memory/engine.ts` | Pure, zero imports, ranking + budget + LRU eviction |
| Extension twin | `extension/shared/memory-pack.js` | Strict subset, one-shot, no eviction |
| Parity gate | `scripts/check-memory-parity.js` | 10 fixtures + token estimator, now in CI |
| MCP server | `services/mcp-memory/` | stdio, 6 read-only tools, PAT auth |
| Token surface | `memory_mcp_manifest/_index/_bodies` | `anon`-granted, identity from token only |
| Extension pill | `extension/content/memory-picker.js` | Injects context into a chat composer |
| Chat capture | `extension/content/chat-capture.js` + `shared/memory-chunk.js` | Pulls a transcript into a space |
| Dashboard | `/memory` routes | Spaces, items, trash, restore |

### 1.2 What it does today

Facts are stored one per row, tagged with labels, grouped into spaces. A named step declares
which labels it needs and how many tokens it may spend. The engine ranks eligible shards
(score, priority, name, id), fills the budget, evicts least-recently-used under pressure, and
returns only the delta on a step change. Three surfaces consume that one rule: the dashboard,
the MCP server (which compiles `engine.ts` directly), and the extension (which reimplements it
under a CI gate).

### 1.3 What is reusable, unchanged

Almost all of it. Specifically worth keeping as-is:

- **`engine.ts` and its zero-import constraint.** This is the single most valuable asset in
  the memory layer. It is the reason one selection rule serves three runtimes.
- **The parity gate.** The only thing preventing the extension and the server from disagreeing.
- **The index/body split.** Listing costs names and summaries; bodies are fetched only for what
  a budget admits. This is the economic core of the product and generalises to any source.
- **The token surface contract.** No `user_id` parameter, identity from the token alone, a
  wrong token returns zero rows. This is a good, auditable boundary.
- **Content hashing, versioning, audit.** Already in place, already correct.

---

## 2. Gaps

### 2.1 Essential, blocking the vision

**G1. Snippets and prompts are invisible to retrieval.** The vision is "SprintBrain owns the
user's knowledge". Today memory retrieval sees `memory_shards` and nothing else. A user's
snippets (108 rows in production) and prompts are the bulk of their actual knowledge and are
unreachable from any AI. `MEMORY_002_PLAN.md` does not mention them once. This is the single
largest gap and it is architectural, not cosmetic.

**G2. Two authorization models.** This is the finding that shapes the rest.

| | Snippets / Prompts | Memory |
| --- | --- | --- |
| Unit of sharing | Folder | None. Personal only |
| Read check | `app.can_read_folder()` → `folder_permissions`, org and team scopes, `default_folders` | `user_id = auth.uid()` |
| Org stamp | `organization_id` column on the row | None |
| Helper on the read path | Yes, STABLE SECURITY DEFINER | No, deliberately |

Both are defensible in isolation. Unified naively they are not: the folder ACL has an incident
history (the recursive-CTE policy that wedged production for about two hours on 2026-08-05, and
the one-way share where revoking never cleared `organization_id`), and MEMORY-001 rejected
folder inheritance for shards on the explicit grounds that a teammate's fact must not silently
steer your assistant.

**G3. `auth.uid()` is null on the MCP token path.** The `memory_mcp_*` functions work because
shards are gated on a flat `user_id` that the definer function compares against a manually
resolved id. `app.can_read_folder()` calls `auth.uid()` internally, so a token-authenticated
function **cannot reuse it**. Any plan to expose snippets or prompts over MCP hits this wall
immediately. It is not a small fix: it means parameterising the ACL helper that every snippet
read in the product already depends on.

**G4. Ranking is about to be split across two languages with only half of it gated.** `S6` puts
hybrid search and RRF fusion in SQL; `S7` puts the Context Builder in `engine.ts`. The parity
gate covers `engine.ts` against `memory-pack.js` and knows nothing about SQL ranking. Following
the plan as written produces a third selection implementation, ungated, in a third language.
That is the duplication the strategic rule forbids, arriving through the front door.

**G5. Steps and query retrieval are modelled as parallel mechanisms.** They are not. A step is a
saved, label-scoped query with a budget. The plan treats `memory_enter_step` and
`build_context` as separate paths, which means two selection entry points to keep in agreement.

### 2.2 Optional, defer without cost

- Semantic embeddings (S10). Still gated on a vendor decision, still the only slice that sends
  body text to a third party.
- SBMF as a full interchange format. Useful, not load-bearing.
- Document upload (S3). Valuable, but it adds a source rather than changing the architecture.
- Space sharing (S9) **as currently specified**. See R2.

---

## 3. Recommended architecture

```
                    ┌──────────────── writes stay where they are ──────────────┐
   snippets ────────┤                                                          │
   prompts  ────────┤  owning tables keep their own RLS, ACL and write paths   │
   memory_shards ───┘                                                          │
        │                                                                      │
        ▼                                                                      │
  ┌───────────────────────────────────────────────────────────┐                │
  │  app.knowledge_index   (VIEW, security_invoker = true)     │◄───────────────┘
  │  kind, source_id, title, summary, body, tokens, labels,    │
  │  updated_at, owner_id                                      │
  └───────────────────────────────────────────────────────────┘
        │  candidate generation: filter + coarse rank, returns ids + scores
        ▼
  ┌───────────────────────────────────────────────────────────┐
  │  engine.ts   selection: dedup → budget → order            │  ← parity-gated
  └───────────────────────────────────────────────────────────┘
        │
        ▼
   Context package  ──►  MCP tools │ dashboard preview │ extension pill
```

### 3.1 One retrieval surface, composed not unified

Do **not** migrate snippets and prompts into `memory_shards`. That would mean duplicated
storage, a broken extension expansion path (which reads `snippets` through a
`chrome.storage` cache), broken Notion sync, and a rewrite of the folder ACL. It is the
rewrite trap.

Instead add **one read-only view** that projects all three into a common retrieval shape. Writes
never go through it. Each row keeps exactly one home.

**The view must be `security_invoker = true`.** That is the whole trick. A Postgres view
defaults to running with the view owner's rights, which would bypass the underlying RLS. With
`security_invoker` set, each source table's own policy applies to the caller. The result is
that **authorization is composed rather than unified**: the retrieval layer never decides
access, it inherits whatever the caller could already see. Deny-by-default is preserved for
free, and G2 stops being a problem to solve and becomes a property to respect.

### 3.2 Where ranking lives, permanently

Draw one line and never cross it:

- **SQL does candidate generation.** Filter by space, kind, labels, ACL. Coarse-rank with
  full-text, trigram and metadata. Fuse with RRF. Return ids and scores. No bodies, no budget
  arithmetic, no deduplication.
- **`engine.ts` does selection.** Deduplicate, apply the token budget, order deterministically,
  return the package. This is the parity-gated half, and `memory-pack.js` mirrors it.

Then `buildContext(query)` and `buildContext(step)` are the same function: a step supplies its
labels and budget as the filter, a query supplies text. That closes G5 and prevents G4.

### 3.3 Snippets and prompts as memory objects

They join retrieval through the view, with their existing semantics intact:

- A **snippet** projects as `kind='snippet'`, title from `title`, body from `body`, summary
  synthesised from the first line. It stays expandable by trigger. Nothing about the extension
  changes.
- A **prompt** projects as `kind='prompt'`, and its existing `intent_category` and
  `strategy_type` become retrieval metadata rather than dead columns.
- A **memory item** projects as it already is.

Nothing is copied, nothing is migrated, and `snippets.body` remains the only place a snippet
body exists.

### 3.4 MCP exposure

Keep one server and one tool vocabulary. Add `search_knowledge` and `build_context` over the
view rather than a second set of memory-only tools.

**But scope the token path honestly.** Until the ACL helpers are parameterised (G3), a
token-authenticated call can only see rows whose policy does not depend on `auth.uid()`, which
today means memory items only. Two options, and the recommendation is the second:

1. Parameterise `app.can_read_folder(folder, uid)`. Correct end state, but it touches the
   helper behind every snippet read in the product, and that code path has already caused one
   multi-hour outage. It deserves its own phase and its own soak, never a side effect.
2. **Ship the view and the Context Builder against memory items first**, with snippets and
   prompts reaching the *JWT* surfaces (dashboard, extension) immediately, where `auth.uid()`
   exists and the folder ACL already works. Extend the token path in a later, dedicated phase.

Option 2 delivers most of the vision at a fraction of the risk, because the extension and the
dashboard are where a user actually reads their own knowledge.

### 3.5 Authorization and tenancy, target state

- One rule stated once: **the retrieval layer never widens access.** Every read composes source
  RLS.
- Memory stays personal by default. Sharing, when it lands, is an explicit grant, never an
  inherited stamp.
- The token surface keeps its contract: no identity parameter, wrong token yields zero rows,
  rate limit at the single resolver.
- Scopes on tokens gate write access, already in place.

---

## 4. Data model: the minimum

**Add exactly one thing now:**

| Object | Type | Why |
| --- | --- | --- |
| `app.knowledge_index` | VIEW, `security_invoker = true` | The single retrieval surface. No storage, no migration, no second source of truth |

**Add when the slice that needs it lands:**

| Object | Slice | Why |
| --- | --- | --- |
| `memory_shards.search_tsv` + `pg_trgm` indexes | S6 | Candidate generation. Generated column, no new table |
| `memory_documents` + `source_id`/`chunk_index` | S3 | A document is a source; its chunks are shards |
| `memory_grants` | S9 | One explicit grant table, replacing the proposed `memory_space_shares` (see R2) |

**Explicitly do not add:**

- A `knowledge_objects` table. That is unified storage, and it is the rewrite.
- A second tag vocabulary. `labels` already spans all three kinds.
- A separate embeddings table before the vendor decision exists.
- Per-kind retrieval functions. One view, one builder.

---

## 5. Migration path

**Nothing about v3.1.0 needs to be undone.** The evolution is additive.

| Step | Change | Backward compatibility |
| --- | --- | --- |
| 1 | Create the view over the three tables | Pure addition. Nothing reads it yet |
| 2 | Add candidate generation over the view | `memory_mcp_index` keeps its signature; new function beside it |
| 3 | Move budget and dedup into `engine.ts`, add parity fixtures | `enterStep` keeps working, reimplemented on top of `buildContext` |
| 4 | Point the MCP server and dashboard at the new path | Old tools keep their names and shapes |
| 5 | Parameterise the folder ACL, its own phase | Existing callers keep the one-argument form as a wrapper |

**Do NOT migrate:**

- **Snippet and prompt rows into memory tables.** Ever. They project, they do not move.
- **`memory_steps` into a generic query.** Keep the table; reframe it as a saved profile. Users
  will have configured steps and the MCP tools reference them by key.
- **The `memory_mcp_*` signatures.** Deployed MCP clients depend on them. Add beside, do not
  reshape.
- **The extension expansion cache.** `content.js` reads snippets from `chrome.storage`, and
  routing that through retrieval would put a network call in the keystroke path.
- **`intentEngine.ts`.** It classifies prompts, which is a different problem from retrieval.
  Leave it where it is rather than folding it into ranking.

---

## 6. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **R1. Third ranking implementation** (G4) | **High** | The SQL/TS line in 3.2, enforced by extending the parity gate before S6 lands, not after |
| **R2. A third ACL** | **High** | `MEMORY_002_PLAN` S9 proposes `memory_space_shares`, which would be a third sharing model beside folder ACL and personal. Converge on one explicit `memory_grants` table, or defer sharing entirely |
| **R3. Folder ACL regression** | **High** | Parameterising `can_read_folder` touches every snippet read. Own phase, own soak, feature-flagged. The 2026-08-05 outage started here |
| **R4. View performance** | Medium | A three-way UNION with `security_invoker` runs each source's policy per query. Measure before shipping; if it degrades, the fix is a materialised projection refreshed on write, not a bypass of RLS |
| **R5. Overengineering** | Medium | The temptation is a generic "knowledge object" abstraction. Resist. One view, one builder, three concrete kinds |
| **R6. Breaking the extension** | Medium | The pill and the expansion path are independent of retrieval and must stay that way. Any change touching `content.js` keystroke handling is out of scope for this work |
| **R7. Source-of-truth drift** | Low, if 3.1 holds | The view has no storage, so drift is structurally impossible. It becomes a real risk the moment anyone proposes caching it |

---

## 7. Implementation phases

Each phase is independently shippable and independently revertible.

### P1. Knowledge view
- **Objective**: one read surface over snippets, prompts and memory items.
- **Files**: one migration creating `app.knowledge_index`.
- **DB**: view only, `security_invoker = true`. No table changes.
- **Tests**: cross-account probe proving the view leaks nothing the caller could not already
  read; a probe per kind confirming the projection is correct.
- **Accept**: two accounts see disjoint rows; row counts per kind match the underlying tables
  for the owner.

### P2. Candidate generation
- **Objective**: `knowledge_search(query, filters)` returning ids and scores, no bodies.
- **Files**: migration; `pg_trgm` and `unaccent`; `search_tsv` on `memory_shards`.
- **DB**: extensions installed, generated column, GIN indexes.
- **Tests**: SQL fixtures for accent-insensitivity, typo tolerance, label filters, empty query.
- **Accept**: ranked ids for a seeded fixture; no body column in the result shape.

### P3. Context Builder in the engine
- **Objective**: `buildContext()` beside `enterStep()`, dedup and budget in one place.
- **Files**: `engine.ts`, `memory-pack.js`, `check-memory-parity.js`.
- **DB**: none.
- **Tests**: new parity fixtures covering dedup and budget; a determinism test over repeated
  runs.
- **Accept**: parity gate green with the new fixtures; `enterStep` reimplemented on
  `buildContext` with its existing fixtures unchanged.

### P4. Surfaces read the new path
- **Objective**: dashboard preview panel and MCP tools use candidate generation plus builder.
- **Files**: `services/mcp-memory/`, dashboard route, API module.
- **DB**: none.
- **Tests**: MCP tool exercised from a real client; dashboard preview shows attached, dropped
  and deduplicated.
- **Accept**: existing `memory_*` tools unchanged in name and shape.

### P5. Snippets and prompts on the JWT surfaces
- **Objective**: search and context over all three kinds where `auth.uid()` exists.
- **Files**: dashboard, extension pill.
- **DB**: none, the view already covers it.
- **Tests**: a shared-folder snippet appears for a teammate and not for an outsider.
- **Accept**: folder ACL semantics identical to the snippets table itself.

### P6. Token path parity, gated separately
- **Objective**: parameterise the folder ACL so token-authenticated calls can reach snippets.
- **Files**: ACL helper migration, `memory_mcp_*`.
- **DB**: `app.can_read_folder(text, uuid)` with the existing signature kept as a wrapper.
- **Tests**: every existing snippet RLS probe re-run unchanged, plus token-path equivalents.
- **Accept**: no change in behaviour for any JWT caller. This phase is reverted on any
  regression, not patched forward.

---

## Recommendation

**B. REVISE PLAN**

The v3.1.0 architecture **can** evolve into the target without unnecessary complexity, and
nothing built so far needs undoing. `engine.ts`, the parity gate, the index/body split and the
token contract are the right foundations and should be kept exactly as they are. There is no
case for STOP.

But `MEMORY_002_PLAN.md` cannot be followed as written, for three concrete reasons:

1. **It never mentions snippets or prompts.** The strategic goal is one knowledge layer; the
   plan describes a memory silo beside the existing library. Building S3 through S9 as written
   delivers a second knowledge system, which is precisely the forbidden outcome.
2. **S6 and S7 together create a third, ungated ranking implementation.** The SQL/TS boundary
   in section 3.2 has to be written into the plan before S6 is built, not discovered after.
3. **S9 proposes a third authorization model.** `memory_space_shares` beside the folder ACL and
   personal ownership. Converge or defer.

Required edits to `MEMORY_002_PLAN.md` before coding resumes: add the knowledge view as the
retrieval surface, restate S6 and S7 against the SQL/TS split, fold steps into the Context
Builder as a saved profile, replace S9's sharing design with a single grant model or defer it,
and insert the folder-ACL parameterisation as its own late, independently revertible phase.

S3 (documents) is unaffected by all of this and can proceed in parallel if you want forward
motion while the plan is revised.
