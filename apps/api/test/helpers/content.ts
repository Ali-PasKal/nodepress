import type { Server } from 'node:http';
import {
  contentModelResponseSchema,
  entryDetailSchema,
  type ContentModelResponse,
  type EntryDetail,
} from '@nexora/shared';
import { createUser, signIn, type SignedIn } from './identity.js';

export async function contentModel(user: SignedIn): Promise<ContentModelResponse> {
  return contentModelResponseSchema.parse(
    (await user.agent.get('/api/v1/content-model').expect(200)).body,
  );
}

export async function idsByKey(user: SignedIn) {
  const model = await contentModel(user);
  const type = (key: string) => model.contentTypes.find((candidate) => candidate.key === key)!;
  const taxonomy = (key: string) => model.taxonomies.find((candidate) => candidate.key === key)!;
  return { type, taxonomy };
}

export async function createEntry(
  user: SignedIn,
  body: Record<string, unknown>,
  expected = 201,
): Promise<EntryDetail> {
  const response = await user.agent
    .post('/api/v1/entries')
    .set('X-CSRF-Token', user.csrf)
    .send({ type: 'post', ...body })
    .expect(expected);
  return expected === 201 ? entryDetailSchema.parse(response.body) : (response.body as EntryDetail);
}

export async function patchEntry(
  user: SignedIn,
  entry: { id: string; version: number },
  body: Record<string, unknown>,
  expected = 200,
) {
  return user.agent
    .patch(`/api/v1/entries/${entry.id}`)
    .set('X-CSRF-Token', user.csrf)
    .send({ version: entry.version, ...body })
    .expect(expected);
}

export async function signInAs(server: Server, admin: SignedIn, role: string): Promise<SignedIn> {
  const user = await createUser(admin, role);
  return signIn(server, user.email, user.password);
}

export function paragraphDoc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}
