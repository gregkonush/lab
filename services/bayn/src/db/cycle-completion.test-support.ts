// Deliberately small SQL fixture schema: production function bodies remain unchanged.
// Columns/indexes cover every dependency read by the completion functions.
export const completionSchemaSql = `
CREATE TABLE autonomous_cycles (cycle_id text PRIMARY KEY, decision_hash text, account_id text, updated_at timestamptz);
CREATE TABLE autonomous_cycle_shadow_decisions (cycle_id text PRIMARY KEY, decision_hash text, document jsonb);
CREATE TABLE intents (intent_id text PRIMARY KEY, account_id text, cycle_id text, strategy_name text,
 decision_hash text, policy_hash text, authority_generation_hash text, risk_decision_id text, state text,
 terminal_outcome text, order_type text, time_in_force text, client_order_id text, symbol text, side text,
 quantity_micros numeric, updated_at timestamptz);
CREATE INDEX intents_cycle_idx ON intents(cycle_id);
CREATE TABLE mutation_events (intent_id text, operation text, event_type text, broker_order_id text,
 occurred_at timestamptz, sequence bigint);
CREATE INDEX mutations_intent_idx ON mutation_events(intent_id, operation, sequence DESC);
CREATE TABLE broker_events (event_id text PRIMARY KEY, account_id text, observed_at timestamptz, source_sequence bigint);
CREATE TABLE orders (event_id text, account_id text, broker_order_id text, client_order_id text,
 intent_id text, symbol text, side text, order_type text, time_in_force text, quantity_micros numeric,
 filled_quantity_micros numeric, status text);
CREATE INDEX orders_account_broker_idx ON orders(account_id, broker_order_id);
CREATE INDEX orders_account_intent_idx ON orders(account_id, intent_id);
CREATE TABLE fills (account_id text, broker_order_id text, intent_id text, client_order_id text,
 symbol text, side text, quantity_micros numeric);
CREATE TABLE position_snapshots (account_id text, observed_at timestamptz, ingestion_sequence bigint,
 ingestion_order_trusted boolean, position_count integer);
CREATE INDEX positions_account_ingestion_idx ON position_snapshots(account_id, ingestion_sequence DESC);
CREATE TABLE reconciliations (account_id text, status text, expected_hash text, observed_hash text,
 discrepancies jsonb, reconciled_at timestamptz);
CREATE INDEX reconciliations_account_time_idx ON reconciliations(account_id, reconciled_at DESC);
`

export const completionDocument = {
  schemaVersion: 'bayn.paper-cycle-decision.v1',
  createdAt: '2026-01-01T00:00:00Z',
  mode: 'PAPER',
  dispatchable: true,
  targetPlan: { status: 'PLANNED' },
  orderedIntentIds: ['intent'],
  deltaRisk: [{ evaluation: { input: { intentId: 'intent' }, decision: { outcome: 'APPROVED', decisionId: 'risk' } } }],
  bindings: {
    strategyName: 'strategy',
    strategyDecisionHash: 'strategy-hash',
    policyHash: 'policy',
    authorityGenerationHash: 'authority',
  },
}

export const resetCompletionSql = `
TRUNCATE autonomous_cycles, autonomous_cycle_shadow_decisions, intents, mutation_events, broker_events,
 orders, fills, position_snapshots, reconciliations;
INSERT INTO autonomous_cycles VALUES ('cycle','decision','account','2026-01-01T00:00:01Z');
INSERT INTO autonomous_cycle_shadow_decisions VALUES ('cycle','decision','${JSON.stringify(completionDocument)}');
INSERT INTO intents VALUES ('intent','account','cycle','strategy','strategy-hash','policy','authority','risk',
 'TERMINAL','FILLED','LIMIT','IOC','client','XYZ','BUY',10,'2026-01-01T00:00:01Z');
INSERT INTO mutation_events VALUES ('intent','SUBMIT','SUBMIT_ACCEPTED','order','2026-01-01T00:00:01Z',1);
INSERT INTO broker_events VALUES ('event','account','2026-01-01T00:00:02Z',1);
INSERT INTO orders VALUES ('event','account','order','client','intent','XYZ','BUY','LIMIT','IOC',10,10,'FILLED');
INSERT INTO fills VALUES ('account','order','intent','client','XYZ','BUY',10);
INSERT INTO position_snapshots VALUES ('account','2026-01-01T00:00:03Z',1,true,0);
INSERT INTO reconciliations VALUES ('account','EXACT','hash','hash','[]','2026-01-01T00:00:04Z');
`
const partial = `UPDATE intents SET terminal_outcome='CANCELED'; UPDATE orders SET status='CANCELED', filled_quantity_micros=5; UPDATE fills SET quantity_micros=5;`
const documentSet = (path: string, value: string) =>
  `UPDATE autonomous_cycle_shadow_decisions SET document=jsonb_set(document,'{${path}}','${value}'::jsonb);`
