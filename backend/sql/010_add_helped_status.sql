ALTER TABLE chat_sessions
    DROP CONSTRAINT IF EXISTS chat_sessions_status_check;

DO $$
DECLARE
    c_name text;
BEGIN
    SELECT conname INTO c_name
    FROM pg_constraint
    WHERE conrelid = 'chat_sessions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%IN%active%human_takeover%resolved%';

    IF c_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE chat_sessions DROP CONSTRAINT %I', c_name);
    END IF;
END $$;

ALTER TABLE chat_sessions
    ADD CONSTRAINT chat_sessions_status_check
    CHECK (status IN ('active', 'human_takeover', 'helped', 'resolved'));
