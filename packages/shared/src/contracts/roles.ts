import { z } from 'zod';
import { uuidSchema } from './common.js';

export const capabilitySchema = z.object({
  key: z.string(),
  category: z.string(),
  description: z.string(),
});
export type CapabilityInfo = z.infer<typeof capabilitySchema>;

export const roleSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  name: z.string(),
  description: z.string(),
  isSystem: z.boolean(),
  grantsAll: z.boolean(),
  capabilities: z.array(z.string()),
  userCount: z.number().int().nonnegative(),
});
export type RoleInfo = z.infer<typeof roleSchema>;

export const roleListResponseSchema = z.object({
  roles: z.array(roleSchema),
  capabilities: z.array(capabilitySchema),
});
export type RoleListResponse = z.infer<typeof roleListResponseSchema>;

const capabilityListSchema = z
  .array(z.string().max(100))
  .max(500)
  .transform((keys) => [...new Set(keys)].sort());

export const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,63}$/, {
      message: 'Use 2–64 lower-case letters, digits or underscores, starting with a letter.',
    }),
  name: z.string().trim().min(1, { message: 'Name is required.' }).max(100),
  description: z.string().trim().max(500).default(''),
  capabilities: capabilityListSchema,
});
export type CreateRoleRequest = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    capabilities: capabilityListSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update.',
  });
export type UpdateRoleRequest = z.input<typeof updateRoleSchema>;
