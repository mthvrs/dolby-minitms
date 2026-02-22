// services/splPlaylistService.js
'use strict';
const cheerio = require('cheerio');

// { [theaterName]: { splTitle, items, fetchedAt } }
const playlistCache = {};
const CACHE_TTL_MS   = 60 * 60 * 1000;  // safety TTL; primary key is splTitle
const PRESHOW_WINDOW = 15 * 60;          // 900 seconds = 15 minutes

// ─── Helpers (verbatim from testIMSplayback.js) ───────────────────────────────

function parseSec(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw).trim();
  const hms = s.match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +hms[3];
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length === 6)
    return +digits.slice(0,2) * 3600 + +digits.slice(2,4) * 60 + +digits.slice(4,6);
  if (digits.length > 0) return +digits;
  return null;
}

function rowClasses($el) {
  return ($el.attr('class') || '').split(/\s+/).filter(Boolean);
}

function bestText($el, selector) {
  const x = $el.find(selector).first();
  if (!x.length) return '';
  return String(x.attr('title') || x.text() || '').trim();
}

function scoreEditorHtml(html) {
  if (!html) return 0;
  const lenScore      = Math.min(50, Math.floor(html.length / 1000));
  const cplnameCount  = (html.match(/name\s*=\s*["']cplname["']/gi) || []).length;
  const cplClassCount = (html.match(/\belement\b[^"]*\bcpl\b/gi)     || []).length;
  const eventDivCount = (html.match(/\beventDiv\b/gi)                 || []).length;
  return lenScore + cplnameCount * 10 + cplClassCount * 5 + eventDivCount;
}

function parseAllCplRowsAndAutomations(html) {
  const $ = cheerio.load(html, { decodeEntities: true });
  const items = [];

  // FIXED: Relaxed selector from 'div.row.m-0.element' to 'div.element'
  // to support both IMS (with Bootstrap-like classes) and DCP (plain classes).
  $('div.element').each((_, el) => {
    const $row   = $(el);
    const classes = rowClasses($row);
    const low    = classes.map(c => c.toLowerCase());

    // Skip nested automations or irrelevant elements if caught here
    if (low.includes('automation')) return;

    // Check for essential fields
    const hasTime  = $row.find('span.editor-time,  span[class*="editor-time"]').length  > 0;
    const hasTitle = $row.find('span.editor-title, span[class*="editor-title"]').length > 0;

    // Fallback logic for DCP dump where editor-time classes are missing
    let timeText = bestText($row, 'span.editor-time,  span[class*="editor-time"]');
    let title    = bestText($row, 'span.editor-title, span[class*="editor-title"]');

    if (!hasTime && !timeText) {
        const spans = $row.find('span.ellipsis');
        if (spans.length >= 1) timeText = $(spans[0]).text().trim();
    }
    if (!hasTitle && !title) {
        const spans = $row.find('span.ellipsis');
        if (spans.length >= 2) title = $(spans[1]).attr('title') || $(spans[1]).text().trim();
    }

    if (!timeText && !title && !hasTime && !hasTitle) return;

    const id         = String($row.attr('id') || '').trim();
    const tSec       = parseSec(timeText);
    const cplname    = String($row.find('input[name="cplname"], input[name="cpl_name"]').val() || '').trim();
    const durationRaw = $row.find('input[name="duration"]').val();
    const duration   = durationRaw != null && String(durationRaw).trim() !== '' ? +durationRaw : null;
    const cplUuid    = String($row.find('input[name="cpl"]').val()     || '').trim();

    const looksLikeItem =
      Number.isFinite(tSec) || Number.isFinite(duration) || !!cplname || !!cplUuid ||
      low.some(c => ['feature','short','trailer','teaser','psa','advertisement','policy','pattern','pack'].includes(c));
    if (!looksLikeItem) return;

    items.push({ id, classes, timeText, tSec, title, cplname, duration, cplUuid, automations: [] });
  });

  // Gather addOnDiv containers keyed by element id or cpl uuid
  const addOnByName = new Map();
  $('div.addOnDiv').each((_, el) => {
    const name = String($(el).attr('name') || '').trim();
    if (name) addOnByName.set(name, $(el));
  });

  for (const it of items) {
    const keys = [...(it.id ? [it.id] : []), ...(it.cplUuid ? [it.cplUuid] : [])];
    const autos = [];
    for (const key of keys) {
      const $add = addOnByName.get(key);
      if (!$add) continue;

      // FIXED: Relaxed selector here too
      $add.find('div.element.automation').each((_, aEl) => {
        const $a       = $(aEl);
        const aId      = String($a.attr('id') || '').trim();

        let aTimeText = bestText($a, 'span.editor-time,  span[class*="editor-time"]');
        let aTitle    = bestText($a, 'span.editor-title, span[class*="editor-title"]');

        // Fallback for DCP
        if (!aTimeText) {
             const spans = $a.find('span');
             if (spans.length >= 1) aTimeText = $(spans[0]).text().trim();
        }
        if (!aTitle) {
             const spans = $a.find('span');
             if (spans.length >= 2) aTitle = $(spans[1]).text().trim();
        }

        const aTSec     = parseSec(aTimeText);
        const kind      = aId ? String($add.find(`input#kind${aId}`).val()   || '').trim() : '';
        const offset    = aId ? String($add.find(`input#offset${aId}`).val() || '').trim() : '';

        if (aTitle && !autos.some(x => x.id === aId && aId))
          autos.push({ id: aId, timeText: aTimeText, tSec: aTSec, title: aTitle, kind, offset });
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

// ─── SPL HTML fetch (multi-strategy, from testIMSplayback.js) ─────────────────

async function loadSplEditorHtml(session, theaterConfig) {
  const ajaxPaths = [
    '/web/sys_control/cinelister/ajax.php',
    '/web/index.php?page=sys_control/cinelister/ajax.php',
  ];
  const referers = [
    `${theaterConfig.url}/web/index.php?page=sys_control/cinelister/editor.php`,
    `${theaterConfig.url}/web/sys_control/cinelister/editor.php`,
  ];
  const payloads = [
    'request=LOAD_SPL_ITEMS&style=editor',
    'request=LOAD_SPL_ITEMS&style=editor&full=1',
    'request=LOAD_SPL_ITEMS',
  ];

  let best = { score: -1, html: '' };

  for (const ajaxPath of ajaxPaths) {
    for (const ref of referers) {
      for (const payload of payloads) {
        try {
          const r = await session.request('POST', ajaxPath, payload, {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Referer': ref,
            'Origin': theaterConfig.url,
          });
          const html  = typeof r.data === 'string' ? r.data : (r.data ? JSON.stringify(r.data) : '');
          const score = scoreEditorHtml(html);
          if (score > best.score) best = { score, html };
        } catch (_) { /* absorb per-attempt failures */ }
      }
    }
  }

  return best.html;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns cached playlist items, refreshing only when splTitle changes or TTL expires.
 * @param {string}  theaterName
 * @param {object}  session       – DolbySessionManager instance
 * @param {object}  theaterConfig – from config.THEATERS
 * @param {string}  currentSplTitle
 */
async function getOrFetchPlaylistItems(theaterName, session, theaterConfig, currentSplTitle) {
  const cached = playlistCache[theaterName];
  if (
    cached &&
    cached.splTitle === currentSplTitle &&
    (Date.now() - cached.fetchedAt) < CACHE_TTL_MS
  ) {
    return cached.items;
  }

  // Prime editor context — some IMS3000 builds require a prior GET of editor.php
  const editorPaths = [
    '/web/index.php?page=sys_control/cinelister/editor.php',
    '/web/sys_control/cinelister/editor.php',
  ];
  for (const u of editorPaths) {
    try {
      await session.request('GET', u, null, {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      });
    } catch (_) {}
  }

  // Set interfaceSize cookie if absent (seen in your curl traces)
  if (session.cookies && !session.cookies.interfaceSize) {
    session.cookies.interfaceSize = 'auto';
  }

  const html  = await loadSplEditorHtml(session, theaterConfig);
  const items = parseAllCplRowsAndAutomations(html);

  playlistCache[theaterName] = { splTitle: currentSplTitle, items, fetchedAt: Date.now() };
  return items;
}

/**
 * Given parsed playlist items and current SPL position (seconds),
 * returns a timer descriptor or null if no event is within 15 minutes.
 *
 * Priority:  "Rails dans" > "Film dans"
 * Rationale: Rails are operationally critical during an active show;
 *            Film countdown is relevant pre-show.
 */
function computeTimer(items, splPositionSec) {
  if (!items || items.length === 0 || splPositionSec == null) return null;

  const shrFtrs = items
    .filter(it => it.tSec != null)
    .filter(isShrFtrLike)
    .sort((a, b) => a.tSec - b.tSec);

  if (shrFtrs.length === 0) return null;

  const firstShrFtr = shrFtrs[0];
  const lastShrFtr  = shrFtrs[shrFtrs.length - 1];
  const filmDelta   = firstShrFtr.tSec - splPositionSec;

  const railAutos = (lastShrFtr.automations || [])
    .filter(a => a.tSec != null && /rail/i.test(a.title || ''))
    .sort((a, b) => a.tSec - b.tSec);

  // FIXED: Select the LAST rail automation, not the first
  const lastRail = railAutos.length > 0 ? railAutos[railAutos.length - 1] : null;
  const railDelta = lastRail ? lastRail.tSec - splPositionSec : null;

  if (railDelta != null && railDelta > 0 && railDelta <= PRESHOW_WINDOW) {
    return { type: 'rails', label: 'Rails dans', secondsRemaining: Math.round(railDelta) };
  }
  if (filmDelta > 0 && filmDelta <= PRESHOW_WINDOW) {
    return { type: 'film', label: 'Film dans', secondsRemaining: Math.round(filmDelta) };
  }

  return null;
}

/** Force-clear cache for a theater (e.g. when SPL is manually changed via macros). */
function invalidateCache(theaterName) {
  delete playlistCache[theaterName];
}

module.exports = { getOrFetchPlaylistItems, computeTimer, invalidateCache, parseSec };
