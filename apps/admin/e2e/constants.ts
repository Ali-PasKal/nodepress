import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const E2E_SETUP_TOKEN = 'e2e-setup-token-0123456789abcdef';
export const E2E_MAIL_DIR = join(tmpdir(), 'nexora-e2e-mail');
export const OWNER = {
  name: 'Site Owner',
  email: 'owner@example.test',
  password: 'correct horse battery staple',
};
