import { Result, Schema } from 'effect'
import { canonicalHashV1Result } from '../hash'
import { InstrumentSymbolSchema } from '../instruments'
import { quantityFromDecimal } from '../quantity'
import { OrderType, TimeInForce } from './contracts'
import { strictParseOptions } from '../schemas'

const Decimal = Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/))
const SubmittedBody = Schema.Struct({
  symbol: InstrumentSymbolSchema,
  qty: Schema.optionalKey(Decimal),
  notional: Schema.optionalKey(Decimal),
  side: Schema.Literals(['buy', 'sell']),
  type: Schema.Literals(['market', 'limit']),
  time_in_force: Schema.Literals(['day', 'gtc', 'ioc', 'fok']),
  client_order_id: Schema.String,
  extended_hours: Schema.Literal(false),
  limit_price: Schema.optionalKey(Decimal),
})

/** Evidence records what was transmitted; it does not construct a broker request. */
export const submittedOrderEvidence = (
  input: unknown,
  expected: {
    readonly requestHash: string
    readonly symbol: string
    readonly side: 'BUY' | 'SELL'
    readonly clientOrderId: string
  },
) =>
  Result.gen(function* () {
    const body = yield* Schema.decodeUnknownResult(SubmittedBody, strictParseOptions)(input)
    const hash = yield* canonicalHashV1Result(body)
    if (
      hash !== expected.requestHash ||
      body.symbol !== expected.symbol ||
      body.client_order_id !== expected.clientOrderId ||
      body.side !== expected.side.toLowerCase() ||
      (body.qty === undefined) === (body.notional === undefined) ||
      (body.type === 'limit') !== (body.limit_price !== undefined) ||
      (body.notional !== undefined && body.type !== 'market')
    )
      return yield* Result.fail({ message: 'submitted body does not bind the intent and durable request hash' })
    const quantity = body.qty === undefined ? undefined : yield* quantityFromDecimal(body.qty)
    const cash = body.notional === undefined ? undefined : yield* quantityFromDecimal(body.notional)
    const price = body.limit_price === undefined ? undefined : yield* quantityFromDecimal(body.limit_price)
    if (
      (quantity !== undefined && quantity <= 0n) ||
      (cash !== undefined && (cash <= 0n || cash % 1000n !== 0n)) ||
      (price !== undefined && (price <= 0n || price % 1000n !== 0n))
    )
      return yield* Result.fail({ message: 'submitted terms exceed the exact quantity or cash domain' })
    const durations = {
      day: TimeInForce.Day,
      gtc: TimeInForce.GoodUntilCanceled,
      ioc: TimeInForce.ImmediateOrCancel,
      fok: TimeInForce.FillOrKill,
    }
    return {
      submittedOrderType: body.type === 'limit' ? OrderType.Limit : OrderType.Market,
      submittedTimeInForce: durations[body.time_in_force],
      ...(quantity === undefined ? {} : { submittedQuantityAtoms: quantity.toString() }),
      ...(cash === undefined ? {} : { submittedNotionalMicros: (cash / 1000n).toString() }),
      ...(price === undefined ? {} : { submittedLimitPriceMicros: (price / 1000n).toString() }),
    }
  })
