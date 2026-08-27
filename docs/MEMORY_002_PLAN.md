# MEMORY-002: SprintBrain Memory, spaces, retrieval, and a writable MCP surface

**Status**: In progress. S0 and S1 shipped; S2 is next. Section 13 records every change made
against this plan while building it.
**Relationship to MEMORY-001**: extends it. Nothing shipped in v2.168.0 is replaced.
**Drafted**: 2026-08-23, for review by Valentina and Alessandro.

---

## 1. Why this document exists

The request was to build a privacy-first memory layer with spaces, import/export, hybrid
search, a context builder, an MCP server and a dashboard. Four commits ago SprintBrain
shipped roughly a third of that. This plan closes the gap without forking the parts that
already work, and it records the decisions that are expensive to reverse later.

The reference screenshots are Plurality Network's AI Context Flow. They are used here as a
structural reference for information architecture only. No string, colour or asset is
copied. Every piece of copy in section 9 is written for SprintBrain, against
`docs/DESIGN_SYSTEM.md`.

---

## 2. What already exists (MEMORY-001, v2.168.0)

Verified against the live database and the working tree on 2026-08-23.

| Piece | Location | State |
| --- | --- | --- |
| `memory_shards` | `services/supabase/migrations/20260822000000_working_memory.sql` | Applied in prod, **0 rows** |
| `memory_steps` | same | Applied, 0 rows |
| `memory_shard_labels`, `memory_step_labels` | same | Applied, 0 rows |
| `memory_tokens` + `memory_issue_token()` | same | Applied, 0 rows |
| `app.memory_resolve_token()` | same | Unexposed schema, definer, throttled `last_used_at` |
| `memory_mcp_manifest / _index / _bodies` | `20260822010000_working_memory_resolve_once.sql` | Applied, granted to `anon`, token resolved once per call |
| Selection engine | `app/src/lib/memory/engine.ts` | Pure, zero imports, all ranking and eviction |
| Extension copy | `extension/shared/memory-pack.js` | Strict subset, no eviction |
| Parity gate | `scripts/check-memory-parity.js` | 10 fixtures plus the token estimator |
| MCP server | `services/mcp-memory/src/index.ts` | stdio, 6 read-only tools |
| Extension Context pill | `extension/content/memory-picker.js` | Mounts on 8 AI chat hosts |
| Tests | `app/src/__tests__/memoryEngine.test.ts` | vitest, runs with `npm run test` |
| Dashboard UI | none | Deliberately deferred |

Three facts from that table drive most of what follows.

**The tables are empty in production.** No user has created a shard. Schema changes to
`memory_*` carry no data-migration risk today, and that window closes the moment the
dashboard ships. Every structural change belongs before slice S2, not after.

**`engine.ts` has zero imports on purpose.** It compiles into two consumers directly (the
dashboard bundle and `services/mcp-memory`, the latter via Node type stripping) and into a
third by hand. Adding an import to it breaks the standalone server. New selection logic
goes in the same file under the same constraint, or in a new file that `engine.ts` does not
import.

**The selection rule is written twice.** `check-memory-parity.js` is the only thing keeping
the two honest. Any change to ranking, budgeting or deduplication must land in `engine.ts`
and in `memory-pack.js` and gain a fixture, in one commit.

---

## 3. Findings that change the plan

**F1. `check-memory-parity.js` does not run in CI.** `.github/workflows/ci.yml` runs eight
checks and memory parity is not among them. The workflow also pins Node 20, while the
script needs 22.18 or newer for TypeScript type stripping. The gate protecting the most
duplicated logic in the repo only runs when someone remembers to run it locally. Fixed in
S0.

**F2. `services/mcp-memory` is version-drifted.** Its `package.json` and its
`SERVER_VERSION` constant both read `2.166.0` against `2.168.0` everywhere else, because
`scripts/check-version.js` validates only `extension/manifest.json`, `app/package.json` and
the landing hero stamp. Fixed in S0.

