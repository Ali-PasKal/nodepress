import { ApiException } from './api-exception.js';

/** 429 with a Retry-After header (set by the global exception filter). */
export class RateLimitedException extends ApiException {
  constructor(readonly retryAfterSeconds: number) {
    super(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.');
    this.name = 'RateLimitedException';
  }
}
