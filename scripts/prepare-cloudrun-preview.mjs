import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

const source = 'dist/client';
const destination = 'deploy/cloudrun/zaojing-web/client';

if (!existsSync(`${source}/index.html`)) {
  throw new Error(`Missing ${source}/index.html; run npm run build:renderer and npm run prepare:online first.`);
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
console.log(`Prepared ${destination} from ${source}.`);
