# kubectl aliases and helpers for the oh-my-posh Zsh setup.
# The file is sourced from .zshrc so keep definitions idempotent.

if ! command -v kubectl >/dev/null 2>&1; then
  return 0
fi

# Keep kubectl completion available even when running without Oh My Zsh.
if [[ -z ${__KUBECTL_COMPLETION_SOURCED:-} ]]; then
  if command -v kubectl >/dev/null 2>&1; then
    autoload -U +X compinit && compinit
    source <(kubectl completion zsh 2>/dev/null)
    __KUBECTL_COMPLETION_SOURCED=1
  fi
fi

alias k='kubectl'
alias kga='kubectl get all'
alias kg='kubectl get'
alias kgp='kubectl get pods'
alias kgd='kubectl get deployments'
alias kgs='kubectl get services'
alias kgns='kubectl get namespaces'
alias kdes='kubectl describe'
alias kaf='kubectl apply -f'
alias kdel='kubectl delete'
alias klogs='kubectl logs -f'
alias ktop='kubectl top pod'

if (( $+functions[compdef] )); then
  compdef k=kubectl 2>/dev/null
fi

__k_current_namespace() {
  local ns
  ns=$(kubectl config view --minify --output 'jsonpath={..namespace}' 2>/dev/null)
  [[ -n $ns ]] && print -r -- "$ns" || print -r -- default
}

__k_require_fzf() {
  if command -v fzf >/dev/null 2>&1; then
    return 0
  fi
  print -u2 -- 'kubectl helper requires fzf; install fzf or set FZF_DEFAULT_COMMAND.'
  return 1
}

kctx() {
  __k_require_fzf || return
  local current ctx
  current=$(kubectl config current-context 2>/dev/null)
  ctx=$(kubectl config get-contexts -o name 2>/dev/null | \
    fzf --prompt='kctx> ' --height=40% --border \
        --preview 'kubectl config view --minify --flatten --context {}' \
        --preview-window=right:60%:wrap \
        --header="current: ${current:-none}") || return
  [[ -n $ctx ]] && kubectl config use-context "$ctx"
}

kns() {
  __k_require_fzf || return
  local ns
  ns=$(kubectl get namespaces -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | \
    fzf --prompt='kns> ' --height=40% --border \
        --preview 'kubectl get namespace {} -o yaml' \
        --preview-window=right:60%:wrap) || return
  [[ -n $ns ]] && kubectl config set-context --current --namespace="$ns"
}

__k_select_pod() {
  __k_require_fzf || return
  local ns line pod
  ns=${1:-$(__k_current_namespace)}
  line=$(kubectl get pods -n "$ns" --no-headers 2>/dev/null | \
    fzf --prompt="pods (${ns})> " --height=50% --border \
        --header-lines=0 --preview "kubectl get pod -n ${ns} {1} -o yaml" \
        --preview-window=right:60%:wrap \
        --bind 'enter:accept' \
        --ansi) || return
  pod=${line%% *}
  [[ -n $pod ]] && print -r -- "$pod"
}

kexec() {
  local pod ns shell
  ns=${KUBECTL_NAMESPACE:-$(__k_current_namespace)}
  pod=${1:-$(__k_select_pod "$ns")} || return
  shell=${2:-/bin/sh}
  kubectl exec -it -n "$ns" "$pod" -- "${shell}"
}

kflog() {
  local pod ns container
  ns=${KUBECTL_NAMESPACE:-$(__k_current_namespace)}
  if [[ -n $1 ]]; then
    pod=$1; shift
  else
    pod=$(__k_select_pod "$ns") || return
  fi
  container=$1
  kubectl logs -f -n "$ns" ${container:+-c "$container"} "$pod"
}

kpf() {
  local pod ns ports
  ns=${KUBECTL_NAMESPACE:-$(__k_current_namespace)}
  if [[ -n $1 && $1 == *:* ]]; then
    ports=$1
    shift
  else
    ports=${2:-8080:80}
  fi
  pod=${1:-$(__k_select_pod "$ns")} || return
  kubectl port-forward -n "$ns" "$pod" "$ports"
}
