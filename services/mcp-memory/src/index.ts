#!/usr/bin/env node
// SprintBrain working memory over MCP (MEMORY-001).
//
// The orchestrator. It holds one WorkingMemory for the life of the process and
// exposes the attach/detach cycle as tools, so the agent driving a task can
// swap its own context as the work moves between steps.
//
// The shape that makes this worth doing: the shard INDEX is cheap (names,
// summaries, token costs, labels) and shard BODIES are not. The index is
// fetched once; bodies are fetched only for shards the budget actually admits,
// and memory_enter_step returns only the bodies that were newly attached. A
// step change costs the tokens the step introduces, not the tokens of
// everything it needs.
//
// Ranking, budgeting and eviction are not implemented here. They live in
// app/src/lib/memory/engine.ts, which this file compiles directly rather than
// re-implementing, so the dashboard preview and the server can never disagree.
//
// stdout belongs to the MCP protocol. Every diagnostic goes to stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  attachShard,
  createWorkingMemory,
  detachShard,
  enterStep,
  isAttached,
  rankForStep,
  renderPack,
  usedTokens,
  type MemoryShard,
  type MemoryStep,
} from '../../../app/src/lib/memory/engine.ts';

import {
  configFromEnv,
  fetchBodies,
  fetchIndex,
  fetchManifest,
  type SupabaseConfig,
} from './supabase.ts';

const SERVER_NAME = 'sprintbrain-memory';
const SERVER_VERSION = '2.172.0';

/** Budget before any step has been entered. Replaced by the step's own budget on the first transition. */
const DEFAULT_BUDGET = 4000;

const config: SupabaseConfig = configFromEnv(process.env);

/**
 * Session state.
 *
 * `shards` holds one object per shard with an EMPTY body until it is hydrated.
 * The engine never reads `body` outside renderPack, and token accounting comes
 * from the DB's token_estimate rather than body length, so ranking and
 * budgeting are correct before a single body has been fetched. hydrate() fills
 * the bodies in place, and because the working memory holds references to these
 * same objects, an attached shard gains its text without being re-attached.
 */
const shards = new Map<string, MemoryShard>();
const steps = new Map<string, MemoryStep>();
const hydrated = new Set<string>();
const memory = createWorkingMemory(DEFAULT_BUDGET);

let indexLoaded = false;

async function loadIndex(force = false): Promise<void> {
  if (indexLoaded && !force) return;
  const rows = await fetchIndex(config);
  shards.clear();
  hydrated.clear();
  for (const row of rows) {
    shards.set(row.id, {
      id: row.id,
      name: row.name,
      summary: row.summary,
      body: '',
      tokens: row.token_estimate,
      labelIds: row.label_ids ?? [],
      pinned: row.pinned,
      priority: row.priority,
    });
  }
  indexLoaded = true;
}

/** MemoryStep with a mutable label array, so the flat manifest can be folded into it. */
interface StepBuilder {
  key: string;
  name: string;
  tokenBudget: number;
  labels: Array<{ labelId: string; weight: number }>;
}

async function loadSteps(force = false): Promise<void> {
  if (steps.size > 0 && !force) return;
  const rows = await fetchManifest(config);
  const building = new Map<string, StepBuilder>();

  for (const row of rows) {
    let target = building.get(row.step_key);
    if (!target) {
      target = { key: row.step_key, name: row.step_name, tokenBudget: row.token_budget, labels: [] };
      building.set(row.step_key, target);
    }
    // The manifest is a flat join, so a step with three labels arrives as three
    // rows and a step with none arrives as one row with null label columns.
    if (row.label_id) {
      target.labels.push({ labelId: row.label_id, weight: row.weight ?? 1 });
    }
  }

  steps.clear();
  for (const [key, built] of building) steps.set(key, built);
}

/** Fetch bodies for ids that do not have one yet, assigning them onto the cached shard objects. */
async function hydrate(ids: readonly string[]): Promise<void> {
  const missing = ids.filter((id) => !hydrated.has(id) && shards.has(id));
  if (missing.length === 0) return;

  const rows = await fetchBodies(config, missing);
  for (const row of rows) {
    const shard = shards.get(row.id);
    if (!shard) continue;
    shard.body = row.body;
    hydrated.add(row.id);
  }
}