**F3. There is no full-text search anywhere in the schema.** No `tsvector`, no `pg_trgm`,
no `unaccent`. Hybrid search is built from nothing, which is good news: there is no legacy
search behaviour to preserve.

**F4. `vector` 0.8.0 is available but not installed, and no embedding provider is wired.**
`ANTHROPIC_API_KEY` exists as an Edge Function secret, but Anthropic publishes no
embeddings endpoint. True semantic search needs a new vendor, a new secret, and every
memory body leaving the machine. That sits in direct tension with "privacy-first", so it is
isolated into the last, decision-gated slice. See D4.

**F5. Shards are personal by explicit design.** The MEMORY-001 migration argues against
folder-inherited sharing: a teammate's fact would silently steer your assistant. The
multi-tenant requirement is satisfied without contradicting that. See D2.

**F6. No GDPR deletion path exists** anywhere in the product. What ships here covers memory
only and does not pretend to be account-wide erasure.

---

## 4. Decisions

### D1. A space is a container, a shard stays the retrieval unit

`memory_spaces` is added above the existing tables. A shard belongs to exactly one space.
Ranking, budgeting and the MCP read surface keep their shape; the queries gain a space
filter.

The four content types in the request map onto one table with a `kind` column
(`fact`, `note`, `document`, `conversation`) rather than four tables. They differ in how
they arrive, not in how they are retrieved, and a single retrieval unit is what makes the
Context Builder's deduplication meaningful.

The 20,000 character body cap stays. A document larger than that is stored once in
`memory_documents` and **chunked** into shards carrying `source_id` and `chunk_index`. The
document is the source of truth; the chunk is what gets attached. Without this, one upload
silently destroys every token budget in the product.

### D2. Multi-tenant means explicit sharing, never inheritance

A space is owned by one user. Its owner may share it to the organization, read-only by
default, as a deliberate act. It is never shared by folder inheritance and never by an
`organization_id` stamp. Both of those shapes have already produced incidents in this
codebase: the one-way folder share, and the recursive-CTE RLS policy that wedged production
for about two hours on 2026-08-05.

Deny-by-default in practice:
- A new space is private. No default shares anything.
- A share grants `read`. `write` is a separate, explicit grant.
- Revoking removes the row. No residual stamp keeps access alive.
- The MCP surface never crosses into a space the token's owner cannot read.
- Link-table RLS keeps the denormalized `user_id` comparison from MEMORY-001. No access
  helper is called on a read path.

### D3. Hybrid search ships lexical first, semantic last

Arms of the hybrid:
1. **Full text**: a generated `tsvector` over name, summary and body, with `unaccent`.
2. **Trigram**: `pg_trgm` similarity on name and summary, catching typos and partial
   handles that `tsquery` misses.
3. **Metadata**: label match, `kind`, space, pinned, recency.
4. **Semantic**: pgvector cosine distance. Slice S10 only, per-space opt-in, off by
   default.

Fusion is **Reciprocal Rank Fusion** (`score = Σ 1/(k + rank_i)`, k = 60), not weighted
score blending. RRF needs no score normalisation between arms, which matters because a
`ts_rank` and a cosine distance are not comparable numbers, and it degrades cleanly when an
arm returns nothing. With embeddings off the fusion runs over three arms instead of four
and the ranking stays stable.

### D4. Embeddings are opt-in, per space, and name the provider

`memory_spaces.embedding_provider` is null by default. Enabling it is a deliberate action
in the UI that states which vendor receives the text and that existing items will be sent
for backfill. Turning it off deletes the vectors.

No provider is chosen in this plan. It is a business decision with a privacy cost, and the
first nine slices do not depend on it. When the time comes: Voyage AI `voyage-3` (1024
dimensions, the provider Anthropic documents) or OpenAI `text-embedding-3-small` (1536).
Either way the column is `vector(N)` with the dimension fixed by the model, and the model
name is stored per row so a provider change is a backfill rather than a corruption.

