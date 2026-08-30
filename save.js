// Serverless function (Vercel): saves site content edited by Dr. Smith.
// It validates the edit key, then commits content.json to the GitHub repo
// using a server-side token. The commit triggers a redeploy, so the change
// goes live for every visitor. Secrets live only in Vercel env vars:
//   EDIT_KEY      - the secret in Dr. Smith's ?edit=... link
//   GITHUB_TOKEN  - a fine-grained PAT with Contents: Read and write on the repo
//   GITHUB_REPO   - optional, defaults to "PRONO2828/smith-blog"
//   GITHUB_BRANCH - optional, defaults to "main"

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const EDIT_KEY = process.env.EDIT_KEY;
  const TOKEN = process.env.GITHUB_TOKEN;
  const REPO = process.env.GITHUB_REPO || 'PRONO2828/smith-blog';
  const BRANCH = process.env.GITHUB_BRANCH || 'main';
  const FILE = 'content.json';

  if (!EDIT_KEY || !TOKEN) {
    res.status(500).json({ error: 'Server not configured (set EDIT_KEY and GITHUB_TOKEN in Vercel).' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const key = body && body.key;
  const content = body && body.content;

  if (key !== EDIT_KEY) { res.status(401).json({ error: 'Invalid edit key.' }); return; }
  if (content == null || typeof content !== 'object' || Array.isArray(content)) {
    res.status(400).json({ error: 'Missing or invalid content.' });
    return;
  }
  // Guard against runaway payloads (base64 images live in here).
  const payload = JSON.stringify(content, null, 2);
  if (payload.length > 5 * 1024 * 1024) {
    res.status(413).json({ error: 'Content too large. Try smaller images/videos.' });
    return;
  }

  const apiUrl = 'https://api.github.com/repos/' + REPO + '/contents/' + FILE;
  const headers = {
    'Authorization': 'Bearer ' + TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'smith-blog-editor',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  try {
    // Get current file SHA (required to update an existing file).
    let sha;
    const getRes = await fetch(apiUrl + '?ref=' + BRANCH, { headers });
    if (getRes.status === 200) { const j = await getRes.json(); sha = j.sha; }

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify({
        message: 'Update site content via in-place editor',
        content: Buffer.from(payload, 'utf8').toString('base64'),
        branch: BRANCH,
        sha: sha
      })
    });

    if (!putRes.ok) {
      const detail = await putRes.text();
      res.status(502).json({ error: 'GitHub write failed (HTTP ' + putRes.status + ').', detail: detail.slice(0, 400) });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Unexpected error: ' + e.message });
  }
};
