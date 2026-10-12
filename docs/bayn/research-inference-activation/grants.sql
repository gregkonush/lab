-- Apply only after approval of the new bayn_research identity through the existing CNPG/secret-management path.
-- This file grants no broker, trading-table, schema-creation, or expense-posting authority.
GRANT CONNECT ON DATABASE bayn TO bayn_research;
GRANT USAGE ON SCHEMA public TO bayn_research;
GRANT SELECT, INSERT ON research_inference_runs, research_inference_receipts TO bayn_research;
