# Research worker activation

This rendered proposal is outside Argo's application inputs. It does not create a credential or deploy a worker.
The source implementation and expense projection use the existing Bayn image delivery. The proposed worker runs
one research Workflow at a time with a separate two-connection database pool. It receives no broker, capital,
Kafka, ClickHouse, model-provider or TigerBeetle credential.

Activation needs approval for one new credential identity and destination. Create `bayn_research` through the existing
CNPG and secret-management path and deliver its connection URI as `bayn/bayn-research-db`, key `fqdn-uri`, to
`RestateDeployment/bayn-research`. Apply only the reviewed [grants](grants.sql). The role has SELECT and INSERT on
the two research tables and no UPDATE or access to trading tables. Existing accounting workers own expense posting
and verification. Neither credentials nor passwords belong in this directory.

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
