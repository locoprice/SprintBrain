# AI Knowledge Layer — Gap Analysis and Phased Plan

**Status:** owner decisions taken 2026-10-04 (P1 first; Anthropic is acceptable; team admins approve). **P1 built in v3.58.0**, not yet live: it needs the `knowledge_feedback` migration applied, the `ask-sprintbrain` edge function deployed and `ANTHROPIC_API_KEY` set as a function secret.
**Principle:** retrieve before generating. SprintBrain stays the authoritative store; AI reads it, cites it, and never invents a company rule it cannot find.

---

## 1. Where we already are

| Spec section | Already shipped | Gap |
|---|---|---|
| 1 Recommendations | Extension Context panel ranks Brain items and snippets against the draft being typed on AI chat sites; Save to Brain suggests a Brain with a one-line reason (v3.55.0). | Not offered in ordinary web fields; no "why" line on snippet suggestions; no dashboard surface. |
| 2 Natural-language access | `knowledge_search` reads a written sentence in EN/IT/ES/FR (stems, typos, idf scoring), one view over snippets + Brain items, RLS-composed. | Returns matches, never an answer. |
| 3 MCP server | `services/mcp-memory`: read Brains by step, attach/detach, `memory_save` (write needs a write-scoped token, hashed, revocable). | Snippets not reachable from the token path (folder ACL must be re-implemented safely first); no snippet create/update; no groups or libraries. |
| 4 AI-assisted creation | `suggest-labels`, `translate-body` (Anthropic, via edge functions). | No full draft proposal (title, trigger, body, folder); no duplicate check. |
| 5 Library maintenance | Usage counts, last used, malformed flag, version history for snippets, prompts and Brain items. | No duplicate / conflict / stale / unused report. |
| 6 Approved-first answers | — | Not built. |
| 7 Human review | Version history + audit log (Brains), prompt and snippet versions. | No status lifecycle (Draft · AI generated · Under review · Approved · Deprecated · Archived); no reviewer field; no review queue. |
| 8 Data protection | RLS everywhere, least-privilege grants, hashed scoped tokens, auth + memory audit logs. Anthropic is the only AI provider; key held server-side. | No per-team AI on/off, provider allow-list, or AI-access audit trail. |
| 9 Context-aware output | Language variants per snippet. | No channel/role adaptation. |
| 10 Semantic search | Keyword + stem + typo, multilingual. | No meaning-based (embedding) search. |
| 11 Provenance | Items carry name, version, updated date. | Answers do not exist yet, so nothing cites. |
| 12 Feedback loop | — | Not built. |

## 2. Phases (each one shippable on its own)

| # | Phase | What users get | Size |
|---|---|---|---|
| **P1** | **Ask SprintBrain** + feedback | Ask a question in plain words; get an answer built only from your own snippets and Brains, each claim linked to its source, plus a clear "Nothing in SprintBrain covers this" when nothing does. Thumbs up / "wrong" / "outdated" sends the source to a review list, never edits it. | Medium |
| P2 | Status lifecycle + review queue | Every snippet, prompt and Brain item shows Draft / AI generated / Under review / Approved / Deprecated / Archived. Approved ranks first in search and answers. Admins approve. | Large (schema + all 3 sections + all surfaces) |
| P3 | AI-assisted snippet creation | Paste a conversation or document → proposed title, trigger, body, folder, labels; warns "a similar snippet exists" and offers to update it instead. Lands as AI generated, never Approved. | Medium |
| P4 | Library health | A report of likely duplicates, conflicting wording, unused and stale items, each with a suggested action that waits for a person. | Medium |
| P5 | MCP: snippets and writes | The MCP server searches snippets as well as Brains, with the same folder permissions; write tools create drafts only and require a write token. | Medium, security-sensitive |
| P6 | Semantic search | Finds the right item when the words differ ("refund" ↔ "money back"). Needs an embedding provider. | Medium + running cost |
| P7 | Team AI controls | Per-team AI switch, approved providers, AI access log, retention settings. | Medium |

Recommended order: P1 → P2 → P3 → P4 → P5, with P7 before any team beyond the founders turns AI on, and P6 when keyword search measurably misses.

## 3. Rules every phase keeps

- Answers cite their sources and separate "From SprintBrain" from "AI interpretation". No source, no company claim.
- AI never writes over existing content. It proposes; a person accepts.
- Search runs as the signed-in user (`security_invoker`); no definer-rights shortcut around folder permissions.
- Parity: snippets, prompts and Brains get the same treatment on every surface where they exist; mobile in the same release.
- Industry-neutral prompts and examples; user docs updated with each phase.

## 4. Decisions

Taken 2026-10-04:
1. P1 first.
2. Sending the matching snippets and Brain items to Anthropic to compose an answer is acceptable; the team AI switch (P7) follows later.
3. Team admins only approve content (P2).

Still open: the embedding provider for P6 (not needed for P1 to P5).

## 5. P1 as built (v3.58.0)

| Piece | Where |
|---|---|
| Answer function: search as the caller, read sources as the caller, Claude answers from them only, citations checked, no sources means no model call | `services/supabase/functions/ask-sprintbrain/index.ts` |
| Feedback table: verdict, question, answer, source snapshot, review status; author and team admins see it; only the status can change | `services/supabase/migrations/20261004120000_knowledge_feedback.sql` |
| Dashboard: "Ask SprintBrain" row in the search panel (⌘↵), answer view, feedback buttons | `app/src/features/search/{GlobalSearch,AskAnswer}.tsx`, `app/src/lib/askKnowledge.ts`, `app/src/lib/api/askApi.ts` |
| Dashboard review list | Settings > Answer feedback, `app/src/features/settings/AnswerFeedbackPanel.tsx` |
| Phone: Ask row under the Snippets, Prompts and Brains search fields, answer sheet, feedback | `app/public/mobile/index.html` |
| Gate | `scripts/check-ask-knowledge.js` (CI) |

Not in P1: the Chrome extension (popup and in-page). Prompts are not searched as answer sources, by the standing knowledge-view rule (a prompt is an instruction, not knowledge); the Ask row still appears on the Prompts page so the three sections behave the same.
