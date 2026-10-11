export const stateLabels = { pending: '等待执行', running: '正在处理', succeeded: '已保存', failed: '处理失败', 'save-failed': '已生成，待保存', unknown: '请求结果未知' };
export function batchInput(files, overrides, model, parameters, prompt, concurrency = 2) {
  return { source: model.source || 'official', modelId: model.id, parameters, prompt: prompt.trim() || '请按用户需求编辑原图，并保持主体一致。', concurrency, items: files.map(file => ({ token: file.token, prompt: overrides.get(file.token)?.trim() || undefined })) };
}
export function progress(batch) { return batch.items.length ? Math.round(batch.items.filter(item => item.state === 'succeeded').length / batch.items.length * 100) : 0; }
export function preferredModelId(models) {
  return ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image', 'gemini-3-pro-image-preview', 'gemini-3-pro-image', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.5', 'gpt-image-2', 'gpt-image-1.5'].find(id => models.some(model => model.id === id)) || models[0]?.id || '';
}
