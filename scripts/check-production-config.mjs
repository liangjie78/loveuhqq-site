import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const db = config.d1_databases?.find(binding => binding.binding === 'DB');
if (!db?.database_id || db.database_name !== 'loveuhqq-notebook' || db.database_id === '1172b520-9bfe-451c-adca-12f09605f697') {
  console.error('Production deployment requires its own loveuhqq-notebook D1 binding. Follow docs/DEPLOYMENT.md before deploying.');
  process.exit(1);
}
const photos = config.kv_namespaces?.find(binding => binding.binding === 'PHOTOS');
if (photos?.id !== 'f2758069198e4a90896513225121d661') {
  console.error('Production deployment requires its own loveuhqq-photos KV binding. Follow docs/DEPLOYMENT.md before deploying.');
  process.exit(1);
}
