-- Let a folder's OWNER take their folder back out of an organization.
--
-- WHY
-- app.enforce_folder_tenancy was asymmetric. Sharing a personal folder INTO an
-- org requires `auth.uid() = OLD.user_id` (you may only share your own folder),
-- but taking it back out required `app.org_role(...) = 'admin'`. So an ordinary
-- member could share their own folder and then could not unshare it.
--
-- That asymmetry is why "unshare" could not be implemented properly on the
-- client. Combined with app.folder_level returning 'owner' to every org admin
-- whenever organization_id is set, revoking the last folder_permissions grant
-- left the folder stamped and every admin still holding owner rights, while the
-- UI reported the folder as not shared.
--
-- WHAT CHANGES
-- Only who may clear or change organization_id. The owner is now allowed
-- alongside an org admin. This can only ever REMOVE access, never grant it:
-- moving a folder INTO an org still requires org membership, and the
-- `auth.uid() = OLD.user_id` check on the share path is untouched.
--
-- app.cascade_folder_org already propagates the new organization_id to the
-- folder's snippets and prompts, so clearing the folder clears its assets too.

create or replace function app.enforce_folder_tenancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id := OLD.user_id;

    IF OLD.organization_id IS NULL AND NEW.organization_id IS NOT NULL THEN
      IF NOT (auth.uid() = OLD.user_id AND app.is_org_member(NEW.organization_id)) THEN
        RAISE EXCEPTION
          'tenancy: you may only share your own folder into an organization you belong to'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF OLD.organization_id IS NOT NULL
          AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      -- The owner may always take their own folder back out; an org admin may
      -- do it for anyone's folder in that org.
      IF NOT (app.org_role(OLD.organization_id) = 'admin' OR auth.uid() = OLD.user_id) THEN
        RAISE EXCEPTION
          'tenancy: only the folder owner or an org admin may move this folder out of its organization'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.organization_id IS NOT NULL AND NOT app.is_org_member(NEW.organization_id) THEN
      RAISE EXCEPTION
        'tenancy: cannot create a folder in an organization you do not belong to'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
