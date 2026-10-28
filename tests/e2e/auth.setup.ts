import { expect, test as setup } from '@playwright/test';

// Sign in once per run and share the session: the Worker rate-limits logins per address.
import { signedIn } from './session';

setup('sign in once', async ({ request, baseURL }) => {
  const password = process.env.E2E_PASSWORD ?? 'e2e-only-password';
  const response = await request.post('/api/session', { data: { password, remember: true }, headers: { Origin: new URL(baseURL!).origin } });
  expect(response.ok()).toBeTruthy();
  await request.storageState({ path: signedIn });
});
