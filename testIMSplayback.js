/**
 * testIMS3000playbacktime.js
 *
 * Goal:
 *  - Print time until/since the FIRST SHR or FTR element in the current SPL
 *  - Print time until/since the first automation containing "rail"
 *    that is embedded within the LAST SHR/FTR element
 *
 * This version is resilient to IMS3000 returning "pattern-only" HTML:
 *  - primes editor context via GET editor.php
 *  - forces interfaceSize=auto cookie (as seen in your curl)
 *  - tries multiple ajax URLs / referers / payloads and chooses the best response
 *  - parses CPL rows globally (not only within eventDiv)
 *
 * Usage:
 *   node testIMS3000playbacktime.js --verbose --dump
 *   node testIMS3000playbacktime.js --uuid urn:uuid:...   (force SPL)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');

const DolbySessionManager = require('./services/dolbySessionManager');
const config = require('./config');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (!v || v.startsWith('--')) ? def : v;
}

const THEATER_NAME = argVal('--theater', 'Salle 1');
const FORCE_UUID = argVal('--uuid', null);
const VERBOSE = process.argv.includes('--verbose');
const DUMP = process.argv.includes('--dump');

const logger = {
  info: m => console.log(`[INFO]  ${m}`),
  warn: m => console.warn(`[WARN]  ${m}`),
  error: m => console.error(`[ERROR] ${m}`),
  debug: m => { if (VERBOSE) console.log(`[DEBUG] ${m}`); },
  truncate: (s, n) => String(s).length > n ? `${String(s).slice(0, n)}…` : String(s),
};

function parseSec(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw).trim();
  const hms = s.match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +hms[3];
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length === 6) return +digits.slice(0, 2) * 3600 + +digits.slice(2, 4) * 60 + +digits.slice(4, 6);
  if (digits.length > 0) return +digits;
  return null;
}

function fmtHMS(totalSec) {
  if (totalSec == null || !Number.isFinite(totalSec)) return 'N/A';
  const sign = totalSec < 0 ? '-' : '';
  const s = Math.abs(Math.round(totalSec));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}:${ss}`;
}

function playbackPagePath(type) {
  return type === 'IMS3000'
    ? '/web/index.php?page=sys_control/cinelister/playback.php'
    : '/web/sys_control/cinelister/playback.php';
}

async function extractSoapSessionId(session, type) {
  const resp = await session.request('GET', playbackPagePath(type), null, {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  });
  const html = typeof resp.data === 'string' ? resp.data : '';
  const match = html.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (!match) throw new Error('SOAP session UUID not found in playback page HTML');
  logger.debug(`SOAP session UUID: ${match[1]}`);
  return match[1];
}

async function getShowStatus(session, theaterConfig) {
  const type = (theaterConfig.type || '').toUpperCase();
  const soapId = await extractSoapSessionId(session, type);

  const soapBody =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://www.doremilabs.com/dc/dcp/json/v1_0">` +
    `<soapenv:Header/><soapenv:Body><v1:GetShowStatus><sessionId>${soapId}</sessionId></v1:GetShowStatus></soapenv:Body></soapenv:Envelope>`;

  const resp = await session.request('POST', '/dc/dcp/json/v1/ShowControl', soapBody, {
    'Content-Type': 'text/xml',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': theaterConfig.url,
    'Referer': `${theaterConfig.url}${playbackPagePath(type)}`,
  });

  if (resp.status === 200 && resp.data?.GetShowStatusResponse?.showStatus) return resp.data.GetShowStatusResponse.showStatus;
  if (resp.data?.Fault) throw new Error(`SOAP Fault: ${resp.data.Fault.faultstring}`);
  throw new Error(`Unexpected SOAP response (HTTP ${resp.status})`);
}

async function primeEditorContext(session, theaterConfig) {
  // Some IMS3000 builds behave differently unless editor.php has been visited in-session.
  const urls = [
    '/web/index.php?page=sys_control/cinelister/editor.php',
    '/web/sys_control/cinelister/editor.php',
  ];
  for (const u of urls) {
    try {
      const r = await session.request('GET', u, null, {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: `${theaterConfig.url}/web/index.php`,
      });
      logger.debug(`Primed editor context: GET ${u} → HTTP ${r.status}`);
    } catch (e) {
      logger.debug(`Prime GET ${u} failed: ${e.message}`);
    }
  }
}

async function listSplOptions(session, theaterConfig) {
  const resp = await session.request('GET', '/web/sys_control/cinelister/popups/open_spl.php', null, {
    Accept: 'text/html, */*; q=0.01',
    Referer: `${theaterConfig.url}/web/sys_control/cinelister/editor.php`,
  });
  const html = typeof resp.data === 'string' ? resp.data : '';
  const $ = cheerio.load(html);
  const opts = [];
  $('#openSPLSelect option').each((_, el) => {
    const title = $(el).text().trim();
    const uuid = ($(el).val() || '').trim();
    if (title && uuid) opts.push({ title, uuid });
  });
  return opts;
}

