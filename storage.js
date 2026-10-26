// Onde os dados ficam salvos.
// - Arquivo local (padrão): data/db.json no computador onde o sistema roda.
// - GitHub: um arquivo num repositório PRIVADO. Usado no Render, que apaga o disco
//   sempre que o site dorme ou é atualizado. Cada salvamento vira uma versão no
//   histórico do repositório, o que também serve de backup.
const fs = require('fs');
const path = require('path');

function fileStorage(file) {
  return {
    name: `arquivo ${file}`,
    async load() {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    save(data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    },
    async flush() {},
  };
}

function githubStorage({ token, repo, file, branch }) {
  const api = `https://api.github.com/repos/${repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}`;
  const ref = branch ? `?ref=${encodeURIComponent(branch)}` : '';
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'gestao-barbosadev',
  };
  const SAVE_DELAY_MS = 3000;
  const RETRY_DELAY_MS = 15000;
  let sha = null;      // versão atual do arquivo no GitHub (exigida para sobrescrever)
  let pending = null;  // dados aguardando envio
  let timer = null;
  let writing = Promise.resolve();

  async function fetchMeta() {
    const res = await fetch(api + ref, { headers: { ...headers, Accept: 'application/vnd.github+json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao ler os dados: ${await res.text()}`);
    return res.json();
  }

  async function load() {
    const meta = await fetchMeta();
    if (!meta) return null;
    sha = meta.sha;
    // Arquivos acima de 1 MB não vêm no JSON; nesse caso baixa o conteúdo bruto.
    if (meta.content && meta.encoding === 'base64') {
      return JSON.parse(Buffer.from(meta.content, 'base64').toString('utf8'));
    }
    const res = await fetch(api + ref, { headers: { ...headers, Accept: 'application/vnd.github.raw+json' } });
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao baixar os dados.`);
    return JSON.parse(await res.text());
  }

  async function put(data, retry = true) {
    const body = {
      message: `Dados: atualização automática (${new Date().toISOString()})`,
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
      ...(sha && { sha }),
      ...(branch && { branch }),
    };
    const res = await fetch(api, {
      method: 'PUT',
      headers: { ...headers, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Versão desatualizada (ex.: arquivo editado direto no GitHub): pega a atual e tenta de novo.
    if ((res.status === 409 || res.status === 422) && retry) {
      sha = (await fetchMeta())?.sha ?? null;
      return put(data, false);
    }
    if (!res.ok) throw new Error(`GitHub respondeu ${res.status} ao salvar: ${await res.text()}`);
    sha = (await res.json()).content.sha;
  }

  // Envios em sequência, nunca dois ao mesmo tempo.
  function flush() {
    clearTimeout(timer);
    writing = writing.then(async () => {
      if (!pending) return;
      const data = pending;
      pending = null;
      try {
        await put(data);
      } catch (err) {
        console.error('Falha ao salvar no GitHub, nova tentativa em instantes:', err.message);
        if (!pending) pending = data;
        timer = setTimeout(flush, RETRY_DELAY_MS);
      }
    });
    return writing;
  }

  return {
    name: `GitHub ${repo}/${file}`,
    load,
    // Junta várias alterações seguidas em um único envio.
    save(data) {
      pending = data;
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY_MS);
    },
    flush,
  };
}

function createStorage(defaultFile) {
  const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_FILE, GITHUB_BRANCH } = process.env;
  if (GITHUB_TOKEN || GITHUB_REPO) {
    if (!GITHUB_TOKEN || !GITHUB_REPO) throw new Error('Defina GITHUB_TOKEN e GITHUB_REPO (ex.: usuario/barbosadev-dados).');
    return githubStorage({ token: GITHUB_TOKEN, repo: GITHUB_REPO, file: GITHUB_FILE || 'db.json', branch: GITHUB_BRANCH });
  }
  return fileStorage(defaultFile);
}

module.exports = { createStorage };