### D5. The Context Builder extends the engine, it does not replace it

`buildContext()` lands in `app/src/lib/memory/engine.ts` beside `enterStep()`, reusing
`attachShard` for budget accounting so both paths evict identically. The extension twin
gains the same function and the parity gate gains fixtures for it. Two selection rules in
one product is exactly what that gate exists to prevent.

Deduplication runs in two passes:
1. **Exact**: identical `content_hash` collapses. Cheap, catches re-imports and chunk
   overlap.
2. **Near**: within the candidate set only, trigram similarity above a threshold collapses
   to the highest-ranked representative. Bounded to the candidate set because an all-pairs
   comparison over a whole library does not scale and is not needed.

Collapsed ids are reported in the package, never silently dropped.

### D6. MCP writes need scoped tokens and real rate limiting

`save_memory` is the first write over MCP. Three things change:

- **Scopes**: `memory_tokens.scopes text[] not null default '{read}'`. A write tool needs a
  token minted with `write`. Existing tokens keep read-only behaviour with no backfill
  decision, because the default is the safe one.
- **Rate limiting**: the MEMORY-001 migration says Postgres cannot express it and points at
  a counter column on `memory_tokens`. That is the right answer. A fixed window
  (`window_started_at`, `window_count`, `rate_limit_per_min`) is enforced inside
  `app.memory_resolve_token`, which already writes on a throttle and is the single
  chokepoint every tool passes through.
- **One deliberate divergence**: an over-limit call raises a distinct error instead of
  returning zero rows. The zero-rows contract exists so the surface cannot confirm which
  tokens exist. A rate-limit response only ever reaches a caller who already holds a valid
  token, so it leaks nothing, and a silent empty result would make clients retry harder
  rather than back off.

### D7. Audit is append-only and content-free

`memory_audit_log` records actor, action, target id, surface (`dashboard`, `mcp`,
`extension`) and a metadata object. It never stores item bodies. Exports are logged,
because an export is the moment data leaves the product and is the one event worth
reconstructing after the fact.

### D8. Deletion is two-stage, and the second stage is real

Soft delete sets `deleted_at`, which powers the trash view. A purge hard-deletes the row
and everything referencing it: versions, embeddings, chunks, link rows, and the storage
object behind a document. The audit log keeps a tombstone naming what was purged and when,
with no content. `memory_purge_space()` and `memory_purge_all()` are the erasure entry
points. Both are irreversible and the UI says so before it runs them.

### D9. No chat panel

Screenshots 2 and 4 show a conversational assistant over the memory. That is a separate
product with its own model cost, streaming infrastructure and privacy surface, and the
requirement list does not ask for it. The same right-hand slot holds the **Context
preview** panel instead: enter a query or pick a step, see exactly the package an agent
would receive, with token accounting and deduplication visible. It answers the same user
question, which is "what does my memory actually know about this", without an LLM in the
loop.

If chat is wanted later it is a clean addition on top of `build_context`, which is the
retrieval half of it.

### D10. SBMF is line-delimited, checksummed, and secret-free

Design goals: streams without loading the archive into memory, survives partial corruption,
diffs readably, round-trips exactly.

```
SBMF/1
{"type":"header","space":{"name":"…","description":"…"},"exported_at":"…","counts":{"items":42,"versions":118},"checksum_alg":"sha256"}
{"type":"label","ref":"l1","name":"reference","color":"azure","parent":null}
{"type":"item","ref":"i1","kind":"fact","name":"…","summary":"…","body":"…","labels":["l1"],"pinned":false,"priority":0,"metadata":{},"created_at":"…","content_hash":"…"}
{"type":"version","item":"i1","version":1,"body":"…","author":"…","created_at":"…"}
{"type":"footer","items":42,"sha256":"<over every preceding line>"}
```

