// routes/timers.js
'use strict';

const express = require('express');
const router  = express.Router();

const { resolveName, clients } = require('./theaters');
const config                   = require('../config');
const { getOrFetchPlaylistItems, computeTimer, parseSec } = require('../services/splPlaylistService');

router.get('/api/timers/:id', async (req, res) => {
  const name = resolveName(req.params.id);
  if (!name) return res.status(404).json({ success: false, error: 'Theater not found' });

  const client       = clients[name];
  const theaterConfig = config.THEATERS[name];
  if (!client || !theaterConfig) {
    return res.status(404).json({ success: false, error: 'Theater client not initialised' });
  }

  try {
    // ── Step 1: Reuse existing SOAP playback status (has its own session cache) ──
    const showStatus = await client.getPlaybackStatus();
    if (!showStatus) {
      return res.json({ success: true, theater: name, timer: null });
    }

    const splTitle        = showStatus.splTitle || null;
    const splPositionSec  = parseSec(showStatus.splPosition);

    if (!splTitle || splPositionSec == null) {
      return res.json({ success: true, theater: name, timer: null });
    }

    // ── Step 2: Fetch/cache playlist items (cached by splTitle) ──────────────────
    const session = client.session; // DolbySessionManager
    const items   = await getOrFetchPlaylistItems(name, session, theaterConfig, splTitle);

    // ── Step 3: Compute timer ────────────────────────────────────────────────────
    const timerBase = computeTimer(items, splPositionSec);

    let timer = null;
    if (timerBase) {
      // Enrich with absolute wall-clock target for optional display
      const targetDate = new Date(Date.now() + timerBase.secondsRemaining * 1000);
      timer = {
        ...timerBase,
        targetTime: targetDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      };
    }

    return res.json({ success: true, theater: name, timer });

  } catch (err) {
    // Timers are best-effort — never let this crash the broader UI
    console.error(`[Timers API] ${name}: ${err.message}`);
    return res.json({ success: true, theater: name, timer: null });
  }
});

module.exports = router;
