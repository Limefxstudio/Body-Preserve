const FIELDS = {
  best_time_to_call: 'GHL_FIELD_BEST_TIME',
  us_state: 'GHL_FIELD_US_STATE',
  whats_bothering: 'GHL_FIELD_CONCERN',
  previous_spend: 'GHL_FIELD_PREVIOUS_SPEND',
  travel_origin: 'GHL_FIELD_TRAVEL_ORIGIN',
  start_timeline: 'GHL_FIELD_START_TIMELINE',
  treatment_budget: 'GHL_FIELD_TREATMENT_BUDGET'
};

module.exports = async function handler(req, res) {
  const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin;
  if (origin && origins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(origin && origins.includes(origin) ? 204 : 403).end();
  if (req.method !== 'POST') return res.status(405).json({ saved: false, error: 'Method not allowed' });
  if (origin && !origins.includes(origin)) return res.status(403).json({ saved: false, error: 'Origin not allowed' });
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId || Object.values(FIELDS).some(key => !process.env[key])) {
    return res.status(503).json({ saved: false, error: 'Server configuration incomplete' });
  }
  const b = req.body || {};
  const name = String(b.full_name || '').trim();
  const email = String(b.email || '').trim();
  const phone = String(b.phone || '').trim();
  const required = ['best_time_to_call','whats_bothering','previous_spend','travel_origin','start_timeline','treatment_budget'];
  if (!name || name.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+1\d{10}$/.test(phone) || !required.every(k => typeof b[k] === 'string' && b[k].trim() && b[k].length <= 300) || b.contact_consent !== 'on') {
    return res.status(400).json({ saved: false, error: 'Please complete all required fields.' });
  }
  const parts = name.split(/\s+/);
  const customFields = Object.entries(FIELDS).filter(([key]) => b[key]).map(([key, env]) => ({ id: process.env[env], field_value: String(b[key]) }));
  const payload = { locationId, firstName: parts[0], lastName: parts.slice(1).join(' '), name, email, phone, source: 'Body Preserve Qualifying Form', customFields };
  try {
    const upstream = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const result = await upstream.json().catch(() => ({}));
    const contactId = result.contact?.id || result.contactId;
    if (!upstream.ok || !contactId) {
      console.error('GHL lead save failed', upstream.status, JSON.stringify(result).slice(0, 1200));
      return res.status(502).json({ saved: false, error: 'GHL could not save this lead. Please try again.' });
    }
    return res.status(200).json({ saved: true, contactId });
  } catch (err) {
    console.error('GHL request error', err.message);
    return res.status(502).json({ saved: false, error: 'Could not reach GHL. Please retry.' });
  }
};
