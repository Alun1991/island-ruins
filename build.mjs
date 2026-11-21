import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
process.chdir(root);

const t0 = Date.now();
const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});

const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync('src/index.template.html', 'utf8');
// function replacement: string replacements would interpret `$&`, `$'`, `` $` `` inside the bundle
const html = tpl.replace('<!--BUNDLE-->', () => `<script>\n${js}</script>`);
fs.writeFileSync('index.html', html);

const kb = (html.length / 1024).toFixed(0);
console.log(`built index.html  ${kb} KB  (${Date.now() - t0}ms)`);
