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
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean);
  const origin = req.headers.origin;
  const originAllowed = Boolean(origin && allowedOrigins.includes(origin));

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (originAllowed) res.setHeader('Access-Control-Allow-Origin', origin);

  if (req.method === 'OPTIONS') {
    // A 403 here typically appears as a CORS error in the browser.
    return res.status(originAllowed ? 204 : 403).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ saved: false, error: 'Method not allowed' });
  }
  if (!originAllowed) {
    return res.status(403).json({ saved: false, error: 'Origin not allowed' });
  }

  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId || Object.values(FIELDS).some(key => !process.env[key])) {
    console.error('Missing required GHL environment configuration');
    return res.status(503).json({ saved: false, error: 'Server configuration incomplete' });
  }

  let b = req.body || {};
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch { return res.status(400).json({ saved: false, error: 'Invalid JSON body' }); }
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) {
    return res.status(400).json({ saved: false, error: 'Invalid submission' });
  }

  const name = String(b.full_name || '').trim();
  const email = String(b.email || '').trim();
  const phone = String(b.phone || '').trim();
  const required = ['best_time_to_call', 'whats_bothering', 'previous_spend', 'travel_origin', 'start_timeline', 'treatment_budget'];
  if (!name || name.length > 160 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !/^\+1\d{10}$/.test(phone) ||
      !required.every(key => typeof b[key] === 'string' && b[key].trim() && b[key].length <= 300) ||
      b.contact_consent !== 'on') {
    return res.status(400).json({ saved: false, error: 'Please complete all required fields.' });
  }

  const parts = name.split(/\s+/);
  const customFields = Object.entries(FIELDS)
    .filter(([key]) => typeof b[key] === 'string' && b[key].trim())
    .map(([key, envName]) => ({ id: process.env[envName], field_value: b[key].trim() }));

  const payload = {
    locationId,
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
    name, email, phone,
    source: 'Body Preserve Qualifying Form',
    customFields
  };

  try {
    const upstream = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
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
  } catch (error) {
    console.error('GHL request error', error.message);
    return res.status(502).json({ saved: false, error: 'Could not reach GHL. Please retry.' });
  }
};
