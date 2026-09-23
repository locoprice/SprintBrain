# Memory Injection Engine: architecture at scale

**Status**: design. Step A (§7) implemented for v3.28.0. Where the build departed from this
design, the section concerned says so and why.
**Extends**: `docs/MEMORY_INJECTION_DESIGN.md`, which specified the v1 that shipped as I1
(v3.22.0). Every principle in `docs/MEMORY_002_PLAN.md` still binds: one knowledge layer,
single selection authority, composed authorization, prompts are not context.
**Written against**: the live database and the working tree at v3.25.1.

---

## 0. The finding that reframes the problem

The library is not 115 snippets. It is **72 facts**, some of them written four times.

| Measured in production | Value |
| --- | --- |
| Active snippet rows | 115 |
| Distinct facts behind them (`lang_group_id`) | 72 |
| Facts stored in more than one language | 15 |
| Token weight of every variant | 11,093 |
| Token weight of one variant per fact | 8,250 |
| **Redundant share** | **25.6%** |

`AEROPORTO` is one message in EN, ES, FR and IT, four rows sharing
`lang_group_id = s1776669227543vw8`. `informazioni varie` is one fact in three languages.

**The retrieval layer cannot see this.** `app.knowledge_index` projects `snippets` without
`lang_group_id` and without `lang`, so `knowledge_search` returns four independent candidates
for one fact. The panel lists them as four separate choices and pre-checks all four. Then
`buildContext`'s near-duplicate pass compares their bodies with trigrams, and because the four
bodies are in **different languages** their trigram overlap is low, so nothing collapses.

The aggregate understates it. A query that matches a four-variant fact matches all four
variants equally well, so they arrive adjacent at the top of the ranking. For those queries the
local waste is not 25%, it is closer to 75% of the tokens spent on that fact.

This is the single largest efficiency defect in the engine today, it is entirely deterministic
to fix, and the signal needed to fix it already exists and is simply not consulted. Step A fixes
it on the client, not in the view: see the correction under Change 1.

Everything below is organised around one idea: **the unit of selection must be the fact, not
the row.**

---

## 0b. The search never read a draft (found 2026-09-18)

A second finding, larger than the first, and made by running the real search on a real library
rather than feeding the panel prepared results.

`knowledge_search` built its full-text query with `websearch_to_tsquery`, which joins every word
with AND, function words included. A draft such as "scrivi al cliente che sono in aeroporto e
rispondo appena posso" became `'scrivi' & 'al' & 'cliente' & 'che' & ...`. No item contains every
word of a sentence, so every real draft returned nothing, and the trigram arm, which compared the
whole sentence to each title, matched nothing either. One or two bare keywords worked, which is
why the original fixtures passed. Four ordinary drafts in three languages all returned zero,
including one describing an existing snippet almost word for word. The panel could only ever
offer a recency browse.

Replaced in `20260918120000_knowledge_search_natural_drafts.sql`, same signature and shape:

| Step | Rule |
| --- | --- |
| Content words | Unaccented, split on non-alphanumerics, 3+ characters, minus the stop words of the Italian, Spanish, English and French stemmers Postgres ships |
| Word forms | The shortest stem across the four languages, matched as a prefix when it has 4+ characters (recibido finds RECIBO); shorter words exactly or with an s |
| Scoring | Sum of idf squared over the words an item contains; title matches count double; body matches are scaled by the length of one language, so a snippet storing four translations is not penalised |
| Typos | A word matching nothing may match a title that reads almost the same (aeropoto finds AEROPORTO) |
| Gate | Score at least 8 and at least half the best, and either a title match or two different words of the draft |
| Languages | The view gained `search_text`: every language a snippet holds, not only its primary body |

`rank` is now that score, not a reciprocal-rank fusion. The panel pre-selects only facts within
0.8 of the best score (`preselect` in `memory-picker.js`); looser matches are listed unticked.

Measured on the same library afterwards: the right item first for 11 of 12 drafts, and nothing for
"ciao come stai", which is the correct answer. About 40 ms per search at 106 items. The function
computes every item's text vector per query, so at thousands of items it will need a stored,
indexed vector over `search_text`: noted, not yet needed.

