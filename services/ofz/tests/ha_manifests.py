"""Check the rendered coordinated-cutover targets, including rejected regressions."""

import copy
import json
import sys
from pathlib import Path


def require(condition, message):
    if not condition:
        raise ValueError(message)


def resource(targets, target, kind, name):
    matches = [
        item
        for item in targets[target]
        if item and item["kind"] == kind and item["metadata"]["name"] == name
    ]
    require(len(matches) == 1, f"{target}: expected one {kind}/{name}")
    return matches[0]


def container(targets, target, kind, name):
    pod = resource(targets, target, kind, name)["spec"]["template"]["spec"]
    return next(item for item in pod["containers"] if item["name"] == name)


def values(item):
    return {entry["name"]: entry.get("value") for entry in item.get("env", [])}


def allows_database_or_api(targets, target, policy, port, labels):
    expected = {
        "namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "ofz"}},
        "podSelector": {"matchLabels": labels},
    }
    rules = resource(targets, target, "NetworkPolicy", policy)["spec"]["egress"]
    return any(
        expected in rule.get("to", [])
        and {"protocol": "TCP", "port": port} in rule.get("ports", [])
        for rule in rules
    )


def validate(targets):
    workloads = [
        ("tengri", "Deployment", "tengri"),
        ("proompteng", "Deployment", "proompteng"),
        ("keycloak", "StatefulSet", "keycloak"),
        ("ofz", "Deployment", "ofz-api"),
    ]
    for target, documents in targets.items():
        for item in documents:
            if item:
                require(
                    item["kind"] != "Namespace",
                    f"{target}: namespace is ApplicationSet-owned",
                )
    native = resource(targets, "ofz", "SpiceDBCluster", "ofz")["spec"]["config"]
    require(
        native.get("dispatchCacheEnabled") == "false"
        and native.get("dispatchClusterCacheEnabled") == "false",
        "ofz: unqualified dispatch caches must stay disabled",
    )
    native_pool = int(native["datastoreConnPoolReadMaxOpen"]) + int(
        native["datastoreConnPoolWriteMaxOpen"]
    )
    maximum_connections = int(
        resource(targets, "ofz", "Cluster", "ofz-db")["spec"]["postgresql"][
            "parameters"
        ]["max_connections"]
    )
    require(
        (int(native["replicas"]) + 1) * native_pool + 3 * (14 + 12 + 8) + 6 * 2
        <= maximum_connections - 30,
        "ofz: simultaneous rolling surges exhaust the SQL connection budget",
    )
    for target, kind, name in workloads:
        spec = resource(targets, target, kind, name)["spec"]
        require(spec["replicas"] == 2, f"{target}: two serving replicas required")
        pod = spec["template"]["spec"]
        labels = spec["template"]["metadata"]["labels"]
        spread = (
            pod.get("affinity", {})
            .get("podAntiAffinity", {})
            .get("requiredDuringSchedulingIgnoredDuringExecution", [])
        )
        require(
            any(
                term["topologyKey"] == "kubernetes.io/hostname"
                and term["labelSelector"]["matchLabels"]
                and all(
                    labels.get(key) == value
                    for key, value in term["labelSelector"]["matchLabels"].items()
                )
                for term in spread
            ),
            f"{target}: required host spread must select the serving Pods",
        )
        pdb = resource(targets, target, "PodDisruptionBudget", name)["spec"]
        require(
            pdb.get("minAvailable") == 1,
            f"{target}: retain one replica during eviction",
        )
        require(
            all(
                labels.get(key) == value
                for key, value in pdb["selector"]["matchLabels"].items()
            ),
            f"{target}: disruption budget must select the serving Pods",
        )

    for target, role in [("tengri", "tengri_controller"), ("proompteng", "tengri_bff")]:
        spec = resource(targets, target, "Deployment", target)["spec"]["template"][
            "spec"
        ]
        app = container(targets, target, "Deployment", target)
        env = values(app)
        require(
            env.get("OFZ_GRPC_ENDPOINT") == "ofz-api.ofz.svc.cluster.local:9443",
            f"{target}: central API required",
        )
        require(
            role in env.get("TENGRI_DATABASE_DSN", ""),
            f"{target}: restricted database role required",
        )
        require(not app.get("envFrom"), f"{target}: unclassified credential injection")
        require(
            not {
                "TENGRI_AUTHZ_ENDPOINT",
                "TENGRI_AUTHZ_KEY_FILE",
                "TENGRI_RUNTIME_SECRET_DIRECTORY",
                "BETTER_AUTH_URL",
            }.intersection(env),
            f"{target}: legacy authority must be removed",
        )
        volumes = {volume["name"]: volume for volume in spec["volumes"]}
        mounts = {mount["mountPath"]: mount for mount in app["volumeMounts"]}
        expected = {
            "/var/run/tengri/database": "tengri-controller-db"
            if target == "tengri"
            else "tengri-bff-db",
            "/var/run/tengri/database-ca": "ofz-database-ca",
        }
        if target == "tengri":
            expected["/var/run/tengri/guest-signing"] = "tengri-guest-signing"
            require(
                env.get("TENGRI_GUEST_SIGNING_KEY_FILE")
                == "/var/run/tengri/guest-signing/key"
                and env.get("TENGRI_GUEST_RECOVERY_GENERATION_FILE")
                == "/var/run/tengri/guest-signing/recovery-generation",
                "tengri: signed guest requests require the private key and recovery generation",
            )
        else:
            require(
                not any(
                    volume.get("secret", {}).get("secretName") == "tengri-guest-signing"
                    for volume in volumes.values()
                ),
                "proompteng: guest signing key belongs only to controllers",
            )
        for path, secret in expected.items():
            mount = mounts.get(path, {})
            require(
                mount.get("readOnly") is True,
                f"{target}: {path} must be mounted read-only",
            )
            require(
                volumes.get(mount.get("name"), {}).get("secret", {}).get("secretName")
                == secret,
                f"{target}: {path} requires {secret}",
            )
        require(
            not any(
                volume.get("secret", {}).get("secretName")
                in {"tengri-runtime", "tengri-spicedb-key", "tengri-bff"}
                for volume in volumes.values()
            ),
            f"{target}: legacy credential volume remains",
        )
    bff = resource(targets, "proompteng", "Deployment", "proompteng")["spec"][
        "template"
    ]["spec"]
    require(
        not bff.get("nodeSelector", {}).get("kubernetes.io/arch"),
        "proompteng: host spread requires both architectures",
    )
    for target, policy in [
        ("tengri", "tengri-control-plane"),
        ("proompteng", "proompteng-web"),
    ]:
        require(
            allows_database_or_api(
                targets, target, policy, 9443, {"app.kubernetes.io/name": "ofz-api"}
            ),
            f"{target}: API egress is blocked",
        )
        require(
            allows_database_or_api(
                targets, target, policy, 5432, {"cnpg.io/cluster": "ofz-db"}
            ),
            f"{target}: shared database egress is blocked",
        )
    require(
        allows_database_or_api(
            targets, "tengri", "tengri-slots", 5432, {"cnpg.io/cluster": "ofz-db"}
        ),
        "tengri: supervisor database egress is blocked",
    )
    traefik = {
        "namespaceSelector": {
            "matchLabels": {"kubernetes.io/metadata.name": "traefik"}
        },
        "podSelector": {"matchLabels": {"app.kubernetes.io/name": "traefik"}},
    }
    bff_egress = resource(targets, "proompteng", "NetworkPolicy", "proompteng-web")[
        "spec"
    ]["egress"]
    require(
        any(
            traefik in rule.get("to", [])
            and {"protocol": "TCP", "port": 8443} in rule.get("ports", [])
            for rule in bff_egress
        ),
        "proompteng: post-DNAT identity-provider egress is blocked",
    )
    crd = resource(
        targets, "tengri", "CustomResourceDefinition", "microvms.runtime.proompteng.ai"
    )
    require(
        crd["spec"] == targets["crd"][0]["spec"],
        "tengri: rendered CRD differs from the generated contract",
    )
    require(
        not any(
            item
            and item["kind"] == "ConfigMap"
            and item["metadata"]["name"] == "tengri-auth-nonces"
            for item in targets["tengri"]
        ),
        "tengri: replay state must be durable SQL",
    )
    kc = values(container(targets, "keycloak", "StatefulSet", "keycloak"))
    require(
        kc.get("KC_CACHE_STACK") == "jdbc-ping" and kc.get("KC_CACHE") == "ispn",
        "keycloak: distributed JDBC cache required",
    )
    require(
        kc.get("KC_CACHE_EMBEDDED_MTLS_ENABLED") == "true",
        "keycloak: cache transport mTLS required",
    )
    require(
        kc.get("KC_HOSTNAME") == "https://auth.proompteng.ai"
        and kc.get("KC_HOSTNAME_STRICT") == "true",
        "keycloak: fixed HTTPS issuer required",
    )
    require(
        "sslmode=verify-full" in kc.get("KC_DB_URL", ""),
        "keycloak: database identity verification required",
    )
    require(
        kc.get("KC_DB_POOL_MAX_SIZE") == "20",
        "keycloak: bounded connection pool required",
    )
    database = resource(targets, "keycloak", "Cluster", "keycloak-db")["spec"]
    require(database["instances"] == 3, "keycloak: three database instances required")
    require(
        database["affinity"]["podAntiAffinityType"] == "required",
        "keycloak: database host spread required",
    )
    require(
        database["postgresql"]["synchronous"]
        == {"method": "any", "number": 1, "dataDurability": "required"},
        "keycloak: synchronous durability required",
    )
    ingress = resource(targets, "keycloak", "IngressRoute", "keycloak")["spec"]
    require(
        ingress["entryPoints"] == ["websecure"]
        and ingress["tls"]["secretName"] == "auth-proompteng-ai-tls",
        "keycloak: reviewed HTTPS certificate required",
    )
    network = resource(targets, "keycloak", "NetworkPolicy", "keycloak-server")["spec"]
    for direction, peer_key in [("ingress", "from"), ("egress", "to")]:
        ports = set()
        for rule in network[direction]:
            transport = {
                entry["port"]
                for entry in rule.get("ports", [])
                if entry["port"] in {7800, 57800}
            }
            if transport:
                ports.update(transport)
                require(
                    rule[peer_key]
                    == [{"podSelector": {"matchLabels": {"app": "keycloak"}}}],
                    f"keycloak: {direction} transport must stay server-only",
                )
        require(
            ports == {7800, 57800}, f"keycloak: {direction} cache transport is blocked"
        )


