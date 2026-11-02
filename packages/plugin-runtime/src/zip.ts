import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * A deliberately small ZIP reader and writer for plugin packages.
 *
 * The reader trusts nothing in the archive: it reads the central directory, refuses encrypted, ZIP64,
 * multi-disk and unusual entries, checks every size against the limits *before* decompressing, inflates with a
 * hard output cap (no zip bombs), and verifies each entry's CRC. Entry names are checked but never used as paths:
 * packages are kept in memory and stored in the database.
 */

export class ZipError extends Error {
  override readonly name = 'ZipError';
}

export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

export interface ZipEntry {
  readonly name: string;
  readonly data: Buffer;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

function safeName(name: string): boolean {
  if (name.length === 0 || name.length > 200) return false;
  if (!/^[A-Za-z0-9._/ -]+$/.test(name)) return false;
  if (name.startsWith('/') || name.includes('//')) return false;
  return name.split('/').every((part, index, parts) => {
    if (part === '.' || part === '..') return false;
    // An empty last part means a directory entry ("folder/").
    return part !== '' || index === parts.length - 1;
  });
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const stop = Math.max(0, buffer.length - EOCD_SIZE - MAX_COMMENT);
  for (let offset = buffer.length - EOCD_SIZE; offset >= stop; offset -= 1) {
    if (
      buffer.readUInt32LE(offset) === EOCD_SIGNATURE &&
      offset + EOCD_SIZE + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      return offset;
    }
  }
  throw new ZipError('This is not a ZIP archive.');
}

export function readZip(buffer: Buffer, limits: ZipLimits): ZipEntry[] {
  if (buffer.length < EOCD_SIZE) throw new ZipError('This is not a ZIP archive.');
  const end = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(end + 4);
  const centralDisk = buffer.readUInt16LE(end + 6);
  const entriesOnDisk = buffer.readUInt16LE(end + 8);
  const entryCount = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralOffset = buffer.readUInt32LE(end + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new ZipError('Multi-part archives are not supported.');
  }
  if (entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported.');
  }
  if (entryCount > limits.maxEntries) {
    throw new ZipError(`The archive has more than ${String(limits.maxEntries)} entries.`);
  }
  if (centralOffset + centralSize > end) throw new ZipError('The archive is damaged.');

  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let declaredTotal = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipError('The archive is damaged.');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd > end) throw new ZipError('The archive is damaged.');
    const name = buffer.toString('latin1', cursor + 46, nameEnd);
    cursor = nameEnd + extraLength + commentLength;

    if ((flags & 0x1) !== 0) throw new ZipError('Encrypted archives are not supported.');
    if (method !== 0 && method !== 8)
      throw new ZipError(`"${name}" uses an unsupported compression.`);
    if (!safeName(name)) throw new ZipError(`The archive contains an invalid file name.`);
    if (name.endsWith('/')) continue; // directory
    if (seen.has(name)) throw new ZipError(`"${name}" appears twice in the archive.`);
    seen.add(name);
    if (size > limits.maxEntryBytes) throw new ZipError(`"${name}" is too large.`);
    declaredTotal += size;
    if (declaredTotal > limits.maxTotalBytes)
      throw new ZipError('The archive unpacks to too much data.');

    if (localOffset + 30 > end || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new ZipError('The archive is damaged.');
    }
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > end) throw new ZipError('The archive is damaged.');
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) {
      if (compressedSize !== size) throw new ZipError('The archive is damaged.');
      data = Buffer.from(raw);
    } else {
      try {
        // A hard cap at the declared size: an entry that inflates to more is refused, not buffered.
        data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw new ZipError(`"${name}" could not be unpacked.`);
      }
    }
    if (data.length !== size || crc32(data) !== crc) {
      throw new ZipError(`"${name}" is damaged (size or checksum mismatch).`);
    }
    entries.push({ name, data });
  }
  return entries;
}

/** Writes a ZIP archive (deflated entries, fixed timestamps so the same files give the same bytes). */
export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  // 1980-01-01 00:00, the earliest DOS date.
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1;
  for (const entry of entries) {
    if (!safeName(entry.name)) throw new ZipError(`Invalid file name "${entry.name}".`);
    const name = Buffer.from(entry.name, 'latin1');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(EOCD_SIZE);
  end.writeUInt32LE(EOCD_SIGNATURE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
