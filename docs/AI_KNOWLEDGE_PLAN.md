# AI Knowledge Layer — Gap Analysis and Phased Plan

**Status:** owner decisions taken 2026-10-04 (P1 first; Anthropic is acceptable; team admins approve). **P1 built in v3.58.0; P2 (review status) built in v3.59.0; P3 (Draft with AI) built in v3.60.0.** **Since v3.61.0 every feature that calls the AI service is locked for Pro (section 8).** Backend live since 2026-10-04: `knowledge_feedback` applied, `ask-sprintbrain` deployed, `ANTHROPIC_API_KEY` set. The dashboard and phone screens reach users with the next release of `main`.
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

Taken 2026-10-04 for P3:
4. A drafted snippet turns the details that change each time (names, dates, choices) into fill-in fields. Amounts and quantities stay as written until a number field exists (see the numeric gap in `CLAUDE.md`).
5. Draft with AI lives in the dashboard only. The phone's Add text stays a quick capture.

Still open: the embedding provider for P6 (not needed for P1 to P5).

## 5. P1 as built (v3.58.0)

| Piece | Where |
|---|---|
| Answer function: search as the caller, read sources as the caller, Claude answers from them only, citations checked, no sources means no model call | `services/supabase/functions/ask-sprintbrain/index.ts` |
| Feedback table: verdict, question, answer, source snapshot, review status; author and team admins see it; only the status can change | `services/supabase/migrations/20261004120000_knowledge_feedback.sql` |
| Dashboard: "Ask SprintBrain" row in the search panel (⌘↵), answer view, feedback buttons | `app/src/features/search/{GlobalSearch,AskAnswer}.tsx`, `app/src/lib/askKnowledge.ts`, `app/src/lib/api/askApi.ts` |
| Dashboard review list | Review > Answer feedback (moved from Settings in v3.59.0), `app/src/features/review/AnswerFeedbackPanel.tsx` |
| Phone: Ask row under the Snippets, Prompts and Brains search fields, answer sheet, feedback | `app/public/mobile/index.html` |
| Gate | `scripts/check-ask-knowledge.js` (CI) |

Not in P1: the Chrome extension (popup and in-page). Prompts are not searched as answer sources, by the standing knowledge-view rule (a prompt is an instruction, not knowledge); the Ask row still appears on the Prompts page so the three sections behave the same.

## 6. P2 as built (v3.59.0)

Owner decisions, 2026-10-04: existing content starts **approved** (no reviewer); a non-admin's edit of approved team content returns it to **under review**; **deprecated** works with a warning, **archived** stops working but stays in the dashboard.

| Piece | Where |
|---|---|
| Status columns on snippets, prompts and Brain items, the guard trigger (approver = team admin for team rows, owner otherwise; reviewer stamped server-side; moving into a team counts as a change), archived left out of the knowledge view, the MCP server and search, MCP saves marked AI generated, search reports status | `services/supabase/migrations/20261005120000_review_status.sql` |
| Statuses, words, approver rule (client mirror) | `app/src/lib/reviewStatus.ts`, `app/src/lib/useReviewApprover.ts` |
| Badge in the three lists; status menu in the three editors | `app/src/components/shared/ReviewStatus{Badge,Menu}.tsx` |
| Review page (Waiting for approval, Answer feedback) and its sidebar count | `app/src/routes/ReviewPage.tsx`, `app/src/features/review/`, `app/src/stores/reviewStore.ts` |
| Ask: approved sources first, each labelled with its status | `services/supabase/functions/ask-sprintbrain/index.ts` |
| Extension: archived left out of the expansion cache, popup, prompts and Context panel; deprecated warns on the inserted-text card, the fill form, the menu, the popup and the Context panel | `extension/background/background.js`, `extension/content/{content,memory-picker}.js`, `extension/popup/` |
| Phone: archived hidden, badges, deprecated warning on open and copy | `app/public/mobile/index.html` |
| Gate | `scripts/check-review-status.js` (CI) |

Status is filtered on the Review page rather than in each section's toolbar: Brains has no filter bar, and the three sections keep identical toolbars. Older installed extensions keep expanding archived snippets until they update.

## 7. P3 as built (v3.60.0)

Owner decisions, 2026-10-04: details that change each time (names, dates, choices) become fill-in fields, numbers stay as written; Draft with AI is dashboard only.

| Piece | Where |
|---|---|
| Draft function: pasted text → a draft snippet, prompt or Brain item; with `target_id`, the update of an existing item plus a sentence on what changed. Reads as the caller, saves nothing, files only under folders and labels the caller sent, keeps a new Brain item's text as pasted | `services/supabase/functions/draft-with-ai/index.ts` |
| `memory_save_shard` takes `p_review_status` (draft, ai_generated, under_review only), so a drafted Brain item is never approved in between | `services/supabase/migrations/20261006120000_memory_save_review_status.sql` |
| Reading a draft into editor values, unique triggers, shortcuts and Brain item names | `app/src/lib/aiDraft.ts` |
| "Already in your library": word overlap, same trigger or shortcut, same name; one check for all three kinds, in the browser | `app/src/lib/draftSimilar.ts` |
| Draft from text button and the notice, shared by the three editors; Update it instead hands the update to the existing item's editor | `app/src/components/shared/DraftWithAi.tsx`, `app/src/stores/draftStore.ts` |
| New items from a draft created as ai_generated in the same write | `snippetsApi.createSnippet`, `promptsApi.createPrompt`, `memoryApi.saveItem` |
| Brain item links: `/memory/<space>?item=<id>` opens the item (Review page, Update it instead) | `app/src/routes/MemorySpacePage.tsx` |
| Gate | `scripts/check-ai-draft.js` (CI) |

An update made with Update it instead follows the normal review rules rather than being marked AI generated: the person saving it has read it, and a non-admin's save of approved team content already returns it to under review. Its trigger or shortcut, folder and labels are kept, because people already type that trigger and language variants are grouped by it.

Not in P3: the extension and the phone (owner decision); a per-team AI switch (P7).

## 8. Pro lock (v3.61.0)

Owner decision, 2026-10-06: until the Pro plan exists, every feature that calls the AI service shows an icon with the tooltip "Available to Pro users soon" and cannot run. The first real drafts had just failed because the Anthropic account had no credit, and signups are open, so anyone could spend the credit.

| Piece | Where |
|---|---|
| One switch per feature (`ask`, `draft`, `translate`, `labels`), all off; the label | `app/src/lib/proFeatures.ts` |
| The lock, the tooltip wrapper and the dimmed look, shared by every locked control | `app/src/components/shared/ProSoon.tsx` |
| Entry points: Draft from text in the three editors (one shared component), the Ask row and its shortcut in the search panel, Translate from EN and Suggest labels in the snippet editor | `components/shared/DraftWithAi.tsx`, `features/search/GlobalSearch.tsx`, `features/snippets/NewSnippetDialog.tsx`, `features/labels/LabelSuggestions.tsx` |
| Phone: the Ask row on the Snippets, Prompts and Brains pages (the label shows in plain sight, a tap says it) | `app/public/mobile/index.html` (`ASK_AVAILABLE`) |
| Gate: one label everywhere, the phone follows the dashboard, every entry point reads its switch, requests leave from one place only, the manual follows the switches | `scripts/check-pro-gate.js` (CI) |
| How to switch a feature on, and the manual lines to restore | `docs/pro-features/README.md` |

The server functions are unchanged and still callable by anyone signed in. The lock is in the interface; the plan check that makes it a real limit belongs with the Pro plan.
