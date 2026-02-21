/**
 * testDCP2000playbacktime.js
 *
 * Interrogates any Dolby server (DCP2000 / IMS3000) for:
 *   - Current show position via SOAP
 *   - First/Last SHR|FTR element timing from the SPL editor HTML
 *   - "Rail" automation timing inside the last SHR/FTR element
 *
 * Writes a complete AI-readable diagnostics file next to this script:
 *   testDCP2000playbacktime_debug_<timestamp>.txt
 *
 * Usage:
 *   node testDCP2000playbacktime.js [--theater "Salle 3"] [--uuid urn:uuid:...] [--verbose]
 *
 * ─── DCP2000 DOM STRUCTURE (observed) ─────────────────────────────────────────
 *
 *  <div class="eventDiv" id="{event-uuid}">                      ← outer container
 *    <div class="element {type} [cpl]" id="{element-uuid}">      ← the row
 *      <span class="ellipsis">HH:MM:SS</span>                   ← time
 *      <span class="ellipsis ellipsis300">CPL name</span>        ← title/name
 *      <input type="hidden" name="duration"  value="...">
 *      <input type="hidden" name="editRate"  value="24 1">
 *      <input type="hidden" name="cpl"       value="{cpl-uuid}">   (absent for patterns)
 *      <input type="hidden" name="cpl_name"  value="...">          (sometimes name="cplname" on other variants)
 *    </div>
 *
 *    <!-- IMPORTANT: addOnDiv[name] key differs depending on item type -->
 *    <!-- - For CPL items: name="{cpl-uuid}" -->
 *    <!-- - For patterns (no cpl): name="{element-uuid}" -->
 *    <div class="addOnDiv automDiv …" name="{cpl-uuid | element-uuid}">
 *      <div class="element automation" id="{auto-uuid}">
 *        <span>HH:MM:SS</span>
 *        <span>rail soir</span>
 *        <input type="hidden" id="kind_{auto-uuid}"   value="Start|End">
 *        <input type="hidden" id="offset_{auto-uuid}" value="1">
 *      </div>
 *    </div>
 *  </div>
 *
 *  Types: pattern | psa | advertisement | trailer | teaser | short | feature | policy
 *  SHR  → class contains "short"
 *  FTR  → class contains "feature"
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const fs      = require('node:fs');
const path    = require('node:path');
const cheerio = require('cheerio');
const DolbySessionManager = require('./services/dolbySessionManager');
const config  = require('./config');

// ── CLI ────────────────────────────────────────────────────────────────────────
function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (!v || v.startsWith('--')) ? def : v;
}
const THEATER_NAME = argVal('--theater', 'Salle 3');
const FORCE_UUID   = argVal('--uuid', null);
const VERBOSE      = process.argv.includes('--verbose');

// ── Diagnostics file (always written) ─────────────────────────────────────────
const DEBUG_FILE = path.join(__dirname, `testDCP2000playbacktime_debug_${Date.now()}.txt`);
const _dbg = fs.createWriteStream(DEBUG_FILE, { flags: 'w', encoding: 'utf8' });

function dbg(...lines) {
  for (const l of lines) {
    const s = typeof l === 'string' ? l : JSON.stringify(l, null, 2);
    _dbg.write(s + '\n');
    if (VERBOSE) process.stdout.write(s + '\n');
  }
}
function dbgSection(title) {
  const bar = '═'.repeat(70);
  dbg('', bar, `  ${title}`, bar);
}
function dbgSub(title) {
  dbg('', `── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}

// ── Console logger ─────────────────────────────────────────────────────────────
const logger = {
  info:  m => { const s = `[INFO]  ${m}`;  console.log(s);   _dbg.write(s + '\n'); },
  warn:  m => { const s = `[WARN]  ${m}`;  console.warn(s);  _dbg.write(s + '\n'); },
  error: m => { const s = `[ERROR] ${m}`;  console.error(s); _dbg.write(s + '\n'); },
  debug: m => { const s = `[DEBUG] ${m}`;  _dbg.write(s + '\n'); if (VERBOSE) console.log(s); },
  truncate: (s, n) => String(s).length > n ? `${String(s).slice(0, n)}…` : String(s),
};

// ── Time helpers ───────────────────────────────────────────────────────────────
function parseSec(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw).trim();
  // HH:MM:SS
  const hms = s.match(/^(\d{1,3}):(\d{2}):(\d{2})(?:\.\d+)?$/);
  if (hms) return (+hms[1] * 3600) + (+hms[2] * 60) + (+hms[3]);
  // pure digits or decimal seconds
  const dec = parseFloat(s);
  if (!isNaN(dec)) return Math.round(dec);
  return null;
}
function fmtHMS(s) {
  if (s == null || !Number.isFinite(s)) return 'N/A';
  const sign = s < 0 ? '-' : '';
  const abs  = Math.abs(Math.round(s));
  return `${sign}${String(Math.floor(abs / 3600)).padStart(2,'0')}:${String(Math.floor((abs % 3600) / 60)).padStart(2,'0')}:${String(abs % 60).padStart(2,'0')}`;
}
function printDelta(label, targetSec, nowSec) {
  if (targetSec == null || nowSec == null) return console.log(`  ${label}: N/A`);
  const d   = targetSec - nowSec;
  const out = d > 0
    ? `  ${label}: ${fmtHMS(d)} (${Math.round(d)}s) until`
    : `  ${label}: ${fmtHMS(-d)} (${Math.round(-d)}s) elapsed since`;
  console.log(out);
  _dbg.write(out + '\n');
}

// ── Path helpers ───────────────────────────────────────────────────────────────
function playbackPagePath(type) {
  return type === 'IMS3000'
    ? '/web/index.php?page=sys_control/cinelister/playback.php'
    : '/web/sys_control/cinelister/playback.php';
}
function editorPagePath(type) {
  return type === 'IMS3000'
    ? '/web/index.php?page=sys_control/cinelister/editor.php'
    : '/web/sys_control/cinelister/editor.php';
}

// ── SOAP ───────────────────────────────────────────────────────────────────────
async function extractSoapSessionId(session, type) {
  const resp  = await session.request('GET', playbackPagePath(type), null, {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  });
  const html  = typeof resp.data === 'string' ? resp.data : '';
  const match = html.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (!match) throw new Error('SOAP session UUID not found in playback page HTML');
  logger.debug(`SOAP session UUID: ${match[1]}`);
  return match[1];
}

async function getShowStatus(session, theaterConfig) {
  const type   = (theaterConfig.type || '').toUpperCase();
  const soapId = await extractSoapSessionId(session, type);

  const body =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://www.doremilabs.com/dc/dcp/json/v1_0">` +
    `<soapenv:Header/><soapenv:Body><v1:GetShowStatus><sessionId>${soapId}</sessionId></v1:GetShowStatus></soapenv:Body></soapenv:Envelope>`;

  const resp = await session.request('POST', '/dc/dcp/json/v1/ShowControl', body, {
    'Content-Type':     'text/xml',
    'Accept':           '*/*',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin':           theaterConfig.url,
    'Referer':          `${theaterConfig.url}${playbackPagePath(type)}`,
  });

  if (resp.status === 200 && resp.data?.GetShowStatusResponse?.showStatus)
    return resp.data.GetShowStatusResponse.showStatus;
  if (resp.data?.Fault)
    throw new Error(`SOAP Fault: ${resp.data.Fault.faultstring}`);
  throw new Error(`Unexpected SOAP response (HTTP ${resp.status})`);
}