async function findSplUuidByTitle(session, theaterConfig, targetTitle) {
  const opts = await listSplOptions(session, theaterConfig);
  const low = targetTitle.toLowerCase();
  const exact = opts.find(o => o.title.toLowerCase() === low);
  if (exact) return exact.uuid;
  const partial = opts.find(o => o.title.toLowerCase().includes(low));
  if (partial) return partial.uuid;
  return null;
}

async function postAjax(session, urlPath, payload, headers) {
  const r = await session.request('POST', urlPath, payload, headers);
  const html = typeof r.data === 'string' ? r.data : (r.data ? JSON.stringify(r.data) : '');
  return { status: r.status, html };
}

function scoreEditorHtml(html) {
  if (!html) return 0;
  const lenScore = Math.min(50, Math.floor(html.length / 1000));
  const cplnameCount = (html.match(/name\s*=\s*["']cplname["']/gi) || []).length;
  const cplClassCount = (html.match(/\belement\b[^"]*\bcpl\b/gi) || []).length;
  const eventDivCount = (html.match(/\beventDiv\b/gi) || []).length;
  return lenScore + cplnameCount * 10 + cplClassCount * 5 + eventDivCount;
}

async function openSplAndGetProps(session, theaterConfig, uuid, ajaxPath) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Referer': `${theaterConfig.url}/web/index.php?page=sys_control/cinelister/editor.php`,
    'Origin': theaterConfig.url,
  };

  await postAjax(session, ajaxPath, `request=OPEN_SPL&uuid=${encodeURIComponent(uuid)}&type=SPL`, headers);

  const props = await postAjax(session, ajaxPath, 'request=GET_SPL_PROPERTIES', headers);

  // try parse JSON body if server responded with JSON as string
  if (props.html && props.html.trim().startsWith('{')) {
    try { return JSON.parse(props.html); } catch (_) {}
  }
  // sometimes axios already parsed JSON; in that case props.html is JSON-stringified above
  try { return JSON.parse(props.html); } catch (_) { return null; }
}

async function loadBestSplEditorHtml(session, theaterConfig) {
  const ajaxPaths = [
    '/web/sys_control/cinelister/ajax.php',
    '/web/index.php?page=sys_control/cinelister/ajax.php', // fallback (some IMS3000 builds route through index.php)
  ];

  const referers = [
    `${theaterConfig.url}/web/index.php?page=sys_control/cinelister/editor.php`,
    `${theaterConfig.url}/web/sys_control/cinelister/editor.php`,
  ];

  const payloads = [
    'request=LOAD_SPL_ITEMS&style=editor',
    'request=LOAD_SPL_ITEMS&style=editor&full=1',
    'request=LOAD_SPL_ITEMS&style=editor&showAll=1',
    'request=LOAD_SPL_ITEMS', // last resort
  ];

  let best = { score: -1, html: '', meta: null };

  for (const ajaxPath of ajaxPaths) {
    for (const ref of referers) {
      for (const payload of payloads) {
        const headers = {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Referer': ref,
          'Origin': theaterConfig.url,
        };
        const { status, html } = await postAjax(session, ajaxPath, payload, headers);
        const score = scoreEditorHtml(html);
        logger.debug(`Tried ${ajaxPath} | ${payload} | ref=${ref.includes('index.php?page=') ? 'index' : 'direct'} → HTTP ${status}, len=${html.length}, score=${score}`);
        if (score > best.score) best = { score, html, meta: { ajaxPath, payload, ref, status, len: html.length } };
      }
    }
  }

  if (best.meta) logger.info(`Selected HTML: ${best.meta.ajaxPath} | ${best.meta.payload} | HTTP ${best.meta.status} | len=${best.meta.len} | score=${best.score}`);
  return best.html;
}

function rowClasses($el) {
  return ($el.attr('class') || '').split(/\s+/).filter(Boolean);
}

function bestText($el, selector) {
  const x = $el.find(selector).first();
  if (!x.length) return '';
  return String(x.attr('title') || x.text() || '').trim();
}

function parseAllCplRowsAndAutomations(html) {
  const $ = cheerio.load(html, { decodeEntities: true });

  const items = [];
  $('div.row.m-0.element').each((_, el) => {
    const $row = $(el);
    const classes = rowClasses($row);
    const low = classes.map(c => c.toLowerCase());
    if (low.includes('automation')) return;

    const hasTime = $row.find('span.editor-time, span[class*="editor-time"]').length > 0;
    const hasTitle = $row.find('span.editor-title, span[class*="editor-title"]').length > 0;
    if (!hasTime || !hasTitle) return;

    const id = String($row.attr('id') || '').trim();
    const timeText = bestText($row, 'span.editor-time, span[class*="editor-time"]');
    const title = bestText($row, 'span.editor-title, span[class*="editor-title"]');
    const tSec = parseSec(timeText);

    const cplname = String($row.find('input[name="cplname"]').val() || '').trim();
    const durationRaw = $row.find('input[name="duration"]').val();
    const duration = durationRaw != null && String(durationRaw).trim() !== '' ? +durationRaw : null;
    const cplUuid = String($row.find('input[name="cpl"]').val() || '').trim();

    const looksLikeItem =
      Number.isFinite(tSec) ||
      Number.isFinite(duration) ||
      !!cplname ||
      !!cplUuid ||
      low.some(c => ['feature','short','trailer','teaser','psa','advertisement','policy','pattern','pack'].includes(c));

    if (!looksLikeItem) return;

    items.push({ id, classes, timeText, tSec, title, cplname, duration, cplUuid, automations: [] });
  });

  const addOnByName = new Map();
  $('div.addOnDiv').each((_, el) => {
    const name = String($(el).attr('name') || '').trim();
    if (name) addOnByName.set(name, $(el));
  });

  for (const it of items) {
    const keys = [];
    if (it.id) keys.push(it.id);
    if (it.cplUuid) keys.push(it.cplUuid);

    const autos = [];
    for (const key of keys) {
      const $add = addOnByName.get(key);
      if (!$add) continue;

      $add.find('div.row.m-0.element.automation').each((_, aEl) => {
        const $a = $(aEl);
        const aId = String($a.attr('id') || '').trim();
        const aTimeText = bestText($a, 'span.editor-time, span[class*="editor-time"]');
        const aTitle = bestText($a, 'span.editor-title, span[class*="editor-title"]');
        const aTSec = parseSec(aTimeText);
        const kind = aId ? String($add.find(`input#kind${aId}`).val() || '').trim() : '';
        const offset = aId ? String($add.find(`input#offset${aId}`).val() || '').trim() : '';

        if (aTitle && !autos.some(x => x.id === aId && aId)) autos.push({ id: aId, timeText: aTimeText, tSec: aTSec, title: aTitle, kind, offset });
      });
    }

    it.automations = autos;
  }

  items.sort((a, b) => {
    if (a.tSec == null && b.tSec == null) return 0;
    if (a.tSec == null) return 1;
    if (b.tSec == null) return -1;
    return a.tSec - b.tSec;
  });

  return items;
}

const SHR_FTR_RE = /(?:^|[^A-Za-z0-9])(SHR|FTR)(?:[^A-Za-z0-9]|$)/i;

function isShrFtrLike(item) {
  const hay = `${item.cplname || ''} ${item.title || ''}`.trim();
  const low = item.classes.map(c => c.toLowerCase());
  return SHR_FTR_RE.test(hay) || low.includes('feature') || low.includes('short');
}

function printDelta(label, targetSec, nowSec) {
  if (targetSec == null || nowSec == null) {
    console.log(`  ${label}: N/A`);
    return;
  }
  const d = targetSec - nowSec;
  if (d > 0) console.log(`  ${label}: ${fmtHMS(d)} (${Math.round(d)}s) until`);
  else console.log(`  ${label}: ${fmtHMS(-d)} (${Math.round(-d)}s) elapsed`);
}

async function main() {
  const theaterConfig = config.THEATERS[THEATER_NAME];
  if (!theaterConfig) {
    logger.error(`Theater "${THEATER_NAME}" not found. Available: ${Object.keys(config.THEATERS).join(', ')}`);
    process.exitCode = 2;
    return;
  }

  const type = (theaterConfig.type || '').toUpperCase();
  logger.info(`Theater : ${THEATER_NAME}  (${type}  @  ${theaterConfig.url})`);

  const session = new DolbySessionManager(THEATER_NAME, theaterConfig, logger);

  try {
    logger.info('Authenticating…');
    const ok = await session.ensureLoggedIn();
    if (!ok) throw new Error('Authentication failed');
    logger.info(`Authenticated  type=${session.detectedType}  PHPSESSID=${logger.truncate(session.sessionId || '', 8)}…`);

    // mimic your curl cookie that often appears with editor calls
    if (!session.cookies.interfaceSize) {
      session.cookies.interfaceSize = 'auto';
      logger.debug('Set cookie interfaceSize=auto');
    }

    await primeEditorContext(session, theaterConfig);

    logger.info('Fetching show status via SOAP…');
    const showStatus = await getShowStatus(session, theaterConfig);

    const splTitle = showStatus.splTitle || null;
    const cplTitle = showStatus.cplTitle || null;
    const nowSec = parseSec(showStatus.splPosition);
    const durSec = parseSec(showStatus.splDuration);
    const stateInfo = showStatus.stateInfo || 'Unknown';

    logger.info(`State="${stateInfo}"  SPL="${splTitle}"  pos=${nowSec}s  (${fmtHMS(nowSec)} / ${fmtHMS(durSec)})`);
    if (VERBOSE) logger.debug(`Current CPL from SOAP: ${cplTitle || '(none)'}`);

    let uuid = FORCE_UUID;
    if (!uuid) {
      if (!splTitle) throw new Error('No splTitle from SOAP and no --uuid supplied');
      logger.info(`Auto-discovering UUID for SPL title "${splTitle}"…`);
      uuid = await findSplUuidByTitle(session, theaterConfig, splTitle);
      if (!uuid) throw new Error(`Could not find UUID for "${splTitle}" in open_spl.php list`);
      logger.info(`Found UUID: ${uuid}`);
    }

    logger.info(`Opening SPL ${uuid}…`);
    const props = await openSplAndGetProps(session, theaterConfig, uuid, '/web/sys_control/cinelister/ajax.php');
    if (props?.title) logger.info(`GET_SPL_PROPERTIES: title="${props.title}", mode="${props.mode}", hfr=${props.hfr}`);

    logger.info('Loading SPL editor HTML (multi-strategy)…');
    const html = await loadBestSplEditorHtml(session, theaterConfig);
    logger.info(`Received ${html.length} chars of editor HTML`);

    if (DUMP) {
      const fn = path.join(process.cwd(), `spl_dump_${Date.now()}.html`);
      fs.writeFileSync(fn, html, 'utf8');
      logger.info(`Dumped HTML to ${fn}`);
    }

    const items = parseAllCplRowsAndAutomations(html);

    // quick sanity prints
    const cplnameCount = (html.match(/name\s*=\s*["']cplname["']/gi) || []).length;
    const eventDivCount = (html.match(/\beventDiv\b/gi) || []).length;
    logger.info(`Sanity: cplnameInputs=${cplnameCount}, eventDivs=${eventDivCount}, parsedItems=${items.length}`);

    if (VERBOSE) {
      const sample = items.slice(0, 12).map(it => `${fmtHMS(it.tSec)} ${it.classes.join(' ')} | ${it.cplname || it.title}`.slice(0, 140));
      sample.forEach(l => logger.debug(l));
    }

    const shrFtr = items.filter(it => it.tSec != null).filter(isShrFtrLike).sort((a, b) => a.tSec - b.tSec);

    // If still nothing, show why (helps you paste a small excerpt)
    if (shrFtr.length === 0) {
      console.log('\n⚠  No SHR/FTR-like element found in loaded HTML.');
      console.log(`   SOAP says current CPL: ${cplTitle || '(none)'}`);
      console.log('   This usually means LOAD_SPL_ITEMS is still returning a cue-only view (patterns only).');
      console.log('   Re-run with --dump --verbose and search the dump for: name="cplname" or class="... cpl ...".');
      process.exitCode = 1;
      return;
    }

    const first = shrFtr[0];
    const last = shrFtr[shrFtr.length - 1];

    console.log('\n========================================================');
    console.log(`Dolby ${type} @ ${theaterConfig.url} | ${THEATER_NAME}`);
    console.log(`State: ${stateInfo}`);
    console.log(`SPL  : ${splTitle}`);
    console.log(`Pos  : ${fmtHMS(nowSec)} (${nowSec}s)`);
    console.log('========================================================');

    console.log('\n▶ FIRST SHR/FTR element');
    console.log(`  Time   : ${fmtHMS(first.tSec)} (${first.tSec}s)`);
    console.log(`  Title  : ${first.title || '(n/a)'}`);
    console.log(`  CPLname: ${first.cplname || '(n/a)'}`);
    printDelta('→ vs now', first.tSec, nowSec);

    console.log('\n▶ LAST SHR/FTR element');
    console.log(`  Time   : ${fmtHMS(last.tSec)} (${last.tSec}s)`);
    console.log(`  Title  : ${last.title || '(n/a)'}`);
    console.log(`  CPLname: ${last.cplname || '(n/a)'}`);

    const railAutos = (last.automations || [])
      .filter(a => a.tSec != null && /rail/i.test(a.title || ''))
      .sort((a, b) => a.tSec - b.tSec);

    console.log('\n▶ First "rail" automation embedded in LAST SHR/FTR');
    if (railAutos.length === 0) {
      console.log('  Not found.');
      if (VERBOSE) {
        console.log('  Embedded automations:', (last.automations || []).map(a => a.title).join(' | ') || '(none)');
      }
    } else {
      const rail = railAutos[0];
      console.log(`  Time  : ${fmtHMS(rail.tSec)} (${rail.tSec}s)`);
      console.log(`  Title : ${rail.title}`);
      if (rail.kind) console.log(`  Kind  : ${rail.kind}`);
      if (rail.offset) console.log(`  Offset: ${rail.offset} frames`);
      printDelta('→ vs now', rail.tSec, nowSec);
    }

    console.log('\nDone.');
  } finally {
    await session.destroy();
    logger.info('Session destroyed');
  }
}

main().catch(e => {
  logger.error(e.message || String(e));
  process.exitCode = 1;
});
