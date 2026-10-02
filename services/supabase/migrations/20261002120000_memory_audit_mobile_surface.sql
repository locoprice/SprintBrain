-- MEMORY · The phone saves too.
--
-- The phone page (/mobile/) gains Add text: one new item in a Brain, saved
-- through memory_save_shard like every other surface. That function writes
-- the audit entry with the caller's surface, and memory_audit_log accepted
-- only 'dashboard', 'mcp' and 'extension', so a save marked 'mobile' was
-- refused whole: the row, its first version and the audit entry together.
--
-- Widening the list is the honest fix. Recording a phone save as 'dashboard'
-- would make the trail say something that did not happen.
--
-- Additive and safe to apply before the phone code ships: every existing row
-- already satisfies the wider check, no function or policy names the allowed
-- values, and the current callers keep sending the surfaces they always did.

alter table public.memory_audit_log
  drop constraint if exists memory_audit_surface_known;

alter table public.memory_audit_log
  add constraint memory_audit_surface_known
    check (surface in ('dashboard', 'mcp', 'extension', 'mobile'));
