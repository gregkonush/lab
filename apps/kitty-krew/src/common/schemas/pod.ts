import { z } from 'zod'

export const podMetadataSchema = z.object({
  name: z.string().optional(),
  namespace: z.string().optional(),
  creationTimestamp: z.preprocess(
    (val) => (val instanceof Date ? val : new Date(String(val))),
    z
      .date()
      .refine((date) => !Number.isNaN(date.getTime()), {
        message: 'Invalid date format for creationTimestamp',
      })
      .refine((date) => date <= new Date(), {
        message: 'creationTimestamp cannot be in the future',
      })
      .optional(),
  ),
  uid: z.string().optional(),
})

export const podStatusSchema = z.object({
  phase: z.string().optional(),
  podIP: z.string().optional(),
})

export const podSchema = z.object({
  metadata: podMetadataSchema.optional(),
  status: podStatusSchema.optional(),
})

export const podListSchema = z.array(podSchema)

// Types inferred from schemas
export type PodMetadata = z.infer<typeof podMetadataSchema>
export type PodStatus = z.infer<typeof podStatusSchema>
export type Pod = z.infer<typeof podSchema>
export type PodList = z.infer<typeof podListSchema>
