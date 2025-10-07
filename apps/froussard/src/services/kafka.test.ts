import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KafkaManager, parseBrokerList, type KafkaConfig, type KafkaMessage } from '@/services/kafka'

const producerFactory = vi.fn()

vi.mock('kafkajs', () => {
  return {
    Kafka: vi.fn((config: KafkaConfig) => ({
      producer: producerFactory,
      __config: config,
    })),
  }
})

describe('parseBrokerList', () => {
  it('splits and trims brokers, removing empties', () => {
    expect(parseBrokerList('broker1:9092, broker2:19092, ,')).toEqual(['broker1:9092', 'broker2:19092'])
  })

  it('returns empty array when input is blank', () => {
    expect(parseBrokerList('   ')).toEqual([])
  })
})

describe('KafkaManager', () => {
  beforeEach(() => {
    producerFactory.mockReset()
  })

  const createProducer = () => {
    const connect = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn().mockResolvedValue(undefined)
    const disconnect = vi.fn().mockResolvedValue(undefined)
    return { connect, send, disconnect }
  }

  const baseConfig: KafkaConfig = {
    brokers: ['broker:9092'],
    clientId: 'test-client',
    sasl: {
      mechanism: 'scram-sha-512',
      username: 'user',
      password: 'pass',
    },
  }

  const baseMessage: KafkaMessage = {
    topic: 'test-topic',
    key: 'key1',
    value: 'value1',
    headers: {},
  }

  it('connects and reuses existing promise on subsequent calls', async () => {
    const producer = createProducer()
    producerFactory.mockReturnValue(producer)

    const manager = new KafkaManager(baseConfig)
    const first = manager.connect()
    const second = manager.connect()
    await Promise.all([first, second])

    expect(producerFactory).toHaveBeenCalledTimes(1)
    expect(producer.connect).toHaveBeenCalledTimes(1)
    expect(manager.isReady()).toBe(true)
  })

  it('publishes messages through the producer', async () => {
    const producer = createProducer()
    producerFactory.mockReturnValue(producer)

    const manager = new KafkaManager(baseConfig)
    await manager.publish(baseMessage)

    expect(producer.connect).toHaveBeenCalledTimes(1)
    expect(producer.send).toHaveBeenCalledWith({
      topic: baseMessage.topic,
      messages: [
        {
          key: baseMessage.key,
          value: baseMessage.value,
          headers: baseMessage.headers,
        },
      ],
    })
  })

  it('recreates producer after a send failure', async () => {
    const firstProducer = createProducer()
    firstProducer.send.mockRejectedValueOnce(new Error('boom'))
    const secondProducer = createProducer()

    producerFactory.mockImplementationOnce(() => firstProducer).mockImplementationOnce(() => secondProducer)

    const manager = new KafkaManager(baseConfig)

    await expect(manager.publish(baseMessage)).rejects.toThrow('boom')

    expect(firstProducer.connect).toHaveBeenCalled()
    expect(firstProducer.send).toHaveBeenCalled()

    await manager.publish(baseMessage)

    expect(producerFactory).toHaveBeenCalledTimes(2)
    expect(secondProducer.connect).toHaveBeenCalledTimes(1)
    expect(secondProducer.send).toHaveBeenCalledTimes(1)
  })

  it('disconnects producer and resets flags', async () => {
    const producer = createProducer()
    producerFactory.mockReturnValue(producer)

    const manager = new KafkaManager(baseConfig)
    await manager.publish(baseMessage)

    await manager.disconnect()
    expect(producer.disconnect).toHaveBeenCalledTimes(1)
    expect(manager.isReady()).toBe(false)
  })
})
