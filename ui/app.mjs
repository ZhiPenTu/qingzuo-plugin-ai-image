import { createPluginClient } from './sdk.mjs';
import { batchInput, progress, stateLabels, preferredModelId } from './state.mjs';

const client = createPluginClient(), element = id => document.getElementById(id);
let models = [], selected = [], generationDrafts = [], nextDraftId = 1, mode = 'edit';
let overrides = new Map(), current = null, history = [], directory = null, previewTokens = [], draftBusy = false;
let proxyModels = [], proxyState = 'idle', proxyMessage = '';
const thumbnails = new Map();

function notice(text, error = false) {
  element('notice').hidden = !text;
  element('notice').textContent = text;
  element('notice').classList.toggle('error', error);
}

function renderService() {
  const proxied = element('source').value === 'proxy';
  element('image-service-state').textContent = proxied ? proxyMessage || '共享连接 · 待刷新模型' : models.length ? '共享官方服务 · ' + models.length + ' 个图像模型' : '共享官方服务 · 尚未配置';
  element('setup-notice').hidden = proxied ? proxyState === 'loading' || proxyModels.length > 0 : models.length > 0;
  element('setup-description').textContent = proxied ? '在轻作「AI 设置」中完成共享连接，然后刷新图片模型。' : '在轻作「AI 设置 → 共享图像能力」配置官方服务，然后刷新模型。插件不会保存服务商密钥。';
}

async function action(work) {
  try { await work(); } catch (error) { notice(error.message || String(error), true); }
}

function catalog() { return element('source').value === 'proxy' ? proxyModels : models; }
function model() { return catalog().find(item => item.id === element('model').value); }
function batchMode() { return current?.mode || mode; }
function running() { return current?.state === 'running' || current?.state === 'canceling'; }
function queueItems() { return current ? current.items : mode === 'generate' ? generationDrafts : selected; }
function itemKey(item) { return current ? item.id : item.key || item.token; }

function choices(id, values) {
  const select = element(id);
  select.replaceChildren(...values.map(value => {
    const option = document.createElement('option');
    option.value = typeof value === 'string' ? value : value.id;
    option.textContent = typeof value === 'string' ? value : value.title;
    return option;
  }));
}

function renderParameters() {
  const selectedModel = model();
  for (const [id, values] of [['size', selectedModel?.sizes], ['ratio', selectedModel?.ratios], ['quality', selectedModel?.qualities]]) {
    const previous = element(id).value;
    choices(id, values || []);
    if (values?.includes(previous)) element(id).value = previous;
    element(id + '-label').hidden = !values?.length;
  }
  element('model-hint').textContent = element('source').value === 'proxy'
    ? '复用轻作共享连接。' + (selectedModel && !selectedModel.sizes.length && !selectedModel.ratios?.length && !selectedModel.qualities?.length ? '此模型未声明可调参数，使用服务默认参数；不会替换型号。' : '确认方案后才发送请求；刷新列表不生成图片。')
    : '使用轻作统一配置的共享官方图像服务；确认方案后才发送请求。';
  render();
}

function renderModels() {
  const previous = element('model').value, available = catalog(), provider = element('provider');
  for (const option of provider.options) {
    option.disabled = !available.some(item => item.provider === option.value);
    option.hidden = option.disabled;
  }
  if (!available.some(item => item.provider === provider.value)) provider.value = available[0]?.provider || '';
  const candidates = available.filter(item => item.provider === provider.value);
  choices('model', candidates);
  element('model').value = candidates.some(item => item.id === previous) ? previous : preferredModelId(candidates);
  element('proxy-controls').hidden = element('source').value !== 'proxy';
  renderService();
  renderParameters();
}

function parameters() {
  const selectedModel = model(), values = {};
  for (const [key, options] of [['size', selectedModel.sizes], ['ratio', selectedModel.ratios], ['quality', selectedModel.qualities]]) {
    if (options?.length) values[key] = element(key).value;
  }
  return values;
}

async function refreshProxy() {
  if (proxyState === 'loading') return;
  proxyState = 'loading';
  proxyMessage = '正在读取兼容服务模型…';
  element('proxy-state').textContent = proxyMessage;
  element('refresh-models').disabled = true;
  renderService();
  render();
  try {
    const available = await client.ai.models({ source: 'proxy' });
    if (!Array.isArray(available) || available.some(item => item.source !== 'proxy')) throw new Error('请更新轻作：当前版本不支持共享图片模型。');
    proxyModels = available;
    proxyState = 'ready';
    proxyMessage = proxyModels.length ? '共享连接 · ' + proxyModels.length + ' 个图片模型' : '共享连接尚未发现可用的图片模型。请检查服务设置与图片模型配置。';
  } catch (error) {
    proxyModels = [];
    proxyState = 'error';
    proxyMessage = error.message || '无法读取共享连接，请检查轻作 AI 设置。';
  } finally {
    element('proxy-state').textContent = proxyMessage;
    element('refresh-models').disabled = false;
    renderModels();
  }
}

