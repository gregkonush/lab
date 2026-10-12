# Research worker activation

This rendered proposal is outside Argo's application inputs. It does not create a credential or deploy a worker.
The source implementation and expense projection use the existing Bayn image delivery. The proposed worker runs
one research Workflow at a time with a separate two-connection database pool. It receives no broker, capital,
Kafka, ClickHouse, model-provider or TigerBeetle credential.

Each run requires HMAC-SHA256 operator approval over its canonical identity, including source, study, exact context,
attempt, token/deadline budget and cost basis. The CLI and worker receive a separate 32-byte random approval key
encoded as lowercase hex. Only the signed proof travels through Restate, never the key. Changed or unsigned runs
are rejected before the durable inference step; a signed run can transmit once. No per-run deployment is needed.
The proposal also allows PostgreSQL ingress from the worker; its source egress rule alone would be insufficient.

Activation needs approval for the restricted database identity and the separate operator approval credential.
Create `bayn_research` through the existing
CNPG and secret-management path and deliver its connection URI as `bayn/bayn-research-db`, key `fqdn-uri`, to
`RestateDeployment/bayn-research`. Apply only the reviewed [grants](grants.sql). The role has SELECT and INSERT on
the two research tables and no UPDATE or access to trading tables. Existing accounting workers own expense posting
and verification. Deliver the approval key to the operator CLI and `bayn/bayn-research-authority`, key `run-approval-key`,
through the existing secret-management path. The worker reads it as `BAYN_RESEARCH_APPROVAL_KEY`; other cluster workloads
receive neither credential. Neither credentials nor passwords belong in this directory.

After that approval, enroll these reviewed resources under `argocd/applications/bayn`, keeping the existing
`bayn-main` Kargo image renderer. Do not apply this directory directly. The image supplies its embedded source
revision, so this worker needs no independent image bump, release branch or source-revision substitution.
Review the exact eligible Freight, generated Kargo commit, Argo revision and image before activation.
Recovery scales only the research worker to zero through GitOps; it never rolls back trading authority.

Validate a complete factor-selection stream, cancelled-stream cleanup, durable replay, expense recovery and
worker-to-model traces against the deployed revision. A synthetic test establishes integration only. The live capture
inventory on October 11 Pacific had 224 chunks across 15 IDs and seven seals, all invalidated. It contains no usable
sealed full session. Keep economic comparisons unavailable until original coverage and preparation expenses are verified.
Do not manufacture semantic descriptions or supply later outcomes to make an old capture eligible.
