import { oneClickBuy } from '@temporal/workflows'
import { getTemporalClient } from '@temporal/client'
import { TASK_QUEUE_NAME } from '@temporal/shared'

export async function POST(req: Request) {
  interface RequestBody {
    itemId: string
    transactionId: string
  }

  let body: RequestBody
  console.log('Starting buy, address:', process.env.TEMPORAL_ADDRESS)

  try {
    body = (await req.json()) as RequestBody
  } catch (error) {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const { itemId, transactionId } = body

  if (!itemId) {
    return new Response('Must send the itemID to buy', { status: 400 })
  }

  await getTemporalClient().workflow.start(oneClickBuy, {
    taskQueue: TASK_QUEUE_NAME,
    workflowId: transactionId,
    args: [itemId],
  })

  return Response.json({ ok: true })
}
