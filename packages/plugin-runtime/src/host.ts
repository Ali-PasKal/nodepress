import { EngineCorruptedError, PluginEngine, type Invocation } from './engine.js';
import type { ChildMessage, ParentMessage } from './protocol.js';

/**
 * Entry point of a plugin's sandbox process (started by `PluginProcess` with an empty environment and Node's
 * permission model). It holds one plugin's code, runs one invocation at a time in the engine, and forwards the
 * plugin's host calls to the parent, which decides whether they are allowed.
 */

let engine: PluginEngine | null = null;
let code = '';
let busy = false;
let nextCallId = 1;
const calls = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

function send(message: ChildMessage): void {
  process.send?.(message);
}

function fatal(message: string): never {
  send({ type: 'fatal', message });
  process.exit(1);
}

async function invoke(id: number, invocation: Invocation): Promise<void> {
  if (!engine) fatal('Invocation before initialisation.');
  if (busy) fatal('Overlapping invocations.');
  busy = true;
  try {
    const outcome = await engine.invoke(code, invocation, (method, args) => {
      const callId = nextCallId++;
      return new Promise((resolve, reject) => {
        calls.set(callId, { resolve, reject });
        send({ type: 'call', id, callId, method, args });
      });
    });
    send({ type: 'result', id, result: outcome.result, logs: outcome.logs });
  } catch (error) {
    if (error instanceof EngineCorruptedError) fatal(error.message);
    throw error;
  } finally {
    // Calls still waiting belong to a finished invocation; their answers are ignored.
    calls.clear();
    busy = false;
  }
}

process.on('message', (raw: ParentMessage) => {
  switch (raw.type) {
    case 'init':
      if (engine) fatal('Initialised twice.');
      code = raw.code;
      PluginEngine.create(raw.limits).then(
        (created) => {
          engine = created;
          send({ type: 'ready' });
        },
        (error: unknown) => {
          fatal(`The engine could not start: ${String(error)}`);
        },
      );
      break;
    case 'invoke':
      void invoke(raw.id, raw.invocation);
      break;
    case 'callResult': {
      const call = calls.get(raw.callId);
      if (!call) return;
      calls.delete(raw.callId);
      if (raw.ok) call.resolve(raw.value);
      else call.reject(new Error(raw.error ?? 'The call failed.'));
      break;
    }
  }
});

// The parent owns this process: when it goes away, so does the sandbox.
process.on('disconnect', () => {
  process.exit(0);
});
