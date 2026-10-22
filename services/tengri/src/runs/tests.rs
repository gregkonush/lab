use super::*;
use chrono::Utc;
use http::{Request, Response};
use kube::{Client, ResourceExt, client::Body};
use std::{
    net::TcpListener,
    process::{Child, Command, Stdio},
};

fn fixture() -> ControlPlane {
    let (service, mut handle) = tower_test::mock::pair::<Request<Body>, Response<Body>>();
    tokio::spawn(async move {
        while let Some((request, response)) = handle.next_request().await {
            assert_eq!(
                request.method(),
                http::Method::GET,
                "sleeping fixture cannot dispatch effects"
            );
            let mut agent = crate::grpc::tests::provisional_terminal_test_agent(Utc::now());
            agent.spec.desired_state = crate::crd::MicroVMDesiredState::Sleeping;
            agent.status = Some(crate::crd::MicroVMStatus {
                phase: crate::crd::MicroVMPhase::Sleeping,
                ..Default::default()
            });
            response.send_response(
                Response::builder()
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_vec(&agent).unwrap()))
                    .unwrap(),
            );
        }
    });
    crate::grpc::tests::test_control_plane(Client::new(service, "tengri"))
}

fn input() -> Input {
    Input {
        id: Uuid::new_v4().to_string(),
        agent_id: "agent-current".into(),
        thread_id: "thread-fixture".into(),
        text: "fixture".into(),
        model: "fixture".into(),
        reasoning_effort: "low".into(),
        images: vec![],
    }
}

fn principal() -> Principal {
    let agent = crate::grpc::tests::provisional_terminal_test_agent(Utc::now());
    Principal::fixture(
        &agent.spec.owner_hash,
        &agent.uid().unwrap(),
        crate::ofz::proto::Action::CodexControl,
    )
}

#[tokio::test]
async fn run_admission_is_bound_to_payload_and_domain() {
    let service = fixture();
    let mut envelope = seal(&service, "query", &input()).await.unwrap();
    assert!(
        open::<Input>(&service, "admission", &envelope)
            .await
            .is_err()
    );
    assert!(open::<Input>(&service, "query", &envelope).await.is_ok());
    envelope.payload.push(' ');
    assert!(open::<Input>(&service, "query", &envelope).await.is_err());
}

#[test]
fn history_requires_the_exact_accepted_turn_and_an_explicit_outcome() {
    let value = serde_json::json!({"thread":{"turns":[{"id":"other","status":"completed"},{"id":"accepted","status":"inProgress"}]}});
    assert!(matches!(
        observed_turn(&value, "missing"),
        State::NeedsReconciliation { .. }
    ));
    assert_eq!(
        observed_turn(&value, "accepted"),
        State::Running {
            turn_id: "accepted".into()
        }
    );
    assert_eq!(
        observed_turn(&value, "other"),
        State::Succeeded {
            turn_id: "other".into()
        }
    );
}

#[test]
fn changed_input_changes_the_durable_identity_digest() {
    let first = input();
    let mut changed = first.clone();
    assert_eq!(
        input_digest(&first).unwrap(),
        input_digest(&changed).unwrap()
    );
    changed.text.push('!');
    assert_ne!(
        input_digest(&first).unwrap(),
        input_digest(&changed).unwrap()
    );
}

#[tokio::test]
async fn snapshot_sleep_keeps_stop_pending_until_the_preserved_turn_is_interrupted() {
    let service = fixture();
    let input = input();
    let control = Control {
        id: Uuid::new_v4().to_string(),
        run_id: input.id.clone(),
        agent_id: input.agent_id.clone(),
        principal: principal(),
        method: "turn/interrupt".into(),
        params: serde_json::json!({}),
    };
    let result = service
        .stop_durable_run(
            &control,
            &input,
            &State::Running {
                turn_id: "preserved-turn".into(),
            },
        )
        .await;
    assert!(!result.terminal());
    assert!(matches!(result,State::Cancelling{turn_id:Some(id),..} if id=="preserved-turn"));
    assert!(
        service
            .stop_durable_run(
                &control,
                &input,
                &State::WaitingForGuest {
                    reason: "not dispatched".into()
                }
            )
            .await
            .terminal()
    );
}

