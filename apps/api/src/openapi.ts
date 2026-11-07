import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, getSchemaPath, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { PRODUCT_NAME } from './config/product';
import { ErrorEnvelopeDto } from './shared/errors/error-envelope.dto';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;

/**
 * The API contract. Used by the dev OpenAPI UI and by `npm run openapi:export`, which writes
 * apps/api/openapi.json for the generated web client. Every 4xx/5xx response gets the
 * ErrorEnvelope schema, so clients can type errors instead of reading descriptions.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle(`${PRODUCT_NAME} API`).setVersion('1').addBearerAuth().build(),
    { extraModels: [ErrorEnvelopeDto] },
  );
  const errorContent = { 'application/json': { schema: { $ref: getSchemaPath(ErrorEnvelopeDto) } } };
  for (const item of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const responses = item[method]?.responses ?? {};
      for (const [status, response] of Object.entries(responses)) {
        if (response === undefined || '$ref' in response) continue;
        if (Number(status) >= 400 && response.content === undefined) {
          response.content = errorContent;
        }
      }
    }
  }
  return document;
}
