import { Context, Effect } from 'effect'
import { CaptureInvalidation, type ResearchCaptureObserver, type ResearchCaptureEvent } from './capture'

export const ActiveResearchCapture = Context.Reference<ResearchCaptureObserver | undefined>(
  'bayn/ActiveResearchCapture',
  { defaultValue: () => undefined },
)

export const recordResearchCapture = (observer: ResearchCaptureObserver, event: ResearchCaptureEvent) =>
  Effect.sync(() => observer.record(event)).pipe(
    Effect.catchCause(() =>
      Effect.sync(() => observer.invalidate(CaptureInvalidation.InvalidEvent)).pipe(Effect.ignoreCause),
    ),
  )
