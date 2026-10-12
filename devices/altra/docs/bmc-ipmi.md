# Altra BMC and IPMI

This runbook records the out-of-band management address for the Altra Talos
node and the safe read-only IPMI commands to verify access.

## Identity

- BMC/IPMI address: `192.168.0.100`
- BMC subnet: `192.168.0.0/24`
- IPMI user: `admin`
- Talos node name: `talos-192-168-1-85`
- Legacy Talos LAN address: `192.168.1.85`
- Current Talos/Tailscale endpoint: `100.100.244.142`

Do not confuse the BMC address with the Talos node addresses. The BMC does not
answer on the `100.100.244.128/25` provider-managed/Tailscale network; reach it
on the default BMC subnet.

## Authentication

Do not put the BMC password on the command line. `ipmitool` reads the password
from `IPMI_PASSWORD` when `-E` is passed.

```bash
export IPMI_PASSWORD='...'

ipmitool -I lanplus -H 192.168.0.100 -U admin -E chassis power status
```

## Temporary macOS reachability

If the workstation is not already on `192.168.0.0/24`, add a temporary address
alias to the connected interface before using IPMI or the BMC web UI:

```bash
sudo ifconfig en0 alias 192.168.0.10 255.255.255.0
ping -c 3 192.168.0.100
```

Remove the alias when finished:

```bash
sudo ifconfig en0 -alias 192.168.0.10
```

Use the actual active interface if it is not `en0`.

## Read-only checks

```bash
ipmitool -I lanplus -H 192.168.0.100 -U admin -E chassis power status
ipmitool -I lanplus -H 192.168.0.100 -U admin -E sdr elist
ipmitool -I lanplus -H 192.168.0.100 -U admin -E sel elist | tail -n 50
```

## Read CPU and RAM temperatures

Altra has a carrier BMC and a module management controller. The default sensor
list and Web UI show carrier sensors. Query the module over IPMB bus `0`, target
`0x82`, before concluding that CPU or RAM temperatures are unavailable.

With `IPMI_PASSWORD` set, read the module's sensor records and CPU temperature:

```bash
ipmitool -I lanplus -H 192.168.0.100 -U admin -E -m 0x20 -b 0 -t 0x82 sdr elist
ipmitool -I lanplus -H 192.168.0.100 -U admin -E -m 0x20 -b 0 -t 0x82 sensor get 'CPU Core Temp'
```

Standard module sensor reads work with `lanplus`. On this Mac, `ipmitool 1.8.19`
intermittently crashes during raw bridge reads, even with requester address
`-m 0x20`. The raw-register command below uses the tested `lan` interface.
`lan` uses IPMI 1.5 without session encryption. Run it only on the trusted BMC
management network. The command does not change BMC settings or retry with a
different protocol.

The module's sensor records do not include every RAM temperature. Read the
SMPro registers through the module with OEM command `0x30 0x31`, CPU I2C address
`0x9e`, and the register number. The following read-only command uses the
existing protected local credential file without putting its password in
arguments or output:

```bash
python3 - <<'PY'
import json
import os
from pathlib import Path
import subprocess

credentials = json.loads((Path.home() / '.config/lab-secrets/altra-bmc.json').read_text())
env = os.environ.copy()
env['IPMI_PASSWORD'] = credentials['password']
command = [
    'ipmitool', '-I', 'lan', '-H', credentials['host'],
    '-U', credentials['username'], '-E', '-N', '2', '-R', '1',
    '-m', '0x20', '-b', '0', '-t', '0x82', 'raw', '0x30', '0x31', '0x9e',
]
registers = [
    ('CPU', 0x10), ('SoC VRD', 0x11), ('DIMM VRD', 0x12), ('Core VRD', 0x13),
    *[(f'DIMM channel {channel}', 0x14 + channel) for channel in range(8)],
    ('RCA VRD', 0x1C), ('Memory hot threshold', 0x32), ('SoC VR hot threshold', 0x33),
]
for name, register in registers:
    result = subprocess.run(
        [*command, hex(register)], env=env, text=True,
        stdout=subprocess.PIPE, check=True, timeout=15,
    )
    raw = bytes.fromhex(result.stdout)
    if len(raw) != 2:
        raise ValueError(f'{name}: expected two bytes, received {len(raw)}')
    if raw == b'\xff\xff':
        print(f'{name}: unavailable')
        continue
    value = int.from_bytes(raw, 'little') & 0x1FF
    temperature = value - 0x200 if value & 0x100 else value
    print(f'{name}: {temperature} C')
PY
```

Keep `altra-bmc.json` outside the repository with file mode `0600` and its
parent directory mode `0700`. Its keys are `host`, `username`, and `password`.

Responses contain two bytes in little-endian order. `ff ff` means unavailable,
not `-1 C`. For other responses, decode the signed low nine bits as degrees
Celsius. For example, `31 00` is `49 C`. Compare RAM readings with the current
memory-hot threshold from register `0x32`. A temperature alone does not identify
which sensor controls a fan.

These registers cover CPU, RAM, and voltage regulators. They do not establish
the temperature of an add-in NIC. Record that temperature as unknown until it
is read from the NIC's telemetry.

Temperature references:

