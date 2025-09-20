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

data "tailscale_devices" "all" {}

locals {
  kube_devices = {
    for device in data.tailscale_devices.all.devices :
    device.hostname => device.id
    if length(device.hostname) > 0 && contains(coalesce(device.tags, []), "tag:kube-node")
  }
}

resource "tailscale_device_subnet_routes" "kube_nodes" {
  for_each = local.kube_devices

  device_id = each.value
  routes = [
    "10.42.0.0/16",
    "10.43.0.0/16"
  ]
}
