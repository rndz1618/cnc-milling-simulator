import { mkdirSync, cpSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const out = join(root, 'dist');
mkdirSync(out, { recursive: true });
cpSync(join(root, 'index.html'), join(out, 'index.html'));
cpSync(join(root, 'src'), join(out, 'src'), { recursive: true });
console.log('static build → dist/ (index.html + src/)');
