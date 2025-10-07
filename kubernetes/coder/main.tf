terraform {
  required_providers {
    coder = {
      source = "coder/coder"
    }
    kubernetes = {
      source = "hashicorp/kubernetes"
    }
  }
}

provider "coder" {
}

variable "use_kubeconfig" {
  type        = bool
  description = <<-EOF
  Use host kubeconfig? (true/false)

  Set this to false if the Coder host is itself running as a Pod on the same
  Kubernetes cluster as you are deploying workspaces to.

  Set this to true if the Coder host is running outside the Kubernetes cluster
  for workspaces.  A valid "~/.kube/config" must be present on the Coder host.
  EOF
  default     = false
}

variable "namespace" {
  type        = string
  description = "The Kubernetes namespace to create workspaces in (must exist prior to creating workspaces). If the Coder host is itself running as a Pod on the same Kubernetes cluster as you are deploying workspaces to, set this to the same namespace."
  default     = "coder"
}

data "coder_parameter" "cpu" {
  name         = "cpu"
  display_name = "CPU"
  description  = "The number of CPU cores"
  default      = "4"
  icon         = "/icon/memory.svg"
  mutable      = true
  option {
    name  = "4 Cores"
    value = "4"
  }
  option {
    name  = "6 Cores"
    value = "6"
  }
  option {
    name  = "8 Cores"
    value = "8"
  }
}

data "coder_parameter" "memory" {
  name         = "memory"
  display_name = "Memory"
  description  = "The amount of memory in GB"
  default      = "8"
  icon         = "/icon/memory.svg"
  mutable      = true
  option {
    name  = "4 GB"
    value = "4"
  }
  option {
    name  = "6 GB"
    value = "6"
  }
  option {
    name  = "8 GB"
    value = "8"
  }
}

data "coder_parameter" "home_disk_size" {
  name         = "home_disk_size"
  display_name = "Home disk size"
  description  = "The size of the home disk in GB"
  default      = "30"
  type         = "number"
  icon         = "/emojis/1f4be.png"
  mutable      = false
  validation {
    min = 1
    max = 99999
  }
}

data "coder_parameter" "repository_url" {
  name         = "repository_url"
  display_name = "Repository URL"
  description  = "Git URL to clone into the workspace"
  default      = "https://github.com/gregkonush/lab"
  icon         = "/icon/git-branch.svg"
  mutable      = true
}

data "coder_parameter" "repository_directory" {
  name         = "repository_directory"
  display_name = "Checkout directory"
  description  = "Parent directory for the cloned repository"
  default      = "~/github.com"
  icon         = "/icon/folder.svg"
  mutable      = true
}

locals {
  repository_url           = trimspace(data.coder_parameter.repository_url.value)
  repository_directory_raw = trimspace(trimsuffix(data.coder_parameter.repository_directory.value, "/"))
  repository_directory     = local.repository_directory_raw != "" ? local.repository_directory_raw : "~/github.com"
  repository_name          = try(regex("[^/]+(?=\\.git$|$)", local.repository_url), "workspace")
  repository_folder        = "${local.repository_directory}/${local.repository_name}"
}

provider "kubernetes" {
  # Authenticate via ~/.kube/config or a Coder-specific ServiceAccount, depending on admin preferences
  config_path = var.use_kubeconfig == true ? "~/.kube/config" : null
}

data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

resource "coder_agent" "main" {
  os             = "linux"
  arch           = "arm64"
  startup_script = <<-EOT
    set -e

    # Install the latest code-server.
    # Append "--version x.x.x" to install a specific version of code-server.
    curl -fsSL https://code-server.dev/install.sh | sh -s -- --method=standalone --prefix=/tmp/code-server

    # Start code-server in the background.
    /tmp/code-server/bin/code-server --auth none --port 13337 >/tmp/code-server.log 2>&1 &
  EOT

  # The following metadata blocks are optional. They are used to display
  # information about your workspace in the dashboard. You can remove them
  # if you don't want to display any information.
  # For basic resources, you can use the `coder stat` command.
  # If you need more control, you can write your own script.
  metadata {
    display_name = "CPU Usage"
    key          = "0_cpu_usage"
    script       = "coder stat cpu"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "RAM Usage"
    key          = "1_ram_usage"
    script       = "coder stat mem"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "Home Disk"
    key          = "3_home_disk"
    script       = "coder stat disk --path $${HOME}"
    interval     = 60
    timeout      = 1
  }

  metadata {
    display_name = "CPU Usage (Host)"
    key          = "4_cpu_usage_host"
    script       = "coder stat cpu --host"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "Memory Usage (Host)"
    key          = "5_mem_usage_host"
    script       = "coder stat mem --host"
    interval     = 10
    timeout      = 1
  }

  metadata {
    display_name = "Load Average (Host)"
    key          = "6_load_host"
    # get load avg scaled by number of cores
    script   = <<EOT
      echo "`cat /proc/loadavg | awk '{ print $1 }'` `nproc`" | awk '{ printf "%0.2f", $1/$2 }'
    EOT
    interval = 60
    timeout  = 1
  }
}

