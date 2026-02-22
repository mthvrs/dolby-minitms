#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const config = require('../config');
const { clients, resolveName } = require('../routes/theaters');

const arg = process.argv[2] || 'salle-2';
const name = resolveName(arg);
if (!name) throw new Error(`Unknown theater: ${arg}`);

const client = clients[name];
if (!client) throw new Error(`Client not initialized for ${name}. Start the server first so it connects.`);

const theaterConfig = config.THEATERS[name];

const OUT_DIR = path.join(process.cwd(), `probe_${name.replace(/\s+/g,'_')}_${Date.now()}`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const GETS = [
  '/web/sys_control/cinelister/editor.php',
  '/web/index.php?page=sys_control/cinelister/editor.php',
  '/web/sys_control/cinelister/',
  '/web/sys_control/',
  '/web/',
  '/cinelister/editor.php',
  '/cinelister/ajax.php',
];

const POSTS = [
  { url: '/web/sys_control/cinelister/ajax.php', body: 'request=LOAD_SPL_ITEMS&style=editor' },
  { url: '/web/index.php?page=sys_control/cinelister/ajax.php', body: 'request=LOAD_SPL_ITEMS&style=editor' },
  { url: '/web/sys_control/cinelister/ajax.php', body: 'request=LOAD_SPL_ITEMS' },
];

(async () => {
  // ensure session exists (should already due to keepalive)
  await client.getPlaybackStatus();

  const session = client.session;

  async function save(label, res) {
    const file = path.join(OUT_DIR, `${label}.txt`);
    fs.writeFileSync(file, res, 'utf8');
    console.log('saved', file, 'len=', res.length);
  }

  for (let i = 0; i < GETS.length; i++) {
    const p = GETS[i];
    try {
      const r = await session.request('GET', p, null, {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });
      const html = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      await save(`GET_${i}_${p.replace(/[^\w]/g,'_')}`, html);
    } catch (e) {
      await save(`GET_${i}_ERROR_${p.replace(/[^\w]/g,'_')}`, String(e.message || e));
    }
  }

  for (let i = 0; i < POSTS.length; i++) {
    const { url, body } = POSTS[i];
    try {
      const r = await session.request('POST', url, body, {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: `${theaterConfig.url}/web/sys_control/cinelister/editor.php`,
        Origin: theaterConfig.url,
      });
      const html = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      await save(`POST_${i}_${url.replace(/[^\w]/g,'_')}`, html);
    } catch (e) {
      await save(`POST_${i}_ERROR_${url.replace(/[^\w]/g,'_')}`, String(e.message || e));
    }
  }

  console.log('done. output dir:', OUT_DIR);
})().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
