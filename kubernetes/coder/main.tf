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

    export NVM_DIR="$HOME/.nvm"
    LOG_DIR="/tmp/coder-bootstrap"
    mkdir -p "$NVM_DIR" "$LOG_DIR"
    touch "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"
    NVM_VERSION="v0.39.7"
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
      if ! curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash >"$LOG_DIR/nvm-install.log" 2>&1; then
        echo "nvm install failed; see $LOG_DIR/nvm-install.log" >&2
      fi
    fi

    if [ -s "$NVM_DIR/nvm.sh" ]; then
      NVM_BASH_SNIPPET="$(cat <<'BASH_SNIPPET'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
BASH_SNIPPET
)"

      for rc_file in "$HOME/.profile" "$HOME/.bashrc"; do
        if ! grep -q "NVM_DIR" "$rc_file" 2>/dev/null; then
          printf '%s\n' "$NVM_BASH_SNIPPET" >> "$rc_file"
        fi
      done

      if ! grep -q "NVM_DIR" "$HOME/.zshrc" 2>/dev/null; then
        cat <<'ZSHRC_NVM' >> "$HOME/.zshrc"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
ZSHRC_NVM
      fi
    fi
    if [ -s "$NVM_DIR/nvm.sh" ]; then
      # shellcheck source=/dev/null
      . "$NVM_DIR/nvm.sh"
      nvm install --lts >/dev/null 2>&1 || nvm install 22 >/dev/null 2>&1 || true
      nvm use --lts >/dev/null 2>&1 || nvm use 22 >/dev/null 2>&1 || true
      nvm alias default "$(nvm current)" >/dev/null 2>&1 || true
    else
      echo "nvm not found; skipping Node.js LTS bootstrap" >&2
    fi

    export PNPM_HOME="$HOME/.local/share/pnpm"
    mkdir -p "$PNPM_HOME"
    mkdir -p "$HOME/.local/bin"
    case ":$PATH:" in
      *:"$HOME/.local/share/pnpm":* | *:"$PNPM_HOME":*) ;;
      *) export PATH="$PNPM_HOME:$PATH" ;;
    esac
    case ":$PATH:" in
      *:"$HOME/.local/bin":*) ;;
      *) export PATH="$HOME/.local/bin:$PATH" ;;
    esac

    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true

    if ! command -v brew >/dev/null 2>&1; then
      export NONINTERACTIVE=1
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" >/tmp/homebrew-install.log 2>&1 || true
    fi

    if [ -d "/home/linuxbrew/.linuxbrew/bin" ]; then
      eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

      if ! grep -q "brew shellenv" "$HOME/.profile" 2>/dev/null; then
        cat <<'BREW_PROFILE' >> "$HOME/.profile"
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
BREW_PROFILE
      fi

      if ! grep -q "brew shellenv" "$HOME/.zshrc" 2>/dev/null; then
        cat <<'BREW_ZSHRC' >> "$HOME/.zshrc"
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
BREW_ZSHRC
      fi
    fi

    if ! command -v convex >/dev/null 2>&1; then
      CONVEX_LOG="$LOG_DIR/convex-install.log"
      : > "$CONVEX_LOG"
      if command -v pnpm >/dev/null 2>&1; then
        if ! pnpm add --global convex@1.27.0 >"$CONVEX_LOG" 2>&1; then
          echo "Convex CLI install via pnpm failed; see $CONVEX_LOG" >&2
        fi
      elif command -v npm >/dev/null 2>&1; then
        if ! npm install --global convex@1.27.0 >"$CONVEX_LOG" 2>&1; then
          echo "Convex CLI install via npm failed; see $CONVEX_LOG" >&2
        fi
      else
        echo "Convex CLI install skipped: npm-compatible package manager not available" >&2
      fi
    fi

    if ! command -v codex >/dev/null 2>&1; then
      CODEX_LOG="$LOG_DIR/codex-install.log"
      : > "$CODEX_LOG"

      if command -v brew >/dev/null 2>&1; then
        if ! brew list codex >/dev/null 2>&1; then
          if ! brew install codex >>"$CODEX_LOG" 2>&1; then
            echo "Codex CLI install via Homebrew failed; see $CODEX_LOG" >&2
          fi
        fi
      fi

      if ! command -v codex >/dev/null 2>&1; then
        if command -v npm >/dev/null 2>&1; then
          if ! npm install --global @openai/codex >>"$CODEX_LOG" 2>&1; then
            echo "Codex CLI install via npm failed; see $CODEX_LOG" >&2
          fi
        elif command -v pnpm >/dev/null 2>&1; then
          if ! pnpm add --global @openai/codex >>"$CODEX_LOG" 2>&1; then
            echo "Codex CLI install via pnpm failed; see $CODEX_LOG" >&2
          fi
        else
          echo "Codex CLI install skipped: npm-compatible package manager not available" >&2
        fi
      fi
    fi

    if ! command -v kubectl >/dev/null 2>&1; then
      KUBECTL_ARCH="$(uname -m)"
      case "$KUBECTL_ARCH" in
        aarch64|arm64) KUBECTL_ARCH="arm64" ;;
        x86_64|amd64)  KUBECTL_ARCH="amd64" ;;
        *)             KUBECTL_ARCH="amd64" ;;
      esac

      KUBECTL_VERSION="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"
      curl -fsSLo "$HOME/.local/bin/kubectl" "https://dl.k8s.io/release/$${KUBECTL_VERSION}/bin/linux/$${KUBECTL_ARCH}/kubectl" && \
        chmod +x "$HOME/.local/bin/kubectl" || \
        echo "kubectl install skipped" >&2
    fi

    if ! command -v argocd >/dev/null 2>&1; then
      ARGOCD_ARCH="$(uname -m)"
      case "$ARGOCD_ARCH" in
        aarch64|arm64) ARGOCD_ARCH="arm64" ;;
        x86_64|amd64)  ARGOCD_ARCH="amd64" ;;
        *)             ARGOCD_ARCH="amd64" ;;
      esac

      curl -fsSLo "$HOME/.local/bin/argocd" "https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-$${ARGOCD_ARCH}" && \
        chmod +x "$HOME/.local/bin/argocd" || \
        echo "argocd install skipped" >&2
    fi

    REPO_ROOT="${local.repository_folder}"
    case "$REPO_ROOT" in
      ~*) REPO_ROOT="$${HOME}$${REPO_ROOT#~}" ;;
    esac

    if [ -d "$REPO_ROOT/.git" ]; then
      if command -v pnpm >/dev/null 2>&1 && [ -f "$REPO_ROOT/pnpm-lock.yaml" ]; then
        PNPM_LOG="$LOG_DIR/pnpm-install.log"
        : > "$PNPM_LOG"
        if ! (cd "$REPO_ROOT" && pnpm install --frozen-lockfile >>"$PNPM_LOG" 2>&1); then
          if ! (cd "$REPO_ROOT" && pnpm install >>"$PNPM_LOG" 2>&1); then
            echo "pnpm install failed; see $PNPM_LOG" >&2
          fi
        fi
      elif command -v pnpm >/dev/null 2>&1 && [ -f "$REPO_ROOT/package.json" ]; then
        PNPM_LOG="$LOG_DIR/pnpm-install.log"
        : > "$PNPM_LOG"
        if ! (cd "$REPO_ROOT" && pnpm install >>"$PNPM_LOG" 2>&1); then
          echo "pnpm install failed; see $PNPM_LOG" >&2
        fi
      elif command -v npm >/dev/null 2>&1 && [ -f "$REPO_ROOT/package.json" ]; then
        NPM_LOG="$LOG_DIR/npm-install.log"
        : > "$NPM_LOG"
        if ! (cd "$REPO_ROOT" && npm install >>"$NPM_LOG" 2>&1); then
          echo "npm install failed; see $NPM_LOG" >&2
        fi
      fi
    else
      echo "Repository directory '$REPO_ROOT' not found; skipping dependency install" >&2
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
  EOT

  depends_on = [module.git-clone, module.nodejs]
}
