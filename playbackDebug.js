#!/usr/bin/env node
// scripts/dumpPlaylistDebug.js
// Runs INSIDE the app context — reads config, reuses session manager and
// splPlaylistService exactly as the timers route does.
// Does NOT start the HTTP server; just bootstraps the minimum needed.
//
// Usage:  node scripts/dumpPlaylistDebug.js <theater-slug-or-name>
//   e.g.  node scripts/dumpPlaylistDebug.js salle-2
//         node scripts/dumpPlaylistDebug.js "Salle 2"
'use strict';

const config   = require('./config');
const { clients, resolveName } = require('./routes/theaters');
const { getOrFetchPlaylistItems, parseSec } = require('./services/splPlaylistService');

const arg = process.argv[2] || 'salle-2';

// ── resolve theater name exactly as timers route does ────────────────────────
const name = resolveName(arg);
if (!name) {
  console.error(`Theater not found for slug/name: "${arg}"`);
  console.error('Known theaters:', Object.keys(config.THEATERS));
  process.exit(1);
}

const client        = clients[name];
const theaterConfig = config.THEATERS[name];

if (!client) {
  console.error(`No client initialised for "${name}". Is the server running? (clients populated lazily)`);
  console.error('Hint: start the server first, let it connect, then Ctrl+C and immediately run this script');
  console.error('OR: this script must run while server.js is NOT holding the port — edit server.js to');
  console.error('export clients and call this script differently. See alternative below.');
  process.exit(1);
}

