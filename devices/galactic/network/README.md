# Prepare the CRS504 storage switch

Tested on 2026-10-10 with RouterOS `7.23.8` long-term and RouterBOARD firmware `7.23.8`.
Both versions and the configuration were verified after reboot. The script was imported twice without errors.

[crs504-bench.rsc](crs504-bench.rsc) configures the CRS504-4XQ-IN on a direct Mac Ethernet connection.
It preserves `192.168.88.1/24` on `ether1` and removes management from the storage bridge.

| Port                   | Intended connection | Configuration                |
| ---------------------- | ------------------- | ---------------------------- |
| `ether1`               | Mac USB Ethernet    | Management `192.168.88.1/24` |
| QSFP28 1, `qsfp28-1-1` | Altra NIC port 1    | 100G DAC, RS-FEC, MTU 1500   |
| QSFP28 2, `qsfp28-2-1` | Turin NIC port 1    | 100G DAC, RS-FEC, MTU 1500   |
| QSFP28 3 and 4         | Unused              | Disabled                     |

1. Connect the Mac to `ether1`. Set its Ethernet adapter to `192.168.88.2/24`, with no router.
2. Sign in at `http://192.168.88.1/`. Set the admin password yourself. Keep credentials out of Git.
3. Save `/export file=flash/before-bench` privately. Enable WebFig **Safe Mode**.
4. Upload the script through **Files**. Run `/file set [find where name="crs504-bench.rsc"] name="flash/crs504-bench.rsc"` so it survives reboot.
5. Run `/import file-name=flash/crs504-bench.rsc verbose=yes` in Terminal.
6. Verify `/ip address print detail` shows `actual-interface=ether1` and both storage bridge ports show `H`.
7. Verify management still responds from the Mac, then turn off **Safe Mode** to retain the changes.

The script requires one existing bridge and the factory management address. It can be reapplied to its own resulting state.
It disables IP forwarding and unused services, limits management services to the bench subnet, and restricts MAC WinBox
and discovery to `ether1`. Keep every lane of QSFP ports 1 and 2 enabled; whole 100G links use all four lanes.

Keep this direct connection until a separate management-LAN change is prepared. Moving `ether1` to the provider LAN
requires new addressing and service allowlists. Restore the Mac adapter to DHCP when bench work finishes.
No host IPs or Ceph networks change through this script. Follow the [hardware upgrade plan](../docs/hardware-network-upgrade-plan.md)
for host installation, link tests, and the Ceph migration gate.

## Install the tested firmware

The tested package is [routeros-7.23.8-mipsbe.npk](https://download.mikrotik.com/routeros/7.23.8/routeros-7.23.8-mipsbe.npk).
Its SHA-256 is `69b044a3b6c9ee65232d3f3232e6a97ac0b5c012098c681b05174c34d5704ff3`.
The bench connection has no gateway, so use the manual package upload rather than an online update.

1. Retain a private configuration export. Download the official package and check it with `shasum -a 256 <file>`.
2. Upload the package to the switch's root through **Files**. Keep **Safe Mode** off before restarting.
3. Run `/system reboot`. Reconnect and verify `/system resource print` reports `version: 7.23.8`.
4. Run `/system routerboard print`. If `current-firmware` differs from `upgrade-firmware`, run `/system routerboard upgrade`, confirm, and reboot again.
5. Verify both firmware fields report `7.23.8`. Repeat the configuration checks below.

Follow the [MikroTik manual upgrade procedure](https://help.mikrotik.com/docs/spaces/ROS/pages/328142/Upgrading%2Band%2Binstallation)
when selecting a newer version. Update this pin only after testing it.

## Verify the saved configuration

Run these commands in the switch Terminal after reboot:

```routeros
/system resource print
/system routerboard print
/interface bridge print detail without-paging
/interface bridge port print without-paging
/interface ethernet print detail without-paging
/ip address print detail without-paging
/ip service print without-paging
/interface ethernet monitor qsfp28-1-1,qsfp28-2-1 once
/interface ethernet print stats without-paging where name~"qsfp28-[12]-1"
/export file=flash/crs504-config
```

Require one `storage` bridge at MTU 1500, exactly two bridge ports with `H`, and management on `ether1`.
Ports 1 and 2 use `100G-baseCR4` and `fec91`. Ports 3 and 4 are disabled. Confirm management access from the Mac.
Keep raw exports and credentials private; the script resolves the switch's own MAC address at import time.

On 2026-10-10, both firmware versions and all these settings survived reboot. Port 1 reported `100Gbps` with `fec91`;
port 2 had no carrier. The port comments record the intended host mapping, not a verified peer identity.
Port 1 recorded 332 corrected FEC errors, one uncorrected error, and two symbol errors after reboot.
These counters stayed unchanged across two samples with almost no traffic. Recheck them under host traffic before acceptance.
Complete the plan's host identification, error-counter and throughput tests before accepting the storage network.
The switch clock was unsynchronized on the bench. Configure NTP when management routing is available.
