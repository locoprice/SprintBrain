-- SprintBrain v2.38.3
-- Date: 2026-05-18
--
-- Drops the @leibtour.com domain restriction introduced in AUTH-001.
-- SprintBrain is now an open SaaS product that accepts any valid email address.

DROP TRIGGER IF EXISTS enforce_leibtour_domain_on_signup ON auth.users;

DROP FUNCTION IF EXISTS public.enforce_leibtour_domain();
