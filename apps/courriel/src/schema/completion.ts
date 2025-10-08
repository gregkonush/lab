import { z } from 'zod'

const parameterSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
})

const metadataSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  uid: z.string().min(1, 'metadata.uid is required'),
  annotations: z.record(z.string(), z.string()).optional().default({}),
  labels: z.record(z.string(), z.string()).optional().default({}),
})

const statusSchema = z.object({
  phase: z.string().min(1, 'status.phase is required'),
  message: z.string().optional(),
  progress: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  nodes: z.record(z.string(), z.unknown()).optional(),
})

const specSchema = z
  .object({
    arguments: z
      .object({
        parameters: z.array(parameterSchema).optional().default([]),
      })
      .partial()
      .optional()
      .default({}),
  })
  .partial()
  .optional()
  .default({})

export const completionSchema = z.object({
  metadata: metadataSchema,
  status: statusSchema,
  spec: specSchema,
})

export type WorkflowCompletion = z.infer<typeof completionSchema>

export const parseCompletion = (payload: unknown): WorkflowCompletion => {
  return completionSchema.parse(payload)
}
