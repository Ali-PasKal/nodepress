// Runs with the sandbox process's Node flags (see process.test.ts) and reports what it could reach.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const attempt = (fn) => {
  try {
    fn();
    return 'allowed';
  } catch (error) {
    return error.code ?? error.name;
  }
};
const results = {
  env: Object.keys(process.env),
  readEtc: attempt(() => readFileSync('/etc/hostname')),
  readRepo: attempt(() => readFileSync(new URL('../../../package.json', import.meta.url))),
  readOwn: attempt(() => readFileSync(new URL('../package.json', import.meta.url))),
  spawn: attempt(() => spawnSync('node', ['--version'])),
  writeTmp: attempt(() => {
    const { writeFileSync } = process.getBuiltinModule('node:fs');
    writeFileSync('/tmp/nexora-probe.txt', 'x');
  }),
  // eslint-disable-next-line no-new-func -- the probe checks that the sandbox flags forbid this
  evalString: attempt(() => new Function('return 1')()),
};
process.send(results);
process.disconnect();
