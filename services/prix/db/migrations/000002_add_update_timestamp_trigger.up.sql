-- Function to update updated_at column
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Dynamically create triggers for all tables in public schema with an updated_at column
DO $$
DECLARE
    tbl_name text;
BEGIN
    FOR tbl_name IN
        SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'updated_at'
          -- Ensure it's a base table, not a view
          AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_update_updated_at ON public.%I;', tbl_name);
        EXECUTE format('CREATE TRIGGER trg_update_updated_at
                        BEFORE UPDATE ON public.%I
                        FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();',
                        tbl_name);
        RAISE NOTICE 'Created trigger trg_update_updated_at on public.%', tbl_name;
    END LOOP;
END;
$$;
