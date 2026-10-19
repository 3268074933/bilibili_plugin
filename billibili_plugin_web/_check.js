const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const jsIds = [...new Set([...js.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))];
const missingJsIds = jsIds.filter((id) => !ids.has(id));

const anchors = [...new Set([...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]))];
const missingAnchors = anchors.filter((id) => !ids.has(id));

const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
const remoteAssets = external.filter((url) => !url.startsWith('https://www.bilibili.com'));

const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const tagStack = [];
const tagErrors = [];
const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
let match;
while ((match = tagRe.exec(html))) {
  const [, closing, tag, rest] = match;
  if (/^<!|^<\?/.test(match[0])) continue;
  if (tag.toLowerCase() === 'script' && !closing) {
    const end = html.indexOf('</script>', tagRe.lastIndex);
    if (end === -1) tagErrors.push('unclosed <script>');
    else tagRe.lastIndex = end + 9;
    continue;
  }
  if (voidTags.has(tag.toLowerCase()) || rest.trim().endsWith('/')) continue;
  if (closing) {
    const last = tagStack.pop();
    if (last !== tag.toLowerCase()) tagErrors.push(`expected </${last}> but found </${tag}>`);
  } else {
    tagStack.push(tag.toLowerCase());
  }
}
if (tagStack.length) tagErrors.push(`unclosed tags: ${tagStack.join(', ')}`);

let cssBraces = 0;
let inComment = false;
let inString = '';
for (let i = 0; i < css.length; i += 1) {
  const ch = css[i];
  const next = css[i + 1];
  if (inComment) {
    if (ch === '*' && next === '/') { inComment = false; i += 1; }
    continue;
  }
  if (inString) {
    if (ch === inString && css[i - 1] !== '\\') inString = '';
    continue;
  }
  if (ch === '/' && next === '*') { inComment = true; i += 1; continue; }
  if (ch === '"' || ch === "'") { inString = ch; continue; }
  if (ch === '{') cssBraces += 1;
  if (ch === '}') cssBraces -= 1;
}

console.log('ids in html:', ids.size);
console.log('missing js ids:', missingJsIds.length ? missingJsIds : 'none');
console.log('anchors:', anchors.length, '| missing:', missingAnchors.length ? missingAnchors : 'none');
console.log('external assets:', external.length ? external : 'none');
console.log('remote assets:', remoteAssets.length ? remoteAssets : 'none');
console.log('html tag errors:', tagErrors.length ? tagErrors : 'none');
console.log('css brace balance:', cssBraces === 0 ? 'ok' : cssBraces);
console.log('inline handlers:', /on(click|load|error|change|input|submit)=/i.test(html) ? 'FOUND' : 'none');
