const fields = `<div class="credential-grid">
  <form data-provider="google" class="credential-provider"><h3>Google · Nano Banana</h3><p>使用 Google 官方图像 API。</p><label for="google-key">Google 图像 API Key</label><input id="google-key" type="password" autocomplete="off" placeholder="粘贴 Google API Key"><div class="key-actions"><button data-key="google" type="submit">保存 Google 密钥</button><button data-clear="google" type="button" class="quiet">清除</button><span id="google-status" role="status">读取配置中…</span></div></form>
  <form data-provider="openai" class="credential-provider"><h3>OpenAI · GPT Image</h3><p>使用 OpenAI 官方图像编辑 API。</p><label for="openai-key">OpenAI 图像 API Key</label><input id="openai-key" type="password" autocomplete="off" placeholder="粘贴 OpenAI API Key"><div class="key-actions"><button data-key="openai" type="submit">保存 OpenAI 密钥</button><button data-clear="openai" type="button" class="quiet">清除</button><span id="openai-status" role="status">读取配置中…</span></div></form>
</div>`;

export function setupCredentials(client, root, notify, onChanged = () => {}) {
  root.innerHTML = '<div class="credential-notice" role="status" aria-live="polite" hidden></div>' + fields;
  const configured = { google: false, openai: false }, working = new Set();
  let loaded = false;
  const report = (text, error = false) => {
    const target = root.querySelector('.credential-notice');
    target.hidden = !text; target.textContent = text; target.classList.toggle('error', error); notify(text, error);
  };
  const render = () => {
    for (const provider of ['google', 'openai']) {
      const form = root.querySelector('[data-provider="' + provider + '"]');
      const input = form.querySelector('input');
      input.disabled = !loaded || working.has(provider);
      form.querySelector('[data-key]').disabled = !loaded || working.has(provider) || !input.value.trim();
      form.querySelector('[data-clear]').disabled = working.has(provider) || !configured[provider];
      form.querySelector('[role="status"]').textContent = !loaded ? '读取配置中…' : configured[provider] ? '已配置' : '未配置';
    }
    onChanged({ ...configured });
  };
  for (const form of root.querySelectorAll('form')) {
    const provider = form.dataset.provider, input = form.querySelector('input');
    input.addEventListener('input', render);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (working.has(provider) || !input.value.trim()) return;
      working.add(provider); render();
      try { await client.credentials.set(provider + '-image', input.value.trim()); input.value = ''; configured[provider] = true; report('密钥已保存，可以返回批图。'); }
      catch (error) { report(error.message || String(error), true); }
      finally { working.delete(provider); render(); }
    });
    form.querySelector('[data-clear]').addEventListener('click', async () => {
      if (working.has(provider) || !window.confirm('确认清除 ' + (provider === 'google' ? 'Google' : 'OpenAI') + ' 图像 API Key？')) return;
      working.add(provider); render();
      try { await client.credentials.clear(provider + '-image'); input.value = ''; configured[provider] = false; report('密钥已清除。'); }
      catch (error) { report(error.message || String(error), true); }
      finally { working.delete(provider); render(); }
    });
  }
  render();
  return { async refresh() {
    const [google, openai] = await Promise.all([client.credentials.status('google-image'), client.credentials.status('openai-image')]);
    configured.google = google; configured.openai = openai; loaded = true; render();
  }, clearInputs() { for (const input of root.querySelectorAll('input')) input.value = ''; render(); } };
}
