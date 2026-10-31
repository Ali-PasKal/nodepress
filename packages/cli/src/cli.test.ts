import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseCommandLine } from './args.ts';
import { endpointOf, satisfiesMinimum } from './commands/doctor.ts';
import { isMigrateAction } from './commands/migrate.ts';

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
  it('compares versions', () => {
    assert.equal(satisfiesMinimum('22.23.4', '22.22.0'), true);
    assert.equal(satisfiesMinimum('v22.22.0', '22.22.0'), true);
    assert.equal(satisfiesMinimum('22.9.0', '22.22.0'), false);
    assert.equal(satisfiesMinimum('24.0.0', '22.22.0'), true);
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
