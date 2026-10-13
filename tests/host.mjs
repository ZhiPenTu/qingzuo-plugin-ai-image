import { expect } from '@playwright/test';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { launchPluginTestHost } from '@commerce/plugin-sdk/testing';

if (!process.env.QINGZUO_HOST_EXECUTABLE) throw new Error('指定固定底座 QINGZUO_HOST_EXECUTABLE。');
const artifact = path.resolve('release/official.ai-image-0.1.0-' + process.platform + '-' + process.arch + '.ecplugin');
const host = await launchPluginTestHost({ executablePath: process.env.QINGZUO_HOST_EXECUTABLE, artifactPath: artifact, pluginId: 'official.ai-image' });
const pageErrors = []; host.plugin.on('pageerror', error => pageErrors.push(error.message)); host.app.context().on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
host.app.process().stderr.on('data', data => process.stderr.write(data));
let draft, round = 0;
const proxyCalls = [];
const imageCatalog = [{ id: 'gemini-3.1-flash-image-preview', type: 'gemini' }, { id: 'gpt-image-2.5-sunburst', type: 'openai' }, { id: 'studio-edit', type: 'openai-image' }, { id: 'fixture-plan', type: 'openai' }];
let proxyCatalog = imageCatalog;
const server = createServer(async (request, response) => {
  if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: proxyCatalog })); return; }
  if (request.url === '/v1/images/edits' || request.url.startsWith('/v1beta/models/')) {
    try {
      expect(request.headers.authorization).toBe('Bearer fixture-text');
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (request.url === '/v1/images/edits') {
        const form = await new Request('http://localhost/edit', { method: 'POST', headers: { 'Content-Type': request.headers['content-type'] }, body: bytes }).formData();
        expect(form.get('n')).toBe('1'); expect(form.get('response_format')).toBe('b64_json'); expect(form.getAll('image[]')).toHaveLength(1);
        expect(Buffer.from(await form.get('image[]').arrayBuffer())).toEqual(png);
        proxyCalls.push({ endpoint: request.url, model: form.get('model') });
      } else {
        const body = JSON.parse(bytes); expect(body.contents[0].parts).toHaveLength(2); expect(body.contents[0].parts[1].inline_data.data).toBe(png.toString('base64'));
        proxyCalls.push({ endpoint: request.url });
      }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(request.url === '/v1/images/edits' ? { data: [{ b64_json: png.toString('base64') }] } : { candidates: [{ content: { parts: [{ inline_data: { data: png.toString('base64') } }] } }] }));
    } catch (error) { console.error(error); response.writeHead(400); response.end(); }
    return;
  }
  let encoded = ''; for await (const bytes of request) encoded += bytes;
  const input = JSON.parse(encoded);
  if (!input.stream) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'connection_check', arguments: '{"ok":true}' } }] } }] })); return; }
  response.setHeader('Content-Type', 'text/event-stream');
  const event = (delta, finish_reason = null) => response.write('data: ' + JSON.stringify({ choices: [{ delta, finish_reason }] }) + '\n\n');
  if (++round === 1) {
    event({ tool_calls: [{ index: 0, id: 'preview-plan', function: { name: 'prepare_plan', arguments: JSON.stringify({ id: draft.id, revision: draft.revision, prompts: draft.items.map((_item, index) => '助手白底方案 ' + (index + 1)) }) } }] }); event({}, 'tool_calls');
  } else { event({ content: '方案已准备，请确认执行。' }); event({}, 'stop'); }
  response.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAdkAAAAASUVORK5CYII=', 'base64');
