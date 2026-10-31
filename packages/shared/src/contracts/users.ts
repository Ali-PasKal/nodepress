import { z } from 'zod';
import { roleRefSchema } from './auth.js';
import {
  displayNameSchema,
  emailSchema,
  isoDateTimeSchema,
  newPasswordSchema,
  paginatedSchema,
  paginationQuerySchema,
  uuidSchema,
} from './common.js';

export const userStatusSchema = z.enum(['active', 'suspended']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const userSummarySchema = z.object({
  id: uuidSchema,
  email: z.string(),
  displayName: z.string(),
  status: userStatusSchema,
  role: roleRefSchema.nullable(),
  lastLoginAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const userListResponseSchema = paginatedSchema(userSummarySchema);
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const userListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: userStatusSchema.optional(),
  roleId: uuidSchema.optional(),
});

export const createUserSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema,
  password: newPasswordSchema,
  roleId: uuidSchema,
});
export type CreateUserRequest = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    status: userStatusSchema.optional(),
    roleId: uuidSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update.',
  });
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;

export const setUserPasswordSchema = z.object({ password: newPasswordSchema });
