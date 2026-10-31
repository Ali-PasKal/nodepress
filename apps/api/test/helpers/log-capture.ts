import { Writable } from 'node:stream';

/**
 * Collects pino's newline-delimited JSON output for assertions.
 *
 * nestjs-pino keeps a single process-wide root logger (production runs one app per process), so each
 * test file that captures logs must create exactly one application. Vitest isolates test files in
 * separate workers, which gives each file a fresh logger.
 */
export class LogCapture extends Writable {
  readonly lines: Record<string, unknown>[] = [];
  readonly raw: string[] = [];

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    for (const line of chunk.toString('utf8').split('\n').filter(Boolean)) {
      this.raw.push(line);
      this.lines.push(JSON.parse(line) as Record<string, unknown>);
    }
    callback();
  }

  accessLogFor(requestId: string): Record<string, unknown> | undefined {
    return this.lines.find(
      (line) => line.msg === 'request completed' && line.requestId === requestId,
    );
  }
}
