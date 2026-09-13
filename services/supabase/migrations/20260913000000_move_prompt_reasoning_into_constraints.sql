-- Retire the Reasoning prompt block (v3.27.0).
-- Each prompt's Reasoning text moves into its Constraints block, ahead of any
-- text already there, and the saved prompt text (content) is rewritten to
-- match: the same words in the same order, only the heading above them changes
-- from "## Reasoning" to "## Constraints". Decided with Valentina, 2026-09-13.
--
-- The editor applies the same rule when it opens a prompt that still has a
-- Reasoning block (foldReasoningIntoConstraints in app/src/lib/promptUtils.ts),
-- which covers anything an older dashboard saves after this runs.
--
-- Safety:
-- * Every row is checked before it is written. The migration stops with
--   nothing changed if a prompt has an unexpected shape: more than one
--   Reasoning or Constraints block, saved text that does not match its blocks,
--   Reasoning and Constraints both holding text but switched differently, or a
--   Reasoning section that does not appear exactly once.
-- * After the rewrite, the new text must match the new blocks, keep whatever
--   followed the blocks (the Ask User Questions section), and differ from the
--   old text only in its headings.
-- * updated_at is left alone, so the prompt list keeps its order and
--   trg_prompts_audit keeps each prompt's last author.
-- * The previous blocks and content are copied to
--   app.prompt_reasoning_backup_20260913 first, so the move can be reversed.
--   The app schema is not exposed through the API.