Rules that make it trustworthy:
- **Refs, not ids.** An archive carries no database uuid, so importing into another account
  cannot collide and cannot reveal who authored a row.
- **Never exported**: `memory_tokens` rows, audit entries, embeddings, user ids. Tokens are
  not redacted out of the export, they are not in the export surface at all. Redaction
  heuristics fail quietly; absence does not.
- **Round trip is a test, not a claim.** Export a space, import into an empty one, assert
  every body is byte-identical and every label association survives.
- `.sbmf` extension, `application/x-sbmf` on download.

The four ordinary formats are one-way conveniences over the same item model:

| Format | Export | Import |
| --- | --- | --- |
| JSON | Full item array, no versions | Accepts its own output and a flat array |
| Markdown | One `##` section per item, YAML front matter for metadata | Splits on `##`, front matter becomes metadata |
| CSV | name, kind, summary, body, labels, pinned, priority | Same header, extra columns ignored |
| TXT | Bodies separated by a rule | Whole file becomes one item |
| SBMF | Everything, including versions and the label vocabulary | Lossless |

---

## 5. Schema

New tables and the columns added to existing ones. Types and constraints follow the
conventions already set by MEMORY-001 and LABELS-001.

### 5.1 `memory_spaces`

```sql
create table public.memory_spaces (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name               text not null,
  description        text not null default '',
  ico                text not null default 'brain',      -- same keyword vocabulary as folders.ico
  -- Null means lexical search only. Set explicitly, per space, by its owner.
  embedding_provider text,
  embedding_model    text,
  is_default         boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint memory_spaces_name_not_blank check (btrim(name) <> ''),
  constraint memory_spaces_name_length    check (char_length(btrim(name)) <= 64),
  constraint memory_spaces_provider_known check (
    embedding_provider is null or embedding_provider in ('voyage', 'openai')
  )
);
```

One default space per user, created lazily on first item write. Case-insensitive unique
name per user, matching `labels` and `memory_shards`.

### 5.2 `memory_space_shares`

```sql
create table public.memory_space_shares (
  space_id        uuid not null references public.memory_spaces(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Denormalized owner, so the read policy is one comparison and calls no helper.
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  access          text not null default 'read',
  created_at      timestamptz not null default now(),
  primary key (space_id, organization_id),
  constraint memory_space_shares_access_known check (access in ('read', 'write'))
);
```

### 5.3 Columns added to `memory_shards`

```sql
alter table public.memory_shards
  add column space_id     uuid references public.memory_spaces(id) on delete cascade,
  add column kind         text not null default 'fact',
  add column metadata     jsonb not null default '{}',
  add column source_id    uuid references public.memory_documents(id) on delete cascade,
  add column chunk_index  int,
  add column content_hash text generated always as (encode(sha256(body::bytea), 'hex')) stored,
  add column search_tsv   tsvector generated always as (
    setweight(to_tsvector('simple', unaccent(coalesce(name, ''))),    'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(summary, ''))), 'B') ||
    setweight(to_tsvector('simple', unaccent(coalesce(body, ''))),    'C')
  ) stored,
  add column deleted_at   timestamptz,
  add column version      int not null default 1;
```

`space_id` is backfilled to a per-user default space and then set `not null`. In production
that backfill touches zero rows today, which is exactly why this migration must land before
the dashboard ships.

`'simple'` rather than `'english'`: SprintBrain is multilingual by design (EN, IT, ES, FR)
and an English stemmer on Italian text produces worse matches than no stemmer at all. A
per-language configuration is a later refinement, not a first cut.

### 5.4 `memory_documents`

```sql
create table public.memory_documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  space_id      uuid not null references public.memory_spaces(id) on delete cascade,
  filename      text not null,
  mime_type     text not null,
  byte_size     bigint not null,
  storage_path  text not null,          -- memory-documents/{user_id}/{uuid}.{ext}
  chunk_count   int not null default 0,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
```

