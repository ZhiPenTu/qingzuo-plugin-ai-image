import { _electron, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const executablePath = process.env.QINGZUO_HOST_EXECUTABLE;
if (!executablePath) throw new Error('指定固定底座 QINGZUO_HOST_EXECUTABLE。');
const hostVersion = process.env.QINGZUO_HOST_VERSION || '0.6.12';
const temporary = await mkdtemp(path.join(os.tmpdir(), 'qingzuo-market-ai-'));
const applicationRoot = process.platform === 'darwin' ? path.resolve(executablePath, '../../..') : path.dirname(executablePath);
const archive = path.join(applicationRoot, process.platform === 'darwin' ? 'Contents/Resources/app.asar' : 'resources/app.asar');
const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
const environment = { ...process.env };
delete environment.NODE_PATH;
delete environment.NODE_OPTIONS;
let app;
try {
  app = await _electron.launch({ executablePath, args: ['--user-data-dir=' + path.join(temporary, 'profile')], cwd: temporary, env: environment });
  const page = await app.firstWindow();
  await expect(page.getByText(/工具服务已就绪|Harness 内核已连接/)).toBeVisible({ timeout: 60000 });
  expect((await page.evaluate(() => window.commerceDesktop.invoke('status'))).version).toBe(hostVersion);
  await page.getByRole('button', { name: '插件市场', exact: true }).click();
  const card = page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: 'AI 批图', exact: true }) });
  await expect(card).toBeVisible({ timeout: 120000 });
  await card.getByRole('button', { name: '安装插件', exact: true }).click();
  await expect.poll(async () => {
    const installed = (await page.evaluate(() => window.commerceDesktop.invoke('status'))).plugins.find(plugin => plugin.id === 'official.ai-image');
    if (installed) return installed;
    if (await page.getByRole('alert').isVisible()) throw new Error(await page.getByRole('alert').innerText());
    return null;
  }, { timeout: 120000 }).toMatchObject({ source: 'market', enabled: true });
  const marketPlugin = (await page.evaluate(() => window.commerceDesktop.invoke('status'))).plugins.find(plugin => plugin.id === 'official.ai-image');
  await page.getByRole('button', { name: '工具中心', exact: true }).click();
  const installed = page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: 'AI 批图', exact: true }) });
  await installed.getByRole('button', { name: '打开工具', exact: true }).click();
  await expect.poll(() => app.context().pages().some(candidate => candidate.url().startsWith('commerce-plugin://official.ai-image/'))).toBe(true);
  const plugin = app.context().pages().find(candidate => candidate.url().startsWith('commerce-plugin://official.ai-image/'));
  await expect(plugin.locator('#source')).toHaveValue('proxy');
  await expect(plugin.locator('#mode-edit')).toHaveAttribute('aria-selected', 'true');
  await expect(plugin.locator('#count')).toHaveText('0');
  await plugin.locator('#mode-generate').click();
  await expect(plugin.locator('#mode-generate')).toHaveAttribute('aria-selected', 'true');
  await expect(plugin.locator('#count')).toHaveText('4');
  await expect(plugin.locator('#templates, #save-template, #delete-template')).toHaveCount(0);
  expect(createHash('sha256').update(await readFile(archive)).digest('hex')).toBe(digest);
  await mkdir('output', { recursive: true });
  await plugin.screenshot({ path: 'output/market-installed.png' });
  await writeFile('output/market-verification.json', JSON.stringify({ platform: process.platform + '-' + process.arch, hostVersion, hostRunId: process.env.QINGZUO_HOST_RUN_ID, hostSha256: digest, pluginVersion: marketPlugin.version, source: 'signed public market', hostUnchanged: true, paidRequests: 0 }, null, 2));
  console.log('Signed public AI-image market installation passed; pinned host unchanged; no image requests.');
} finally {
  await app?.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
