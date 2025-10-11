import { Layer } from 'effect'
import { make as makeManagedRuntime, type ManagedRuntime } from 'effect/ManagedRuntime'

import { AppConfigLayer } from '@/effect/config'
import { AppLoggerLayer } from '@/logger'
import { KafkaProducerLayer } from '@/services/kafka'
import { GithubServiceLayer } from '@/services/github'

const BaseAppLayer = Layer.mergeAll(AppConfigLayer, AppLoggerLayer, KafkaProducerLayer, GithubServiceLayer)

export type AppRuntimeLayer = typeof BaseAppLayer

export const AppLayer = BaseAppLayer

export type AppRuntime = ManagedRuntime<Layer.Success<AppRuntimeLayer>, Layer.Error<AppRuntimeLayer>>

export const makeAppRuntime = (): AppRuntime => makeManagedRuntime(AppLayer)
