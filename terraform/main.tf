terraform {
  required_providers {
    harvester = {
      source  = "harvester/harvester"
      version = "0.6.4"
    }
  }
  backend "pg" {
    conn_str = "postgres://localhost:5433/altra?sslmode=disable"
  }
}

provider "harvester" {
  kubeconfig = "~/.kube/altra.yaml"
}

resource "harvester_image" "ubuntu" {
  name         = "ubuntu"
  display_name = "Ubuntu Server Image"
  source_type  = "download"
  namespace    = "harvester-public"
  url          = "https://cloud-images.ubuntu.com/focal/current/focal-server-cloudimg-arm64.img"
}

resource "harvester_clusternetwork" "kube_network" {
  name = "kube-network"
}

resource "harvester_vlanconfig" "kube_vlan_config" {
  cluster_network_name = harvester_clusternetwork.kube_network.name
  name                 = "kube-vlan"
  uplink {
    nics = ["eth0", "eth1"]
  }
}
