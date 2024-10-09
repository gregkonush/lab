import { Client, Connection } from '@temporalio/client'

class TemporalClient {
  static #instance: Client

  private constructor() {}

  public static get instance(): Client {
    if (!TemporalClient.#instance) {
      TemporalClient.#instance = TemporalClient.makeClient()
    }

    return TemporalClient.#instance
  }

  private static makeClient(): Client {
    const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233'
    console.log('Starting client, address:', address)
    const connection = Connection.lazy({
      address,
    })
    return new Client({ connection })
  }
}

export const temporalClient = TemporalClient.instance
