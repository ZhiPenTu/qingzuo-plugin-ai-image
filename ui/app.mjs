import { createPluginClient } from './sdk.mjs';
import { batchInput, progress, stateLabels, preferredModelId } from './state.mjs';
import { setupCredentials } from './credentials.mjs';
const client = createPluginClient(), element = id => document.getElementById(id);
let models = [], selected = [], overrides = new Map(), current = null, history = [], directory = null, previewTokens = [], assistantRunning = false, draftBusy = false;
let configuredKeys = {}, proxyModels = [], proxyState = 'idle', proxyMessage = '';
const thumbnails = new Map();
function notice(text, error = false) { element('notice').hidden = !text; element('notice').textContent = text; element('notice').classList.toggle('error', error); }
const credentials = setupCredentials(client, element('credential-fields'), notice, configured => {
  configuredKeys = configured; renderService();
});
function renderService() {
  const proxied = element('source').value === 'proxy';
  element('image-service-state').textContent = proxied ? proxyMessage || 'CLIProxyAPI · 待刷新模型' : ['Google ' + (configuredKeys.google ? '已配置' : '未配置'), 'OpenAI ' + (configuredKeys.openai ? '已配置' : '未配置')].join(' · ');
  element('setup-notice').hidden = proxied ? proxyState === 'loading' || proxyModels.length > 0 : Boolean(configuredKeys.google || configuredKeys.openai);
  element('setup-description').textContent = proxied ? '在轻作「AI 设置 → 代理连接」配置 CLIProxyAPI 和图片账户，然后刷新模型；无需填写官方 API Key。' : '此来源使用插件专用的 Google / OpenAI 官方 API Key。';
}
for (const id of ['open-api-settings', 'setup-api']) element(id).onclick = () => element('api-settings').showModal();
for (const id of ['close-api-settings', 'finish-api-settings']) element(id).onclick = () => element('api-settings').close();
element('api-settings').addEventListener('close', () => credentials.clearInputs());
async function action(work) { try { await work(); } catch (error) { notice(error.message || String(error), true); } }
function catalog() { return element('source').value === 'proxy' ? proxyModels : models; }
function model() { return catalog().find(item => item.id === element('model').value); }
function choices(id, values) { const select = element(id); select.replaceChildren(...values.map(value => { const option = document.createElement('option'); option.value = typeof value === 'string' ? value : value.id; option.textContent = typeof value === 'string' ? value : value.title; return option; })); }
function renderParameters() {
  const selectedModel = model();
  for (const [id, values] of [['size', selectedModel?.sizes], ['ratio', selectedModel?.ratios], ['quality', selectedModel?.qualities]]) { const previous = element(id).value; choices(id, values || []); if (values?.includes(previous)) element(id).value = previous; element(id + '-label').hidden = !values?.length; }
  element('model-hint').textContent = element('source').value === 'proxy' ? '复用轻作代理账户，不改变默认助手模型。' + (selectedModel && !selectedModel.sizes.length && !selectedModel.ratios?.length && !selectedModel.qualities?.length ? '此模型未声明可调参数，使用服务默认参数；不会替换型号。' : '图片确认后才上传；刷新列表不生成图片。') : '使用插件专用官方 API Key；图片确认后才上传。';
  render();
}
function renderModels() {
  const previous = element('model').value, available = catalog(), provider = element('provider');
  for (const option of provider.options) { option.disabled = !available.some(item => item.provider === option.value); option.hidden = option.disabled; }
  if (!available.some(item => item.provider === provider.value)) provider.value = available[0]?.provider || '';
  const candidates = available.filter(item => item.provider === provider.value); choices('model', candidates);
  element('model').value = candidates.some(item => item.id === previous) ? previous : preferredModelId(candidates);
  element('proxy-controls').hidden = element('source').value !== 'proxy'; renderService(); renderParameters();
}
function parameters() { const selectedModel = model(), values = {}; for (const [key, options] of [['size', selectedModel.sizes], ['ratio', selectedModel.ratios], ['quality', selectedModel.qualities]]) if (options?.length) values[key] = element(key).value; return values; }
async function refreshProxy() {
  if (proxyState === 'loading') return;
  proxyState = 'loading'; proxyMessage = '正在读取 CLIProxyAPI 图片模型…'; element('proxy-state').textContent = proxyMessage; element('refresh-models').disabled = true; renderService(); render();
  try { const catalog = await client.ai.models({ source: 'proxy' }); if (!Array.isArray(catalog) || catalog.some(model => model.source !== 'proxy')) throw new Error('请更新轻作本地预览：当前底座未提供 CLIProxyAPI 图片模型接口。'); proxyModels = catalog; proxyState = 'ready'; proxyMessage = proxyModels.length ? 'CLIProxyAPI · ' + proxyModels.length + ' 个图片模型' : '代理尚未发现可编辑图片的模型。请检查账户与图片模型配置。'; }
  catch (error) { proxyModels = []; proxyState = 'error'; proxyMessage = error.message || '无法连接代理，请检查轻作 AI 设置。'; }
  finally { element('proxy-state').textContent = proxyMessage; element('refresh-models').disabled = false; renderModels(); }
}
function render() {
  const items = current ? current.items : selected, running = current?.state === 'running' || current?.state === 'canceling';
  element('count').textContent = items.length; element('prepare').disabled = !selected.length || draftBusy || !model() || element('source').value === 'proxy' && proxyState === 'loading'; element('trial').disabled = element('prepare').disabled;
  element('batch-actions').hidden = !current; element('execute').disabled = !current || running || draftBusy || current.state === 'finished' && !current.items.some(item => item.state === 'pending');
  element('execute').textContent = current?.state === 'draft' ? '确认方案并执行' : '授权目录并恢复未开始项';
  element('cancel').disabled = !running; element('retry').disabled = !current || running || draftBusy || !current.items.some(item => ['failed', 'save-failed'].includes(item.state));
  if (current) { element('progress-bar').style.width = progress(current) + '%'; element('batch-status').textContent = current.items.filter(item => item.state === 'succeeded').length + ' / ' + items.length + ' 张已保存 · ' + (current.source === 'proxy' ? 'CLIProxyAPI' : '官方 API') + ' · ' + current.modelId + ' · ' + ({ draft: '等待确认方案', running: '后台执行中', canceling: '正在停止', canceled: '已停止', interrupted: '执行中断', finished: '批次结束' })[current.state]; }
  const queue = element('queue');
  if (!items.length) { queue.innerHTML = '<div class="empty"><span>✧</span><h3>从一张图片开始</h3><p>PNG、JPEG、WebP · 单张不超过 25 MB</p></div>'; return; }
  queue.replaceChildren();
  for (const item of items) {
    const row = document.createElement('div'); row.className = 'queue-row';
    const thumb = document.createElement('img'); thumb.className = 'thumb'; thumb.alt = ''; if (thumbnails.has(item.token)) thumb.src = thumbnails.get(item.token);
    const info = document.createElement('div'), name = document.createElement('div'); name.className = 'file-name'; name.textContent = item.name; info.append(name);
    const prompt = document.createElement('textarea'); prompt.className = 'item-prompt'; prompt.rows = 2; prompt.placeholder = '留空使用统一提示词'; prompt.setAttribute('aria-label', item.name + ' 提示词'); prompt.value = current ? item.prompt : overrides.get(item.token) || ''; prompt.disabled = current ? current.state !== 'draft' : false;
    prompt.addEventListener('change', () => { if (current) void action(async () => { const prompts = current.items.map(value => value.id === item.id ? prompt.value : value.prompt); current = await client.ai.batch.revise({ id: current.id, revision: current.revision, prompts }); render(); }); else overrides.set(item.token, prompt.value); }); info.append(prompt);
    if (item.state) { const status = document.createElement('div'); status.className = 'item-status'; status.textContent = stateLabels[item.state] || item.state; info.append(status); }
    if (item.error) { const error = document.createElement('div'); error.className = 'item-error'; error.textContent = item.error; info.append(error); }
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = current ? item.outputMime ? '对比预览' : '查看原图' : '移除';
    button.addEventListener('click', () => void action(async () => {
      if (!current) { selected = selected.filter(value => value.token !== item.token); overrides.delete(item.token); thumbnails.delete(item.token); await client.files.release(item.token); render(); return; }
      await Promise.all(previewTokens.map(token => client.files.release(token).catch(() => {}))); previewTokens = [];
      const original = await client.ai.batch.preview({ id: current.id, itemId: item.id, original: true }); previewTokens.push(original.token); element('original').src = await client.files.url(original.token);
      element('result').removeAttribute('src'); element('result').hidden = !item.outputMime;
      if (item.outputMime) { const result = await client.ai.batch.preview({ id: current.id, itemId: item.id }); previewTokens.push(result.token); element('result').src = await client.files.url(result.token); }
      element('comparison').hidden = false;
    })); row.append(thumb, info, button); queue.append(row);
  }
}
async function refresh() { history = await client.ai.batch.list(); const select = element('history'); select.replaceChildren(new Option('当前选择', ''), ...history.map(batch => new Option(new Date(batch.created).toLocaleString() + ' · ' + batch.items.length + ' 张', batch.id))); if (current) { current = history.find(batch => batch.id === current.id) || current; select.value = current.id; } render(); }
async function prepare(single = false) { if (draftBusy) return; if (!model()) throw new Error('请先选择可用的图片模型。'); draftBusy = true; render(); try { current = await client.ai.batch.create(batchInput(single ? selected.slice(0, 1) : selected, overrides, model(), parameters(), element('prompt').value, single ? 1 : Number(element('concurrency').value))); await refresh(); notice('方案已准备，请检查逐图提示词，再确认执行。'); } finally { draftBusy = false; render(); } }
async function execute(retryFailed = false) {
  if (!current) return;
  if (!window.confirm('确认使用 ' + current.modelId + ' 处理本批次？\n' + (current.source === 'proxy' ? '每张图片会发送至已配置的 CLIProxyAPI，由代理账户处理，可能消耗额度或产生费用。' : '每张图片会发送至官方服务，按 API 规则计费。') + (retryFailed ? '\n失败项将重新请求；保存失败项只重新保存。' : ''))) return;
  directory = await client.files.pickDirectory(); if (!directory) return;
  current = await client.ai.batch.start({ id: current.id, revision: current.revision, directoryToken: directory.token, retryFailed }); render(); notice('已开始后台处理，结果逐张保存到 ' + directory.name + '。');
}
function templates() { try { return JSON.parse(localStorage.getItem('prompt-templates') || '[]').filter(item => typeof item.name === 'string' && typeof item.prompt === 'string').slice(0, 50); } catch { return []; } }
function renderTemplates() { element('templates').replaceChildren(new Option('选择模板', ''), ...templates().map((template, index) => new Option(template.name, String(index)))); }
function renderChat(session) { assistantRunning = session.state === 'running'; element('send').disabled = assistantRunning; element('chat').replaceChildren(...session.history.map(message => { const bubble = document.createElement('div'); bubble.className = message.role === 'user' ? 'user-message' : 'assistant-message'; bubble.textContent = message.text; return bubble; })); if (session.error) notice(session.error, true); element('chat').scrollTop = element('chat').scrollHeight; }
element('provider').onchange = renderModels; element('model').onchange = renderParameters;
element('source').value = localStorage.getItem('image-source') === 'official' ? 'official' : 'proxy';
element('source').onchange = () => { localStorage.setItem('image-source', element('source').value); renderModels(); if (element('source').value === 'proxy') void refreshProxy(); };
element('refresh-models').onclick = () => void refreshProxy();
element('pick').onclick = () => void action(async () => { if (current) { current = null; overrides = new Map(); } const files = await client.files.pickMany(); selected.push(...files); for (const file of files) thumbnails.set(file.token, await client.files.url(file.token)); render(); });
element('prepare').onclick = () => void action(() => prepare()); element('trial').onclick = () => void action(() => prepare(true)); element('execute').onclick = () => void action(() => execute()); element('retry').onclick = () => void action(() => execute(true));
element('cancel').onclick = () => void action(async () => { current = await client.ai.batch.cancel({ id: current.id }); render(); });
element('clear').onclick = () => void action(async () => { await Promise.allSettled(selected.map(file => client.files.release(file.token))); selected = []; overrides = new Map(); current = null; thumbnails.clear(); element('comparison').hidden = true; render(); });
element('history').onchange = () => { current = history.find(batch => batch.id === element('history').value) || null; render(); };
element('close-preview').onclick = () => void action(async () => { element('comparison').hidden = true; element('original').removeAttribute('src'); element('result').removeAttribute('src'); await Promise.allSettled(previewTokens.map(token => client.files.release(token))); previewTokens = []; });
element('save-template').onclick = () => { const prompt = element('prompt').value.trim(); if (!prompt) return notice('请先填写提示词。', true); const values = templates(); values.push({ name: prompt.slice(0, 24), prompt }); localStorage.setItem('prompt-templates', JSON.stringify(values.slice(-50))); renderTemplates(); notice('提示词模板已保存。'); };
element('delete-template').onclick = () => { const index = element('templates').value; if (index === '') return; const values = templates(); values.splice(Number(index), 1); localStorage.setItem('prompt-templates', JSON.stringify(values)); renderTemplates(); };
element('templates').onchange = () => { const index = element('templates').value; if (index !== '') element('prompt').value = templates()[Number(index)].prompt; };
element('send').onclick = () => void action(async () => { const text = element('message').value.trim(); if (!text || assistantRunning) return; if (!current && selected.length) { if (!element('prompt').value.trim()) element('prompt').value = text; await prepare(); } const session = await client.ai.assistant.send({ text, batchId: current?.id }); element('message').value = ''; renderChat(session); });
element('stop-assistant').onclick = () => void action(async () => renderChat(await client.ai.assistant.cancel()));
client.ai.onEvent(event => { if (event.type === 'batch') { if (event.batch.id === current?.id) { current = event.batch; render(); } } else if (event.type === 'assistant') { renderChat(event.session); void action(refresh); } else if (event.type === 'assistant-delta') { let bubble = element('chat').querySelector('.streaming'); if (!bubble) { bubble = document.createElement('div'); bubble.className = 'assistant-message streaming'; element('chat').append(bubble); } bubble.textContent += event.text; element('chat').scrollTop = element('chat').scrollHeight; } });
await action(async () => { const [catalog, assistant] = await Promise.all([client.ai.models(), client.ai.assistant.status(), credentials.refresh()]); models = catalog; renderModels(); renderTemplates(); renderChat(assistant); await refresh(); });
if (element('source').value === 'proxy') await refreshProxy();
