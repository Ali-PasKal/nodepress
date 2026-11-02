import type { EngineLimits, Invocation, InvocationResult, LogLine } from './engine.js';

/**
 * Messages between the API process (parent) and a plugin's sandbox process (child), sent over Node's IPC
 * channel as JSON. The parent validates everything it receives (see `process.ts`): a child is untrusted.
 *
 * This module has no runtime imports: the sandbox process loads it.
 */

export type ParentMessage =
  | { readonly type: 'init'; readonly code: string; readonly limits: Partial<EngineLimits> }
  | { readonly type: 'invoke'; readonly id: number; readonly invocation: Invocation }
  | {
      readonly type: 'callResult';
      readonly callId: number;
      readonly ok: boolean;
      readonly value?: unknown;
      readonly error?: string;
    };

export type ChildMessage =
  | { readonly type: 'ready' }
  | {
      readonly type: 'call';
      readonly id: number;
      readonly callId: number;
      readonly method: string;
      readonly args: readonly unknown[];
    }
  | {
      readonly type: 'result';
      readonly id: number;
      readonly result: InvocationResult;
      readonly logs: readonly LogLine[];
    }
  | { readonly type: 'fatal'; readonly message: string };