// ── Editor priming ─────────────────────────────────────────────────────────────
async function primeEditorContext(session, theaterConfig) {
  const type = (theaterConfig.type || '').toUpperCase();
  for (const u of [
    editorPagePath(type),
    '/web/sys_control/cinelister/editor.php',
    '/web/index.php?page=sys_control/cinelister/editor.php',
  ]) {
    try {
      const r = await session.request('GET', u, null, {
        Accept:  'text/html,*/*;q=0.8',
        Referer: `${theaterConfig.url}/web/index.php`,
      });
      logger.debug(`Primed: GET ${u} → HTTP ${r.status}`);
      if (r.status === 200) break;
    } catch (e) {
      logger.debug(`Prime ${u} failed: ${e.message}`);
    }
  }
}

// ── SPL UUID discovery ─────────────────────────────────────────────────────────
async function findSplUuidByTitle(session, theaterConfig, targetTitle) {
  const resp = await session.request('GET', '/web/sys_control/cinelister/popups/open_spl.php', null, {
    Accept:  'text/html, */*; q=0.01',
    Referer: `${theaterConfig.url}/web/sys_control/cinelister/editor.php`,
  });
  const html = typeof resp.data === 'string' ? resp.data : '';
  const $    = cheerio.load(html);

  let uuid = null;
  const low = targetTitle.toLowerCase();

  $('#openSPLSelect option').each((_, el) => {
    if (uuid) return;
    const label = $(el).text().trim();
    const val   = ($(el).val() || '').trim();
    if (label.toLowerCase() === low || label.toLowerCase().includes(low)) uuid = val;
  });

  return uuid;
}

