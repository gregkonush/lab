import type { JevInstructions } from './instructions-contract'

export const jevInstructions: JevInstructions = {
  entry:
    'Assume only for this question that a long continuation setup is supported. Select the supplied complete long plan that best fits the observed price structure and movement scale over `task.horizonMinutes`. Compare stop placement against observed invalidation levels, target distance against observed movement and volatility, and estimated net reward against estimated loss after costs. Proposed order prices are hypothetical, not additional observations or predictions. Choose wait or avoid if no supplied complete plan is structurally coherent. This conditional plan selection does not authorize an entry; code separately requires the current-setup judgment and enforces permission, funding, sizing, freshness, protection and account risk.',
}
