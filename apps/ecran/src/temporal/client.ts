import { Client, Connection } from '@temporalio/client'

const client: Client = makeClient()

function makeClient(): Client {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233'
  console.log('Starting client, address:', address)
  const connection = Connection.lazy({
    address,
  })
  return new Client({ connection })
}

export function getTemporalClient(): Client {
  return client
}