import { MarketKind } from '../instruments'
import { quantityScale } from '../quantity'
import { OrderType, TimeInForce } from './contracts'

/** Alpaca extended equity orders require DAY; crypto supports IOC at every hour. */
export const cashSpotLimitTimeInForce = (market: MarketKind): TimeInForce.Day | TimeInForce.ImmediateOrCancel =>
  market === MarketKind.Equity ? TimeInForce.Day : TimeInForce.ImmediateOrCancel

export const cashSpotClosingOrderType = (market: MarketKind, quantityAtoms: bigint): OrderType =>
  market === MarketKind.Equity && quantityAtoms % quantityScale !== 0n ? OrderType.Market : OrderType.Limit
