// One endpoint behind the contact form. Everything here talks to its service
// over plain fetch, which is global in Vercel's Node runtime, so this project
// still has no package.json and no build step.
//
// CommonJS on purpose: with no package.json declaring "type": "module", a .js
// file in /api is treated as CommonJS. Renaming this to .mjs is what it would
// take to use `export default` instead.
//
// Order of work, and why:
//   1. Verify the Turnstile token   (cheap, and gates everything after it)
//   2. Write the lead to Airtable   (the durable record; must not be lost)
//   3. Email the team               (so a human knows immediately)
//   4. Email the visitor            (their receipt)
//   5. Score the lead with Claude, then patch the score onto the record
//
// Steps 2 to 5 are each wrapped so a failure downstream never discards a lead
// that has already been captured. A dead Resend key should not cost you the
// submission.
//
// On step 5 and "run it in the background": a Vercel Node function is frozen
// the moment it returns a response, so work started after res.json() does not
// finish. Scoring therefore runs inline, before the response, and adds roughly
// a second. If that becomes annoying, the fix is `waitUntil` from the
// @vercel/functions package (which does mean adding a package.json), or moving
// this file to a Cloudflare Worker, where ctx.waitUntil() is native.

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const AIRTABLE_API = 'https://api.airtable.com/v0';
const RESEND_API = 'https://api.resend.com/emails';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// Claude Opus 5 at low effort. Adaptive thinking is on by default on this
// model and max_tokens caps thinking plus response together, so max_tokens is
// set well above the size of the JSON we actually want back. Swap the model to
// "claude-haiku-4-5" to cut the per-lead cost by roughly 5x.
const MODEL = 'claude-opus-5';

const BUSINESS_LABELS = {
  aba: 'ABA clinic',
  senior: 'Senior care',
  amazon: 'Amazon seller',
  local: 'Local service business',
  other: 'Something else',
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Turnstile answers with { success: boolean, "error-codes": [...] }. Anything
// other than an explicit success is treated as a failure, including a network
// error reaching Cloudflare: failing open here would defeat the point.
async function verifyHuman(token, ip) {
  if (!token) return false;
  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY || '',
    response: token,
  });
  if (ip) body.set('remoteip', ip);

  try {
    const res = await fetch(TURNSTILE_VERIFY, { method: 'POST', body });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error('turnstile verify failed', err);
    return false;
  }
}

async function createLead(fields) {
  const table = encodeURIComponent(process.env.AIRTABLE_TABLE || 'Leads');
  const res = await fetch(`${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${table}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) throw new Error(`airtable create ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}

async function updateLead(recordId, fields) {
  const table = encodeURIComponent(process.env.AIRTABLE_TABLE || 'Leads');
  const res = await fetch(`${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${table}/${recordId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!res.ok) throw new Error(`airtable update ${res.status}: ${await res.text()}`);
}

async function sendEmail(payload) {
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
}

// Structured outputs guarantee the reply parses. Note the schema carries no
// numeric minimum or maximum: the API's schema subset does not support them,
// so the 0 to 100 range is stated in the prompt instead.
const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', description: 'Fit from 0 to 100.' },
    priority: { type: 'string', enum: ['hot', 'warm', 'cold'] },
    reason: { type: 'string', description: 'One or two sentences, plain language.' },
  },
  required: ['score', 'priority', 'reason'],
  additionalProperties: false,
};

async function scoreLead(lead) {
  const prompt = [
    'Score this inbound lead for a marketing agency that builds brands and',
    'websites for ABA clinics, senior care, Amazon sellers, and local service',
    'businesses.',
    '',
    `Name: ${lead.firstName} ${lead.lastName}`,
    `Email: ${lead.email}`,
    `Business type: ${lead.businessTypeLabel}`,
    `Services requested: ${lead.services || 'none specified'}`,
    '',
    'Score 0 to 100 on fit and buying intent. A named business email and a',
    'clear service request score higher than a free email address with no',
    'services picked. Use "hot" for 70 and above, "warm" for 40 to 69, and',
    '"cold" below 40. Keep the reason to one or two plain sentences a',
    'salesperson can read at a glance.',
  ].join('\n');

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SCORE_SCHEMA },
      },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();

  // Safety classifiers can decline a request, which arrives as a normal 200
  // with stop_reason "refusal" and no text block. Thinking blocks also come
  // before the text block, so find it by type rather than taking content[0].
  if (data.stop_reason === 'refusal') throw new Error('anthropic refused to score');
  const text = (data.content || []).find(function (b) { return b.type === 'text'; });
  if (!text) throw new Error('anthropic returned no text block');
  return JSON.parse(text.text);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const email = String(body.email || '').trim();
  const businessType = String(body.businessType || '').trim();
  const services = String(body.services || '').trim();
  const token = body['cf-turnstile-response'];

  if (!firstName || !lastName || !email || !businessType) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'That email address does not look right.' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (!(await verifyHuman(token, ip))) {
    return res.status(403).json({ error: 'Could not verify you are human. Please reload and try again.' });
  }

  const businessTypeLabel = BUSINESS_LABELS[businessType] || businessType;
  const lead = { firstName, lastName, email, businessType, businessTypeLabel, services };

  // Step 2. The one step allowed to fail the request: if the lead is not
  // stored anywhere, there is nothing to tell the visitor was received.
  let recordId;
  try {
    recordId = await createLead({
      'First Name': firstName,
      'Last Name': lastName,
      Email: email,
      'Business Type': businessTypeLabel,
      Services: services,
      'Submitted At': new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'We could not save that. Please try again in a moment.' });
  }

  const fullName = `${firstName} ${lastName}`;
  const servicesLine = services || 'none specified';

  // Steps 3 and 4 in parallel; neither can fail the request.
  await Promise.allSettled([
    sendEmail({
      from: process.env.FROM_EMAIL,
      to: process.env.NOTIFY_EMAIL,
      reply_to: email,
      subject: `New lead: ${fullName} (${businessTypeLabel})`,
      html: `<h2>New lead</h2>
<p><strong>Name:</strong> ${escapeHtml(fullName)}<br>
<strong>Email:</strong> ${escapeHtml(email)}<br>
<strong>Business type:</strong> ${escapeHtml(businessTypeLabel)}<br>
<strong>Services:</strong> ${escapeHtml(servicesLine)}</p>`,
    }),
    sendEmail({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: 'Thanks for reaching out to Creative Stone',
      html: `<p>Hi ${escapeHtml(firstName)},</p>
<p>Thanks for getting in touch. We have your details and someone will come back
to you shortly with an honest read on whether we are a good match.</p>
<p>If you would rather just grab a time, you can book a 15-minute call on the
site whenever suits you.</p>
<p>Mozy<br>Creative Stone</p>`,
    }),
  ]).then(function (results) {
    results.forEach(function (r) {
      if (r.status === 'rejected') console.error('email failed', r.reason);
    });
  });

  // Step 5. Inline rather than after the response, for the freeze reason at
  // the top of this file. Never fatal: an unscored lead is still a lead.
  try {
    const score = await scoreLead(lead);
    await updateLead(recordId, {
      Score: score.score,
      'Score Reason': score.reason,
      Priority: score.priority,
    });
  } catch (err) {
    console.error('scoring failed', err);
  }

  return res.status(200).json({ ok: true });
};
