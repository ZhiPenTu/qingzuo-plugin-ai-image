import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const repository = 'ZhiPenTu/qingzuo-desktop';
const hostVersion = process.env.QINGZUO_HOST_VERSION || 'v0.6.6';
const json = args => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
assert.match(hostVersion, /^v\d+\.\d+\.\d+$/);
assert.match(process.env.QINGZUO_HOST_RUN_ID || '', /^\d+$/);
const run = json(['run', 'view', process.env.QINGZUO_HOST_RUN_ID, '--repo', repository, '--json', 'conclusion,workflowName,headSha,headBranch']);
assert.equal(run.conclusion, 'success');
assert.equal(run.workflowName, 'Release commerce desktop');
assert.equal(run.headBranch, hostVersion);
let tag = json(['api', 'repos/' + repository + '/git/ref/tags/' + hostVersion]).object;
for (let depth = 0; tag.type === 'tag' && depth < 3; depth++) tag = json(['api', 'repos/' + repository + '/git/tags/' + tag.sha]).object;
assert.equal(tag.type, 'commit');
assert.equal(tag.sha, run.headSha);
for (const version of [hostVersion, 'sdk-v1.2.0']) {
  const release = json(['api', 'repos/' + repository + '/releases/tags/' + version]);
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, false);
  if (version === 'sdk-v1.2.0') {
    const asset = release.assets.find(item => item.name === 'commerce-plugin-sdk-1.2.0.tgz');
    assert.ok(asset);
    const bytes = await readFile('vendor/' + asset.name);
    assert.equal(bytes.length, asset.size);
    assert.equal('sha256:' + createHash('sha256').update(bytes).digest('hex'), asset.digest);
  }
}
console.log('Verified immutable Qingzuo ' + hostVersion + ' host run and released SDK 1.2.0 bytes.');
