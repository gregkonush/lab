import { Kafka, type Producer } from 'kafkajs'

export interface KafkaConfig {
  brokers: string[]
  clientId: string
  sasl: {
    mechanism: 'scram-sha-512'
    username: string
    password: string
  }
}

export interface KafkaMessage {
  topic: string
  key: string
  value: string
  headers: Record<string, string>
}

export class KafkaManager {
  private readonly kafka: Kafka
  private producer: Producer
  private connectPromise: Promise<void> | null = null
  private ready = false

  constructor(config: KafkaConfig, allowAutoTopicCreation = false) {
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      ssl: false,
      sasl: config.sasl,
    })

    this.producer = this.kafka.producer({ allowAutoTopicCreation })
  }

  async connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise
    }

    this.connectPromise = this.producer
      .connect()
      .then(() => {
        this.ready = true
      })
      .catch((error) => {
        this.ready = false
        this.connectPromise = null
        throw error
      })

    return this.connectPromise
  }

  isReady(): boolean {
    return this.ready
  }

  async publish(message: KafkaMessage): Promise<void> {
    await this.connect()

    try {
      await this.producer.send({
        topic: message.topic,
        messages: [
          {
            key: message.key,
            value: message.value,
            headers: message.headers,
          },
        ],
      })
    } catch (error) {
      this.ready = false
      this.connectPromise = null
      this.producer = this.kafka.producer({ allowAutoTopicCreation: false })
      throw error
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.producer.disconnect()
    } finally {
      this.ready = false
      this.connectPromise = null
    }
  }
}

export const parseBrokerList = (raw: string): string[] => {
  return raw
    .split(',')
    .map((broker) => broker.trim())
    .filter((broker) => broker.length > 0)
}
