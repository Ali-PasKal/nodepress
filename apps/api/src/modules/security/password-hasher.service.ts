import { Injectable } from '@nestjs/common';
import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { generateToken } from './crypto.js';

/**
 * Argon2id parameters: OWASP Password Storage Cheat Sheet baseline (19 MiB, 2 iterations, 1 lane).
 * `Algorithm` is an ambient const enum, so its numeric value is used (2 = Argon2id).
 */
const PARAMETERS = {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- ambient const enum cannot be referenced under isolatedModules; 2 is Algorithm.Argon2id.
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
const CURRENT_PREFIX = `$argon2id$v=19$m=${String(PARAMETERS.memoryCost)},t=${String(PARAMETERS.timeCost)},p=${String(PARAMETERS.parallelism)}$`;

@Injectable()
export class PasswordHasher {
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return hash(password, PARAMETERS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Performs a full verification against a throwaway hash, so a login for an unknown account takes as
   * long as one for a real account and timing does not reveal which emails exist.
   */
  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash(generateToken());
    await this.verify(await this.dummyHash, password);
  }

  /** True when a stored hash uses outdated parameters and should be replaced after a successful login. */
  needsRehash(passwordHash: string): boolean {
    return !passwordHash.startsWith(CURRENT_PREFIX);
  }
}