async function refreshOfficial() {
  const button = element('refresh-service');
  button.disabled = true;
  try {
    const available = await client.ai.models({ source: 'official' });
    if (!Array.isArray(available) || available.some(item => item.source !== 'official')) throw new Error('当前底座未提供共享官方图像模型接口。');
    models = available;
  } catch (error) {
    models = [];
    notice(error.message || '无法读取共享图像服务，请检查轻作 AI 设置。', true);
  } finally {
    button.disabled = false;
    renderModels();
  }
}

async function refreshSelected() {
  if (element('source').value === 'proxy') await refreshProxy();
  else await refreshOfficial();
}

function renderMode() {
  const generating = batchMode() === 'generate', busy = running();
  for (const [id, value] of [['mode-edit', 'edit'], ['mode-generate', 'generate']]) {
    const button = element(id);
    button.classList.toggle('is-active', batchMode() === value);
    button.setAttribute('aria-selected', String(batchMode() === value));
    button.disabled = busy;
  }
  element('mode-hint').textContent = generating ? '无需原图，按提示词批量生成新图片。' : '导入原图，按统一提示词批量改写。';
  element('composer-title').textContent = generating ? '生成方案' : '编辑方案';
  element('composer-description').textContent = generating ? '选择模型并写下这一组图片的统一要求。' : '选择模型并写下这一组图片的统一要求。';
  element('pick').hidden = generating || Boolean(current);
  element('generate-count-label').hidden = !generating || Boolean(current);
  element('generate-count').value = String(generationDrafts.length);
  element('prompt-label').textContent = generating ? '统一生成提示词' : '统一编辑提示词';
  element('prompt').placeholder = generating
    ? '例如：一只戴红色围巾的柴犬站在雪地里，清晨柔光，真实摄影，画面干净。'
    : '例如：保留商品形状、颜色和文字，改成自然光下的浅色背景，增加柔和阴影。';
  element('prepare').textContent = generating ? '准备批量生成' : '准备批量方案';
  element('trial').textContent = generating ? '先生成一张' : '先试一张';
  element('queue-title').textContent = generating ? '生成队列' : '图片队列';
  element('summary').textContent = generating ? '每个项目可单独调整提示词，留空使用统一提示词。' : '导入原图后，可以为每张图片单独设置提示词。';
  element('comparison-title').textContent = generating ? '生成结果' : '原图与结果';
  element('comparison-description').textContent = generating ? '查看本次生成的图片。' : '对比本次编辑前后的画面。';
  element('original-figure').hidden = generating;
  element('result-caption').textContent = generating ? '生成结果' : '编辑结果';
}