# code-server
resource "coder_app" "code-server" {
  agent_id     = coder_agent.main.id
  slug         = "code-server"
  display_name = "code-server"
  icon         = "/icon/code.svg"
  url          = "http://localhost:13337?folder=/home/coder"
  subdomain    = false
  share        = "owner"

  healthcheck {
    url       = "http://localhost:13337/healthz"
    interval  = 3
    threshold = 10
  }
}

resource "kubernetes_persistent_volume_claim" "home" {
  metadata {
    name      = "coder-${data.coder_workspace.me.id}-home"
    namespace = var.namespace
    labels = {
      "app.kubernetes.io/name"     = "coder-pvc"
      "app.kubernetes.io/instance" = "coder-pvc-${data.coder_workspace.me.id}"
      "app.kubernetes.io/part-of"  = "coder"
      //Coder-specific labels.
      "com.coder.resource"       = "true"
      "com.coder.workspace.id"   = data.coder_workspace.me.id
      "com.coder.workspace.name" = data.coder_workspace.me.name
      "com.coder.user.id"        = data.coder_workspace_owner.me.id
      "com.coder.user.username"  = data.coder_workspace_owner.me.name
    }
    annotations = {
      "com.coder.user.email" = data.coder_workspace_owner.me.email
    }
  }
  wait_until_bound = false
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = {
        storage = "${data.coder_parameter.home_disk_size.value}Gi"
      }
    }
  }
}

