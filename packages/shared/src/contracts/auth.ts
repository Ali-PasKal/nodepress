import { z } from 'zod';
import {
  displayNameSchema,
  emailSchema,
  isoDateTimeSchema,
  newPasswordSchema,
  uuidSchema,
} from './common.js';

export const loginRequestSchema = z.object({
  email: emailSchema,
  // The policy is enforced when passwords are set, not at login.
  password: z.string().min(1, { message: 'Password is required.' }).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const roleRefSchema = z.object({ id: uuidSchema, key: z.string(), name: z.string() });

export const authUserSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  displayName: z.string(),
  role: roleRefSchema.nullable(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const sessionResponseSchema = z.discriminatedUnion('authenticated', [
  z.object({ authenticated: z.literal(false) }),
  z.object({
    authenticated: z.literal(true),
    user: authUserSchema,
    capabilities: z.array(z.string()),
    /** Send as `X-CSRF-Token` on every state-changing request. Keep it in memory only. */
    csrfToken: z.string(),
    expiresAt: isoDateTimeSchema,
  }),
]);
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const passwordResetRequestSchema = z.object({ email: emailSchema });
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: 'Current password is required.' }).max(256),
  newPassword: newPasswordSchema,
});

export const updateProfileSchema = z.object({ displayName: displayNameSchema });

export const sessionSummarySchema = z.object({
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const messageResponseSchema = z.object({ message: z.string() });