function render() {
  const items = queueItems(), activeMode = batchMode(), busy = running();
  element('count').textContent = items.length;
  element('prepare').disabled = Boolean(current) || !items.length || draftBusy || !model() || element('source').value === 'proxy' && proxyState === 'loading';
  element('trial').disabled = element('prepare').disabled;
  element('batch-actions').hidden = !current;
  element('execute').disabled = !current || busy || draftBusy || current.state === 'finished' && !current.items.some(item => item.state === 'pending');
  element('execute').textContent = !current ? '确认方案并执行' : current.state === 'draft' ? '确认方案并执行' : current.state === 'finished' && !current.items.some(item => ['pending', 'failed'].includes(item.state)) ? '批次已完成' : '授权目录并继续未开始项';
  element('cancel').disabled = !busy;
  element('retry').disabled = !current || busy || draftBusy || !current.items.some(item => ['failed', 'save-failed'].includes(item.state));
  if (current) {
    element('progress-bar').style.width = progress(current) + '%';
    element('batch-status').textContent = current.items.filter(item => item.state === 'succeeded').length + ' / ' + items.length + ' 张已保存 · ' + (current.source === 'proxy' ? '共享连接' : '共享官方服务') + ' · ' + current.modelId + ' · ' + ({ draft: '等待确认方案', running: '后台执行中', canceling: '正在停止', canceled: '已停止', interrupted: '执行中断', finished: '批次结束' })[current.state];
  }
  renderMode();
  const queue = element('queue');
  if (!items.length) {
    const title = activeMode === 'generate' ? '设置生成数量，开始批量生成' : '从一张图片开始';
    const detail = activeMode === 'generate' ? '文生图不需要导入原图' : 'PNG、JPEG、WebP · 单张不超过 25 MB';
    queue.innerHTML = '<div class="empty"><span>✧</span><h3>' + title + '</h3><p>' + detail + '</p></div>';
    return;
  }
  queue.replaceChildren();
  for (const [index, item] of items.entries()) {
    const key = itemKey(item), row = document.createElement('div');
    row.className = 'queue-row';
    let thumb;
    if (activeMode === 'generate') {
      thumb = document.createElement('span');
      thumb.className = 'thumb thumb-generate';
      thumb.textContent = '✦';
      thumb.setAttribute('aria-hidden', 'true');
    } else {
      thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.alt = '';
      if (thumbnails.has(item.token)) thumb.src = thumbnails.get(item.token);
    }
    const info = document.createElement('div'), name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = current ? item.name : activeMode === 'generate' ? '生成图-' + (index + 1) : item.name;
    info.append(name);
    const prompt = document.createElement('textarea');
    prompt.className = 'item-prompt';
    prompt.rows = 2;
    prompt.placeholder = '留空使用统一提示词';
    prompt.setAttribute('aria-label', name.textContent + ' 提示词');
    prompt.value = current ? item.prompt : overrides.get(key) || '';
    prompt.disabled = current ? current.state !== 'draft' : false;
    prompt.addEventListener('change', () => {
      if (current) {
        void action(async () => {
          const prompts = current.items.map(value => value.id === item.id ? prompt.value : value.prompt);
          current = await client.ai.batch.revise({ id: current.id, revision: current.revision, prompts });
          render();
        });
      } else {
        overrides.set(key, prompt.value);
      }
    });
    info.append(prompt);
    if (item.state) {
      const status = document.createElement('div');
      status.className = 'item-status';
      status.textContent = stateLabels[item.state] || item.state;
      info.append(status);
    }
    if (item.error) {
      const error = document.createElement('div');
      error.className = 'item-error';
      error.textContent = item.error;
      info.append(error);
    }
    const button = document.createElement('button');
    button.className = 'secondary';
    button.textContent = current ? item.outputMime ? activeMode === 'generate' ? '查看结果' : '对比预览' : activeMode === 'generate' ? '等待生成' : '查看原图' : '移除';
    button.disabled = Boolean(current && activeMode === 'generate' && !item.outputMime);
    button.addEventListener('click', () => void action(async () => {
      if (!current) {
        if (activeMode === 'generate') {
          generationDrafts = generationDrafts.filter(value => value.key !== key);
          overrides.delete(key);
        } else {
          selected = selected.filter(value => value.token !== item.token);
          overrides.delete(item.token);
          thumbnails.delete(item.token);
          await client.files.release(item.token);
        }
        render();
        return;
      }
      await Promise.all(previewTokens.map(token => client.files.release(token).catch(() => {})));
      previewTokens = [];
      element('original').removeAttribute('src');
      element('result').removeAttribute('src');
      if (activeMode === 'edit') {
        const original = await client.ai.batch.preview({ id: current.id, itemId: item.id, original: true });
        previewTokens.push(original.token);
        element('original').src = await client.files.url(original.token);
      }
      element('result').hidden = !item.outputMime;
      if (item.outputMime) {
        const result = await client.ai.batch.preview({ id: current.id, itemId: item.id });
        previewTokens.push(result.token);
        element('result').src = await client.files.url(result.token);
      }
      element('comparison').hidden = false;
    }));
    row.append(thumb, info, button);
    queue.append(row);
  }
}

async function refresh() {
  history = await client.ai.batch.list();
  const select = element('history');
  select.replaceChildren(new Option('当前选择', ''), ...history.map(batch => new Option(new Date(batch.created).toLocaleString() + ' · ' + batch.items.length + ' 项', batch.id)));
  if (current) {
    current = history.find(batch => batch.id === current.id) || current;
    select.value = current.id;
  }
  render();
}

function syncGenerationDrafts(count) {
  const size = Math.max(1, Math.min(20, Number.isInteger(count) ? count : 1));
  while (generationDrafts.length < size) generationDrafts.push({ key: 'generate-' + nextDraftId++ });
  while (generationDrafts.length > size) {
    const removed = generationDrafts.pop();
    overrides.delete(removed.key);
  }
  element('generate-count').value = String(size);
}

