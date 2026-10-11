# Bosgame M5 (Ryzen AI Max+ 395) - Talos driver notes

Last reviewed: 2026-10-11

## Network expansion and workload placement

The Galactic unit is a Bosgame M5 with a Ryzen AI Max+ 395. Talos reports a Realtek
RTL8125 Ethernet controller, PCI ID `10ec:8125`, on a PCIe 2.0 x1 link. Its `eno1`
interface currently negotiates 1000 Mb/s. The onboard controller supports 2.5GbE;
the current 1Gb/s link is not evidence of a 1GbE-only controller.

Bosgame exposes USB4 and two M.2 PCIe 4.0 x4 storage slots, without a conventional
PCIe x8 or x16 card slot. AMD specifies the USB4 ports at 40Gb/s. An M.2 PCIe 4.0 x4
adapter has about 63Gb/s of encoded lane bandwidth before transaction overhead.
Neither interface can carry a full 100Gb/s in one direction. An externally powered
M.2 NIC arrangement might negotiate a 100G Ethernet link, but would retain the PCIe
bottleneck and require separate power, mounting, and cooling. It is not a practical
full-rate 100G upgrade for this chassis.

Sources: [Bosgame M5 specifications](https://www.bosgamepc.com/products/bosgame-m5-ai-mini-desktop-ryzen-ai-max-395)
and [AMD Ryzen AI Max+ 395 specifications](https://www.amd.com/en/products/processors/laptop/ryzen/ai-300-series/amd-ryzen-ai-max-plus-395.html).
The controller, PCIe link, negotiated Ethernet speed, and CPU identity were read
from this unit on 2026-10-11.

Galactic therefore reserves Ryzen for compute and local storage. Its 1.8TB XFS
user volume at `/var/mnt/local-path-provisioner` shares the physical boot NVMe with
Talos `/var`; separate partitions isolate capacity, not disk I/O. Ceph services,
including the third monitor, retain access to Ryzen. Applications mounting Ceph
volumes use Altra or Turin. See the
[placement rollout](../../galactic/scheduling/README.md) for the scheduling contract.

## What this device is (vendor + AMD)

- Bosgame lists the M5 AI Mini Desktop with AMD Ryzen AI Max+ 395 and Radeon 8060S,
  up to 128GB LPDDR5X-8000, dual PCIe 4.0 M.2 slots, USB4 ports, HDMI 2.1, DisplayPort 2.1,
  SD 4.0, and 2.5GbE LAN.
  https://bosgamepc.com/products/bosgame-m5-ai-mini-desktop-ryzen-ai-max-395-128gb-2tb
- AMD specs for Ryzen AI Max+ 395: 16 cores / 32 threads, 3.0 GHz base, up to 5.1 GHz boost,
  80 MB cache, Radeon 8060S (40 graphics cores), 50 TOPS NPU, and 45-120W cTDP.
  https://www.amd.com/en/newsroom/press-releases/2025-1-6-amd-unveils-its-most-advanced-ai-pc-portfolio.html
- SKU note: Bosgame's product page says "No WiFi module" for this model, while third-party
  coverage of the M5 mentions Wi-Fi 7 and Bluetooth 5.2. Treat Wi-Fi/BT as SKU-dependent
  and verify the actual unit before assuming support.
  https://bosgamepc.com/products/bosgame-m5-ai-mini-desktop-ryzen-ai-max-395-128gb-2tb
  https://www.techradar.com/computing/mini-pcs/bosgame-teases-its-amd-ryzen-ai-max-395-mini-pc-with-128gb-of-ram-for-usd1999

## Vendor driver package inventory (Windows)

Bosgame's download center lists these driver packages for the M5:

- Chipset
- Graphics
- Audio
- Wi-Fi
- Bluetooth
- LAN
- Card reader
- ACP
- Camera
- Radeon Software
- DRTM
- Performance button

Source:
https://www.bosgamepc.com/pages/bosgamepc-downloader?view=m5-1

## Talos driver/extension implications

Talos is immutable: drivers are delivered via system extensions, and extensions only activate
on install/upgrade.
https://www.talos.dev/latest/talos-guides/configuration/system-extensions/

Talos 1.9+ removed AMDGPU from the base image; AMDGPU now requires system extensions.
https://www.talos.dev/v1.9/introduction/whats-new/#removed-amdgpu-from-the-base-image

### Required for Ryzen AI Max+ 395 GPU

The Talos AMD GPU guide indicates AMD GPU support requires these official extensions:

- siderolabs/amdgpu
- siderolabs/amd-ucode

For AMD Ryzen AI Max+ 395 (Strix Halo), the guide also lists extra kernel args:

- amd_iommu=off
- amdgpu.gttsize=131072
- ttm.pages_limit=33554432

These are embedded in boot assets via `devices/ryzen/manifests/ryzen-tailscale-schematic.yaml`
and applied by using an Image Factory installer image generated from that schematic.
https://docs.siderolabs.com/talos/v1.11/configure-your-talos-cluster/hardware-and-drivers/amd-gpu

## Action checklist (Talos)

1. Confirm Talos version on the node.
2. Build or select a Talos installer image that includes the required extensions and kernel args.
3. Apply updated machine config (installer image only) and perform upgrade so extensions activate.
4. Verify extensions are active: `talosctl get extensions`.
5. Install ROCm GPU Operator or AMD GPU device plugin in Kubernetes.
6. Validate GPU availability from workloads or runtime logs.

See `devices/ryzen/docs/amdgpu-device-plugin.md` for the pinned device plugin manifests and verification steps.

## Reproducible install (Talos v1.12.4, Ryzen node)

Talos boot assets must include the AMD GPU extensions and Strix Halo kernel args. The
installer will reject configs that set `install.extraKernelArgs` alongside
`install.grubUseUKICmdline`. Embed the kernel args in the installer image instead.

### 1) Create an Image Factory schematic + installer image

This repo tracks the schematic source-of-truth (extensions + kernel args):

- `devices/ryzen/manifests/ryzen-tailscale-schematic.yaml`

Generate a schematic ID:

```bash
SCHEMATIC_ID="$(
  curl -sS -X POST --data-binary @devices/ryzen/manifests/ryzen-tailscale-schematic.yaml \
    https://factory.talos.dev/schematics | jq -r .id
)"
```

The corresponding installer image is:

```text
factory.talos.dev/metal-installer/<schematic-id>:v1.12.4
```

### 2) Patch the node + upgrade (activates extensions)

```bash
export TALOSCONFIG=$PWD/devices/ryzen/talosconfig

cat > /tmp/ryzen-installer-image.patch.yaml <<EOF
machine:
  install:
    image: factory.talos.dev/metal-installer/${SCHEMATIC_ID}:v1.12.4
EOF

talosctl patch mc -n 192.168.1.194 -e 192.168.1.194 \
  --patch @/tmp/ryzen-installer-image.patch.yaml \
  --mode=no-reboot

# If drain is blocked by kubevirt PDBs:
kubectl --context galactic -n kubevirt delete pdb virt-controller-pdb

talosctl upgrade -n 192.168.1.194 -e 192.168.1.194 \
  --image factory.talos.dev/metal-installer/${SCHEMATIC_ID}:v1.12.4
```

### 3) Verify

```bash
talosctl get extensions -n 192.168.1.194 -e 192.168.1.194
talosctl read -n 192.168.1.194 -e 192.168.1.194 /proc/cmdline
kubectl --context galactic get nodes -o wide
```

## Open questions (verify on this unit)

- Actual Wi-Fi/BT module present? (SKU variations in sources.)
- NIC chipset for driver mapping.
- Any additional devices (card reader, camera, audio) you need in Talos.
