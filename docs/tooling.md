# Tooling Setup

This guide consolidates the CLI and runtime tooling used across the Experimentation Lab. Commands assume macOS (Homebrew) unless otherwise noted. Linux alternatives are included where relevant.

## Node.js, pnpm, and Bun

- Node.js 22.20.0 (managed by `nvm` inside the Coder template)
- pnpm 10.18.1 (installed automatically by `corepack` in the template)
- Optional Bun runtime:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```

## Terraform / OpenTofu

- Install Terraform via Homebrew:
  ```bash
  brew install terraform
  ```
- The repo primarily uses [OpenTofu](https://opentofu.org/) (see `tofu/`), invoked through package scripts such as `pnpm run tf:plan`.

## Kubernetes Tooling

- kubectl:
  ```bash
  brew install kubectl
  ```
- Optional: `./kubernetes/install.sh` seeds baseline manifests.
- Configure kubeconfig access to Harvester or lab clusters:
  ```bash
  # copy contents of downloaded config to ~/.kube/altra.yaml
  touch ~/.kube/altra.yaml
  ```

## Ansible

Used for host bootstrap and configuration (`ansible/`).
```bash
brew install ansible
```

## PostgreSQL

- CLI tools on macOS:
  ```bash
  brew install postgresql
  ```
- Server packages on Ubuntu:
  ```bash
  sudo apt update && sudo apt install postgresql
  ```
- Configure authentication as documented in the main README under **Database Setup**.

## Python Tooling

Some automation leverages Python-based utilities.

- Install pyenv:
  ```bash
  brew install pyenv
  ```
- Install Python 3.12:
  ```bash
  pyenv install 3.12
  ```
- Install pipx for isolated CLI tools:
  ```bash
  brew install pipx
  ```
- Manage project packages with Poetry via pipx:
  ```bash
  pipx install poetry
  ```

## GitHub CLI

Required for certain automation scripts.
```bash
brew install gh
```

---

Refer back to the main README for day-to-day workflows, infrastructure commands, and service-level documentation.
