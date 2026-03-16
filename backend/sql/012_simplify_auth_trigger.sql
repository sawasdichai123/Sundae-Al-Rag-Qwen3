-- Migration 012: Simplify auth trigger (multi-tenant)
-- No org assignment on signup — user creates org after approval

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_profiles (
        id, email, full_name, role, is_approved, organization_id
    )
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data ->> 'full_name',
        'user',
        false,
        NULL   -- org assigned later when user creates or joins one
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;