Still lexical. A draft in English cannot find a snippet whose English wording shares none of its
words, and a role word like cliente still pulls in the odd loosely related reply, which is why
those are listed unticked rather than hidden. Meaning, as opposed to wording, needs the semantic
arm (step H) and its vendor decision.

---

## 1. The ideal architecture

The shape that shipped is right. Three structural changes, none of which is a rewrite.

```
   snippets (folder ACL)        memory_shards (personal RLS)
            │                              │
            └──────────────┬───────────────┘
                           ▼
              app.knowledge_index   VIEW, security_invoker
              + identity columns it currently drops:
                container_id · updated_at · content_hash
              (translation grouping comes from the client, see Change 1)
                           │
                           ▼  SQL: filter, coarse rank, RRF fuse
              public.knowledge_search  → ids, scores, summaries, NO bodies
                           │
                           ▼  TS/JS: the single selection authority
              ┌────────────────────────────────────────────┐
              │  1. CLUSTER    rows → facts        ← NEW    │
              │  2. GATE       absolute + relative ← CHANGED│
              │  3. RANK       relevance × source weight    │
              │  4. RESOLVE    supersession        ← NEW    │
              │  5. FILL       budget, compress             │
              └────────────────────────────────────────────┘
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
         browser renderer       MCP renderer
         (composer adapters)    (structured package)
```

### Change 1. The view must carry identity, not just content

The view projects what an item *says* and drops what an item *is*. Add, per row:

| Column | Source | Why the engine needs it |
| --- | --- | --- |
| `content_hash` | `memory_shards.content_hash` / null | Exact-duplicate fast path |
| `container_id` | already present | Source weighting and project awareness |
| `updated_at` | already present, not returned by search | Supersession and recency tiebreak |

`knowledge_search` returns them. They cost nothing: the view already reads these rows.

> **Correction, made while building step A.** This table originally also proposed `group_id`
> (`coalesce(snippets.lang_group_id, id)`) and `lang` as view columns. That would have been
> wrong, though not visibly on today's data. The product already has ONE definition of "the same
> snippet in several languages", in `extension/shared/snippet-stats.js`, used by expansion, the
> popup, `Sprintbrain.html` and mobile: rows join by `lang_group_id` **and** by trigger base,
> transitively, and never across owners. Grouping by `lang_group_id` alone would have been a
> second, weaker copy of that rule. Measured on 2026-09-16 both give the same 72 facts, so the
> difference is latent: it appears the first time two translations are linked by trigger only.
>
> So grouping happens on the client, where that rule already runs over the local library the
> extension keeps for expansion. `content.js` answers "which fact is this snippet, and what are its
> translations" through the same functions a trigger expands through, and the engine collapses by
> the key it is given. No view change, no migration, and the panel can never disagree with a
> trigger about what one snippet is.

**`snippets` has no `content_hash` column.** Only `memory_shards` does. So exact dedup is
structurally unavailable for the larger half of the library, and near-dedup carries the whole
load there. Either add a generated hash column to `snippets` or accept that snippet dedup is
always fuzzy. Recommendation: add it, generated, because a generated column is free to
maintain and the alternative is a fuzzy comparison doing work an equality check could do.

### Change 2. Deduplication moves before the user sees the list

Today dedup runs inside `buildContext`, on bodies, **after** the user has ticked boxes. So the
panel shows duplicates as independent choices, the user spends budget on them, and the toast
reports the merge afterwards. That is the wrong order: the panel is where the user decides, so
the panel must already show facts.

Clustering by translation group needs no bodies and can therefore run on the search result,
before render. Shipped in step A. Exact-hash collapse likewise. Only genuine near-duplicate detection between *different*
facts still needs bodies, and that stays where it is.

### Change 3. One engine file, not two

This is the change with the largest long-term effect and the least visible short-term payoff.

The selection rule is written twice: `app/src/lib/memory/engine.ts` is the authority and
`extension/shared/memory-pack.js` is a hand-mirrored copy, held together by
`scripts/check-memory-parity.js`. The stated reason is that the extension has no build step and
cannot import TypeScript.