// ── Ajax helpers ───────────────────────────────────────────────────────────────
async function postAjax(session, urlPath, payload, headers) {
  const r    = await session.request('POST', urlPath, payload, headers);
  const html = typeof r.data === 'string' ? r.data : (r.data ? JSON.stringify(r.data) : '');
  return { status: r.status, html };
}

async function openSpl(session, theaterConfig, uuid) {
  const ajaxPath = '/web/sys_control/cinelister/ajax.php';
  const type     = (theaterConfig.type || '').toUpperCase();
  const headers  = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Referer':      `${theaterConfig.url}${editorPagePath(type)}`,
    'Origin':       theaterConfig.url,
  };

  await postAjax(session, ajaxPath, `request=OPEN_SPL&uuid=${encodeURIComponent(uuid)}&type=SPL`, headers);
  const props = await postAjax(session, ajaxPath, 'request=GET_SPL_PROPERTIES', headers);

  try { return JSON.parse(props.html); } catch (_) { return null; }
}

// ── HTML loading ───────────────────────────────────────────────────────────────
async function loadSplEditorHtml(session, theaterConfig) {
  const type     = (theaterConfig.type || '').toUpperCase();
  const ajaxPath = '/web/sys_control/cinelister/ajax.php';
  const headers  = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Referer':      `${theaterConfig.url}${editorPagePath(type)}`,
    'Origin':       theaterConfig.url,
  };
  const { status, html } = await postAjax(session, ajaxPath, 'request=LOAD_SPL_ITEMS&style=editor', headers);
  logger.info(`LOAD_SPL_ITEMS → HTTP ${status}, len=${html.length}`);
  return html;
}