CREATE TABLE IF NOT EXISTS app.prompt_reasoning_backup_20260913 (
  prompt_id    uuid PRIMARY KEY,
  blocks       jsonb NOT NULL,
  content      text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app.prompt_reasoning_backup_20260913 FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  p             record;
  r             jsonb;
  c             jsonb;
  r_text        text;
  c_text        text;
  r_on          boolean;
  c_on          boolean;
  merged        jsonb;
  new_blocks    jsonb;
  new_content   text;
  old_seg       text;
  new_seg       text;
  old_assembled text;
  new_assembled text;
  moved         int := 0;
BEGIN
  FOR p IN
    SELECT id, blocks, content
    FROM prompts
    WHERE jsonb_typeof(blocks) = 'array'
      AND blocks @> '[{"type": "reasoning"}]'
    FOR UPDATE
  LOOP
    IF (SELECT count(*) FROM jsonb_array_elements(p.blocks) e WHERE e->>'type' = 'reasoning') <> 1
       OR (SELECT count(*) FROM jsonb_array_elements(p.blocks) e WHERE e->>'type' = 'constraints') > 1 THEN
      RAISE EXCEPTION 'prompt %: unexpected number of Reasoning or Constraints blocks', p.id;
    END IF;

    SELECT e INTO r FROM jsonb_array_elements(p.blocks) e WHERE e->>'type' = 'reasoning';
    SELECT e INTO c FROM jsonb_array_elements(p.blocks) e WHERE e->>'type' = 'constraints';
    r_text := regexp_replace(coalesce(r->>'content', ''), '^\s+|\s+$', '', 'g');
    c_text := regexp_replace(coalesce(c->>'content', ''), '^\s+|\s+$', '', 'g');
    r_on := coalesce((r->>'enabled')::boolean, false);
    c_on := coalesce((c->>'enabled')::boolean, false);

    -- Same assembly as assembleBlocks: enabled blocks with text, "## Type" headings.
    SELECT coalesce(string_agg(
             '## ' || upper(left(e->>'type', 1)) || substr(e->>'type', 2) || E'\n'
               || regexp_replace(e->>'content', '^\s+|\s+$', '', 'g'),
             E'\n\n' ORDER BY ord)
           FILTER (WHERE coalesce((e->>'enabled')::boolean, false)
                     AND regexp_replace(coalesce(e->>'content', ''), '^\s+|\s+$', '', 'g') <> ''), '')
      INTO old_assembled
      FROM jsonb_array_elements(p.blocks) WITH ORDINALITY AS t(e, ord);
    IF left(p.content, length(old_assembled)) <> old_assembled THEN
      RAISE EXCEPTION 'prompt %: saved text does not match its blocks', p.id;
    END IF;

    IF r_text = '' THEN
      -- An empty Reasoning block never reached the saved text.
      SELECT coalesce(jsonb_agg(e ORDER BY ord), '[]'::jsonb) INTO new_blocks
        FROM jsonb_array_elements(p.blocks) WITH ORDINALITY AS t(e, ord)
        WHERE e->>'type' <> 'reasoning';
      new_content := p.content;
    ELSE
      IF c_text = '' THEN
        merged := jsonb_build_object('type', 'constraints', 'content', r->>'content', 'enabled', r_on);
      ELSIF r_on = c_on THEN
        merged := jsonb_build_object('type', 'constraints', 'content', r_text || E'\n\n' || c_text, 'enabled', c_on);
      ELSE
        RAISE EXCEPTION 'prompt %: Reasoning and Constraints both hold text but are switched differently', p.id;
      END IF;

      -- Constraints keeps its place when it exists; otherwise the text takes Reasoning's place.
      SELECT jsonb_agg(
               CASE
                 WHEN e->>'type' = 'constraints' OR (e->>'type' = 'reasoning' AND c IS NULL) THEN merged
                 ELSE e
               END
               ORDER BY ord)
        INTO new_blocks
        FROM jsonb_array_elements(p.blocks) WITH ORDINALITY AS t(e, ord)
        WHERE NOT (e->>'type' = 'reasoning' AND c IS NOT NULL);

      IF r_on THEN
        IF c_on AND c_text <> '' THEN
          old_seg := E'## Reasoning\n' || r_text || E'\n\n## Constraints\n';
          new_seg := E'## Constraints\n' || r_text || E'\n\n';
        ELSE
          old_seg := E'## Reasoning\n' || r_text;
          new_seg := E'## Constraints\n' || r_text;
        END IF;
        IF (length(p.content) - length(replace(p.content, old_seg, ''))) / length(old_seg) <> 1
           OR (length(p.content) - length(replace(p.content, E'## Reasoning\n', ''))) / length(E'## Reasoning\n') <> 1 THEN
          RAISE EXCEPTION 'prompt %: the Reasoning section does not appear exactly once in the saved text', p.id;
        END IF;
        new_content := replace(p.content, old_seg, new_seg);
      ELSE
        new_content := p.content;
      END IF;
    END IF;

    SELECT coalesce(string_agg(
             '## ' || upper(left(e->>'type', 1)) || substr(e->>'type', 2) || E'\n'
               || regexp_replace(e->>'content', '^\s+|\s+$', '', 'g'),
             E'\n\n' ORDER BY ord)
           FILTER (WHERE coalesce((e->>'enabled')::boolean, false)
                     AND regexp_replace(coalesce(e->>'content', ''), '^\s+|\s+$', '', 'g') <> ''), '')
      INTO new_assembled
      FROM jsonb_array_elements(new_blocks) WITH ORDINALITY AS t(e, ord);
    IF replace(replace(p.content, E'## Reasoning\n', ''), E'## Constraints\n', '')
         <> replace(new_content, E'## Constraints\n', '')
       OR left(new_content, length(new_assembled)) <> new_assembled
       OR substr(new_content, length(new_assembled) + 1) <> substr(p.content, length(old_assembled) + 1) THEN
      RAISE EXCEPTION 'prompt %: rewritten text failed its check', p.id;
    END IF;

    INSERT INTO app.prompt_reasoning_backup_20260913 (prompt_id, blocks, content)
      VALUES (p.id, p.blocks, p.content)
      ON CONFLICT (prompt_id) DO NOTHING;
    UPDATE prompts SET blocks = new_blocks, content = new_content WHERE id = p.id;
    moved := moved + 1;
  END LOOP;

  RAISE NOTICE 'Reasoning moved into Constraints on % prompts', moved;
END $$;
