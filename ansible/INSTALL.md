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
