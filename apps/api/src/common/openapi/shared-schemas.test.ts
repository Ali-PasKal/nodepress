import { describe, expect, it } from 'vitest';
import { hoistSharedSchemas } from './shared-schemas.js';

const big = (marker: string) => ({
  type: 'object',
  properties: Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => [
      `${marker}${String(index)}`,
      { type: 'string', maxLength: 100 },
    ]),
  ),
});

describe('hoistSharedSchemas', () => {
  it('moves repeated large schemas into components and refers to them', () => {
    const styles = big('padding');
    const document = {
      openapi: '3.0.0',
      paths: {
        '/a': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { styles, other: { type: 'string' } } },
                },
              },
            },
          },
        },
        '/b': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { list: { type: 'array', items: { ...styles } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: { Existing: { type: 'string' } } },
    };
    const result = hoistSharedSchemas(document);
    expect(result.components.schemas).toHaveProperty('Styles');
    expect(result.components.schemas).toHaveProperty('Existing');
    const a = result.paths['/a'].post.requestBody.content['application/json'].schema;
    expect(a.properties.styles).toEqual({ $ref: '#/components/schemas/Styles' });
    expect(a.properties.other).toEqual({ type: 'string' });
    const b = result.paths['/b'].get.responses['200'].content['application/json'].schema;
    expect(b.properties.list.items).toEqual({ $ref: '#/components/schemas/Styles' });
    // The input is not modified.
    expect(
      document.paths['/a'].post.requestBody.content['application/json'].schema.properties.styles,
    ).toBe(styles);
  });

  it('hoists nested repeats and leaves small or unique schemas inline', () => {
    const inner = big('inner');
    const outer = { type: 'object', properties: { inner, more: big('outer') } };
    const document = {
      paths: {
        '/x': { get: { schema: { type: 'object', properties: { first: outer, second: outer } } } },
        '/y': {
          get: {
            schema: { type: 'object', properties: { inner, tiny: { type: 'string' } } },
          },
        },
      },
    };
    const result = hoistSharedSchemas(document) as unknown as {
      paths: Record<string, { get: { schema: { properties: Record<string, unknown> } } }>;
      components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    };
    const names = Object.keys(result.components.schemas);
    expect(names).toEqual(['First', 'Inner']);
    expect(result.components.schemas.First?.properties?.inner).toEqual({
      $ref: '#/components/schemas/Inner',
    });
    expect(result.paths['/y']?.get.schema.properties.inner).toEqual({
      $ref: '#/components/schemas/Inner',
    });
    expect(result.paths['/y']?.get.schema.properties.tiny).toEqual({ type: 'string' });
  });

  it('does not mistake a property named "type" for a schema', () => {
    const document = {
      paths: {
        '/z': {
          get: { schema: { type: 'object', properties: { type: { type: 'string' } } } },
        },
      },
    };
    expect(hoistSharedSchemas(document).paths).toEqual(document.paths);
  });
});
