import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { registerSchemaTitles } from '../common/openapi/schema-titles.js';
import { hoistSharedSchemas } from '../common/openapi/shared-schemas.js';
import { OPENAPI_UI_PATH } from './http-security.js';

export const OPENAPI_JSON_PATH = `${OPENAPI_UI_PATH}/openapi.json`;

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  registerSchemaTitles();
  const config = new DocumentBuilder()
    .setTitle('NEXORA CMS API')
    .setDescription(
      'Management and delivery API for NEXORA CMS. All error responses use the `{ error: { code, message, requestId } }` envelope.',
    )
    .setVersion('1')
    .build();
  return hoistSharedSchemas(SwaggerModule.createDocument(app, config));
}

/** Serves the Swagger UI and the raw OpenAPI document. Disabled by default in production. */
export function setupOpenApi(app: INestApplication): void {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup(OPENAPI_UI_PATH.slice(1), app, document, {
    jsonDocumentUrl: OPENAPI_JSON_PATH.slice(1),
    yamlDocumentUrl: `${OPENAPI_UI_PATH.slice(1)}/openapi.yaml`,
    customSiteTitle: 'NEXORA CMS API',
  });
}