Bucket `memory-documents` is **private**, unlike `company-logos`. Reads go through signed
URLs. Policies follow the established `storage.foldername(name)[1] = auth.uid()::text`
pattern.

### 5.5 `memory_shard_versions`

Mirrors `snippet_revisions`: append-only, 1-indexed, no update or delete policy, serialised
by a `for update` lock in the save function.

```sql
create table public.memory_shard_versions (
  id             uuid primary key default gen_random_uuid(),
  shard_id       uuid not null references public.memory_shards(id) on delete cascade,
  version_number int not null check (version_number > 0),
  editor_id      uuid not null references auth.users(id),
  editor_display text not null,
  name           text not null,
  summary        text not null default '',
  body           text not null,
  edit_note      text,
  created_at     timestamptz not null default now(),
  unique (shard_id, version_number)
);
```

### 5.6 `memory_audit_log`

```sql
create table public.memory_audit_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  action     text not null,    -- item.create, item.update, item.delete, item.purge,
                               -- space.share, space.unshare, export, import,
                               -- token.issue, token.revoke, mcp.call
  target_id  uuid,
  surface    text not null default 'dashboard',
  metadata   jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint memory_audit_surface_known check (surface in ('dashboard', 'mcp', 'extension'))
);
```

Own-row select only. No insert policy for `authenticated`: writes come from SECURITY
DEFINER functions and the service role, so a client cannot forge an entry.

### 5.7 Columns added to `memory_tokens`

```sql
alter table public.memory_tokens
  add column scopes             text[] not null default '{read}',
  add column rate_limit_per_min int not null default 60,
  add column window_started_at  timestamptz,
  add column window_count       int not null default 0,
  add constraint memory_tokens_scopes_known check (scopes <@ array['read','write']::text[]),
  add constraint memory_tokens_rate_sane   check (rate_limit_per_min between 1 and 6000);
```

### 5.8 Indexes

```sql
create index memory_shards_search_tsv_idx  on public.memory_shards using gin (search_tsv);
create index memory_shards_name_trgm_idx   on public.memory_shards using gin (name gin_trgm_ops);
create index memory_shards_space_live_idx  on public.memory_shards (space_id) where deleted_at is null;
create index memory_shards_hash_idx        on public.memory_shards (user_id, content_hash);
create index memory_shards_source_idx      on public.memory_shards (source_id, chunk_index);
```

Extensions required: `pg_trgm`, `unaccent`. `vector` only in S10.

---

## 6. Search and Context Builder contracts

### 6.1 `memory_search(p_query, p_space_ids, p_kinds, p_label_ids, p_limit)`

Returns `(shard_id, name, summary, kind, space_id, token_estimate, rank, matched_arms)`.
No bodies. A search result list costs names and summaries, the same economy MEMORY-001
established for the shard index.

Implementation: one CTE per arm, each producing `(id, rank)`, fused by RRF in a final
select. Metadata filters apply inside every arm rather than after fusion, so a filtered
search does not return a short list because the filter ran last.

### 6.2 `buildContext()` in `engine.ts`

```ts
export interface ContextRequest {
  budget: number;
  candidates: readonly MemoryShard[];   // already ranked by memory_search or rankForStep
  dedupe: boolean;
  minRankToInclude?: number;
}

export interface ContextPackage {
  items: Array<{ id: string; name: string; summary: string; body: string; tokens: number }>;
  usedTokens: number;
  budget: number;
  /** Dropped because the budget filled. Rank order preserved. */
  droppedForBudget: SkippedShard[];
  /** Collapsed as duplicates, each naming the representative that survived. */
  deduped: Array<{ id: string; name: string; mergedInto: string; reason: 'exact' | 'near' }>;
  /** Distinct documents the surviving chunks came from. */
  sources: Array<{ documentId: string; filename: string; chunks: number }>;
}
```

