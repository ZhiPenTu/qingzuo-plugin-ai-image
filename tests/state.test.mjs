import test from 'node:test';
import assert from 'node:assert/strict';
import { batchInput, progress, preferredModelId } from '../ui/state.mjs';
test('batch snapshot combines common prompt with per-image overrides', () => {
  const result = batchInput([{ token: 'first' }, { token: 'second' }], new Map([['second', 'keep the label']]), { id: 'test' }, { size: 'auto' }, 'white background', 2);
  assert.equal(result.mode, 'edit');
  assert.equal(result.prompt, 'white background'); assert.deepEqual(result.items, [{ token: 'first', prompt: undefined }, { token: 'second', prompt: 'keep the label' }]); assert.equal(result.concurrency, 2);
});
test('progress counts only saved outputs, not generated or interrupted requests', () => {
  assert.equal(progress({ items: [{ state: 'succeeded' }, { state: 'save-failed' }, { state: 'unknown' }, { state: 'pending' }] }), 25);
});
test('batch source is snapshotted, with official defaults for older catalogs', () => {
  const files = [{ token: 'first' }];
  assert.equal(batchInput(files, new Map(), { id: 'alias', source: 'proxy' }, {}, 'edit').source, 'proxy');
  assert.equal(batchInput(files, new Map(), { id: 'legacy' }, {}, 'edit').source, 'official');
});
test('text-to-image drafts contain prompts without original image tokens', () => {
  const drafts = [{ key: 'generate-1' }, { key: 'generate-2' }];
  const result = batchInput(drafts, new Map([['generate-2', '夜景版本']]), { id: 'image-generate', source: 'proxy' }, { ratio: '1:1' }, '一只柴犬', 2, 'generate');
  assert.equal(result.mode, 'generate');
  assert.deepEqual(result.items, [{ prompt: undefined }, { prompt: '夜景版本' }]);
  assert.equal(Object.hasOwn(result.items[0], 'token'), false);
});
test('empty text-to-image prompt is not replaced with edit-specific copy', () => {
  const result = batchInput([{ key: 'generate-1' }], new Map(), { id: 'image-generate' }, {}, '', 1, 'generate');
  assert.equal(result.prompt, '');
});
test('preferred default only selects an actually discovered model, never a fabricated fallback', () => {
  assert.equal(preferredModelId([{ id: 'gpt-image-1.5' }, { id: 'gpt-image-2.5-sunburst' }]), 'gpt-image-2.5-sunburst');
  assert.equal(preferredModelId([{ id: 'my-alias' }]), 'my-alias'); assert.equal(preferredModelId([]), '');
});