def main():
    directory = Path(sys.argv[1])
    targets = {
        name: json.loads((directory / f"{name}.json").read_text())
        for name in ["tengri", "proompteng", "keycloak", "ofz", "crd"]
    }
    validate(targets)
    mutations = [
        lambda data: container(data, "tengri", "Deployment", "tengri")["env"].append(
            {"name": "TENGRI_GUEST_SIGNING_KEY_FILE", "value": "/tmp/wrong-key"}
        ),
        lambda data: resource(data, "proompteng", "Deployment", "proompteng")["spec"][
            "template"
        ]["spec"]["volumes"].append(
            {"name": "guest-signing", "secret": {"secretName": "tengri-guest-signing"}}
        ),
        lambda data: resource(data, "ofz", "SpiceDBCluster", "ofz")["spec"][
            "config"
        ].update(dispatchCacheEnabled="true"),
        lambda data: resource(data, "ofz", "SpiceDBCluster", "ofz")["spec"][
            "config"
        ].update(datastoreConnPoolReadMaxOpen="20", datastoreConnPoolWriteMaxOpen="10"),
        lambda data: resource(data, "tengri", "Deployment", "tengri")["spec"].update(
            replicas=1
        ),
        lambda data: resource(data, "proompteng", "Deployment", "proompteng")["spec"][
            "template"
        ]["spec"].pop("affinity"),
        lambda data: resource(data, "tengri", "Deployment", "tengri")["spec"][
            "template"
        ]["spec"].update(volumes=[]),
        lambda data: container(data, "keycloak", "StatefulSet", "keycloak")[
            "env"
        ].append({"name": "KC_CACHE_EMBEDDED_MTLS_ENABLED", "value": "false"}),
        lambda data: resource(data, "keycloak", "Cluster", "keycloak-db")["spec"][
            "postgresql"
        ]["synchronous"].update(dataDurability="preferred"),
        lambda data: resource(
            data, "tengri", "CustomResourceDefinition", "microvms.runtime.proompteng.ai"
        )["spec"].update(versions=[]),
        lambda data: data["ofz"].append(
            {"kind": "Namespace", "metadata": {"name": "ofz"}}
        ),
        lambda data: resource(data, "tengri", "NetworkPolicy", "tengri-control-plane")[
            "spec"
        ].update(egress=[]),
        lambda data: resource(data, "keycloak", "NetworkPolicy", "keycloak-server")[
            "spec"
        ]["ingress"][-1].update({"from": [{"ipBlock": {"cidr": "0.0.0.0/0"}}]}),
    ]
    mutations.extend(
        [
            lambda data: resource(
                data, "proompteng", "NetworkPolicy", "proompteng-web"
            )["spec"].update(
                egress=[
                    rule
                    for rule in resource(
                        data, "proompteng", "NetworkPolicy", "proompteng-web"
                    )["spec"]["egress"]
                    if {"protocol": "TCP", "port": 8443} not in rule.get("ports", [])
                ]
            ),
            lambda data: resource(
                data, "proompteng", "NetworkPolicy", "proompteng-web"
            )["spec"]["egress"][-1]["to"][0]["podSelector"]["matchLabels"].update(
                {"app.kubernetes.io/name": "wrong-identity-provider"}
            ),
        ]
    )
    for index, mutate in enumerate(mutations):
        invalid = copy.deepcopy(targets)
        mutate(invalid)
        try:
            validate(invalid)
        except ValueError:
            continue
        raise RuntimeError(f"HA regression {index + 1} was accepted")
    print(f"PASS: four rendered HA targets and {len(mutations)} rejected regressions")


if __name__ == "__main__":
    main()
