import { serve } from "@hono/node-server";
import { Hono } from "hono";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const app = new Hono();

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.get("/", (c) =>
  c.json({ message: "bonjour from the cdk8s + Argo CD sample server" }),
);

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Server listening on http://localhost:${info.port}`);
  },
);

process.on("SIGTERM", () => {
  server.close(() => {
    console.log("Server terminated gracefully");
  });
});
