import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

type BodySchema = NonNullable<
  Extract<Parameters<typeof ApiBody>[0], { schema?: unknown }>['schema']
>;

/** Documents a request body from its shared Zod contract (the same schema the validation pipe uses). */
export function ZodBody(schema: z.ZodType): MethodDecorator {
  const jsonSchema = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  });
  return ApiBody({ schema: jsonSchema as BodySchema });
}
