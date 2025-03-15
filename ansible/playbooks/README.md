# Tailscale Installation Playbook for Ubuntu

This playbook installs Tailscale on Ubuntu hosts defined in the inventory file, following the official Tailscale installation method for Ubuntu.

## Prerequisites

- Ansible installed on the control node
- SSH access to all target hosts
- Sudo privileges on target hosts
- All hosts running Ubuntu

## Usage

Run the playbook with:

```bash
# Run with interactive authentication (will provide login URLs)
ansible-playbook -i ../inventory/hosts.ini install_tailscale.yml

# Run with automatic authentication using an authkey
export TAILSCALE_AUTHKEY=tskey-auth-xxxxxxxxxxxx
ansible-playbook -i ../inventory/hosts.ini install_tailscale.yml
```

You can get an auth key from the [Tailscale Admin Console](https://login.tailscale.com/admin/settings/keys).

## Playbook Details

The playbook:

1. Adds the official Tailscale package signing key
2. Adds the Tailscale repository for Ubuntu
3. Installs the Tailscale package
4. Starts and enables the Tailscale service
5. Runs `tailscale up` with the authkey from TAILSCALE_AUTHKEY environment variable (if set)
   or without an authkey (interactive authentication) if not set

## Post-Installation

If not using an authkey, after installation, you'll need to authenticate each node to your Tailscale network:

1. Check the logs on each node to find the authentication URL
2. Complete the authentication in a web browser using the URL

The official Tailscale installation documentation used: https://tailscale.com/kb/1187/install-ubuntu-2204