The reason is real but the conclusion does not follow. `engine.ts` already has **zero imports**,
a constraint it carries specifically so several runtimes can consume it. The only thing forcing
duplication is the *language*, not the architecture. Authored as plain JavaScript with JSDoc
types and `checkJs`, one file could be loaded directly by the extension through the manifest,
imported by the dashboard bundle, and compiled by the MCP server, exactly as today, with the
type safety the dashboard build relies on preserved.

That would delete `memory-pack.js`, delete the parity gate, and halve the cost of every change
described in this document.

**The parity gate is also weaker than it looks, and this project has the evidence.** In v3.25.1
both implementations returned 1.0 when comparing two empty bodies. They agreed perfectly, the
gate stayed green, and every body-less candidate in a package collapsed into whichever ranked
first. A gate that proves two things agree cannot prove they agree on the right answer. The fix
added absolute assertions beside the parity check, which is the correct patch, and it is also an
argument that the thing being guarded should not exist in duplicate.

Against: it is a refactor with no user-visible benefit, it touches the code that decides what
enters someone's model context, and the parity gate does catch genuine one-sided drift. It
should be done deliberately, with the existing fixtures kept and run against the merged file,
not squeezed in beside a feature.

---

## 2. The pipeline, stage by stage

### Stage 0. Query construction (deterministic)

The draft is the query. Already shipped: last 600 characters, injected block stripped first so
the context never ranks itself.

Two additions worth making, both deterministic and both cheap:

- **Language of the draft.** Detect it from the draft text, then prefer the matching variant
  inside a cluster. Writing in Italian should pull the Italian body. **Not in step A.** The only
  detector in the product is `app/src/lib/languageDetect.ts`, dashboard TypeScript the extension
  cannot load. Bringing it over means either a hand-mirrored twin, the duplication Change 3
  argues against, or a TS-to-JS generator with its own gate. Step A uses the user's default
  language instead, the order expansion already follows, with a one-click switch in the panel.
  Rank cannot stand in for detection: see stage 2.
- **Named container match.** If the draft contains a token matching a space or folder name,
  boost that container. This is the honest version of "project awareness": no inference, just a
  name match, and it degrades to nothing when there is no match.

Neither is intent classification. Real intent detection needs semantics, and the deterministic
substitute for it is a well-built query plus good ranking. Calling a keyword match "intent"
would be overselling it.

### Stage 1. Candidate generation (SQL, unchanged in shape)

`knowledge_search(query, kinds, label_ids, container_ids, limit)`. FTS plus trigram, fused with
Reciprocal Rank Fusion at k = 60. Returns ids, scores, summaries, plus the new identity columns.

At 1,000 items `limit = 40` stops being enough, because 40 rows may be only 12 facts once
clustered. **Fetch a row budget, not a fact budget**: request enough rows to yield a target
number of facts, roughly `limit = target_facts × expected_variants`, capped. Cheap, because rows
are ids and summaries.

### Stage 2. Cluster (new, deterministic)

Group by the product's translation rule (see Change 1). Each cluster becomes one candidate fact
carrying:

- the best rank among its variants, because that rank belongs to the fact,
- the variant chosen for injection: the first of the user's default language, then EN, ES, IT,
  FR, among **every** translation the fact has, including ones the search did not match,
- the other variants, listed and switchable but never injected together.

One fact, one row in the panel, one entry in the budget.

**Why not the best-ranked translation.** It looks like free language detection: an Italian draft
should match the Italian body best. It is not reliable, for a structural reason. Both search arms
number their results with `row_number()` ordered by score and then by `source_id`, so translations
that match equally (a title match scores every translation the same, because they share a title)
still receive distinct, strictly ordered ranks. The difference between two translations' ranks
is often an artifact of their ids, not evidence of the draft's language. Choosing by it would make
the language appear to change at random. Built as `clusterCandidates` in `engine.ts` and
`memory-pack.js`, with `groupKey` supplied by the caller.

### Stage 3. Gate (changed)