async function trusted(work, args) {
  return host.app.evaluate(async (_electron, input) => {
    const vm = process.getBuiltinModule('node:vm'), path = process.getBuiltinModule('node:path'), url = process.getBuiltinModule('node:url');
    const runtimeURL = url.pathToFileURL(path.join(process.resourcesPath, 'app.asar/desktop/main.mjs')).href;
    const runtime = await vm.runInThisContext('import(' + JSON.stringify(runtimeURL) + ')', { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
    if (input.work === 'fixture') {
      globalThis.qingzuoImageCalls = [];
      runtime.imageEditor.request = async (url, options) => {
        globalThis.qingzuoImageCalls.push(url);
        if (url.includes('googleapis')) {
          if (options.headers['x-goog-api-key'] !== 'fixture-google') throw new Error('Google credential contract');
          const body = JSON.parse(options.body); if (body.contents[0].parts.filter(part => part.inline_data).length !== 1) throw new Error('One image required');
        } else if (url !== 'https://api.openai.com/v1/images/edits' || options.headers.Authorization !== 'Bearer fixture-openai' || options.body.get('n') !== '1') throw new Error('OpenAI contract');
        await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 400); options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true }); });
        return Response.json(url.includes('googleapis') ? { candidates: [{ content: { parts: [{ inlineData: { data: input.args.png } }] } }] } : { data: [{ b64_json: input.args.png }] });
      };
    } else if (input.work === 'calls') return globalThis.qingzuoImageCalls;
    else if (input.work === 'diagnostic') return runtime.host.stdout?.read()?.toString() || 'no kernel stdout';
    else if (input.work === 'clear-images' || input.work === 'clear') { if (input.work === 'clear') await runtime.proxy.credentials.clear('system.ai', 'external'); for (const name of ['google-image', 'openai-image']) await runtime.proxy.credentials.clear('official.ai-image', name); }
  }, { work, args });
}
try {
  expect((await host.page.evaluate(() => window.commerceDesktop.invoke('status'))).version).toBe('0.3.0');
  const inputs = [];
  for (let index = 0; index < 4; index++) { const filename = path.join(host.temporary, 'original-' + index + '.png'); await writeFile(filename, png); inputs.push(filename); }
  const output = path.join(host.temporary, 'results'); await mkdir(output);
  await host.app.evaluate(({ dialog }, { inputs, output }) => { dialog.showOpenDialog = async options => ({ canceled: false, filePaths: options.properties.includes('openDirectory') ? [output] : inputs }); }, { inputs, output });
  await trusted('fixture', { png: png.toString('base64') });
  expect((await host.page.evaluate(() => window.commerceDesktop.invoke('ai.start'))).running).toBe(true);
  expect(await host.page.evaluate(() => window.commerceDesktop.invoke('ai.accounts'))).toEqual([]);
  if (process.env.QINGZUO_UI_EVIDENCE_DIR) {
    await mkdir(process.env.QINGZUO_UI_EVIDENCE_DIR, { recursive: true });
    await host.page.getByRole('button', { name: 'AI 设置', exact: true }).click();
    await host.page.getByRole('button', { name: '账户与 API', exact: true }).click();
    await host.page.getByRole('button', { name: 'OAuth 登录', exact: true }).click();
    await host.page.screenshot({ path: path.join(process.env.QINGZUO_UI_EVIDENCE_DIR, 'AI设置界面.png') });
    await host.page.getByRole('button', { name: '图像 API', exact: true }).click();
    await host.page.getByRole('button', { name: '配置图像 API', exact: true }).click();
    await expect(host.plugin.getByRole('heading', { name: '图像 API 配置', exact: true })).toBeVisible();
    await host.plugin.screenshot({ path: path.join(process.env.QINGZUO_UI_EVIDENCE_DIR, '图像API配置界面.png') });
    await host.plugin.getByRole('link', { name: '返回 AI 批图' }).click();
  }
  await host.page.evaluate(() => window.commerceDesktop.invoke('ai.stop'));
  await host.page.evaluate(async base => { await window.commerceDesktop.invoke('ai.configure', { mode: 'external', address: base, apiKey: 'fixture-text', model: 'fixture-plan' }); await window.commerceDesktop.invoke('ai.verify'); }, 'http://127.0.0.1:' + server.address().port);
  await host.plugin.locator('#open-api-settings').click();
  await host.plugin.locator('#google-key').fill('fixture-google'); await host.plugin.locator('[data-key="google"]').click(); await expect(host.plugin.locator('#google-key')).toHaveValue('');
  await host.plugin.locator('#openai-key').fill('fixture-openai'); await host.plugin.locator('[data-key="openai"]').click();
  await expect(host.plugin.locator('#openai-status')).toHaveText('已配置');
  await host.plugin.locator('#finish-api-settings').click();
  await expect(host.plugin.locator('#api-settings')).not.toBeVisible();
  await host.page.getByRole('button', { name: 'AI 设置', exact: true }).click();
  await host.page.getByRole('button', { name: '账户与 API', exact: true }).click();
  await expect(host.page.getByRole('heading', { name: 'OAuth 账户登录' })).toBeVisible();
  await expect(host.page.getByRole('button', { name: '登录 Codex' })).toBeDisabled();
  await host.page.getByRole('button', { name: '图像 API', exact: true }).click();
  await host.page.getByRole('button', { name: '配置图像 API', exact: true }).click();
  await expect(host.plugin.getByRole('heading', { name: '图像 API 配置', exact: true })).toBeVisible();
  await expect(host.plugin.locator('#google-status')).toHaveText('已配置');
  await expect(host.plugin.locator('#google-key')).toHaveValue('');
  await host.plugin.getByRole('link', { name: '返回 AI 批图' }).click();
  await host.plugin.locator('#source').selectOption('official');
  await host.plugin.locator('#pick').click(); await expect(host.plugin.locator('#count')).toHaveText('4');
  await host.plugin.locator('#prompt').fill('统一白底，保留商品');
  await host.plugin.getByLabel('original-1.png 提示词', { exact: true }).fill('第二张增加阴影');
  await host.plugin.locator('#open-api-settings').click();
  await expect(host.plugin.locator('#google-key')).toHaveValue('');
  await host.plugin.locator('#finish-api-settings').click();
  await expect(host.plugin.locator('#count')).toHaveText('4');
  await expect(host.plugin.locator('#prompt')).toHaveValue('统一白底，保留商品');
  await expect(host.plugin.getByLabel('original-1.png 提示词', { exact: true })).toHaveValue('第二张增加阴影');
  await host.plugin.locator('#prepare').click(); await expect(host.plugin.locator('#batch-actions')).toBeVisible();
  draft = (await host.plugin.evaluate(() => window.commercePlugin.invoke('ai.batch.list')))[0]; expect(draft.items[1].prompt).toBe('第二张增加阴影');
  await host.plugin.locator('#message').fill('优化成统一的电商白底方案'); await host.plugin.locator('#send').click();
  await expect.poll(async () => { const status = await host.plugin.evaluate(() => window.commercePlugin.invoke('ai.assistant.status')); if (status.error) throw new Error(status.error); return status.history.length; }, { timeout: 30000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await host.plugin.evaluate(() => window.commercePlugin.invoke('ai.assistant.status'))).state).toBe('idle');
  await expect.poll(async () => (await host.plugin.evaluate(id => window.commercePlugin.invoke('ai.batch.get', { id }), draft.id)).revision).toBe(2);
  expect((await trusted('calls')).length).toBe(0);
  await expect(host.plugin.locator('#chat')).toContainText('请确认执行');
  await mkdir('output', { recursive: true }); await host.plugin.evaluate(() => window.scrollTo(0, 0)); await host.plugin.screenshot({ path: 'output/preview-plan.png' });
  await host.plugin.evaluate(() => { window.confirm = () => true; });
  await host.plugin.locator('#execute').click();
  await expect.poll(async () => (await trusted('calls')).length).toBeGreaterThanOrEqual(1);
  await host.page.evaluate(() => window.commerceDesktop.invoke('view.close', { id: 'official.ai-image' }));
  await expect.poll(async () => (await readdir(output)).length).toBe(4);
  expect((await trusted('calls')).length).toBe(4);
  await host.page.getByRole('button', { name: '工具中心', exact: true }).click();
  await host.page.locator('[data-slot="card"]').filter({ has: host.page.getByRole('heading', { name: 'AI 批图', exact: true }) }).getByRole('button', { name: '打开工具', exact: true }).click();
  await expect.poll(() => host.app.context().pages().some(page => page.url().startsWith('commerce-plugin://official.ai-image/'))).toBe(true);
  host.plugin = host.app.context().pages().find(page => page.url().startsWith('commerce-plugin://official.ai-image/'));
  await host.plugin.locator('#history').selectOption(draft.id); await expect(host.plugin.locator('#batch-status')).toContainText('4 / 4');
  await host.plugin.getByRole('button', { name: '对比预览' }).first().click(); await expect(host.plugin.locator('#result')).toBeVisible();
  expect(await host.plugin.locator('#result').evaluate(image => image.complete && image.naturalWidth === 1)).toBe(true);
  await host.plugin.screenshot({ path: 'output/preview-completed.png' });
  await host.plugin.locator('#clear').click(); await host.plugin.locator('#pick').click(); await host.plugin.locator('#provider').selectOption('openai');
  await host.plugin.locator('#prompt').fill('保留商品，柔和光线'); await host.plugin.locator('#trial').click();
  await host.plugin.evaluate(() => { window.confirm = () => true; }); await host.plugin.locator('#execute').click();
  await expect.poll(async () => (await readdir(output)).length).toBe(5); expect((await trusted('calls')).at(-1)).toBe('https://api.openai.com/v1/images/edits');
  await trusted('clear-images');
  await host.plugin.locator('#clear').click(); await host.plugin.locator('#pick').click();
  await host.plugin.locator('#source').selectOption('proxy');
  await expect(host.plugin.locator('#proxy-state')).toContainText('3 个图片模型');
  await host.plugin.locator('#provider').selectOption('google');
  await expect(host.plugin.locator('#model')).toHaveValue('gemini-3.1-flash-image-preview');
  await host.plugin.locator('#prompt').fill('代理账户统一白底');
  proxyCatalog = []; await host.plugin.locator('#refresh-models').click();
  await expect(host.plugin.locator('#proxy-state')).toContainText('尚未发现'); await expect(host.plugin.locator('#prepare')).toBeDisabled();
  await expect(host.plugin.locator('#count')).toHaveText('4'); await expect(host.plugin.locator('#prompt')).toHaveValue('代理账户统一白底');
  proxyCatalog = imageCatalog; await host.plugin.locator('#refresh-models').click();
  await expect(host.plugin.locator('#proxy-state')).toContainText('3 个图片模型');
  await host.plugin.locator('#prepare').click();
  await expect(host.plugin.locator('#batch-status')).toContainText('外部代理');
  await expect(host.plugin.locator('#execute')).toBeEnabled();
  const proxyBatch = (await host.plugin.evaluate(() => window.commercePlugin.invoke('ai.batch.list')))[0];
  expect(proxyBatch.source).toBe('proxy'); expect(proxyCalls).toHaveLength(0);
  await host.plugin.evaluate(() => { window.confirm = () => false; }); await host.plugin.locator('#execute').click();
  expect(proxyCalls).toHaveLength(0);
  await host.plugin.locator('#source').selectOption('official');
  await host.plugin.evaluate(() => { window.confirm = message => { window.lastConfirmation = message; return true; }; });
  await host.plugin.locator('#execute').click(); await expect.poll(async () => (await readdir(output)).length).toBe(9);
  expect(await host.plugin.evaluate(() => window.lastConfirmation)).toContain('外部代理');
  expect(proxyCalls).toHaveLength(4); expect(proxyCalls.every(call => call.endpoint.includes('gemini-3.1-flash-image-preview'))).toBe(true);
  expect((await host.page.evaluate(() => window.commerceDesktop.invoke('ai.status'))).model).toBe('fixture-plan');
  await host.plugin.locator('#clear').click(); await host.plugin.locator('#pick').click(); await host.plugin.locator('#source').selectOption('proxy');
  await expect(host.plugin.locator('#refresh-models')).toBeEnabled();
  await host.plugin.locator('#provider').selectOption('openai'); await host.plugin.locator('#trial').click(); await host.plugin.locator('#execute').click();
  await expect.poll(async () => (await readdir(output)).length).toBe(10); expect(proxyCalls.at(-1).model).toBe('gpt-image-2.5-sunburst');
  await host.plugin.locator('#clear').click(); await host.plugin.locator('#pick').click(); await host.plugin.locator('#provider').selectOption('compatible');
  await expect(host.plugin.locator('#model')).toHaveValue('studio-edit'); await expect(host.plugin.locator('#size-label')).not.toBeVisible();
  await host.plugin.locator('#trial').click(); await host.plugin.locator('#execute').click();
  await expect.poll(async () => (await readdir(output)).length).toBe(11); expect(proxyCalls.at(-1).model).toBe('studio-edit');
  const evidence = process.env.QINGZUO_UI_EVIDENCE_DIR || 'output'; await mkdir(evidence, { recursive: true });
  await host.plugin.evaluate(() => window.scrollTo(0, 0));
  await host.plugin.screenshot({ path: path.join(evidence, '外部代理批图界面.png') });
  await host.plugin.locator('#clear').click(); await host.plugin.locator('#provider').selectOption('openai');
  await host.plugin.evaluate(() => window.scrollTo(0, 0));
  await host.plugin.screenshot({ path: path.join(evidence, '外部代理图片模型.png') });
  expect(pageErrors).toEqual([]);
  console.log('独立安装包验收通过：官方与代理两类接口、代理别名、无需官方密钥、多图保存、模型刷新保留队列、批次来源冻结、确认隔离、默认助手不变；无付费请求。');
} catch (error) { console.error('验收诊断', await host.plugin.locator('#notice').textContent(), await host.plugin.evaluate(() => window.commercePlugin.invoke('ai.assistant.status')), await trusted('diagnostic')); throw error; }
finally { await trusted('clear').catch(() => {}); await host.close(); await new Promise(resolve => server.close(resolve)); }
