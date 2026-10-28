// Loads a TypeScript module from src/ the way the browser bundle sees it:
// esbuild resolves extensionless imports, strips types and hands back a data URL.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const cache = new Map();

export async function load(path) {
  if (!cache.has(path)) {
    const result = await build({
      entryPoints: [`${root}/${path}`], bundle: true, write: false, format: 'esm', platform: 'neutral',
      target: 'es2022', logLevel: 'silent', mainFields: ['module', 'main'],
    });
    const code = result.outputFiles[0].text;
    cache.set(path, import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`));
  }
  return cache.get(path);
}