// ══════════════════════════════════════════════════════════════════════════════
// Diagnostics (kept: useful to re-verify DOM on other servers)
// ══════════════════════════════════════════════════════════════════════════════
function runHtmlDiagnostics(html, showStatus) {
  const $ = cheerio.load(html, { decodeEntities: true });

  dbgSection('1 · RAW HTML METRICS');
  dbg(`Total length   : ${html.length} chars`);
  dbg(`<div> count    : ${(html.match(/<div/gi)  || []).length}`);
  dbg(`<tr>  count    : ${(html.match(/<tr/gi)   || []).length}`);
  dbg(`<span> count   : ${(html.match(/<span/gi) || []).length}`);
  dbg(`<input> count  : ${(html.match(/<input/gi)|| []).length}`);

  dbgSub('Keyword occurrences in raw HTML');
  for (const kw of ['eventDiv','element','cpl','automation','addOnDiv',
    'editor-time','editor-title','cplname','cpl_name','FTR','SHR','rail',
    'short','feature','row m-0','Black','ellipsis300']) {
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    dbg(`  "${kw}" → ${(html.match(re) || []).length}`);
  }

  dbgSection('2 · ALL UNIQUE TAG+CLASS COMBOS (top 80 by frequency)');
  const comboMap = new Map();
  $('*').each((_, el) => {
    const key = `<${el.tagName}> class="${($(el).attr('class') || '').trim().replace(/\s+/g,' ')}"`;
    comboMap.set(key, (comboMap.get(key) || 0) + 1);
  });
  [...comboMap.entries()].sort((a,b) => b[1]-a[1]).slice(0,80)
    .forEach(([k,n]) => dbg(`  ${String(n).padStart(4)}×  ${k}`));

  dbgSection('3 · ALL eventDiv ELEMENTS — outer HTML (first 600 chars each)');
  $('div.eventDiv').each((i, el) => {
    const $el = $(el);
    dbg(`\n  [${i}] eventDiv id="${$el.attr('id') || ''}" children=${$el.children().length}`);
    dbg(`       outerHTML(600): ${$.html($el).slice(0,600).replace(/\n/g,'↵')}`);
  });

  dbgSection('4 · ALL div.element CHILDREN (all, with classes and text)');
  $('div.element').each((i, el) => {
    const $el = $(el);
    dbg(`  [${i}] id="${$el.attr('id')||''}" class="${$el.attr('class')||''}" | text="${$el.text().trim().slice(0,120).replace(/\n/g,' ')}"`);
  });

  dbgSection('5 · ALL addOnDiv ELEMENTS (with child count and name attr)');
  $('[class*="addOnDiv"]').each((i, el) => {
    const $el = $(el);
    dbg(`  [${i}] name="${$el.attr('name')||''}" children=${$el.children().length}`);
    if ($el.children().length > 0)
      dbg(`       first child HTML(400): ${$.html($el.children().first()).slice(0,400).replace(/\n/g,'↵')}`);
  });

  dbgSection('6 · AUTOMATION ELEMENTS — full structure');
  $('div.element.automation').each((i, el) => {
    const $el = $(el);
    dbg(`  [${i}] id="${$el.attr('id')||''}" | outerHTML(500): ${$.html($el).slice(0,500).replace(/\n/g,'↵')}`);
  });

  dbgSection('7 · ALL <input> ELEMENTS');
  $('input').each((i, el) => {
    const $el = $(el);
    dbg(`  [${i}] name="${$el.attr('name')||''}" id="${$el.attr('id')||''}" type="${$el.attr('type')||''}" value="${String($el.val()||'').slice(0,80)}"`);
  });

  dbgSection('8 · ALL data-* ATTRIBUTES');
  const dataAttrs = new Set();
  $('*').each((_, el) => { if (el.attribs) for (const a of Object.keys(el.attribs)) if (a.startsWith('data-')) dataAttrs.add(a); });
  if (!dataAttrs.size) dbg('  (none)');
  else [...dataAttrs].sort().forEach(a => dbg(`  ${a}`));

  dbgSection('9 · SOAP showStatus (full)');
  dbg(JSON.stringify(showStatus, null, 2));

  dbgSection('10 · SOAP FALLBACK TIMING CALCULATION');
  const nowSec = parseSec(showStatus.splPosition);
  const elPos  = parseSec(showStatus.elementPosition);
  const elDur  = parseSec(showStatus.elementDuration);
  const ftrStart = (nowSec != null && elPos != null) ? nowSec - elPos : null;
  dbg(`  splPosition     : ${showStatus.splPosition}s  (${fmtHMS(nowSec)})`);
  dbg(`  elementPosition : ${showStatus.elementPosition}s  (${fmtHMS(elPos)})`);
  dbg(`  elementDuration : ${showStatus.elementDuration}s  (${fmtHMS(elDur)})`);
  dbg(`  → FTR start in SPL = nowSec - elementPosition = ${ftrStart}s  (${fmtHMS(ftrStart)})`);
  dbg(`  → FTR end   in SPL = FTR start + elementDuration = ${ftrStart != null && elDur != null ? ftrStart + elDur : 'N/A'}s`);

  dbgSection('11 · RAW HTML — FIRST 3000 CHARS');
  dbg(html.slice(0, 3000));
  dbgSection('12 · RAW HTML — LAST 1500 CHARS');
  dbg(html.slice(-1500));
  dbgSection('END OF DIAGNOSTICS');
}