The current floor is `DEFAULT_MIN_RANK = 1/75`, the RRF score of something ranked 15th by a
single arm. **That is a relative cut, not a quality cut.** RRF scores encode position, not
similarity, so "15th best" means something quite different in a library of 100 and a library of
1,000. The floor does not tighten as the library grows; it admits progressively weaker matches.

At scale the gate needs two tests, and a candidate must pass both:

- **Relative**: the existing RRF floor, which keeps the long tail out.
- **Absolute**: a minimum `ts_rank` or trigram similarity from the arm that matched. A candidate
  that matched one uncommon word in a 3,000 word body is noise regardless of where it ranked.

The absolute threshold is the harder number to choose and should be calibrated against the real
library rather than guessed. It is also the one that decides whether the panel stays honest as
the library grows.

The browse exemption stays: an empty draft ranks everything zero, and a browse is not filtered
by relevance. It is also never pre-selected, which is the v3.25.1 behaviour.

### Stage 4. Resolve conflicts (new, partly deterministic)

Three distinct cases, and only the first two are solvable without semantics.

| Case | Signal | Action |
| --- | --- | --- |
| Same fact, many languages | the translation group | Collapse in stage 2. Not a conflict |
| Same fact, edited over time | trigram 0.5 to 0.85 **and** `updated_at` far apart | Prefer newer. Show the older marked superseded, user can override |
| Genuine contradiction | none available | **Cannot be detected deterministically** |

The middle case is the dangerous one in practice, and it has a cheap proxy. An old cancellation
policy and its replacement share most of their wording and differ in the clause that matters.
Trigram similarity puts them in a band that is too low for the 0.85 near-duplicate threshold and
too high to be unrelated. Combined with a large gap in `updated_at`, that band is a good
supersession signal. It is a heuristic, so it must **suggest and be reversible**, never silently
drop.

The third case needs embeddings and a resolution interface. Both are large. It stays a FUTURE
capability, as `MEMORY_002_PLAN.md` §10 already says, and the honest position is to say so
rather than imply the engine handles contradictions.

### Stage 5. Rank

In order: pinned, then relevance, then source weight, then recency, then stable tiebreaks on
name and id. Determinism is a hard requirement and is already tested over 100 repeated runs.

**Source weight** is the new term and the largest quality lever at scale. It is a multiplier per
container, from two sources:

- explicit, a number the user sets on a space or folder,
- implicit, derived from what the user has actually injected before, which requires the
  telemetry in §7.

Weighting, never filtering. A hard filter on the active space would hide the house style rules
that live in a general space, which is exactly the knowledge that should always be reachable.

### Stage 6. Fill and compress

Unchanged and correct: full body if it fits, else the summary marked as compressed, else
dropped and reported. Pinned items bypass the budget and the overrun is reported rather than
hidden.

---

## 3. The experience inside ChatGPT, Claude and Gemini

The panel that shipped is close. What changes is what a row *means*.

```
🧠 Memory · 3 facts · 640 / 2,000 tokens                    [2,000 ▾] [↻]

[✓] Cancellation Policy            240t   memory · Policies
[✓] Guest Communication Style      190t   snippet · Style
       ↳ 4 languages, inserting IT
[✓] Airbnb Rules                   210t   snippet · Platforms  · summary only
[ ] Late Checkout Fee               90t   snippet · superseded by Cancellation Policy?

    2 more matched, below the relevance floor          [show]

                                          [Esc]  [Insert 3]
```

What each line earns its place for:

- **"3 facts", not "6 items".** The count the user budgets against is the count of facts.
- **The language line.** It says a choice was made on their behalf and which way it went. A user
  writing in Italian who sees "inserting EN" learns instantly that detection missed.
- **The space or folder name.** With 1,000 items across many spaces, "which pile did this come
  from" is most of what makes a suggestion trustworthy.
- **"summary only".** The user can see the engine traded completeness for budget, and expand it
  if the trade was wrong.
- **"superseded by"** with a question mark. A suggestion, unticked by default, never a silent
  drop.
- **The below-floor line.** Proof that the floor exists and is doing something, which is what
  stops a user from believing the library is smaller than it is.

Unchanged and non-negotiable: no automatic insertion, no send-button hook, insertion writes
visible delimited text the user can read and edit, Remove strips exactly that block, Undo
restores the composer.