Determinism is a hard requirement, as it is for `rankForStep`: the same candidates and the
same budget always produce the same package, because an agent that gets different context
for the same query on a rerun is not debuggable.

---

## 7. MCP surface

Existing tools keep their names and behaviour. New tools:

| Tool | Scope | Notes |
| --- | --- | --- |
| `list_spaces` | read | Name, item count, whether embeddings are on |
| `search_memory` | read | Wraps `memory_search`. Returns summaries, never bodies |
| `build_context` | read | Query or step, plus a budget. Returns the package from 6.2 |
| `save_memory` | **write** | Creates or updates one item. Requires a `write` token |
| `export_space` | read | Returns SBMF as text. Logged to the audit trail |

Server-side authorization rules, unchanged in spirit from MEMORY-001:
- No tool accepts a `user_id`. Identity comes from the token alone, so there is no
  parameter to vary in order to reach another account.
- A token without `write` in `scopes` cannot reach `memory_mcp_save`, enforced in the
  function, not in the client.
- A wrong token still returns zero rows rather than an error.
- Rate limiting is enforced in `app.memory_resolve_token`, so it applies to every tool
  including ones added later.

---

## 8. Security and privacy posture

| Requirement | How it is met |
| --- | --- |
| Deny-by-default isolation | RLS on every new table, `auth.uid() = user_id` on personal rows; shares are explicit rows, never stamps or inheritance |
| No raw secret exfiltration | `memory_tokens` is outside the export surface entirely; only SHA-256 hashes are stored; plaintext is returned once at issue |
| GDPR deletion | `memory_purge_space()` and `memory_purge_all()` hard-delete rows, versions, embeddings, chunks and storage objects, leaving a content-free tombstone |
| Audit | Append-only `memory_audit_log`, no bodies, exports recorded |
| Rate limiting | Fixed window on `memory_tokens`, enforced at the single resolver chokepoint |
| Transport | Documents in a private bucket with signed URLs, not public read |

Two things this plan does **not** claim:
- It is not end-to-end encrypted. Bodies are readable by the database. Saying otherwise
  would be false, and client-side encryption would make server-side search impossible.
- Enabling embeddings sends body text to a third party. The UI says which one, before it
  happens, and the default is off.

---

## 9. Dashboard UI

New route `/memory`, sidebar entry "Memory" with the `Brain` icon and a count pill, placed
after Prompts. All copy below is final and written to `toneofvoice.md`.

### 9.1 Spaces index (`/memory`)

Structure taken from screenshot 1, rebuilt on existing components.

- `PageHeader` title "Memory", description "Facts, notes and documents your assistant can
  read."
- Tabs: All, Mine, Shared with me (`components/ui/tabs`).
- Toolbar: search input, "New space" primary button, sort control, grid and list toggle.
- Card grid: space icon, name, "N items", relative updated time, pin toggle, overflow menu
  (Rename, Share, Export, Delete).
- `EmptyState` when there are none: "No spaces yet", "A space holds the facts one kind of
  work needs. Create one and add your first note."

### 9.2 Space detail (`/memory/:spaceId`)

Structure taken from screenshot 2.

- Back link, space icon, name, role badge (Owner or Shared), share and export actions.
- Three `KpiCard` tiles: Items, Created, Storage.
- Two drop targets side by side: "Add text" and "Upload file", both dashed, matching
  `EmptyState`'s dashed border treatment.
- "Contents (N)" list with a kind filter and a Trash toggle.
- Item row: kind badge, name, size, `AssetAttribution` for who added it, summary with a
  "Show more" expander, overflow menu (Edit, History, Labels, Delete).

### 9.3 Context preview panel

Right-hand panel, 520px, matching `PromptBlockEditor`'s established side-panel pattern.
Query input, optional step selector, budget field. Shows the package: which items were
attached, which were dropped for budget, which collapsed as duplicates, and the token
total against the budget. Copy button emits the rendered pack.

