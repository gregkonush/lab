import { createServer, IncomingMessage, ServerResponse } from "node:http";

const host = "0.0.0.0";
const port = Number.parseInt(process.env.PORT ?? "8080", 10);

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const { method, url } = req;

  if (method === "GET" && (url === "/" || url === undefined)) {
    const body = "bonjour\n";
    res.writeHead(200, {
      "content-length": Buffer.byteLength(body).toString(),
      "content-type": "text/plain; charset=utf-8",
    });
    res.end(body);
    return;
  }

  res.writeHead(404, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify({ error: "Not Found" }));
}

export function startServer(): void {
  const server = createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      res.writeHead(500, {
        "content-type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify({ error: message }));
    }
  });

  server.listen(port, host, () => {
    console.log(`bonjour-serveur listening on http://${host}:${port}`);
  });
}

if (require.main === module) {
  startServer();
}