**Cross-turn awareness is missing and matters most in long chats.** Today insertion replaces the
block in the composer, which handles the current message. It does not know what was injected
three turns ago and already sits in the conversation above. In a long working session that means
re-injecting established facts every turn. The fix is a per-conversation injected set, keyed on
the tab and thread, that downweights rather than excludes, because a model's attention to
something twenty messages back is not the same as having it in the current message.

---

## 4. Behaviour at 1,000 items

Where each stage breaks, and what holds it.

| Stage | Failure at scale | Fix |
| --- | --- | --- |
| Search | 40 rows may be 12 facts | Request rows, target facts |
| Search | Two-way union runs each source's RLS per query | Already indexed with GIN on both arms. Measure with `index_advisor` before assuming |
| Gate | Rank-relative floor admits weaker matches as the library grows | Add the absolute threshold |
| Cluster | None. Grouping is a hash | |
| Near-dedup | O(k²) over accepted items | k is bounded by the budget, roughly 10. Fine. Do **not** extend it to all-pairs over the library |
| Panel | 40 rows is a scroll, 12 facts is a list | Clustering is also the UX fix |
| Bodies | Fetched only for accepted ids | Already correct. This is the index/body split doing its job |

The architecture scales because the expensive operation is bounded by the **budget**, not by the
library. Listing costs names and summaries. Bodies cost only what a budget admits. That property
is the economic core of the product and every change here preserves it.

The one thing that would break it is a materialised copy of the view. `MEMORY_002_PLAN.md` R4
already forbids it, for the additional reason that a cached copy does not follow RLS.

---

## 5. Token optimisation

Ranked by tokens saved per unit of work.

1. **Collapse language variants.** 25.6% of library weight today, far more on queries that hit a
   multilingual fact. Deterministic, and the data already exists.
2. **Absolute relevance gate.** Every candidate that should not have been offered is pure waste
   when accepted, and the panel's pre-check means weak candidates *are* accepted by default.
3. **Summary instead of body**, already shipped, marked in the panel.
4. **Supersession**, which removes a whole item rather than shortening one.
5. **Cross-turn suppression**, worth the most in exactly the long sessions where budgets hurt.

**The token estimate is a known inaccuracy and should be named rather than quietly trusted.**
`ceil(characters / 4)` is computed by a generated column in Postgres and mirrored in the engine,
and the two must agree, which is why it cannot be a real tokenizer. Four characters per token
errs high on English prose and errs badly on accented and non-Latin text. This library is
Italian, Spanish, French and English. Budgets here are approximate in a direction that varies by
language. That is acceptable for a budget and would not be acceptable for a hard limit, so
nothing downstream should treat the number as exact.

---

## 6. Deterministic versus AI-assisted

One line, and it is worth stating as a principle because it is what keeps the feature fast and
debuggable:

> **Nothing produced by a model may sit between the keystroke and the preview.**

| Always deterministic | May be AI-assisted, always asynchronous and opt-in |
| --- | --- |
| Candidate generation and fusion | Better summaries than the first line |
| Clustering, gating, ranking, budgeting | Label suggestions |
| Variant choice and compression | Embeddings for a semantic arm |
| The injected block format | Contradiction detection |
| Everything in the panel | Query expansion, if it ever earns its place |

An LLM may **enrich stored data ahead of time**. It may not participate in choosing what goes in
the box. This keeps the panel inside its 300 ms target, keeps a package reproducible for the same
draft, and keeps the failure modes explainable. It also means turning every AI feature off
degrades quality without breaking anything.

The semantic arm (E1) remains blocked on a decision nobody has made: which vendor sees the text.
That is a privacy commitment, not a technical choice, and it belongs to Valentina and Alessandro.

---

## 7. What to build first

Ordered by value per unit of risk. The first two are small and the second one is urgent for a
reason that is easy to miss.