(async () => {
  const out = {
    theater: name,
    ts: new Date().toISOString(),
  };

  // 1) Get playback status via the same client the timers route uses
  let showStatus = null;
  try {
    showStatus = await client.getPlaybackStatus();
    out.showStatus = showStatus;
  } catch (e) {
    out.showStatusError = e.message;
  }

  const splTitle       = showStatus && showStatus.splTitle;
  const splPositionSec = showStatus ? parseSec(showStatus.splPosition) : null;
  out.splTitle        = splTitle;
  out.splPositionParsed = splPositionSec;

  if (!splTitle || splPositionSec == null) {
    out.verdict = 'ABORT: splTitle or splPosition missing/unparseable — computeTimer would return null here';
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  // 2) Fetch / cache playlist items
  let items = [];
  try {
    items = await getOrFetchPlaylistItems(name, client.session, theaterConfig, splTitle);
    out.itemCount = items.length;
  } catch (e) {
    out.itemsError = e.message;
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  if (items.length === 0) {
    out.verdict = 'ABORT: getOrFetchPlaylistItems returned [] — HTML fetch failed or parser found nothing';
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  // 3) Dump a summary of every item: index, classes, title, cplname, tSec, automations
  out.items = items.map((it, i) => ({
    index:      i,
    id:         it.id,
    classes:    it.classes,
    title:      it.title,
    cplname:    it.cplname,
    tSec:       it.tSec,
    tSecFmt:    it.tSec != null ? fmt(it.tSec) : null,
    duration:   it.duration,
    cplUuid:    it.cplUuid,
    isShrFtr:   isShrFtrLike(it),
    automations: (it.automations || []).map(a => ({
      id:       a.id,
      title:    a.title,
      tSec:     a.tSec,
      tSecFmt:  a.tSec != null ? fmt(a.tSec) : null,
      kind:     a.kind,
      offset:   a.offset,
      matchesRailRegex: /rail/i.test(a.title || ''),
    })),
  }));

  // 4) Reproduce computeTimer logic step by step, verbosely
  const SHR_FTR_RE = /(?:^|[^A-Za-z0-9])(SHR|FTR)(?:[^A-Za-z0-9]|$)/i;
  function isShrFtrLike(item) {
    const hay = `${item.cplname || ''} ${item.title || ''}`.trim();
    const low = item.classes.map(c => c.toLowerCase());
    return SHR_FTR_RE.test(hay) || low.includes('feature') || low.includes('short');
  }

  const shrFtrs = items
    .filter(it => it.tSec != null)
    .filter(isShrFtrLike)
    .sort((a, b) => a.tSec - b.tSec);

  out.shrFtrCandidates = shrFtrs.map(it => ({
    index:   items.indexOf(it),
    title:   it.title,
    cplname: it.cplname,
    classes: it.classes,
    tSec:    it.tSec,
    tSecFmt: fmt(it.tSec),
  }));

  if (shrFtrs.length === 0) {
    out.verdict = 'FAIL: No SHR/FTR rows with valid tSec found. Timer cannot trigger.';
    out.allItemsShrFtrCheck = items.map(it => ({
      title:      it.title,
      cplname:    it.cplname,
      classes:    it.classes,
      tSec:       it.tSec,
      isShrFtr:   isShrFtrLike(it),
    }));
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }

  const firstShrFtr = shrFtrs[0];
  const lastShrFtr  = shrFtrs[shrFtrs.length - 1];
  const filmDelta   = firstShrFtr.tSec - splPositionSec;
  out.filmDelta     = filmDelta;
  out.filmDeltaFmt  = fmt(filmDelta);
  out.PRESHOW_WINDOW = 900;
  out.filmWouldTrigger = filmDelta > 0 && filmDelta <= 900;

  // All automations from last SHR/FTR
  const allAutos = (lastShrFtr.automations || []);
  out.lastShrFtrAutomations = allAutos.map(a => ({
    title:             a.title,
    tSec:              a.tSec,
    tSecFmt:           a.tSec != null ? fmt(a.tSec) : null,
    matchesRailRegex:  /rail/i.test(a.title || ''),
  }));

  // Rail automations
  const railAutos = allAutos
    .filter(a => a.tSec != null && /rail/i.test(a.title || ''))
    .sort((a, b) => a.tSec - b.tSec);

  out.railAutos = railAutos.map(a => ({
    title:  a.title,
    tSec:   a.tSec,
    tSecFmt: fmt(a.tSec),
    delta:  a.tSec - splPositionSec,
    deltaFmt: fmt(a.tSec - splPositionSec),
  }));

  // lastRail (fix: should be last, not first)
  const lastRail  = railAutos[railAutos.length - 1] || null;
  const firstRail = railAutos[0] || null;
  const railDeltaFirst = firstRail ? firstRail.tSec - splPositionSec : null;
  const railDeltaLast  = lastRail  ? lastRail.tSec  - splPositionSec : null;

  out.railDeltaFirst    = railDeltaFirst;
  out.railDeltaFirstFmt = railDeltaFirst != null ? fmt(railDeltaFirst) : null;
  out.railDeltaLast     = railDeltaLast;
  out.railDeltaLastFmt  = railDeltaLast != null ? fmt(railDeltaLast) : null;

  out.railFirstWouldTrigger = railDeltaFirst != null && railDeltaFirst > 0 && railDeltaFirst <= 900;
  out.railLastWouldTrigger  = railDeltaLast  != null && railDeltaLast  > 0 && railDeltaLast  <= 900;

  // Final verdict
  if (railAutos.length === 0 && !out.filmWouldTrigger) {
    out.verdict = 'FAIL: No rail automations found in last SHR/FTR AND filmDelta is outside window. No timer.';
  } else if (railAutos.length === 0) {
    out.verdict = 'INFO: No rail automations. Film timer WOULD trigger if logic is correct.';
  } else if (!out.railLastWouldTrigger && !out.filmWouldTrigger) {
    out.verdict = `FAIL: Rail/Film deltas both outside 0–900s window. railLast=${out.railDeltaLastFmt}, film=${out.filmDeltaFmt}`;
  } else {
    out.verdict = 'OK: At least one timer should be triggering. Check computeTimer code if still null.';
  }

  console.log(JSON.stringify(out, null, 2));
})().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});

function fmt(sec) {
  if (sec == null || !Number.isFinite(sec)) return String(sec);
  const s  = Math.round(sec);
  const neg = s < 0;
  const abs = Math.abs(s);
  const h  = Math.floor(abs / 3600);
  const m  = Math.floor((abs % 3600) / 60);
  const ss = abs % 60;
  const r  = h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
    : `${m}:${String(ss).padStart(2,'0')}`;
  return neg ? `-${r}` : r;
}
