import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseCommandLine } from './args.ts';
import { checkNodeVersion, endpointOf, satisfiesRange } from './commands/doctor.ts';
import { isMigrateAction } from './commands/migrate.ts';
import { resolveCommand } from './process.ts';

const BIN = fileURLToPath(new URL('../bin/nexora.js', import.meta.url));

describe('parseCommandLine', () => {
  it('defaults to help', () => {
    assert.equal(parseCommandLine([]).command, 'help');
  });

  it('parses commands, positionals and flags', () => {
    const parsed = parseCommandLine(['migrate', 'dev', '--name', 'add_users']);
    assert.equal(parsed.command, 'migrate');
    assert.deepEqual(parsed.positionals, ['dev']);
    assert.equal(parsed.flags.name, 'add_users');
    assert.equal(parsed.flags.infra, true);
    assert.equal(parseCommandLine(['dev', '--no-infra']).flags.infra, false);
  });

  it('rejects unknown options', () => {
    assert.throws(() => parseCommandLine(['dev', '--yolo']));
  });
});

describe('doctor helpers', () => {
  it('evaluates engines ranges like the root package.json uses', () => {
    const range = '^22.22.0 || >=23.6.0';
    for (const ok of ['22.22.0', 'v22.23.4', '23.6.0', '23.7.0', '24.0.0', '26.1.0']) {
      assert.equal(satisfiesRange(ok, range), true, ok);
    }
    for (const bad of ['22.21.9', '22.9.0', '23.5.0', '20.19.0']) {
      assert.equal(satisfiesRange(bad, range), false, bad);
    }
  });

  it('accepts LTS releases, warns on non-LTS releases, and fails outside the range', () => {
    const range = '^22.22.0 || >=23.6.0';
    assert.equal(checkNodeVersion('22.23.4', range).level, 'ok');
    assert.equal(checkNodeVersion('24.15.0', range).level, 'ok');
    assert.equal(checkNodeVersion('23.7.0', range).level, 'warn');
    assert.equal(checkNodeVersion('22.12.0', range).level, 'fail');
  });

  it('supports comparator sets and rejects malformed input', () => {
    assert.equal(satisfiesRange('18.5.0', '>=18 <20'), true);
    assert.equal(satisfiesRange('20.0.0', '>=18 <20'), false);
    assert.equal(satisfiesRange('22.0.0', '22.0.0'), true);
    assert.equal(satisfiesRange('22.0.0', 'latest'), false);
    assert.equal(satisfiesRange('not-a-version', '>=1'), false);
  });

  it('matches the Node.js range declared in the root package.json', () => {
    const root = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as {
      engines: { node: string };
    };
    assert.equal(satisfiesRange(process.versions.node, root.engines.node), true);
  });

  it('extracts service endpoints with default ports', () => {
    assert.deepEqual(endpointOf('postgresql://u:p@db.local/nexora', 5432), {
      host: 'db.local',
      port: 5432,
    });
    assert.deepEqual(endpointOf('redis://127.0.0.1:6380', 6379), { host: '127.0.0.1', port: 6380 });
    assert.equal(endpointOf('not a url', 5432), null);
  });
});

describe('migrate', () => {
  it('accepts only known actions', () => {
    assert.equal(isMigrateAction('deploy'), true);
    assert.equal(isMigrateAction('drop-everything'), false);
    assert.equal(isMigrateAction(undefined), false);
  });

  it('refuses to reset without --force', () => {
    const result = spawnSync(process.execPath, [BIN, 'migrate', 'reset'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--force/);
  });

  it('refuses destructive actions in production', () => {
    const result = spawnSync(process.execPath, [BIN, 'migrate', 'reset', '--force'], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /disabled when NODE_ENV=production/);
  });
});

describe('binary', () => {
  it('prints help and version', () => {
    assert.match(
      execFileSync(process.execPath, [BIN, 'help'], { encoding: 'utf8' }),
      /nexora <command>/,
    );
    assert.match(
      execFileSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' }).trim(),
      /^\d+\.\d+\.\d+$/,
    );
  });

  it('fails on unknown commands', () => {
    const result = spawnSync(process.execPath, [BIN, 'create', 'plugin'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command "create"/);
  });
});

describe('resolveCommand (cross-platform process launching)', () => {
  it('runs pnpm through Node using npm_execpath, without a shell', () => {
    const resolved = resolveCommand(
      'pnpm',
      ['run', 'build'],
      { npm_execpath: '/opt/pnpm/bin/pnpm.cjs' },
      'win32',
    );
    assert.deepEqual(resolved, {
      command: process.execPath,
      args: ['/opt/pnpm/bin/pnpm.cjs', 'run', 'build'],
      shell: false,
    });
  });

  it('runs a standalone pnpm executable directly', () => {
    const resolved = resolveCommand(
      'pnpm',
      ['test'],
      { npm_execpath: 'C:\\pnpm\\pnpm.exe' },
      'win32',
    );
    assert.deepEqual(resolved, { command: 'C:\\pnpm\\pnpm.exe', args: ['test'], shell: false });
  });

  it('falls back to the pnpm.cmd shim through a shell only on Windows', () => {
    assert.deepEqual(resolveCommand('pnpm', ['test'], {}, 'win32'), {
      command: 'pnpm.cmd',
      args: ['test'],
      shell: true,
    });
    assert.deepEqual(resolveCommand('pnpm', ['test'], {}, 'linux'), {
      command: 'pnpm',
      args: ['test'],
      shell: false,
    });
  });

  it('leaves other commands untouched', () => {
    assert.deepEqual(resolveCommand('docker', ['compose', 'version'], {}, 'win32'), {
      command: 'docker',
      args: ['compose', 'version'],
      shell: false,
    });
  });

  it('rejects unsafe migration names', () => {
    const result = spawnSync(process.execPath, [BIN, 'migrate', 'dev', '--name', 'x & del /q *'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /letters, digits and underscores/);
  });
});