resource "kubernetes_deployment" "main" {
  count = data.coder_workspace.me.start_count
  depends_on = [
    kubernetes_persistent_volume_claim.home
  ]
  wait_for_rollout = false
  metadata {
    name      = "coder-${data.coder_workspace.me.id}"
    namespace = var.namespace
    labels = {
      "app.kubernetes.io/name"     = "coder-workspace"
      "app.kubernetes.io/instance" = "coder-workspace-${data.coder_workspace.me.id}"
      "app.kubernetes.io/part-of"  = "coder"
      "com.coder.resource"         = "true"
      "com.coder.workspace.id"     = data.coder_workspace.me.id
      "com.coder.workspace.name"   = data.coder_workspace.me.name
      "com.coder.user.id"          = data.coder_workspace_owner.me.id
      "com.coder.user.username"    = data.coder_workspace_owner.me.name
    }
    annotations = {
      "com.coder.user.email" = data.coder_workspace_owner.me.email
    }
  }

  spec {
    replicas = 1
    selector {
      match_labels = {
        "app.kubernetes.io/name"     = "coder-workspace"
        "app.kubernetes.io/instance" = "coder-workspace-${data.coder_workspace.me.id}"
        "app.kubernetes.io/part-of"  = "coder"
        "com.coder.resource"         = "true"
        "com.coder.workspace.id"     = data.coder_workspace.me.id
        "com.coder.workspace.name"   = data.coder_workspace.me.name
        "com.coder.user.id"          = data.coder_workspace_owner.me.id
        "com.coder.user.username"    = data.coder_workspace_owner.me.name
      }
    }
    strategy {
      type = "Recreate"
    }

    template {
      metadata {
        labels = {
          "app.kubernetes.io/name"     = "coder-workspace"
          "app.kubernetes.io/instance" = "coder-workspace-${data.coder_workspace.me.id}"
          "app.kubernetes.io/part-of"  = "coder"
          "com.coder.resource"         = "true"
          "com.coder.workspace.id"     = data.coder_workspace.me.id
          "com.coder.workspace.name"   = data.coder_workspace.me.name
          "com.coder.user.id"          = data.coder_workspace_owner.me.id
          "com.coder.user.username"    = data.coder_workspace_owner.me.name
        }
      }
      spec {
        security_context {
          run_as_user     = 1000
          fs_group        = 1000
          run_as_non_root = true
        }

        container {
          name              = "dev"
          image             = "codercom/enterprise-base:ubuntu"
          image_pull_policy = "Always"
          command           = ["sh", "-c", replace(coder_agent.main.init_script, "coder-linux-amd64", "coder-linux-arm64")]
          security_context {
            run_as_user = "1000"
          }
          env {
            name  = "CODER_AGENT_TOKEN"
            value = coder_agent.main.token
          }
          resources {
            requests = {
              "cpu"    = "250m"
              "memory" = "512Mi"
            }
            limits = {
              "cpu"    = "${data.coder_parameter.cpu.value}"
              "memory" = "${data.coder_parameter.memory.value}Gi"
            }
          }
          volume_mount {
            mount_path = "/home/coder"
            name       = "home"
            read_only  = false
          }
        }

        volume {
          name = "home"
          persistent_volume_claim {
            claim_name = kubernetes_persistent_volume_claim.home.metadata.0.name
            read_only  = false
          }
        }

        affinity {
          // This affinity attempts to spread out all workspace pods evenly across
          // nodes.
          pod_anti_affinity {
            preferred_during_scheduling_ignored_during_execution {
              weight = 1
              pod_affinity_term {
                topology_key = "kubernetes.io/hostname"
                label_selector {
                  match_expressions {
                    key      = "app.kubernetes.io/name"
                    operator = "In"
                    values   = ["coder-workspace"]
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

module "git-clone" {
  source   = "registry.coder.com/coder/git-clone/coder"
  version  = "1.1.1"
  agent_id = coder_agent.main.id
  url      = local.repository_url
  base_dir = local.repository_directory
}

module "cursor" {
  source     = "registry.coder.com/coder/cursor/coder"
  version    = "1.3.2"
  agent_id   = coder_agent.main.id
  folder     = local.repository_folder
  depends_on = [module.git-clone]
}

module "nodejs" {
  source               = "registry.coder.com/thezoker/nodejs/coder"
  version              = "1.0.11"
  agent_id             = coder_agent.main.id
  node_versions        = ["20", "22"]
  default_node_version = "22"
}

resource "coder_script" "bootstrap_tools" {
  agent_id           = coder_agent.main.id
  display_name       = "Bootstrap developer tools"
  run_on_start       = true
  start_blocks_login = true
  script             = <<-EOT
    #!/usr/bin/env bash
    set -euo pipefail

    log() {
      printf '[bootstrap] %s\n' "$1" | tee -a "$LOG_FILE"
    }

    fail() {
      printf '[bootstrap][error] %s\n' "$1" | tee -a "$LOG_FILE" >&2
      exit 1
    }

    wait_for_path() {
      local target="$1"
      local attempts="$${2:-60}"
      local sleep_seconds="$${3:-2}"
      local i
      for ((i = 0; i < attempts; i++)); do
        if [ -s "$target" ]; then
          return 0
        fi
        sleep "$sleep_seconds"
      done
      return 1
    }

    normalize_nvm_dir() {
      if [ -s "$NVM_DIR/nvm.sh" ]; then
        return 0
      fi
      if [ -s "$NVM_DIR/nvm/nvm.sh" ]; then
        NVM_DIR="$NVM_DIR/nvm"
        export NVM_DIR
        return 0
      fi
      return 1
    }

    wait_for_nvm_dir() {
      local attempts="$${1:-60}"
      local sleep_seconds="$${2:-2}"
      local i
      for ((i = 0; i < attempts; i++)); do
        if normalize_nvm_dir; then
          return 0
        fi
        sleep "$sleep_seconds"
      done
      return 1
    }

    wait_for_command() {
      local cmd="$1"
      local attempts="$${2:-60}"
      local sleep_seconds="$${3:-2}"
      local i
      for ((i = 0; i < attempts; i++)); do
        if command -v "$cmd" >/dev/null 2>&1; then
          return 0
        fi
        sleep "$sleep_seconds"
      done
      return 1
    }

    has_nvm_version() {
      local major="$1"
      local candidate
      for candidate in "$NVM_DIR"/versions/node/v"$major".*/bin/node; do
        if [ -x "$candidate" ]; then
          return 0
        fi
      done
      return 1
    }

    wait_for_nvm_version() {
      local major="$1"
      local attempts="$${2:-60}"
      local sleep_seconds="$${3:-2}"
      local i
      for ((i = 0; i < attempts; i++)); do
        if has_nvm_version "$major"; then
          return 0
        fi
        sleep "$sleep_seconds"
      done
      return 1
    }

    LOG_DIR="/tmp/coder-bootstrap"
    mkdir -p "$LOG_DIR"
    LOG_FILE="$LOG_DIR/bootstrap.log"
    log "Starting developer tool bootstrap"
    touch "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"

    export PATH="$HOME/.local/bin:$PATH"
    export PNPM_HOME="$HOME/.local/share/pnpm"
    mkdir -p "$PNPM_HOME" "$HOME/.local/bin" /tmp/coder-script-data/bin
    case ":$PATH:" in
      *:"$PNPM_HOME":*) ;;
      *) export PATH="$PNPM_HOME:$PATH" ;;
    esac

    export NVM_DIR="$HOME/.nvm"
    NVM_VERSION="v0.39.7"
    DEFAULT_NODE_MAJOR="22"
    mkdir -p "$NVM_DIR"

    if ! normalize_nvm_dir; then
      log "Waiting for nvm from module.nodejs"
      if ! wait_for_nvm_dir 90 2; then
        log "module.nodejs did not publish nvm in time; installing nvm $NVM_VERSION"
        if ! curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash >"$LOG_DIR/nvm-install.log" 2>&1; then
          fail "nvm install failed; see $LOG_DIR/nvm-install.log"
        fi
        normalize_nvm_dir || fail "nvm not available after install; see $LOG_DIR/nvm-install.log"
      fi
    fi

    if normalize_nvm_dir; then
      . "$NVM_DIR/nvm.sh"
    else
      fail "nvm not available after install; see $LOG_DIR/nvm-install.log"
    fi

    if ! wait_for_nvm_version "$DEFAULT_NODE_MAJOR" 90 2; then
      log "Node.js $DEFAULT_NODE_MAJOR not detected; installing via nvm"
      if ! nvm install "$DEFAULT_NODE_MAJOR" >"$LOG_DIR/node-install.log" 2>&1; then
        fail "Node.js install failed; see $LOG_DIR/node-install.log"
      fi
    else
      log "Detected Node.js $DEFAULT_NODE_MAJOR provisioned by module.nodejs"
    fi

    if ! nvm use "$DEFAULT_NODE_MAJOR" >/dev/null 2>&1; then
      log "Retrying Node.js $DEFAULT_NODE_MAJOR install"
      if ! nvm install "$DEFAULT_NODE_MAJOR" >"$LOG_DIR/node-install.log" 2>&1; then
        fail "Node.js install failed; see $LOG_DIR/node-install.log"
      fi
      nvm use "$DEFAULT_NODE_MAJOR" >/dev/null 2>&1 || fail "Unable to switch to Node.js $DEFAULT_NODE_MAJOR"
    fi

    nvm alias default "$DEFAULT_NODE_MAJOR" >/dev/null 2>&1 || true
    hash -r

    if command -v node >/dev/null 2>&1; then
      NODE_VERSION=$(node --version 2>/dev/null || echo "unknown")
      log "Node $NODE_VERSION ready"
    fi

    if ! wait_for_command npm 60 2; then
      fail "npm not found after Node.js install; see $LOG_DIR/node-install.log"
    fi

    if ! command -v corepack >/dev/null 2>&1; then
      log "Waiting for corepack availability"
      wait_for_command corepack 60 2 || log "corepack still unavailable; continuing with npm fallback"
    fi

    if command -v corepack >/dev/null 2>&1; then
      log "Enabling corepack"
      corepack enable >/dev/null 2>&1 || true
      if corepack prepare pnpm@9 --activate >"$LOG_DIR/pnpm-prepare.log" 2>&1; then
        hash -r
      fi
    else
      log "corepack not available; will fall back to npm installation"
    fi

    if ! command -v pnpm >/dev/null 2>&1; then
      log "Activating pnpm via corepack"
      if command -v corepack >/dev/null 2>&1; then
        if ! corepack prepare pnpm@9 --activate >"$LOG_DIR/pnpm-prepare.log" 2>&1; then
          log "corepack activation failed; falling back to npm install"
        else
          hash -r
        fi
      fi
    fi

    if ! command -v pnpm >/dev/null 2>&1; then
      log "Installing pnpm via npm fallback"
      if ! npm install -g pnpm >"$LOG_DIR/pnpm-install.log" 2>&1; then
        fail "pnpm install failed; see $LOG_DIR/pnpm-install.log"
      fi
      hash -r
    fi

    if ! command -v pnpm >/dev/null 2>&1; then
      fail "pnpm not found after install; see $LOG_DIR/pnpm-install.log"
    fi

    if command -v pnpm >/dev/null 2>&1; then
      PNPM_VERSION=$(pnpm --version 2>/dev/null || echo "unknown")
      log "pnpm $PNPM_VERSION ready"
    fi

    if ! command -v convex >/dev/null 2>&1; then
      log "Installing Convex CLI"
      if ! npm install -g convex@1.27.0 >"$LOG_DIR/convex-install.log" 2>&1; then
        fail "Convex CLI install failed; see $LOG_DIR/convex-install.log"
      fi
    fi

    if ! command -v codex >/dev/null 2>&1; then
      log "Installing OpenAI Codex CLI"
      if ! npm install -g @openai/codex >"$LOG_DIR/codex-install.log" 2>&1; then
        fail "Codex CLI install failed; see $LOG_DIR/codex-install.log"
      fi
    fi

    if ! command -v kubectl >/dev/null 2>&1; then
      log "Installing kubectl"
      KUBECTL_ARCH="$(uname -m)"
      case "$KUBECTL_ARCH" in
        aarch64|arm64) KUBECTL_ARCH="arm64" ;;
        x86_64|amd64)  KUBECTL_ARCH="amd64" ;;
        *)             KUBECTL_ARCH="amd64" ;;
      esac
      KUBECTL_VERSION="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"
      if ! curl -fsSLo "$HOME/.local/bin/kubectl" "https://dl.k8s.io/release/$${KUBECTL_VERSION}/bin/linux/$${KUBECTL_ARCH}/kubectl" 2>"$LOG_DIR/kubectl-install.log"; then
        fail "kubectl download failed; see $LOG_DIR/kubectl-install.log"
      fi
      chmod +x "$HOME/.local/bin/kubectl"
      ln -sf "$HOME/.local/bin/kubectl" /tmp/coder-script-data/bin/kubectl
    fi

    if ! command -v argocd >/dev/null 2>&1; then
      log "Installing Argo CD CLI"
      ARGOCD_ARCH="$(uname -m)"
      case "$ARGOCD_ARCH" in
        aarch64|arm64) ARGOCD_ARCH="arm64" ;;
        x86_64|amd64)  ARGOCD_ARCH="amd64" ;;
        *)             ARGOCD_ARCH="amd64" ;;
      esac
      if ! curl -fsSLo "$HOME/.local/bin/argocd" "https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-$${ARGOCD_ARCH}" 2>"$LOG_DIR/argocd-install.log"; then
        fail "Argo CD CLI download failed; see $LOG_DIR/argocd-install.log"
      fi
      chmod +x "$HOME/.local/bin/argocd"
      ln -sf "$HOME/.local/bin/argocd" /tmp/coder-script-data/bin/argocd
    fi

    if ! command -v gh >/dev/null 2>&1; then
      log "Installing GitHub CLI"
      GH_ARCH="$(uname -m)"
      case "$GH_ARCH" in
        aarch64|arm64) GH_ARCH="arm64" ;;
        x86_64|amd64)  GH_ARCH="amd64" ;;
        *)             GH_ARCH="amd64" ;;
      esac
      GH_VERSION="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest 2>/dev/null | grep -m1 '\"tag_name\"' | sed -E 's/.*\"tag_name\": *\"v?([^\" ]+)\".*/\\1/')"
      if [ -z "$GH_VERSION" ]; then
        GH_VERSION="2.55.0"
        log "Unable to determine latest GitHub CLI version; falling back to $GH_VERSION"
      fi
      GH_TMP="$(mktemp -d)"
      GH_TAR="$GH_TMP/gh.tar.gz"
      if ! curl -fsSLo "$GH_TAR" "https://github.com/cli/cli/releases/download/v$${GH_VERSION}/gh_$${GH_VERSION}_linux_$${GH_ARCH}.tar.gz" 2>"$LOG_DIR/gh-install.log"; then
        rm -rf "$GH_TMP"
        fail "GitHub CLI download failed; see $LOG_DIR/gh-install.log"
      fi
      if ! tar -xzf "$GH_TAR" -C "$GH_TMP" >>"$LOG_DIR/gh-install.log" 2>&1; then
        rm -rf "$GH_TMP"
        fail "GitHub CLI extract failed; see $LOG_DIR/gh-install.log"
      fi
      GH_DIR="$(find "$GH_TMP" -maxdepth 1 -type d -name 'gh_*' | head -n1)"
      if [ -z "$GH_DIR" ] || [ ! -x "$GH_DIR/bin/gh" ]; then
        rm -rf "$GH_TMP"
        fail "GitHub CLI archive missing expected binary; see $LOG_DIR/gh-install.log"
      fi
      install -m 0755 "$GH_DIR/bin/gh" "$HOME/.local/bin/gh"
      ln -sf "$HOME/.local/bin/gh" /tmp/coder-script-data/bin/gh
      rm -rf "$GH_TMP"
    fi

    NVM_SNIPPET="$(cat <<BASH_SNIPPET