**A. Language-variant clustering.** The 25.6%. **Implemented for v3.28.0**, differently from first
proposed. Grouping uses the product's existing translation rule on the client instead of new view
columns (Change 1), and the translation inserted is the user's default language rather than the
draft's, because the only language detector lives in dashboard TypeScript (stage 0). The panel
shows one row per fact with the chosen language as a button that switches to the next
translation, and tokens and summary follow that choice. Covered by 11 parity cases for
`clusterCandidates` and an end-to-end section in `scripts/check-lang-variants.js` that runs the
real `content.js`, engine and panel code together.

Found while verifying, and left for C: the panel pre-selects anything with a rank above zero, but
`buildContext` then drops anything under the relevance floor at insert, and the toast reports
that drop as "did not fit". An item can be ticked by the panel and removed by the engine for a
reason the user is told wrongly. That is the gate's job, and the fix belongs with it.

**B. Injection telemetry.** There is no record anywhere of what was suggested, what was accepted,
and what was rejected. No table, no events, nothing. Every adaptive feature in the brief depends
on this data: source weighting, adaptive budgets, learning from repeated injections. It cannot be
backfilled, so every week without it is a week of evidence permanently lost. It is also the
cheapest item on this list.

Record per shown candidate: item id, kind, container, rank position, whether checked, whether
inserted, host, budget, timestamp. **Record a hash of the query, never the draft text.** The
draft is the user's private writing and storing it would be a change in what the product
collects, requiring consent rather than a migration.

**C. The absolute relevance gate.** Calibrate the threshold against the real library rather than
picking a number. B makes the calibration possible. **Largely delivered with the draft search fix
(§0b):** the gate now lives in `knowledge_search`, calibrated by hand on 17 drafts against a
production library, and the panel pre-selects only the strongest matches. What remains is
recalibrating on real accept and reject data once B records it. The old mismatch, where the panel
ticked an item the engine's floor then dropped as "did not fit", no longer occurs: nothing the
search returns falls under that floor.

**D. Source weighting and the named-container boost.** The biggest quality lever once there are
many spaces. Explicit weights first, implicit weights once B has produced data.

**E. Supersession detection.** The similarity band plus the recency gap, suggested and
reversible.

**F. Cross-turn injected set.**

**G. One engine file.** Do it between features, not during one. Every item above costs roughly
double until it is done, which is the argument for doing it early, and it is a refactor of the
code that decides what enters someone's context, which is the argument for doing it carefully.

**H. Semantic arm.** Last, and only after the vendor question is answered.

Deliberately not on this list: contradiction detection beyond supersession, intent
classification, and anything that puts a model in the synchronous path.

---

## 8. What I would change in the current design

Six things, in descending order of how much they cost today.

1. **The view drops the columns the engine most needs.** It projects content and discards
   identity. `group_id`, `lang`, `content_hash` and `updated_at` are all present in the source
   tables and all absent from retrieval. This is the root of the 25.6%.

2. **Deduplication happens after the user has already chosen.** The panel is the decision point
   and it shows rows, not facts. Clustering must run before render.

3. **The relevance floor is relative where it needs to be absolute.** A rank-based cut does not
   tighten as a library grows.

4. **The selection rule exists twice.** Justified by a build-step constraint that a change of
   authoring language would remove. The parity gate that protects it cannot catch a mistake both
   copies share, and this project has already shipped one such bug.

5. **`snippets` has no content hash**, so exact dedup is unavailable for 115 of the 123 items and
   fuzzy comparison does work an equality check could do.

6. **Nothing is measured.** The product cannot answer "which memories actually get used", which
   is both the most interesting question it could ask and a prerequisite for half the roadmap.

What I would **not** change, having looked for reasons to:

- **Prompts stay out of the context surface.** The reasoning in `MEMORY_002_PLAN.md` P-1 is
  sound. A prompt is an instruction, and a model given a stored instruction alongside a live one
  follows neither reliably. Prompt discovery is a real and separate problem that already has a
  home.
- **`security_invoker` composition.** Authorization is inherited rather than re-decided, and the
  retrieval layer can only narrow access. This is the right answer and it should never be
  "fixed" by promoting a function to definer.
- **The index/body split.** It is why the feature scales at all.
- **No automatic insertion.** Text appearing in a message the user did not put there is the one
  failure that would end trust in this product.