// ══════════════════════════════════════════════════════════════════════════════
// Parser (DCP2000 + IMS3000 tolerant)
// ══════════════════════════════════════════════════════════════════════════════

function extractTime($el, $) {
  // IMS3000 style
  const $edTime = $el.find('[class*="editor-time"]').first();
  if ($edTime.length) return ($edTime.attr('title') || $edTime.text() || '').trim();

  // DCP2000 style: first <span> that is not the title span (ellipsis300)
  const $timeSpan = $el.find('span').filter((_, s) => {
    const cls = ($(s).attr('class') || '');
    return !cls.includes('ellipsis300');
  }).first();

  return ($timeSpan.attr('title') || $timeSpan.text() || '').trim();
}

function extractTitle($el, $) {
  // IMS3000 style
  const $edTitle = $el.find('[class*="editor-title"]').first();
  if ($edTitle.length) return ($edTitle.attr('title') || $edTitle.text() || '').trim();

  // DCP2000 style: span.ellipsis300
  const $titleSpan = $el.find('span.ellipsis300, span[class*="ellipsis300"]').first();
  if ($titleSpan.length) return ($titleSpan.attr('title') || $titleSpan.text() || '').trim();

  // DCP2000 automation rows: second span (no class)
  const spans = $el.find('span');
  if (spans.length >= 2) return ($(spans[1]).attr('title') || $(spans[1]).text() || '').trim();

  return '';
}

const SHR_FTR_CPL_RE = /(?:^|[^A-Za-z0-9])(FTR|SHR)(?:[^A-Za-z0-9]|$)/i;
function isShrFtrElement(classes, cplName) {
  return classes.includes('short') ||
         classes.includes('feature') ||
         SHR_FTR_CPL_RE.test(cplName);
}

