import { fastify } from "fastify"
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify"
import routes from "./connect"

async function main() {
  const server = fastify({
    http2: true,
  })
  await server.register(fastifyConnectPlugin, {
    routes,
  })
  await server.listen({ host: "0.0.0.0", port: 3000 })
  console.log("Server is listening at", server.addresses())
}
void main()