function resolveShard(reference: string): MemoryShard | null {
  const byId = shards.get(reference);
  if (byId) return byId;
  const needle = reference.trim().toLowerCase();
  for (const shard of shards.values()) {
    if (shard.name.toLowerCase() === needle) return shard;
  }
  return null;
}

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function nameOf(id: string): string {
  return shards.get(id)?.name ?? id;
}

function namesOf(ids: readonly string[]): string {
  return ids.length === 0 ? 'none' : ids.map(nameOf).join(', ');
}

function accounting(): string {
  const used = usedTokens(memory);
  const over = used > memory.budget ? '  OVER BUDGET' : '';
  return `${used}/${memory.budget} tokens${over}`;
}

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

server.registerTool(
  'memory_steps',
  {
    title: 'List memory steps',
    description:
      'List the configured steps, their token budgets and the labels each one requires. Call this first to find out which step keys memory_enter_step accepts.',
    inputSchema: {
      refresh: z.boolean().optional().describe('Re-read the manifest from the database instead of using the cached copy.'),
    },
  },
  async ({ refresh }) => {
    await loadSteps(refresh === true);
    if (steps.size === 0) {
      return text('No steps configured. Create them in the dashboard, or with the example SQL in services/mcp-memory/README.md.');
    }
    const lines = [...steps.values()].map(
      (step) => `- ${step.key} (${step.name}): budget ${step.tokenBudget} tokens, ${step.labels.length} label(s)`,
    );
    return text(`Steps:\n${lines.join('\n')}`);
  },
);

server.registerTool(
  'memory_index',
  {
    title: 'List memory shards',
    description:
      'List available shards as name, summary and token cost, without any bodies. Pass a step key to see only what that step would attach, in rank order. This is the cheap call: use it to decide what is worth attaching before spending tokens on bodies.',
    inputSchema: {
      step: z.string().optional().describe('Step key. Restricts the listing to shards eligible for that step, best first.'),
      refresh: z.boolean().optional().describe('Re-read the index from the database instead of using the cached copy.'),
    },
  },
  async ({ step, refresh }) => {
    await loadIndex(refresh === true);
    if (shards.size === 0) return text('No shards yet.');

    let listing = [...shards.values()];
    let header = `${listing.length} shard(s)`;

    if (step) {
      await loadSteps();
      const target = steps.get(step);
      if (!target) return text(`Unknown step "${step}". Call memory_steps for the list.`);
      listing = rankForStep(listing, target);
      header = `${listing.length} shard(s) eligible for "${step}", best first (budget ${target.tokenBudget})`;
    }

    const lines = listing.map((shard) => {
      const flags = [shard.pinned ? 'pinned' : null, isAttached(memory, shard.id) ? 'attached' : null]
        .filter(Boolean)
        .join(', ');
      return `- ${shard.name} [${shard.tokens}t${flags ? `, ${flags}` : ''}] ${shard.summary}`;
    });
    return text(`${header}:\n${lines.join('\n')}`);
  },
);

server.registerTool(
  'memory_enter_step',
  {
    title: 'Switch working memory to a step',
    description:
      'Move working memory to a step: detach what the step does not need, keep what it does, and attach the rest in rank order until the budget is full. Returns ONLY the bodies of newly attached shards, because shards that were already attached are already in your context. Call this whenever the task moves to a new phase.',
    inputSchema: {
      step: z.string().describe('Step key, from memory_steps.'),
    },
  },
  async ({ step }) => {
    await Promise.all([loadIndex(), loadSteps()]);
    const target = steps.get(step);
    if (!target) return text(`Unknown step "${step}". Call memory_steps for the list.`);

    const result = enterStep(memory, target, [...shards.values()]);
    await hydrate(result.attached);

    const parts: string[] = [
      `Step: ${target.name} (${result.stepKey})  ${accounting()}`,
      `Attached ${result.attached.length}, kept ${result.kept.length}, detached ${result.detached.length}.`,
    ];
    if (result.detached.length > 0) parts.push(`Detached: ${namesOf(result.detached)}`);
    if (result.kept.length > 0) parts.push(`Still attached from before: ${namesOf(result.kept)}`);
    if (result.evicted.length > 0) parts.push(`Evicted for budget: ${namesOf(result.evicted)}`);
    if (result.skipped.length > 0) {
      parts.push(`Did not fit: ${result.skipped.map((s) => s.name).join(', ')}. Raise the step budget or split these shards.`);
    }
    if (result.overBudget) {
      parts.push('Pinned shards alone exceed this budget. They are attached anyway; unpin something or raise the budget.');
    }

    if (result.attached.length === 0) {
      parts.push('\nNo new bodies to read.');
      return text(parts.join('\n'));
    }

    const bodies = result.attached.map((id) => {
      const shard = shards.get(id);
      if (!shard) return `## ${id}\n(missing from index)`;
      if (!shard.body) return `## ${shard.name}\n(body could not be loaded)`;
      return `## ${shard.name}\n${shard.body}`;
    });

    parts.push(`\nNewly attached:\n\n${bodies.join('\n\n')}`);
    return text(parts.join('\n'));
  },
);

