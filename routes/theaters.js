const express = require('express');
const router = express.Router();
const config = require('../config');
const DolbyClientUnified = require('../services/dolbyClientUnified');
const { slugify } = require('../utils');

const clients = {};
const slugToName = {};
const nameToSlug = {};

// Initialize clients and slug maps
for (const [name, theaterConfig] of Object.entries(config.THEATERS)) {
  clients[name] = new DolbyClientUnified(name, theaterConfig);
  const slug = slugify(name);
  slugToName[slug] = name;
  nameToSlug[name] = slug;
}

function resolveName(idOrSlug) {
  if (clients[idOrSlug]) return idOrSlug;
  if (slugToName[idOrSlug]) return slugToName[idOrSlug];
  return null;
}

// List theaters (Salles)
router.get('/api/theaters', (req, res) => {
  const theaters = Object.keys(config.THEATERS).map((name) => ({
    name,
    slug: nameToSlug[name],
    type: config.THEATERS[name].type,
    url: config.THEATERS[name].url,
  }));
  res.json({ theaters });
});

// Theater detail
router.get('/api/theaters/:id', (req, res) => {
  const name = resolveName(req.params.id);
  if (!name) return res.status(404).json({ error: 'Theater not found' });

  const t = config.THEATERS[name];
  res.json({
    name,
    slug: nameToSlug[name],
    type: t.type,
    url: t.url,
  });
});

// Connect
router.post('/api/theaters/:id/connect', async (req, res) => {
  const name = resolveName(req.params.id);
  if (!name) return res.status(404).json({ error: 'Theater not found' });

  const client = clients[name];

  try {
    const connected = await client.checkConnection();
    if (!connected) {
      return res.status(503).json({
        connected: false,
        name,
        error: 'Server unreachable',
      });
    }

    const authenticated = await client.login();
    if (!authenticated) {
      return res.status(401).json({
        connected: true,
        name,
        authenticated: false,
        error: 'Authentication failed',
      });
    }

    res.json({
      connected: true,
      authenticated: true,
      name,
      slug: nameToSlug[name],
      type: client.config.type,
      message: 'Connection established and authenticated',
    });
  } catch (error) {
    res.status(500).json({ error: error.message, name });
  }
});

// Disconnect
router.post('/api/theaters/:id/disconnect', async (req, res) => {
  const name = resolveName(req.params.id);
  if (!name) return res.status(404).json({ error: 'Theater not found' });

  try {
    const client = clients[name];
    await client.destroy();
    res.json({ success: true, name, message: 'Session destroyed' });
  } catch (error) {
    res.status(500).json({ error: error.message, name });
  }
});

module.exports = { router, clients, resolveName, slugify, nameToSlug };