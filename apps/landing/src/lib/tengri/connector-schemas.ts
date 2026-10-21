import { z } from 'zod'
import { workspaceUidSchema } from './access-schemas'

const identifier = z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/)
const constraints = z.record(z.string().startsWith('/').max(256), z.array(z.json()).min(1).max(128))
export const connectorCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('providers') }).strict(),
  z.object({ action: z.literal('list'), workspace: workspaceUidSchema.optional() }).strict(),
  z
    .object({
      action: z.literal('create'),
      id: workspaceUidSchema,
      operationId: z.uuid(),
      provider: identifier,
      name: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal('connectToken'),
      id: workspaceUidSchema,
      version: z.number().int().positive(),
      token: z
        .string()
        .min(1)
        .max(16384)
        .regex(/^[^\p{Cc}]+$/u),
    })
    .strict(),
  z.object({ action: z.literal('oAuthStart'), id: workspaceUidSchema }).strict(),
  z.object({ action: z.literal('connectClient'), id: workspaceUidSchema }).strict(),
  z
    .object({
      action: z.literal('bind'),
      id: workspaceUidSchema,
      workspace: workspaceUidSchema,
      operations: z.array(identifier).max(128),
      constraints,
    })
    .strict(),
  z.object({ action: z.literal('disconnect'), id: workspaceUidSchema, operationId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('invoke'),
      id: workspaceUidSchema,
      workspace: workspaceUidSchema,
      operation: identifier,
      arguments: z.record(z.string(), z.json()),
    })
    .strict(),
])
export type ConnectorCommand = z.infer<typeof connectorCommandSchema>