- [ADLINK's module bridge and CPU temperature command](https://www.ipi.wiki/community/forum/topic/119644/access-to-smpro-telemetry-from-the-bmc)
- [Linux SMPro register map and temperature decoding](https://github.com/torvalds/linux/blob/aaed66fadba2d2de8fe0daa0aa3eac827d2076b9/drivers/hwmon/smpro-hwmon.c)

## Fan headers and control limits

Readback on 2026-10-11 identified an ADLINK carrier BMC with firmware `2.07`,
manufacturer ID `24339`, and product ID `514`. Its web interface is MegaRAC
SP-X. Use this identity when selecting commands; Supermicro and ASRock fan
commands are not an interface for this carrier.

The [ADLINK carrier manual, pages 33–34](https://www.adlinktech.com/Products/Download.ashx?file=1956%5CCOM-HPC_Server-Base_manual_50M-77106-1000-10_230720.pdf&isManual=yes&type=MDownload)
identifies these four-pin headers. The RPM values are individual samples, not
fixed settings or a physical front/rear fan map.

| Carrier header | Controller  | Carrier sensor               | RPM on 2026-10-11 |
| -------------- | ----------- | ---------------------------- | ----------------: |
| `FAN_0`        | CPU module  | Not reported in carrier SDRs |           Unknown |
| `FAN_1`        | Carrier BMC | `BMC_FAN1`                   |              2600 |
| `FAN_2`        | Carrier BMC | `BMC_FAN2`                   |              3800 |
| `FAN_4`        | Carrier BMC | `BMC_FAN4`                   |              3500 |
| `FAN_5`        | Carrier BMC | `BMC_FAN5`                   |              3400 |

There is no `FAN_3` header in that manual's fan table. The module-controlled
`FAN_0` is separate from the four BMC-controlled headers. A sensor name does
not identify a connected fan's brand or its position in the case. Trace the
cable to the board label before assigning a front, rear, radiator, or pump role.

### Verified interfaces

No software fan-speed write is verified for this carrier on firmware `2.07`.
The investigation used read commands only and left Altra's settings unchanged:

| Read                                      | Carrier BMC             | Module at IPMB `0x82`   |
| ----------------------------------------- | ----------------------- | ----------------------- |
| PICMG properties, `raw 0x2c 0x00 0x00`    | `0xc1`, invalid command | `00 14 00 00`           |
| Fan properties, `raw 0x2c 0x14 0x00 0x00` | `0xc1`, invalid command | `0xc1`, invalid command |
| Fan level, `raw 0x2c 0x16 0x00 0x00`      | `0xc1`, invalid command | `0xc1`, invalid command |

The module's PICMG identity response does not establish fan-control support.
The local `ipmitool picmg` command also failed its address-information check;
the raw reads above separate that client failure from the controller responses.

An HTTPS request to `/redfish/v1/` returned the web application's HTML rather
than a Redfish JSON service root. The served `/source.min.js` bundle contained
fan sensor and event handling, but no fan-speed control route was identified.
These observations establish the limits of the tested interfaces, not that
every OEM interface or future firmware lacks fan control. Do not guess raw
writes without a carrier-specific command definition and a verified restore path.

To repeat a module identity read with `IPMI_PASSWORD` set, use the trusted BMC
network and the tested `lan` transport described above:

```bash
ipmitool -I lan -H 192.168.0.100 -U admin -E -N 2 -R 1 \
  -m 0x20 -b 0 -t 0x82 raw 0x2c 0x00 0x00
```

### Control PWM fans independently

For the 12 V, four-pin `NF-A14 industrialPPC-2000 PWM`, an external PWM
controller provides speed adjustment without an unverified BMC command.
The [Noctua NA-FC1](https://www.noctua.at/en/products/na-fc1) supports manual
PWM generation and includes a three-way splitter and SATA power adapter.

```text
PSU SATA power -> NA-FC1 power adapter -> NA-FC1 -> splitter -> case fans
```

This wiring is an option, not a verified installation on Altra. A powered PWM
hub distributes its input signal and does not itself supply a speed curve.
Keep pump power separate. Start at full duty and validate CPU, RAM, regulator,
and [NIC temperatures](../../galactic/network/README.md#read-nic-temperature)
with the final case airflow before reducing speed. A fixed manual setting does
not provide a temperature-dependent curve.

## Power control

Use power control only after checking Kubernetes, etcd, and Ceph safety gates.
For Talos maintenance, prefer `talosctl reboot` or `talosctl shutdown` while the
Talos API is healthy.

```bash
# Power on
ipmitool -I lanplus -H 192.168.0.100 -U admin -E chassis power on

# Graceful ACPI shutdown request
ipmitool -I lanplus -H 192.168.0.100 -U admin -E chassis power soft

# Warm reset
ipmitool -I lanplus -H 192.168.0.100 -U admin -E chassis power reset

# Forced power off; use only during explicit recovery
ipmitool -I lanplus -H 192.168.0.100 -U admin -E chassis power off
```

## One-time boot override

```bash
# Boot into BIOS setup on next boot
ipmitool -I lanplus -H 192.168.0.100 -U admin -E chassis bootdev bios

# Boot from virtual CD/DVD on next boot
ipmitool -I lanplus -H 192.168.0.100 -U admin -E chassis bootdev cdrom

# PXE on next boot
ipmitool -I lanplus -H 192.168.0.100 -U admin -E chassis bootdev pxe
```

Then reboot through the safest available path.

## Serial-over-LAN

```bash
ipmitool -I lanplus -H 192.168.0.100 -U admin -E sol activate
```

Exit SOL with `~.` on a new line. If the default SOL channel does not work,
inspect BMC channel settings before trying board-specific bridge options.

## Safety notes

- Do not commit BMC credentials.
- Do not reset or power-cycle Altra during Ceph recovery unless the Talos node
  is already failed and a separate recovery decision has been made.
- Before planned Talos work, capture `kubectl get nodes`, etcd members,
  `ceph -s`, and a server-side drain dry-run.
