/*****
Remove Tailscale devices whose names match hardcoded hostnames (from Ansible inventory).

Usage examples (Bun):
  # Dry run (uses '-' to refer to the API key's tailnet)
  TS_API_KEY=tskey-xxxxxxxxxxxxxxxx bun run scripts/tailscale-prune.ts -t - --dry-run

  # Or omit -t to default to '-'
  TS_API_KEY=tskey-xxxxxxxxxxxxxxxx bun run scripts/tailscale-prune.ts --dry-run

  # Delete without prompts
  TS_API_KEY=tskey-xxxxxxxxxxxxxxxx bun run scripts/tailscale-prune.ts -t - -y

Flags:
  -t, --tailnet     Tailnet name (e.g., your-tailnet@example.com). Defaults to '-'.
  -k, --api-key     Tailscale API key (or env TS_API_KEY / TAILSCALE_API_KEY)
      --dry-run     Print actions without deleting
  -y, --yes         Do not prompt; delete without confirmation
  -r, --regex       Optional regex to filter hostnames (default: all)
*****/

// Hostnames hardcoded from ansible/inventory/hosts.ini (kube masters + workers)
function generateInventoryHostnames(): string[] {
  const masters = ["kube-master-00", "kube-master-01", "kube-master-02"];
  const workers: string[] = [];
  for (let i = 0; i <= 29; i += 1) {
    const suffix = i.toString().padStart(2, "0");
    workers.push(`kube-worker-${suffix}`);
  }
  return [...masters, ...workers];
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "-t":
      case "--tailnet":
        args.tailnet = next; i += 1; break;
      case "-k":
      case "--api-key":
        args.apiKey = next; i += 1; break;
      case "--dry-run":
        args.dryRun = true; break;
      case "-y":
      case "--yes":
        args.yes = true; break;
      case "-r":
      case "--regex":
        args.regex = next; i += 1; break;
      default:
        // ignore unknowns
        break;
    }
  }
  return args as {
    tailnet?: string;
    apiKey?: string;
    dryRun?: boolean;
    yes?: boolean;
    regex?: string;
  };
}

async function main() {
  const { tailnet, apiKey, dryRun, yes, regex } = parseArgs(process.argv);
  const tailscaleApiKey = apiKey || process.env.TS_API_KEY || process.env.TAILSCALE_API_KEY;

  const effectiveTailnet = tailnet && tailnet.trim().length > 0 ? tailnet : "-";
  if (!tailscaleApiKey) {
    console.error("Error: Tailscale API key not provided (use --api-key or TS_API_KEY/TAILSCALE_API_KEY env)");
    process.exit(2);
  }

  let hostnames = generateInventoryHostnames();
  if (regex) {
    const re = new RegExp(regex);
    hostnames = hostnames.filter((h) => re.test(h));
  }
  if (hostnames.length === 0) {
    console.log("No hostnames to process after filtering; exiting.");
    process.exit(0);
  }

  const devicesRes = await fetch(`https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(effectiveTailnet)}/devices`, {
    headers: {
      Authorization: `Bearer ${tailscaleApiKey}`,
      Accept: "application/json",
    },
  });
  if (!devicesRes.ok) {
    console.error(`Failed to fetch devices: ${devicesRes.status} ${devicesRes.statusText}`);
    process.exit(1);
  }
  const devicesJson: any = await devicesRes.json();
  const devices: any[] = Array.isArray(devicesJson) ? devicesJson : (devicesJson.devices ?? []);

  type Match = { host: string; id: string; device: any };
  const matches: Match[] = [];
  for (const host of hostnames) {
    for (const d of devices) {
      const name: string = d?.name ?? "";
      const hostname: string = d?.hostname ?? "";
      const dnsName: string = d?.dnsName ?? "";
      if (name === host || hostname === host || (dnsName && dnsName.startsWith(`${host}.`))) {
        const id: string = d?.id;
        if (id) {
          matches.push({ host, id, device: d });
        }
      }
    }
  }

  if (matches.length === 0) {
    console.log("No matching devices found in tailnet for provided hostnames.");
    process.exit(0);
  }

  console.log(`Found ${matches.length} matching device(s).`);
  for (const m of matches) {
    console.log(`- host=${m.host} id=${m.id} name=${m.device?.name ?? ""}`);
  }

  if (dryRun) {
    console.log("Dry-run mode; no deletions performed.");
    process.exit(0);
  }

  if (!yes) {
    const prompt = "Proceed to delete ALL of the above devices? [y/N] ";
    const input = await readStdin(prompt);
    if (!/^y(es)?$/i.test(input.trim())) {
      console.log("Aborted by user.");
      process.exit(130);
    }
  }

  let deletedCount = 0;
  let failedCount = 0;
  for (const m of matches) {
    const delRes = await fetch(`https://api.tailscale.com/api/v2/device/${encodeURIComponent(m.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tailscaleApiKey}` },
    });
    if (delRes.ok) {
      console.log(`Deleted device id=${m.id} (host=${m.host})`);
      deletedCount += 1;
    } else {
      console.error(`Failed to delete id=${m.id} (host=${m.host}): ${delRes.status} ${delRes.statusText}`);
      failedCount += 1;
    }
  }

  console.log(`Done. Deleted: ${deletedCount}/${matches.length}`);
  process.exit(failedCount === 0 ? 0 : 1);
}

async function readStdin(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  return await new Promise((resolve) => {
    const onData = (buf: Buffer) => {
      chunks.push(new Uint8Array(buf));
      if (buf.includes(10) || buf.includes(13)) { // newline
        process.stdin.off("data", onData);
        resolve(decoder.decode(Buffer.concat(chunks)));
      }
    };
    process.stdin.on("data", onData);
  });
}

// Run
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