#[tokio::test]
#[ignore = "child process for the disposable Restate recovery test"]
async fn fixture_worker() {
    let port = env::var("TENGRI_FIXTURE_PORT").expect("fixture child only");
    let service = Arc::new(fixture());
    let endpoint = Endpoint::builder()
        .bind(TengriAgentRun {
            service: service.clone(),
        })
        .bind(TengriRunControl {
            service: service.clone(),
        })
        .bind(TengriWorkspaceRuns { service })
        .build();
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .unwrap();
    HttpServer::new(endpoint).serve(listener).await;
}

struct Worker(Child);
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn worker(port: u16) -> Worker {
    Worker(
        Command::new(env::current_exe().unwrap())
            .args([
                "--ignored",
                "--exact",
                "runs::tests::fixture_worker",
                "--nocapture",
            ])
            .env("TENGRI_FIXTURE_PORT", port.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    )
}

async fn register(
    http: &reqwest::Client,
    admin: &str,
    port: u16,
    deadline: tokio::time::Instant,
) -> String {
    loop {
        if let Ok(response) = http
            .post(format!("{admin}/deployments"))
            .json(&serde_json::json!({"uri":format!("http://host.docker.internal:{port}")}))
            .send()
            .await
            && response.status().is_success()
        {
            let value: serde_json::Value = response.json().await.unwrap();
            return value["id"].as_str().expect("deployment identity").into();
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "fixture deployment did not register"
        );
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}
struct Engine(String);
impl Drop for Engine {
    fn drop(&mut self) {
        let _ = Command::new("docker")
            .args(["rm", "--force", &self.0])
            .output();
    }
}
fn engine_port(engine: &Engine, port: &str) -> u16 {
    let output = Command::new("docker")
        .args(["inspect", &engine.0])
        .output()
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    json[0]["NetworkSettings"]["Ports"][port][0]["HostPort"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap()
}

async fn admission(service: &ControlPlane, input: Input) -> Envelope {
    let principal = principal();
    let mut claim = Claim {
        workspace_uid: principal.context.workspace_uid.clone(),
        run_id: input.id.clone(),
        signature: String::new(),
    };
    claim.signature = service
        .auth
        .seal_run("workspace", claim.payload().as_bytes())
        .await
        .unwrap();
    seal(
        service,
        "admission",
        &Admission {
            digest: input_digest(&input).unwrap(),
            input,
            principal,
            claim,
        },
    )
    .await
    .unwrap()
}
async fn status(
    client: &TengriAgentRunIngressClient<reqwest::Client>,
    service: &ControlPlane,
    input: &Input,
    owner: &str,
) -> Result<Snapshot, restate_sdk::ingress::ClientError> {
    let envelope = seal(
        service,
        "query",
        &Query {
            run_id: input.id.clone(),
            owner_hash: owner.into(),
            workspace_uid: principal().context.workspace_uid,
            digest: Some(input_digest(input).unwrap()),
            expires_at_ms: crate::ofz::now_ms().unwrap() + 2000,
        },
    )
    .await
    .unwrap();
    client
        .status(Json(envelope))
        .call()
        .await?
        .into_body()
        .map(Json::into_inner)
}

#[tokio::test]
#[ignore = "requires Docker; starts an isolated Restate 1.7.9 and kills an actual worker process"]
async fn restate_preserves_acceptance_exclusion_and_stop_across_worker_sigkill() {
    let image = "docker.restate.dev/restatedev/restate:1.7.9@sha256:329e32e12059610b681e165161bcd0722d193325b6c893bc46bfec72cd54b595";
    let mut command = Command::new("docker");
    command.args([
        "run",
        "--detach",
        "--publish",
        "127.0.0.1::8080",
        "--publish",
        "127.0.0.1::9070",
    ]);
    if cfg!(target_os = "linux") {
        command.args(["--add-host", "host.docker.internal:host-gateway"]);
    }
    let output = command.arg(image).output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let engine = Engine(String::from_utf8(output.stdout).unwrap().trim().into());
    let ingress = ReqwestClient::connect(
        format!("http://127.0.0.1:{}", engine_port(&engine, "8080/tcp"))
            .parse::<http::Uri>()
            .unwrap(),
    )
    .unwrap();
    let admin = format!("http://127.0.0.1:{}", engine_port(&engine, "9070/tcp"));
    let socket = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = socket.local_addr().unwrap().port();
    drop(socket);
    let mut process = worker(port);
    let http = reqwest::Client::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    let original_deployment = register(&http, &admin, port, deadline).await;
    let service = fixture();
    let input = input();
    let client = TengriAgentRunIngressClient::from_client(ingress.clone(), input.id.clone());
    client
        .run(Json(admission(&service, input.clone()).await))
        .send()
        .await
        .unwrap();
    let owner = principal().owner_hash;
    loop {
        if let Ok(snapshot) = status(&client, &service, &input, &owner).await
            && matches!(snapshot.state, State::WaitingForGuest { .. })
        {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "accepted run did not reach guest wait"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let query = Query {
        run_id: String::new(),
        owner_hash: owner.clone(),
        workspace_uid: principal().context.workspace_uid,
        digest: None,
        expires_at_ms: crate::ofz::now_ms().unwrap() + 2000,
    };
    let workspace =
        TengriWorkspaceRunsIngressClient::from_client(ingress.clone(), query.workspace_uid.clone());
    let active = workspace
        .active(Json(seal(&service, "active-query", &query).await.unwrap()))
        .call()
        .await
        .unwrap()
        .into_body()
        .unwrap()
        .into_inner();
    assert_eq!(active, Some(input.id.clone()));
    let claim = Claim {
        workspace_uid: query.workspace_uid,
        run_id: input.id.clone(),
        signature: String::new(),
    };
    assert!(
        workspace.claim(Json(claim)).call().await.is_err(),
        "claim handler must be private to service calls"
    );
    let socket = TcpListener::bind("127.0.0.1:0").unwrap();
    let next_port = socket.local_addr().unwrap().port();
    drop(socket);
    let _next_version = worker(next_port);
    let next_deployment = register(&http, &admin, next_port, deadline).await;
    assert_ne!(
        original_deployment, next_deployment,
        "version registration must retain the original pinned endpoint"
    );
    // Repeated input is the same workflow, and a changed payload is rejected by readback.
    client
        .run(Json(admission(&service, input.clone()).await))
        .send()
        .await
        .unwrap();
    let mut changed = input.clone();
    changed.text.push('!');
    assert_eq!(
        status(&client, &service, &changed, &owner)
            .await
            .unwrap_err()
            .response()
            .unwrap()
            .status(),
        409
    );
    assert_eq!(
        status(&client, &service, &input, &"b".repeat(64))
            .await
            .unwrap_err()
            .response()
            .unwrap()
            .status(),
        403
    );
    let mut other = input.clone();
    other.id = Uuid::new_v4().to_string();
    let other_client = TengriAgentRunIngressClient::from_client(ingress.clone(), other.id.clone());
    other_client
        .run(Json(admission(&service, other.clone()).await))
        .send()
        .await
        .unwrap();
    loop {
        if let Ok(snapshot) = status(&other_client, &service, &other, &owner).await
            && matches!(snapshot.state, State::Rejected { .. })
        {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "workspace exclusion did not settle"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    process.0.kill().unwrap();
    process.0.wait().unwrap();
    // These are independent OS processes. Listener cancellation alone would leave HTTP/2 tasks alive.
    process = worker(port);
    let stop = Control {
        id: Uuid::new_v4().to_string(),
        run_id: input.id.clone(),
        agent_id: input.agent_id.clone(),
        principal: principal(),
        method: "turn/interrupt".into(),
        params: serde_json::json!({}),
    };
    let stop_client = TengriRunControlIngressClient::from_client(ingress.clone(), stop.id.clone());
    let envelope = seal(&service, "control", &stop).await.unwrap();
    let receipt = control_receipt(&stop_client, envelope).await.unwrap();
    assert_eq!(receipt.digest, control_digest(&stop).unwrap());
    assert!(receipt.result.delivered);
    let repeated = control_receipt(
        &stop_client,
        seal(&service, "control", &stop).await.unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(repeated.digest, receipt.digest);
    let mut changed_stop = stop.clone();
    changed_stop.method = "turn/steer".into();
    let duplicate = control_receipt(
        &stop_client,
        seal(&service, "control", &changed_stop).await.unwrap(),
    )
    .await
    .unwrap();
    assert_ne!(
        duplicate.digest,
        control_digest(&changed_stop).unwrap(),
        "changed control input cannot reuse a committed result"
    );
    loop {
        if let Ok(snapshot) = status(&client, &service, &input, &owner).await
            && matches!(snapshot.state, State::Cancelled { .. })
        {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "durable Stop did not settle after worker replacement"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    drop(process);
}
