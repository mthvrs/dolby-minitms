// routes/macros.js
const express = require('express');
const router = express.Router();
const { clients, resolveName } = require('./theaters');

// GET /api/macros/:id - Load macros
router.get('/:id', async (req, res) => {
  const name = resolveName(req.params.id);
  if (!name) return res.status(404).json({ error: 'Theater not found' });
  const client = clients[name];
  try {
    const macros = await client.loadMacros();
    if (macros == null) {
      return res.status(500).json({ error: 'Failed to load macros from server', theater: name });
    }
    res.json({ theater: name, macros });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/macros/:id/execute - Execute macro
router.post('/:id/execute', async (req, res) => {
  const name = resolveName(req.params.id);
  if (!name) return res.status(404).json({ error: 'Theater not found' });
  const client = clients[name];
  const { macroName, displayName } = req.body || {};
  if (!macroName) return res.status(400).json({ error: 'macroName required' });
  try {
    const success = await client.executeMacro(macroName);
    res.json({ success, theater: name, macro: macroName, display: displayName || macroName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