async function prepare(single = false) {
  if (draftBusy) return;
  if (!model()) throw new Error('请先选择可用的图片模型。');
  const sourceItems = mode === 'generate' ? generationDrafts : selected;
  if (!sourceItems.length) throw new Error(mode === 'generate' ? '请先设置生成数量。' : '请先导入图片。');
  const chosen = single ? sourceItems.slice(0, 1) : sourceItems;
  const commonPrompt = element('prompt').value;
  if (mode === 'generate' && !commonPrompt.trim() && chosen.every(item => !overrides.get(item.key || item.token)?.trim())) throw new Error('请填写统一提示词，或为至少一个生成项目填写提示词。');
  draftBusy = true;
  render();
  try {
    current = await client.ai.batch.create(batchInput(chosen, overrides, model(), parameters(), commonPrompt, single ? 1 : Number(element('concurrency').value), mode));
    await refresh();
    notice(mode === 'generate' ? '生成方案已准备，请检查逐项提示词，再确认执行。' : '方案已准备，请检查逐图提示词，再确认执行。');
  } finally {
    draftBusy = false;
    render();
  }
}

async function execute(retryFailed = false) {
  if (!current) return;
  const operation = current.mode === 'generate' ? '生成' : '处理';
  if (!window.confirm('确认使用 ' + current.modelId + ' ' + operation + '本批次？\n' + (current.source === 'proxy' ? '每个项目会发送至轻作共享连接，可能消耗额度或产生费用。' : '每个项目会发送至轻作共享官方图像服务，按 API 规则计费。') + (retryFailed ? '\n失败项将重新请求；保存失败项只重新保存。' : ''))) return;
  directory = await client.files.pickDirectory();
  if (!directory) return;
  current = await client.ai.batch.start({ id: current.id, revision: current.revision, directoryToken: directory.token, retryFailed });
  render();
  notice('已开始后台处理，结果逐张保存到 ' + directory.name + '。');
}

async function closePreview() {
  element('comparison').hidden = true;
  element('original').removeAttribute('src');
  element('result').removeAttribute('src');
  await Promise.allSettled(previewTokens.map(token => client.files.release(token)));
  previewTokens = [];
}

function switchMode(next) {
  if (running() || next === mode && !current) return;
  current = null;
  mode = next;
  void closePreview();
  render();
}

element('provider').onchange = renderModels;
element('model').onchange = renderParameters;
const savedSource = localStorage.getItem('image-source');
element('source').value = savedSource === 'official' || savedSource === 'proxy' ? savedSource : 'proxy';
element('source').onchange = () => {
  localStorage.setItem('image-source', element('source').value);
  renderModels();
  void refreshSelected();
};
element('refresh-models').onclick = () => void refreshProxy();
element('refresh-service').onclick = () => void refreshSelected();
element('setup-refresh').onclick = () => void refreshSelected();
element('mode-edit').onclick = () => switchMode('edit');
element('mode-generate').onclick = () => switchMode('generate');
element('generate-count').onchange = () => {
  syncGenerationDrafts(Number(element('generate-count').value));
  render();
};
element('pick').onclick = () => void action(async () => {
  if (current) {
    current = null;
    overrides = new Map();
  }
  const files = await client.files.pickMany();
  selected.push(...files);
  for (const file of files) thumbnails.set(file.token, await client.files.url(file.token));
  render();
});
element('prepare').onclick = () => void action(() => prepare());
element('trial').onclick = () => void action(() => prepare(true));
element('execute').onclick = () => void action(() => execute());
element('retry').onclick = () => void action(() => execute(true));
element('cancel').onclick = () => void action(async () => { current = await client.ai.batch.cancel({ id: current.id }); render(); });
element('clear').onclick = () => void action(async () => {
  await Promise.allSettled(selected.map(file => client.files.release(file.token)));
  selected = [];
  overrides = new Map();
  current = null;
  thumbnails.clear();
  syncGenerationDrafts(generationDrafts.length || 4);
  await closePreview();
  render();
});
element('history').onchange = () => {
  current = history.find(batch => batch.id === element('history').value) || null;
  if (current) mode = current.mode || 'edit';
  void closePreview();
  render();
};
element('close-preview').onclick = () => void closePreview();

client.ai.onEvent(event => {
  if (event.type === 'batch' && event.batch.id === current?.id) {
    current = event.batch;
    render();
  }
});

syncGenerationDrafts(4);
await action(async () => {
  models = await client.ai.models({ source: 'official' });
  if (!savedSource && models.length) {
    element('source').value = 'official';
    localStorage.setItem('image-source', 'official');
  }
  renderModels();
  await refresh();
});
if (element('source').value === 'proxy') await refreshProxy();
