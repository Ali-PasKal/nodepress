import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PluginPackageError, readPluginPackage, writePluginPackage } from './package.js';
import { readZip, writeZip, ZipError } from './zip.js';

const limits = { maxEntries: 10, maxEntryBytes: 64 * 1024, maxTotalBytes: 128 * 1024 };
const file = (name: string, text: string) => ({ name, data: Buffer.from(text, 'utf8') });

const manifest = {
  id: 'acme.hello',
  name: 'Hello',
  version: '1.0.0',
  apiVersion: 1,
  main: 'plugin.js',
  shortcodes: [{ name: 'hello', label: 'Hello' }],
};

function packageWith(overrides: object = {}, extra: { name: string; data: Buffer }[] = []) {
  return writePluginPackage([
    file('nexora-plugin.json', JSON.stringify({ ...manifest, ...overrides })),
    file('plugin.js', 'export default { shortcodes: { hello() { return "hi"; } } };'),
    ...extra,
  ]);
}

function expectPackageError(action: () => unknown, message: RegExp) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PluginPackageError);
    expect((error as Error).message).toMatch(message);
    return error as PluginPackageError;
  }
  throw new Error('expected a PluginPackageError');
}

/** Rewrites the 4-byte little-endian value at every central-directory entry offset (for tampering). */
function patchCentral(zip: Buffer, offset: number, size: 2 | 4, value: number): Buffer {
  const copy = Buffer.from(zip);
  for (let index = 0; index + 4 <= copy.length; index += 1) {
    if (copy.readUInt32LE(index) === 0x02014b50) {
      if (size === 2) copy.writeUInt16LE(value, index + offset);
      else copy.writeUInt32LE(value, index + offset);
    }
  }
  return copy;
}

