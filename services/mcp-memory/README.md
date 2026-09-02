# SprintBrain working memory (MCP)

An MCP server that gives an AI assistant a working memory it can swap as the
work moves between steps. Facts are stored as individually addressable shards.
A step declares which labels it needs. The server attaches only those shards,
inside a token budget, and evicts the least recently used ones when the budget
fills.

The point is what it does **not** send. Listing 200 shards costs a few hundred
tokens of names and summaries. Bodies are fetched only for shards the budget
admits, and entering a step returns only the bodies that were newly attached, so
a step change costs the tokens the step introduces rather than the tokens of
everything it needs.

## Requirements

- Node 22.18 or newer. The server runs TypeScript directly via Node's native
  type stripping, so there is no build step.
- The `MEMORY-001` migration applied:
  `services/supabase/migrations/20260822000000_working_memory.sql`.

## Install

```bash
cd services/mcp-memory
npm install
```

## Get a token

The server is headless, so it has no browser session to inherit. It
authenticates with a personal access token that carries your identity and
nothing else.

Run this as your logged-in user, in the Supabase SQL editor or from the
dashboard:

```sql
select * from public.memory_issue_token('laptop mcp');
```

Copy the `token` column. It is shown once and only its SHA-256 hash is stored,
so a lost token is reissued, never recovered.

To see or revoke what you have issued:

```sql
select id, name, prefix, created_at, last_used_at, revoked_at from public.memory_tokens;
update public.memory_tokens set revoked_at = now() where id = '<id>';
```

## Connect it

Add this to your MCP client config. For Claude Code that is `.mcp.json` in the
project root, for Claude Desktop it is `claude_desktop_config.json`.

```json
{
  "mcpServers": {
    "sprintbrain-memory": {
      "command": "node",
      "args": ["C:/Users/averd/Desktop/Claude Projects/SprintBrain/services/mcp-memory/src/index.ts"],
      "env": {
        "SPRINTBRAIN_MEMORY_TOKEN": "sbmw_..."
      }
    }
  }
}
```

`SPRINTBRAIN_SUPABASE_URL` and `SPRINTBRAIN_SUPABASE_ANON_KEY` default to the
production project and only need setting to point at a branch database.

## Set up steps and shards

Nothing is seeded. Steps are your own vocabulary, and shipping one industry's
phase names into every account would break the industry-neutral rule in
`CLAUDE.md`. The example below uses generic phases. Replace them with whatever
your work actually has.

```sql
-- 1. Labels. Reuses the vocabulary snippets and prompts already share,
--    so renaming one here renames it everywhere.
insert into public.labels (name, color) values
  ('reference', 'azure'),
  ('procedure', 'teal'),
  ('constraint', 'rose');

-- 2. Steps, each with its own budget.
insert into public.memory_steps (key, name, token_budget, sort_order) values
  ('research', 'Research', 4000, 0),
  ('draft',    'Draft',    3000, 1),
  ('review',   'Review',   2000, 2);

-- 3. Which labels each step wants. Weight ranks the shards, it does not
--    filter them: eligibility is a union over the step's labels.
insert into public.memory_step_labels (step_id, label_id, weight)
select s.id, l.id, 2
from public.memory_steps s, public.labels l
where s.key = 'research' and l.name = 'reference';

-- 4. A shard. `pinned` means always attached and never evicted.
insert into public.memory_shards (name, summary, body, pinned, priority) values
  ('house-style', 'How output should be written', 'Short sentences. No filler.', true, 0);

-- 5. Tag it.
insert into public.memory_shard_labels (shard_id, label_id)
select m.id, l.id
from public.memory_shards m, public.labels l
where m.name = 'house-style' and l.name = 'reference';
```

Keep a shard to one fact. The body is capped at 20,000 characters because
anything larger is a document, and no budget survives attaching one.

## Tools

| Tool | What it does |
|---|---|
| `memory_steps` | Lists steps, budgets, and how many labels each requires. |
| `memory_index` | Lists shards as name, summary and token cost. No bodies. Pass a `step` to see only what it would attach, in rank order. |
| `memory_enter_step` | Switches to a step. Returns the bodies of newly attached shards only. |
| `memory_attach` | Attaches one shard by name or id, outside the step's selection. |
| `memory_detach` | Detaches one shard, freeing its tokens. |
| `memory_state` | What is attached and how much budget it uses. `include_bodies` re-reads the full pack. |

## How selection works

A shard is eligible for a step if it carries **any** of that step's labels. The
weights of the matching labels sum into its score, and the ranking is score,
then `priority`, then name. It is fully deterministic: the same shards and the
same step always produce the same pack, because an agent that gets a different
context for the same step on a rerun is not debuggable.

Filling then follows that ranking until the budget is reached.

- **Pinned** shards attach to every step and are never evicted. If pins alone
  exceed a budget they are attached anyway and the overrun is reported, because
  silently dropping a fact marked always-on is the worse failure.
- **Step** attachments are dropped when the step changes.
- **Manual** attachments survive a step change, since something asked for them
  on purpose. They remain evictable under budget pressure.

Token counts are `ceil(characters / 4)`, computed by a generated column in
Postgres and by `estimateTokens()` in `app/src/lib/memory/engine.ts`. The two
must stay in lockstep. It is crude on purpose: budgeting needs a number that is
stable, cheap and identical on both sides of the wire, and a real tokenizer
cannot run inside a generated column. Treat a budget as approximate.

## Where the logic lives

Ranking, budgeting and eviction are in `app/src/lib/memory/engine.ts`, which
this server compiles directly rather than reimplementing. That file has no
imports at all, which is what lets both the dashboard bundle and this standalone
process use it without a shared package. Tests are in
`app/src/__tests__/memoryEngine.test.ts` and run with the rest of the dashboard
suite:

```bash
cd app && npm run test
```

## Security notes

- Three functions are granted to `anon`: `memory_mcp_manifest`,
  `memory_mcp_index` and `memory_mcp_bodies`. None of them accepts a user id.
  Identity comes from the token alone, so there is no parameter to vary in order
  to read someone else's rows. A wrong token returns zero rows rather than an
  error, so the surface does not confirm which tokens exist.
- Shards are personal and are not shared through folders. A shard is background
  knowledge injected into someone's model context, and inherited org-wide
  sharing would mean a teammate's fact silently steering your assistant.
- Request-rate limiting is not implemented. These calls ride the platform's API
  gateway limits. If abuse appears, add a counter column to `memory_tokens`.

## The same memory in the browser

The Chrome extension reads the same shards and steps. On a supported AI chat
site it mounts a "Context" pill next to the prompt box: pick a step and the
shards it wants are prepended to what you have typed, inside the step's budget.

Two differences from this server, both deliberate:

- **No token.** The extension has the user's own session, so it queries
  `memory_shards` and `memory_steps` directly and RLS decides what it sees. The
  `memory_mcp_*` functions exist for headless clients that have no session. A
  browser extension must not carry a shared secret it does not need.
- **No eviction.** The picker is one-shot, so it ranks and fills an empty budget
  and stops. Attach, detach and LRU only matter across a long agent session.

The selection rule is implemented twice, since the extension has no build step
and cannot import TypeScript: `app/src/lib/memory/engine.ts` is the authority
and `extension/shared/memory-pack.js` is the copy. `node
scripts/check-memory-parity.js` runs both over the same fixtures and fails the
commit if a single pack differs. Change one, change the other.