export const completionCases: ReadonlyArray<{ name: string; sql: string; expected: boolean }> = [
  { name: 'fully filled exact completion', sql: '', expected: true },
  {
    name: 'duplicate planned identity preserves existing semantics',
    sql: `UPDATE autonomous_cycle_shadow_decisions SET document=jsonb_set(jsonb_set(document,'{orderedIntentIds}',(document->'orderedIntentIds') || (document->'orderedIntentIds')),'{deltaRisk}',(document->'deltaRisk') || (document->'deltaRisk'))`,
    expected: true,
  },
  { name: 'missing cycle', sql: 'DELETE FROM autonomous_cycles', expected: false },
  { name: 'missing decision', sql: 'DELETE FROM autonomous_cycle_shadow_decisions', expected: false },
  { name: 'current generation mismatch', sql: "UPDATE autonomous_cycles SET decision_hash='new'", expected: false },
  {
    name: 'wrong stored decision hash',
    sql: "UPDATE autonomous_cycle_shadow_decisions SET decision_hash='new'",
    expected: false,
  },
  {
    name: 'completion predates cycle',
    sql: "UPDATE autonomous_cycles SET updated_at='2026-01-01T00:00:11Z'",
    expected: false,
  },
  { name: 'risk denied', sql: documentSet('deltaRisk,0,evaluation,decision,outcome', '"DENIED"'), expected: false },
  { name: 'risk id mismatch', sql: "UPDATE intents SET risk_decision_id='other'", expected: false },
  { name: 'cross account intent', sql: "UPDATE intents SET account_id='other'", expected: false },
  { name: 'cross cycle intent', sql: "UPDATE intents SET cycle_id='other'", expected: false },
  { name: 'missing intent', sql: 'DELETE FROM intents', expected: false },
  { name: 'nonterminal intent', sql: "UPDATE intents SET state='SUBMITTING'", expected: false },
  {
    name: 'future intent mutation cutoff',
    sql: "UPDATE intents SET updated_at='2026-01-01T00:00:11Z'",
    expected: false,
  },
  {
    name: 'strict mutation cutoff equality',
    sql: "UPDATE mutation_events SET occurred_at='2026-01-01T00:00:04Z'",
    expected: false,
  },
  {
    name: 'new order observation after reconciliation',
    sql: "UPDATE broker_events SET observed_at='2026-01-01T00:00:05Z'",
    expected: false,
  },
  {
    name: 'reconciliation after completion',
    sql: "UPDATE reconciliations SET reconciled_at='2026-01-01T00:00:11Z'",
    expected: false,
  },
  { name: 'mismatched reconciliation hash', sql: "UPDATE reconciliations SET observed_hash='other'", expected: false },
  { name: 'reconciliation discrepancy', sql: "UPDATE reconciliations SET discrepancies='[{}]'", expected: false },
  {
    name: 'unknown broker order',
    sql: "INSERT INTO orders (account_id,broker_order_id) VALUES ('account','unknown')",
    expected: false,
  },
  {
    name: 'unresolved later mutation',
    sql: "INSERT INTO mutation_events VALUES ('intent','SUBMIT','SUBMIT_STARTED',NULL,'2026-01-01T00:00:03Z',2)",
    expected: false,
  },
  { name: 'empty intent array', sql: documentSet('orderedIntentIds', '[]'), expected: false },
  { name: 'nonarray intent ids', sql: documentSet('orderedIntentIds', '{}'), expected: false },
  { name: 'null intent id', sql: documentSet('orderedIntentIds', '[null]'), expected: false },
  { name: 'numeric intent id', sql: documentSet('orderedIntentIds', '[1]'), expected: false },
  { name: 'null riskBlock is present', sql: documentSet('riskBlock', 'null'), expected: false },
  { name: 'partial IOC reconciled flat', sql: partial, expected: true },
  { name: 'partial IOC still held', sql: partial + ' UPDATE position_snapshots SET position_count=1', expected: false },
  {
    name: 'partial IOC untrusted positions',
    sql: partial + ' UPDATE position_snapshots SET ingestion_order_trusted=false',
    expected: false,
  },
  { name: 'partial IOC fill sum mismatch', sql: partial + ' UPDATE fills SET quantity_micros=4', expected: false },
  {
    name: 'partial IOC wrong fill identity',
    sql: partial + " UPDATE fills SET client_order_id='other'",
    expected: false,
  },
  {
    name: 'partial IOC later active order',
    sql:
      partial +
      " INSERT INTO broker_events VALUES ('active','account','2026-01-01T00:00:02Z',2); INSERT INTO orders(event_id,account_id,broker_order_id,intent_id,status) VALUES('active','account','active-order','intent','NEW')",
    expected: false,
  },
  {
    name: 'zero fill canceled IOC',
    sql: "UPDATE intents SET terminal_outcome='CANCELED'; UPDATE orders SET status='CANCELED',filled_quantity_micros=0; DELETE FROM fills",
    expected: true,
  },
  {
    name: 'zero fill cancellation with retained fill',
    sql: "UPDATE intents SET terminal_outcome='CANCELED'; UPDATE orders SET status='CANCELED',filled_quantity_micros=0",
    expected: false,
  },
]

export const malformedCompletionSql = `
DO $fixture$
BEGIN
  UPDATE autonomous_cycle_shadow_decisions SET document=jsonb_set(document,'{createdAt}','"not-a-time"');
  BEGIN
    PERFORM baseline_completion('cycle','decision','2026-01-01T00:00:10Z');
    RAISE EXCEPTION 'baseline did not reject malformed time';
  EXCEPTION WHEN invalid_datetime_format THEN NULL;
  END;
  BEGIN
    PERFORM paper_cycle_completion_evidence_matches('cycle','decision','2026-01-01T00:00:10Z');
    RAISE EXCEPTION 'candidate did not reject malformed time';
  EXCEPTION WHEN invalid_datetime_format THEN NULL;
  END;
END
$fixture$;
`