export NVM_DIR="$NVM_DIR"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
BASH_SNIPPET
    )"

    for rc_file in "$HOME/.profile" "$HOME/.bashrc"; do
      if ! grep -q "NVM_DIR" "$rc_file" 2>/dev/null; then
        printf '%s\n' "$NVM_SNIPPET" >> "$rc_file"
      fi
    done

    if ! grep -q "NVM_DIR" "$HOME/.zshrc" 2>/dev/null; then
      cat <<ZSHRC_NVM >> "$HOME/.zshrc"
export NVM_DIR="$NVM_DIR"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
ZSHRC_NVM
    fi

    if ! grep -q "PNPM_HOME" "$HOME/.profile" 2>/dev/null; then
      cat <<'PROFILE' >> "$HOME/.profile"
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"
export PATH="$HOME/.local/bin:$PATH"
PROFILE
    fi

    if ! grep -q "PNPM_HOME" "$HOME/.zshrc" 2>/dev/null; then
      cat <<'ZSHRC' >> "$HOME/.zshrc"
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"
export PATH="$HOME/.local/bin:$PATH"
ZSHRC
    fi

    REPO_ROOT="${local.repository_folder}"
    case "$REPO_ROOT" in
      ~*) REPO_ROOT="$${HOME}$${REPO_ROOT#~}" ;;
    esac

    if [ ! -d "$REPO_ROOT/.git" ]; then
      for candidate in "$${REPO_ROOT%/*}"/*; do
        if [ -d "$candidate/.git" ]; then
          REPO_ROOT="$candidate"
          log "Detected cloned repository at $REPO_ROOT"
          break
        fi
      done
    fi

    if [ -d "$REPO_ROOT/.git" ]; then
      if [ -f "$REPO_ROOT/pnpm-lock.yaml" ]; then
        log "Installing workspace dependencies with pnpm"
        if ! (cd "$REPO_ROOT" && pnpm install --frozen-lockfile >"$LOG_DIR/pnpm-install.log" 2>&1); then
          fail "pnpm install failed; see $LOG_DIR/pnpm-install.log"
        fi
      elif [ -f "$REPO_ROOT/package.json" ]; then
        log "Installing workspace dependencies with npm"
        if ! (cd "$REPO_ROOT" && npm install >"$LOG_DIR/npm-install.log" 2>&1); then
          fail "npm install failed; see $LOG_DIR/npm-install.log"
        fi
      else
        log "No Node.js manifest found in $REPO_ROOT; skipping dependency install"
      fi
    else
      log "Repository directory '$REPO_ROOT' not found; skipping dependency install"
    fi

    log "Bootstrap complete"
  EOT

  depends_on = [module.git-clone, module.nodejs]
}