### 9.4 Connect via MCP modal

Structure taken from screenshot 3, content rewritten for a stdio server.

- Command block with copy button.
- Four numbered setup steps.
- Token section: issue, name, copy once, revoke. The plaintext is shown exactly once and
  the modal says so.
- "Works with" chips: Claude Code, Claude Desktop, Cursor, Windsurf, and any MCP client.

### 9.5 Settings

New "Memory" tab in `SettingsPage`, holding token management, per-space embedding controls,
and the purge actions.

---

## 10. Slices

Each slice is independently shippable, passes the full gate set, and carries its own
version bump across all four stamps.

| Slice | Version | Contents | Done when |
| --- | --- | --- | --- |
| **S0** ✅ | 2.170.0 | Version parity for `services/mcp-memory` and `Sprintbrain.html`; `check-version.js` covers both; CI moves to Node 22 and runs `check-memory-parity.js` | Shipped. 5 stamps checked, each negative-tested; parity step in the workflow |
| **S1** ✅ | 2.171.0 | Migration: spaces, kinds, metadata, content hash, soft delete, versions table with an atomic save RPC, audit log, token scopes and rate limiting. Extension filters trashed shards | Shipped. Applied to production and verified by 23 probes inside a rolled-back transaction |
| **S2** | 2.172.0 | `/memory` route: spaces index and space detail, item CRUD via "Add text"; types, API module, store | Create, edit, trash, restore a space and an item end to end in the preview |
| **S3** | 2.173.0 | Documents: private bucket, upload, chunking into shards, `source_id` and `chunk_index`, source attribution | A 200 KB file uploads, chunks, and every chunk stays under the 20,000 character cap |
| **S4** | 2.174.0 | Version history panel over the versions written since S1 | Editing an item twice shows versions 1 and 2; restore works |
| **S5** | 2.175.0 | Import and export: JSON, Markdown, CSV, TXT, SBMF | Round-trip test asserts byte-identical bodies and preserved labels |
| **S6** | 2.176.0 | Hybrid search, lexical arms only, plus the search UI. Adds `search_tsv`, `pg_trgm`, `unaccent` | `memory_search` returns sane rankings on a seeded fixture; accent-insensitive and typo-tolerant cases covered by tests |
| **S7** | 2.177.0 | Context Builder in `engine.ts` and `memory-pack.js`, new parity fixtures, preview panel | Parity gate green with the new fixtures; determinism test passes over 100 runs |
| **S8** | 2.178.0 | MCP: `list_spaces`, `search_memory`, `build_context`, `save_memory`, `export_space` on the scopes and rate limit built in S1; Connect modal; token UI | All tools exercised from a real MCP client; over-limit call returns the back-off error |
| **S9** | 2.179.0 | GDPR purge, `memory_space_shares` and the non-owner read path, access-control UI | Purge removes every referencing row and the storage object; audit tombstone present with no body text |
| **S10** | gated | pgvector, provider integration, per-space opt-in, backfill | Only after the provider decision in D4 |

---

## 11. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Parity gate drift | Two selection rules disagree in production; the extension packs a different context than the MCP server | S0 puts the gate in CI before any engine change. Every engine edit adds a fixture |
| Structural migration after launch | `space_id not null` backfill against real rows instead of zero | S1 lands before S2. The window is open now and closes when the dashboard ships |
| Document chunking blows budgets | One upload makes every step overflow | Hard cap per chunk enforced by the existing `memory_shards_body_length` check; chunker tested at the boundary |
| RLS policy shape regression | A recursive policy on a hot read path wedged production for two hours on 2026-08-05 | Every new link table keeps the denormalized `user_id` comparison. No access helper on a read policy. Reviewed explicitly in S1 |
| `anon` grant surface grows | The MCP functions are the only `anon`-executable functions in the schema | New functions follow the same contract: no `user_id` parameter, identity from the token, zero rows on a bad token |
| Embedding provider leak | Body text reaches a third party | Off by default, per space, named in the UI, deletable |
| Search performance on large spaces | GIN index bloat, slow trigram scans | Trigram limited to name and summary; body covered by the tsvector arm only. Index advisor run in S6 |
| Node version split | CI on 20, type stripping needs 22.18+ | S0 moves CI to Node 22 |
| Parallel sessions share this working tree | A concurrent push claims the version number | Fetch and compare HEAD before every push; take the next version if claimed |

