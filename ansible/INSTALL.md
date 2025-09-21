# Installing Ansible

## On macOS

```bash
# Using Homebrew
brew install ansible

# Using pip
pip install ansible
```

## On Ubuntu/Debian

```bash
# Add repository and install
sudo apt update
sudo apt install software-properties-common
sudo add-apt-repository --yes --update ppa:ansible/ansible
sudo apt install ansible

# Or using pip
sudo apt update
sudo apt install python3-pip
pip3 install ansible
```

## Verifying Installation

```bash
ansible --version
```

## Running the Tailscale Playbook

Once Ansible is installed:

```bash
cd ansible
ansible-playbook -i inventory/hosts.ini playbooks/install_tailscale.yml
```

## Installing the K3s Cluster (official playbook wrapper)

1. Install the official K3s Ansible collection:

   ```bash
   cd ansible
   ansible-galaxy collection install -r collections/requirements.yml
   ```

2. Update `inventory/group_vars/k3s_cluster.yml` with a secure `token` (use `ansible-vault` or an environment-specific override) and tweak any optional settings.

3. Run the wrapper playbook, which delegates to `k3s.orchestration.site` from the official collection:

   ```bash
   ansible-playbook -i inventory/hosts.ini playbooks/k3s-ha.yml
   ```

The official collection handles bootstrapping the first server, joining the remaining control-plane nodes, and enrolling all agents while honoring the configuration defined in `k3s_cluster.yml`.
