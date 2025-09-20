terraform {
  required_providers {
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.22.0"
    }
  }
}

provider "tailscale" {
  tailnet = var.tailnet
  api_key = var.tailscale_api_key
}

locals {
  // Rendered ACL policy managed by this stack.
  tailnet_acl = templatefile("${path.module}/templates/policy.hujson.tmpl", {})
}

resource "tailscale_acl" "tailnet" {
  acl = local.tailnet_acl
}

resource "tailscale_dns_preferences" "tailnet" {
  magic_dns = true
}

resource "tailscale_dns_nameservers" "tailnet" {
  nameservers = var.dns_nameservers
}