---

## 12. Open decisions

1. **Embedding provider**, or no semantic arm at all. S10 is blocked on this and nothing
   else is.
2. **Document size ceiling.** A per-space storage quota is not in this plan. Suggested
   default: 25 MB per space, 5 MB per file.
3. **Conversation import.** The `conversation` kind is defined but nothing produces it yet.
   Options: paste a transcript, or an extension capture on supported chat hosts. The second
   is a larger feature and belongs in its own ticket.
4. **Team memory.** D2 allows an owner to share a space read-only. Whether a shared space
   may be written to by teammates is a product decision, not a technical one.

---

## 13. Changes against this plan, and why

Recorded as the work lands, so the plan stays honest rather than aspirational.

**Versions shifted by one.** A concurrent session claimed 2.169.0 while S0 was in
progress. Every slice moved up. The working tree is shared, so check `origin/develop`
before assuming a version is free.

**S1 lost three things it was scoped to carry.**

- `memory_space_shares` moved wholly to S9. S1 would have created a table that granted
  nothing, since the non-owner read path was already scheduled for S9. Half a feature in
  the schema is worse than none.
- `source_id` and `chunk_index` moved to S3, where `memory_documents` exists to reference.
- `search_tsv`, `pg_trgm` and `unaccent` moved to S6, where something reads them. Adding a
  generated column later costs a table rewrite, which is why `content_hash` stayed in S1:
  deduplication and import both need it, and it is cheapest to add while the table is
  empty. The search column is a bigger object and S6 still lands before real volume.

**S1 gained one thing.** `extension/background/background.js` now filters
`deleted_at=is.null` on both memory reads. Without it, the first item anyone trashed in S2
would still have been offered by the extension's Context pill.

**Two defects found by probing, not by reading.**

- **Grants did not match either migration's stated intent.** Supabase's default privileges
  grant ALL on every new table in `public` to `authenticated`, and a GRANT is additive, so
  the explicit grant lists in MEMORY-001 and in S1 never took anything away.
  `memory_tokens` said "no INSERT" and had INSERT; `memory_shard_versions` said
  append-only and had UPDATE and DELETE. Nothing was actually exposed, because RLS refuses
  any command with no policy and cross-account isolation was verified directly, but the
  defence-in-depth layer was missing. Fixed for all eight memory tables in
  `20260823130000_memory_grants_least_privilege.sql`. **Every future migration in this
  feature must REVOKE before it GRANTs**, or the gap reopens on the next new table.
- **Restore can collide with a reused name.** The unique index on shard and space names is
  partial on `deleted_at is null`, so trashing an item frees its name. Trash "notes",
  create a new "notes", then restore the old one and the restore fails on a unique
  violation. That is the right trade (a trashed item must not squat a name), but S2's
  restore action has to detect the collision and either refuse with a clear message or
  offer a rename. It must not surface a raw database error.

**How S1 was verified.** 23 probes ran against production inside a transaction that was
rolled back by design, confirmed afterwards by every memory table still reading zero rows.
They covered the default space being created on demand, version numbering, audit entries
staying free of body text, the content hash tracking the body, the closed `kind` set, the
metadata cap, the audit action shape, token scope denial, the rate limit raising PT429, an
unknown token still yielding rows rather than an error, trashed shards disappearing from
both MCP read functions, name reuse after trashing, and cross-account isolation on both the
read path and the save RPC.
