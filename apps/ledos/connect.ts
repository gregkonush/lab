import type { ConnectRouter } from "@connectrpc/connect"
import { ProomptService } from "./generated/ai/proompteng/ledos/v1/proompt_api_connect"

export default (router: ConnectRouter) =>
  router.service(ProomptService, {
    query: async function* query(req) {
      yield { answer: `Let me find answer for ~ ${req.input}` }
    },
  })
