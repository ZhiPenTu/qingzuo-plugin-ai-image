import test from 'node:test';
import assert from 'node:assert/strict';
import { batchInput, progress, preferredModelId } from '../ui/state.mjs';
test('batch snapshot combines common prompt with per-image overrides', () => {
  const result = batchInput([{ token: 'first' }, { token: 'second' }], new Map([['second', 'keep the label']]), { id: 'test' }, { size: 'auto' }, 'white background', 2);
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
test('preferred default only selects an actually discovered model, never a fabricated fallback', () => {
  assert.equal(preferredModelId([{ id: 'gpt-image-1.5' }, { id: 'gpt-image-2.5-sunburst' }]), 'gpt-image-2.5-sunburst');
  assert.equal(preferredModelId([{ id: 'my-alias' }]), 'my-alias'); assert.equal(preferredModelId([]), '');
});
