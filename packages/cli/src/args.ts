import { parseArgs } from 'node:util';

export interface ParsedCommand {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly flags: {
    readonly infra: boolean;
    readonly e2e: boolean;
    readonly force: boolean;
    readonly name?: string;
    readonly help: boolean;
  };
}

export function parseCommandLine(argv: readonly string[]): ParsedCommand {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      'no-infra': { type: 'boolean', default: false },
      e2e: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      name: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  const [command = values.version ? 'version' : 'help', ...rest] = positionals;
  return {
    command,
    positionals: rest,
    flags: {
      infra: !values['no-infra'],
      e2e: values.e2e,
      force: values.force,
      help: values.help,
      ...(values.name === undefined ? {} : { name: values.name }),
    },
  };
}
