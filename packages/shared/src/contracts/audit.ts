import { z } from 'zod';
import { isoDateTimeSchema, paginatedSchema, paginationQuerySchema, uuidSchema } from './common.js';

export const auditEventSchema = z.object({
  id: uuidSchema,
  occurredAt: isoDateTimeSchema,
  action: z.string(),
  actor: z.object({ id: uuidSchema, email: z.string(), displayName: z.string() }).nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});
export type AuditEventInfo = z.infer<typeof auditEventSchema>;

export const auditListResponseSchema = paginatedSchema(auditEventSchema);
export type AuditListResponse = z.infer<typeof auditListResponseSchema>;

export const auditListQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  actorId: uuidSchema.optional(),
});
