import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

const source = 'dist/renderer';
const destination = 'dist/client';

if (!existsSync(`${source}/index.html`)) {
  throw new Error(`Missing ${source}/index.html; run npm run build:renderer first.`);
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
console.log(`Prepared ${destination} from ${source}.`);
