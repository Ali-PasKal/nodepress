/**
 * Zod contracts are converted to JSON Schema per route, so large shared parts (rich text, builder documents and
 * their styles) are repeated in every operation that uses them. This pass moves every large schema that occurs
 * more than once into `components.schemas` and replaces the occurrences with `$ref`s, which keeps the document
 * small and readable without changing what it describes.
 */

type Json = null | boolean | number | string | Json[] | JsonObject;
interface JsonObject {
  [key: string]: Json;
}

/** Schemas smaller than this (as compact JSON) stay inline. */
const MIN_SHARED_SIZE = 1_000;

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON Schema node (not a map of properties or media types, which may contain a key named "type"). */
function isSchema(node: JsonObject): boolean {
  return (
    typeof node.type === 'string' ||
    Array.isArray(node.type) ||
    Array.isArray(node.oneOf) ||
    Array.isArray(node.anyOf) ||
    Array.isArray(node.allOf)
  );
}

/** JSON with sorted keys, so equal schemas compare equal. */
function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function pascal(text: string): string {
  const words = text
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('') || 'Schema';
}

interface Candidate {
  key: string;
  node: JsonObject;
  count: number;
  /** How often each property name holds this schema (the most common one names the component). */
  hints: Map<string, number>;
}

/** Visits schema nodes with a name hint (the property name they appear under). */
function visit(
  node: Json,
  hint: string,
  onSchema: (node: JsonObject, hint: string) => void,
  skipRoot = false,
): void {
  if (Array.isArray(node)) {
    for (const item of node) visit(item, hint, onSchema);
    return;
  }
  if (!isObject(node)) return;
  if (!skipRoot && isSchema(node)) onSchema(node, hint);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && isObject(value)) {
      for (const [name, property] of Object.entries(value)) visit(property, name, onSchema);
    } else if (key === 'items') {
      visit(value, `${hint} item`, onSchema);
    } else {
      visit(value, hint, onSchema);
    }
  }
}

/** Replaces every occurrence of the schema with the given canonical form by a reference. */
function replace(node: Json, key: string, ref: JsonObject, skipRoot = false): Json {
  if (Array.isArray(node)) return node.map((item) => replace(item, key, ref));
  if (!isObject(node)) return node;
  if (!skipRoot && isSchema(node) && canonical(node) === key) return { ...ref };
  return Object.fromEntries(
    Object.entries(node).map(([name, value]) => [name, replace(value, key, ref)]),
  );
}

export function hoistSharedSchemas<Document extends object>(document: Document): Document {
  const result = structuredClone(document) as unknown as JsonObject;
  const components = isObject(result.components) ? result.components : {};
  const schemas = isObject(components.schemas) ? components.schemas : {};
  result.components = components;
  components.schemas = schemas;

  for (;;) {
    const candidates = new Map<string, Candidate>();
    const count = (node: JsonObject, hint: string) => {
      const key = canonical(node);
      if (key.length < MIN_SHARED_SIZE) return;
      const candidate: Candidate = candidates.get(key) ?? {
        key,
        node,
        count: 0,
        hints: new Map<string, number>(),
      };
      candidate.count += 1;
      candidate.hints.set(hint, (candidate.hints.get(hint) ?? 0) + 1);
      candidates.set(key, candidate);
    };
    visit(result.paths ?? null, 'schema', count);
    for (const [name, schema] of Object.entries(schemas)) visit(schema, name, count, true);

    // The largest repeated schema first; smaller ones repeated inside it are found in the next rounds.
    let best: Candidate | null = null;
    for (const candidate of candidates.values()) {
      if (candidate.count > 1 && (!best || candidate.key.length > best.key.length)) {
        best = candidate;
      }
    }
    if (!best) break;

    let hint = 'schema';
    let uses = 0;
    for (const [name, times] of best.hints) {
      if (times > uses) [hint, uses] = [name, times];
    }
    const title = typeof best.node.title === 'string' ? best.node.title : hint;
    const base = pascal(title);
    let name = base;
    for (let suffix = 2; name in schemas; suffix += 1) name = `${base}${String(suffix)}`;
    const ref: JsonObject = { $ref: `#/components/schemas/${name}` };

    result.paths = replace(result.paths ?? null, best.key, ref);
    for (const [existing, schema] of Object.entries(schemas)) {
      schemas[existing] = replace(schema, best.key, ref, true);
    }
    schemas[name] = best.node;
  }
  return result as unknown as Document;
}
