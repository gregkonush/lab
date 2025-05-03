-- Dynamically drop triggers from all tables in public schema with an updated_at column
DO $$
DECLARE
    tbl_name text;
BEGIN
    FOR tbl_name IN
        SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'updated_at'
          AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_update_updated_at ON public.%I;', tbl_name);
        RAISE NOTICE 'Dropped trigger trg_update_updated_at from public.%', tbl_name;
    END LOOP;
END;
$$;

-- Drop the function itself
DROP FUNCTION IF EXISTS trigger_set_timestamp();