server.registerTool(
  'memory_attach',
  {
    title: 'Attach one shard',
    description:
      'Attach a single shard by name or id, outside whatever the current step selected. Evicts least-recently-used shards if the budget requires it. A manual attachment survives the next step change, unlike a step selection.',
    inputSchema: {
      shard: z.string().describe('Shard name or id.'),
    },
  },
  async ({ shard: reference }) => {
    await loadIndex();
    const shard = resolveShard(reference);
    if (!shard) return text(`No shard named "${reference}". Call memory_index for the list.`);

    const result = attachShard(memory, shard, 'manual');
    if (!result.attached) {
      return text(
        `Could not attach "${shard.name}" (${shard.tokens} tokens): it does not fit in ${memory.budget} and nothing else is evictable. ${accounting()}`,
      );
    }

    await hydrate([shard.id]);
    const evicted = result.evicted.length > 0 ? `\nEvicted: ${namesOf(result.evicted)}` : '';
    return text(`Attached ${shard.name}.  ${accounting()}${evicted}\n\n## ${shard.name}\n${shard.body}`);
  },
);

server.registerTool(
  'memory_detach',
  {
    title: 'Detach one shard',
    description:
      'Detach a shard by name or id, freeing its tokens. Use when a fact has served its purpose and the budget is needed elsewhere.',
    inputSchema: {
      shard: z.string().describe('Shard name or id.'),
    },
  },
  async ({ shard: reference }) => {
    await loadIndex();
    const shard = resolveShard(reference);
    if (!shard) return text(`No shard named "${reference}".`);
    if (!detachShard(memory, shard.id)) return text(`"${shard.name}" was not attached.`);
    return text(`Detached ${shard.name}.  ${accounting()}`);
  },
);

server.registerTool(
  'memory_state',
  {
    title: 'Inspect working memory',
    description:
      'What is attached right now, and how much of the budget it uses. Returns names and token costs by default; pass include_bodies to re-read the full pack, for example after a context compaction.',
    inputSchema: {
      include_bodies: z.boolean().optional().describe('Return the full text of every attached shard, not just the listing.'),
    },
  },
  async ({ include_bodies }) => {
    const pack = renderPack(memory);
    if (pack.shards.length === 0) {
      return text(`Nothing attached.  ${accounting()}\nCall memory_enter_step to load a step.`);
    }

    if (include_bodies === true) await hydrate(pack.shards.map((s) => s.id));

    const header = `Step: ${pack.stepKey ?? 'none'}  ${accounting()}`;
    const lines = pack.shards.map((s) => `- ${s.name} [${s.tokens}t${s.pinned ? ', pinned' : ''}] ${s.summary}`);

    if (include_bodies !== true) return text(`${header}\n${lines.join('\n')}`);

    const bodies = pack.shards.map((s) => `## ${s.name}\n${shards.get(s.id)?.body ?? s.body}`);
    return text(`${header}\n${lines.join('\n')}\n\n${bodies.join('\n\n')}`);
  },
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
  process.stderr.write(`${SERVER_NAME} v${SERVER_VERSION} ready on stdio\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${SERVER_NAME}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
