import dgraph from "dgraph-js"
import grpc from "@grpc/grpc-js"

async function main() {
  const clientStub = new dgraph.DgraphClientStub("localhost:9080", grpc.credentials.createInsecure())
  const dgraphClient = new dgraph.DgraphClient(clientStub)
  const op = new dgraph.Operation()
  op.setDropAll(true)
  await dgraphClient.alter(op)
}

main()
  .then(() => console.log("Migration completed"))
  .catch((err) => {
    console.error("Migration failed:", err)
    process.exit(1)
  })
