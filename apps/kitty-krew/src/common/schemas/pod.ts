import { z } from 'zod'

export const podMetadataSchema = z.object({
  name: z.string().optional(),
  namespace: z.string().optional(),
  creationTimestamp: z.date().optional(),
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