function parseSplItems(html) {
  const $ = cheerio.load(html, { decodeEntities: true });
  const items = [];

  // Map addOnDiv[name] -> element
  const addOnByKey = new Map();
  $('div[class*="addOnDiv"]').each((_, el) => {
    const name = String($(el).attr('name') || '').trim();
    if (name) addOnByKey.set(name, $(el));
  });

  $('div.eventDiv').each((_, evDiv) => {
    const eventDivId = String($(evDiv).attr('id') || '').trim();

    // The main row is the first child div.element (excluding automation)
    const $el = $(evDiv).children('div.element').not('.automation').first();
    if (!$el.length) return;

    const elementId = String($el.attr('id') || '').trim();
    const classes   = ($el.attr('class') || '').split(/\s+/).filter(Boolean);

    const timeText  = extractTime($el, $);
    const tSec      = parseSec(timeText);
    const title     = extractTitle($el, $);

    const cplName = String(
      $el.find('input[name="cpl_name"]').val() ||
      $el.find('input[name="cplname"]').val()  ||
      $el.find('input[name="cplname"]').val()  || ''
    ).trim();

    const cplUuid  = String($el.find('input[name="cpl"]').val() || '').trim();

    const durRaw   = $el.find('input[name="duration"]').val();
    const duration = (durRaw != null && durRaw !== '') ? parseFloat(durRaw) : null;

    // KEY FIX:
    // - CPL items: addOnDiv[name] == cplUuid
    // - Patterns:  addOnDiv[name] == elementId
    const lookupKey = cplUuid || elementId;

    const automations = [];
    const $addOn = addOnByKey.get(lookupKey);
    if ($addOn) {
      $addOn.find('div.element.automation').each((_, aEl) => {
        const $a     = $(aEl);
        const aId    = String($a.attr('id') || '').trim();
        const aTxt   = extractTime($a, $);
        const aName  = extractTitle($a, $);
        const aTSec  = parseSec(aTxt);

        // These inputs are inside the automation element
        const kind   = String($a.find(`input[id="kind_${aId}"], input[id^="kind_"]`).first().val() || '').trim();
        const offset = String($a.find(`input[id="offset_${aId}"], input[id^="offset_"]`).first().val() || '').trim();

        automations.push({ id: aId, tSec: aTSec, timeText: aTxt, title: aName, kind, offset });
      });
    }

    items.push({
      eventDivId,
      elementId,
      classes,
      timeText,
      tSec,
      title: title || cplName,
      cplName,
      cplUuid,
      duration,
      automations,
    });
  });

  items.sort((a, b) => (a.tSec ?? 1e15) - (b.tSec ?? 1e15));
  return items;
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  const theaterConfig = config.THEATERS[THEATER_NAME];
  if (!theaterConfig)
    throw new Error(`Unknown theater "${THEATER_NAME}". Available: ${Object.keys(config.THEATERS).join(', ')}`);

  const type = (theaterConfig.type || '').toUpperCase();

  dbgSection('RUN METADATA');
  dbg(`Date/Time   : ${new Date().toISOString()}`);
  dbg(`Theater     : ${THEATER_NAME}`);
  dbg(`Type        : ${type}`);
  dbg(`URL         : ${theaterConfig.url}`);
  dbg(`FORCE_UUID  : ${FORCE_UUID || '(none)'}`);
  dbg(`Node        : ${process.version}`);
  dbg(`Script      : ${__filename}`);
  dbg(`Debug file  : ${DEBUG_FILE}`);

  logger.info(`Theater : ${THEATER_NAME}  (${type}  @  ${theaterConfig.url})`);
  logger.info(`Diagnostics → ${path.basename(DEBUG_FILE)}`);

  const session = new DolbySessionManager(THEATER_NAME, theaterConfig, logger);

  try {
    logger.info('Authenticating…');
    if (!await session.ensureLoggedIn()) throw new Error('Authentication failed');
    logger.info(`Authenticated  type=${session.detectedType}  PHPSESSID=${logger.truncate(session.sessionId || '', 8)}…`);

    await primeEditorContext(session, theaterConfig);

    logger.info('Fetching show status via SOAP…');
    const showStatus = await getShowStatus(session, theaterConfig);
    logger.debug(`Full showStatus:\n${JSON.stringify(showStatus, null, 2)}`);

    const splTitle      = showStatus.splTitle   || null;
    const cplTitle      = showStatus.cplTitle   || null;
    const nowSec        = parseSec(showStatus.splPosition);
    const durSec        = parseSec(showStatus.splDuration);
    const state         = showStatus.stateInfo  || 'Unknown';
    const soapEventId   = showStatus.eventId    || null;
    const soapElementId = showStatus.elementId  || null;

    logger.info(`State="${state}"  SPL="${splTitle}"  pos=${fmtHMS(nowSec)} (${nowSec}s / ${durSec}s)`);
    logger.debug(`SOAP eventId="${soapEventId}"  elementId="${soapElementId}"  CPL="${cplTitle}"`);

    // ── UUID discovery ───────────────────────────────────────────────────────
    let uuid = FORCE_UUID;
    if (!uuid) {
      if (!splTitle) throw new Error('No splTitle from SOAP and no --uuid supplied');
      logger.info(`Discovering UUID for "${splTitle}"…`);
      uuid = await findSplUuidByTitle(session, theaterConfig, splTitle);
      if (!uuid) throw new Error(`UUID not found for "${splTitle}"`);
      logger.info(`Found UUID: ${uuid}`);
    }

    const props = await openSpl(session, theaterConfig, uuid);
    if (props?.title) logger.info(`SPL properties: title="${props.title}", mode="${props.mode}", hfr=${props.hfr}`);

    // ── Load editor HTML ─────────────────────────────────────────────────────
    logger.info('Loading SPL editor HTML…');
    const html = await loadSplEditorHtml(session, theaterConfig);
    logger.info(`Received ${html.length} chars`);

    // Save raw HTML dump for inspection
    const htmlDump = path.join(__dirname, `dcp2000_spl_dump_${Date.now()}.html`);
    fs.writeFileSync(htmlDump, html, 'utf8');
    logger.info(`Raw HTML → ${path.basename(htmlDump)}`);

    // Diagnostics
    runHtmlDiagnostics(html, showStatus);

    // Parse
    const items = parseSplItems(html);

    dbgSection('PARSED ITEMS (all eventDivs)');
    items.forEach((it, i) => {
      dbg(`  [${String(i).padStart(2)}] t=${fmtHMS(it.tSec)}  classes="${it.classes.join(' ')}"  cplName="${(it.cplName || '').slice(0,80)}"  dur=${it.duration}  automations=${it.automations.length}`);
      it.automations.forEach(a => dbg(`         AUTO: t=${fmtHMS(a.tSec)}  "${a.title}"  kind="${a.kind}"  offset="${a.offset}"`));
    });

    logger.info(`Parsed ${items.length} eventDiv items`);
    if (VERBOSE) {
      items.forEach(it => {
        const kind = it.classes.filter(c => !['element','cpl'].includes(c)).join(' ');
        logger.debug(`  ${fmtHMS(it.tSec)}  ${kind.padEnd(24)} | ${((it.cplName || it.title) || '').slice(0,80)}`);
      });
    }

    // ── SHR/FTR selection ────────────────────────────────────────────────────
    let shrFtrItems = items.filter(it => it.tSec != null && isShrFtrElement(it.classes, it.cplName));

    dbgSection('SHR/FTR CANDIDATES');
    if (!shrFtrItems.length) dbg('  (none from HTML parser)');
    else shrFtrItems.forEach((it, i) =>
      dbg(`  [${i}] t=${fmtHMS(it.tSec)} classes="${it.classes.join(' ')}" "${(it.cplName || '').slice(0,80)}"`));

    // SOAP cross-reference (optional logging)
    if (soapElementId) {
      const soapMatchedItem = items.find(it => it.elementId === soapElementId || it.eventDivId === soapEventId) || null;
      if (soapMatchedItem) logger.info(`SOAP elementId matched: "${soapMatchedItem.cplName || soapMatchedItem.title}" t=${fmtHMS(soapMatchedItem.tSec)}`);
    }

    // SOAP fallback: if HTML gave us no SHR/FTR at all
    if (!shrFtrItems.length) {
      const elPos = parseSec(showStatus.elementPosition);
      const elDur = parseSec(showStatus.elementDuration);
      if (nowSec != null && elPos != null && elDur != null && SHR_FTR_CPL_RE.test(cplTitle || '')) {
        const ftrStart = nowSec - elPos;
        logger.warn(`HTML parse found no SHR/FTR. Synthesising from SOAP: start=${fmtHMS(ftrStart)}, dur=${fmtHMS(elDur)}`);
        shrFtrItems = [{
          eventDivId: soapEventId || '',
          elementId:  soapElementId || '',
          classes:    ['element', 'feature', 'cpl'],
          timeText:   fmtHMS(ftrStart),
          tSec:       ftrStart,
          title:      cplTitle || '',
          cplName:    cplTitle || '',
          cplUuid:    '',
          duration:   elDur,
          automations: [],
          _synthetic: true,
        }];
      }
    }

    if (!shrFtrItems.length) {
      console.log('\n⚠  No SHR/FTR element found — even SOAP fallback failed.');
      console.log(`   SOAP CPL: ${cplTitle || '(none)'}`);
      console.log(`   Review: ${DEBUG_FILE}`);
      process.exitCode = 1;
      return;
    }

    const first = shrFtrItems[0];
    const last  = shrFtrItems[shrFtrItems.length - 1];

    // Rail automations inside the last SHR/FTR element
    const railAutos = (last.automations || [])
      .filter(a => a.tSec != null && /rail/i.test(a.title || ''))
      .sort((a, b) => a.tSec - b.tSec);

    // ── Final output ─────────────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════════════════════');
    console.log(`Dolby ${type}  @  ${theaterConfig.url}  |  ${THEATER_NAME}`);
    console.log(`SPL   : ${splTitle}`);
    console.log(`State : ${state}`);
    console.log(`Pos   : ${fmtHMS(nowSec)} (${nowSec}s of ${durSec}s)`);
    if (last._synthetic) console.log('  ⚠  Timing synthesised from SOAP (HTML had no parseable SHR/FTR rows)');
    console.log('════════════════════════════════════════════════════════');

    console.log('\n▶ FIRST SHR/FTR element');
    console.log(`  Time    : ${fmtHMS(first.tSec)} (${first.tSec}s)`);
    console.log(`  Classes : ${first.classes.join(' ')}`);
    console.log(`  CPL     : ${first.cplName || first.title}`);
    if (first.duration) console.log(`  Duration: ${fmtHMS(Math.round(first.duration))} (${first.duration}s)`);
    printDelta('→ vs now', first.tSec, nowSec);

    console.log('\n▶ LAST SHR/FTR element');
    if (last !== first) {
      console.log(`  Time    : ${fmtHMS(last.tSec)} (${last.tSec}s)`);
      console.log(`  Classes : ${last.classes.join(' ')}`);
      console.log(`  CPL     : ${last.cplName || last.title}`);
      if (last.duration) console.log(`  Duration: ${fmtHMS(Math.round(last.duration))} (${last.duration}s)`);
      if (last.duration) console.log(`  End     : ${fmtHMS(last.tSec + Math.round(last.duration))} (${last.tSec + Math.round(last.duration)}s)`);
    } else {
      console.log('  (same as FIRST)');
      if (last.duration) console.log(`  End     : ${fmtHMS(last.tSec + Math.round(last.duration))} (${last.tSec + Math.round(last.duration)}s)`);
    }
    printDelta('→ vs now', last.tSec, nowSec);

    console.log('\n▶ First "rail" automation in LAST SHR/FTR');
    if (!railAutos.length) {
      console.log('  Not found.');
      if (last.automations?.length)
        console.log(`  All automations: ${last.automations.map(a => `"${a.title}"`).join(' | ')}`);
      else
        console.log('  (no automations attached to this element)');
    } else {
      const rail = railAutos[0];
      console.log(`  Time    : ${fmtHMS(rail.tSec)} (${rail.tSec}s)`);
      console.log(`  Title   : ${rail.title}`);
      if (rail.kind)   console.log(`  Kind    : ${rail.kind}`);
      if (rail.offset) console.log(`  Offset  : ${rail.offset} frames`);
      printDelta('→ vs now', rail.tSec, nowSec);
    }

    console.log('\nDone.');
    console.log(`\n📄 Diagnostics: ${path.basename(DEBUG_FILE)}`);

  } finally {
    await session.destroy();
    _dbg.end();
    logger.info('Session destroyed');
  }
}

main().catch(e => {
  logger.error(e.message || String(e));
  _dbg.end();
  process.exitCode = 1;
});
