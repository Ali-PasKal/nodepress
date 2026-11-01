import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { CoreCapability } from '@nexora/shared';
import type { Request } from 'express';
import type { AuthContext } from './auth-context.js';

export const ACCESS_POLICY = Symbol('nexora:access-policy');

export type AccessPolicy =
  | { readonly kind: 'public' }
  | {
      readonly kind: 'authenticated';
      /** Every one of these is required. */
      readonly capabilities: readonly string[];
      /** At least one of these is required (when present). */
      readonly anyOf?: readonly string[];
    };

/** Route needs no session (health, login, setup...). Unsafe methods still get origin checks. */
export const Public = () => SetMetadata(ACCESS_POLICY, { kind: 'public' } satisfies AccessPolicy);

/** Route needs a valid session but no particular capability (own profile, logout). */
export const Authenticated = () =>
  SetMetadata(ACCESS_POLICY, { kind: 'authenticated', capabilities: [] } satisfies AccessPolicy);

/** Route needs a session holding every listed capability. */
export const RequireCapabilities = (...capabilities: [CoreCapability, ...CoreCapability[]]) =>
  SetMetadata(ACCESS_POLICY, { kind: 'authenticated', capabilities } satisfies AccessPolicy);

/**
 * Route needs a session holding at least one of the listed capabilities (e.g. read endpoints shared by
 * several roles). Finer, per-record rules are enforced by the service.
 */
export const RequireAnyCapability = (
  ...capabilities: [CoreCapability, CoreCapability, ...CoreCapability[]]
) =>
  SetMetadata(ACCESS_POLICY, {
    kind: 'authenticated',
    capabilities: [],
    anyOf: capabilities,
  } satisfies AccessPolicy);

/** Injects the AuthContext. Only valid on routes guarded by @Authenticated / @RequireCapabilities. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.auth) {
      throw new Error('CurrentAuth used on a route that does not require authentication');
    }
    return request.auth;
  },
);