describe('zip reader', () => {
  it('reads what the writer writes', () => {
    const entries = [file('a.txt', 'hello'), file('dir/b.txt', 'x'.repeat(5_000))];
    expect(readZip(writeZip(entries), limits)).toEqual(entries);
  });

  it('refuses archives that are not zips, damaged, or tampered with', () => {
    expect(() => readZip(Buffer.from('not a zip at all, sorry'), limits)).toThrow(ZipError);
    const zip = writeZip([file('a.txt', 'hello world')]);
    const truncated = zip.subarray(0, zip.length - 30);
    expect(() => readZip(truncated, limits)).toThrow(ZipError);
    // Flip a byte of the compressed data: the checksum no longer matches.
    const flipped = Buffer.from(zip);
    flipped[32 + 'a.txt'.length] = (flipped[32 + 'a.txt'.length] ?? 0) ^ 0xff;
    expect(() => readZip(flipped, limits)).toThrow(/damaged|could not be unpacked/);
  });

  it('stops zip bombs before they inflate', () => {
    // Hand-built archive: the central directory claims 1 KB, the data inflates to 50 MB.
    const name = Buffer.from('bomb.txt');
    const data = deflateRawSync(Buffer.alloc(50 * 1024 * 1024));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(1_024, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(Buffer.alloc(1_024)), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(1_024, 24);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(30 + name.length + data.length, 16);
    const bomb = Buffer.concat([local, name, data, central, name, end]);
    expect(() => readZip(bomb, limits)).toThrow('"bomb.txt" could not be unpacked.');
    // Honest sizes above the limits are refused before anything is inflated.
    const big = writeZip([{ name: 'big.txt', data: Buffer.alloc(100 * 1024) }]);
    expect(() => readZip(big, limits)).toThrow(/too large/);
    const many = writeZip(Array.from({ length: 11 }, (_, index) => file(`f${String(index)}`, 'x')));
    expect(() => readZip(many, limits)).toThrow(/more than 10 entries/);
    const total = writeZip(
      Array.from({ length: 3 }, (_, index) => ({
        name: `f${String(index)}`,
        data: Buffer.alloc(60_000),
      })),
    );
    expect(() => readZip(total, limits)).toThrow(/too much data/);
  });

  it('refuses encrypted, unusual and unsafe entries', () => {
    const zip = writeZip([file('a.txt', 'hello')]);
    expect(() => readZip(patchCentral(zip, 8, 2, 0x1), limits)).toThrow(/Encrypted/);
    expect(() => readZip(patchCentral(zip, 10, 2, 12), limits)).toThrow(/unsupported compression/);
    const zip64 = Buffer.from(zip);
    zip64.writeUInt32LE(0xffffffff, zip64.length - 22 + 16);
    expect(() => readZip(zip64, limits)).toThrow(/ZIP64/);
    // Names cannot be written unsafely by our writer, so patch them in: "../x.t" has the same length.
    for (const bad of ['../x.t', '/a.txt', 'a\\.tx']) {
      const named = Buffer.from(writeZip([file('aaaaaa', 'hello')]));
      let index = named.indexOf('aaaaaa');
      while (index !== -1) {
        named.write(bad, index, 'latin1');
        index = named.indexOf('aaaaaa', index + 1);
      }
      expect(() => readZip(named, limits)).toThrow(/invalid file name/);
    }
    const duplicate = writeZip([file('a.txt', '1'), file('b.txt', '2')]);
    const patched = Buffer.from(duplicate);
    let index = patched.indexOf('b.txt');
    while (index !== -1) {
      patched.write('a.txt', index, 'latin1');
      index = patched.indexOf('b.txt', index + 1);
    }
    expect(() => readZip(patched, limits)).toThrow(/appears twice/);
  });
});

describe('plugin packages', () => {
  it('reads a valid package with defaults applied, also from a zipped folder', () => {
    const plugin = readPluginPackage(packageWith({}, [file('README.md', '# Hello\n')]));
    expect(plugin.manifest).toMatchObject({
      id: 'acme.hello',
      permissions: [],
      hosts: [],
      settings: [],
      hooks: [],
      shortcodes: [{ name: 'hello', label: 'Hello', attributes: {}, description: '' }],
    });
    expect(plugin.code).toContain('export default');
    expect(plugin.readme).toBe('# Hello\n');
    const folder = writePluginPackage([
      file('hello/nexora-plugin.json', JSON.stringify(manifest)),
      file('hello/plugin.js', 'export default {};'),
    ]);
    expect(readPluginPackage(folder).manifest.id).toBe('acme.hello');
  });

  it('explains what is wrong with a package', () => {
    expectPackageError(() => readPluginPackage(Buffer.from('nope')), /not a ZIP/);
    expectPackageError(
      () => readPluginPackage(writePluginPackage([file('plugin.js', 'x')])),
      /no nexora-plugin\.json/,
    );
    expectPackageError(
      () =>
        readPluginPackage(
          writePluginPackage([file('nexora-plugin.json', '{ nope'), file('plugin.js', 'x')]),
        ),
      /not valid JSON/,
    );
    expectPackageError(
      () =>
        readPluginPackage(
          writePluginPackage([file('nexora-plugin.json', JSON.stringify(manifest))]),
        ),
      /no plugin\.js/,
    );
    const invalid = expectPackageError(
      () =>
        readPluginPackage(
          packageWith({
            id: 'NoDot',
            apiVersion: 99,
            permissions: ['http:fetch'],
            shortcodes: [{ name: 'year', label: 'Year' }],
          }),
        ),
      /invalid/,
    );
    expect(invalid.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['id', 'apiVersion', 'shortcodes.0.name', 'hosts']),
    );
    expectPackageError(
      () =>
        readPluginPackage(
          writePluginPackage([
            file('nexora-plugin.json', JSON.stringify(manifest)),
            { name: 'plugin.js', data: Buffer.from([0xff, 0xfe, 0x00]) },
          ]),
        ),
      /not valid UTF-8/,
    );
    expectPackageError(() => readPluginPackage(Buffer.alloc(3 * 1024 * 1024)), /larger than 2 MB/);
  });
});
