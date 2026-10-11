import { createPluginClient } from './sdk.mjs';
import { setupCredentials } from './credentials.mjs';
const notice = (text, error = false) => {
  const target = document.getElementById('notice');
  target.hidden = !text; target.textContent = text; target.classList.toggle('error', error);
};
const client = createPluginClient();
const credentials = setupCredentials(client, document.getElementById('credential-fields'), notice);
document.getElementById('check-proxy').onclick = async () => {
  const button = document.getElementById('check-proxy'), status = document.getElementById('proxy-status'); button.disabled = true;
  try { const models = await client.ai.models({ source: 'proxy' }); if (!Array.isArray(models) || models.some(model => model.source !== 'proxy')) throw new Error('请更新轻作本地预览：当前底座未提供 CLIProxyAPI 图片模型接口。'); status.textContent = models.length ? '已发现 ' + models.length + ' 个图片模型，返回批图选择使用。' : '尚未发现图片编辑模型，请检查代理账户与图片路由配置。'; }
  catch (error) { status.textContent = error.message || '代理连接失败，请检查轻作 AI 设置。'; }
  finally { button.disabled = false; }
};
await credentials.refresh().catch(error => notice(error.message || String(error), true));
