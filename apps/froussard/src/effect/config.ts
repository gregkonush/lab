import { Effect, Layer } from 'effect'

import { loadConfig, type AppConfig } from '@/config'

export class AppConfigService extends Effect.Tag('@froussard/AppConfig')<AppConfigService, AppConfig>() {}

export const AppConfigLayer = Layer.sync(AppConfigService, () => loadConfig())
