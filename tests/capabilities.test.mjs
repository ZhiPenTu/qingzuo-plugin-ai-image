import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));

test('AI 图像服务由底座共享，插件只声明业务所需的图像能力', () => {
  assert.equal(pkg.version, '0.2.0');
  assert.equal(pkg.commerce.api, '^1.6.0');
  assert.equal(pkg.commerce.settings, undefined);
  assert.deepEqual(pkg.commerce.permissions, { files: true, ai: ['image-edit'] });
});

test('插件界面只提供批次业务设置，不包含服务商密钥或独立设置页', async () => {
  const html = await readFile('ui/index.html', 'utf8');
  assert.doesNotMatch(html, /api-settings|google-key|openai-key|插件专用/);
  assert.doesNotMatch(html, /template|模板/);
  assert.match(html, /AI 设置/);
  for (const file of ['ui/settings.html', 'ui/settings.mjs', 'ui/credentials.mjs', 'ui/credentials.css']) {
    await assert.rejects(access(file), { code: 'ENOENT' });
  }
});
