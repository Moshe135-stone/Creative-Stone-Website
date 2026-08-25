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
//   5. Add them to the Resend audience, if they opted in and are not in it
//   6. Score the lead with Claude, then patch the score onto the record
//
// Steps 2 to 6 are each wrapped so a failure downstream never discards a lead
// that has already been captured. A dead Resend key should not cost you the
// submission.
//
// On step 6 and "run it in the background": a Vercel Node function is frozen
// the moment it returns a response, so work started after res.json() does not
// finish. Scoring therefore runs inline, before the response, and adds roughly
// a second. If that becomes annoying, the fix is `waitUntil` from the
// @vercel/functions package (which does mean adding a package.json), or moving
// this file to a Cloudflare Worker, where ctx.waitUntil() is native.

const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const AIRTABLE_API = 'https://api.airtable.com/v0';
const RESEND_API = 'https://api.resend.com/emails';
const RESEND_AUDIENCES = 'https://api.resend.com/audiences';
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
//
// The error codes are the only way to tell the failure modes apart, and they
// are worth keeping: "invalid-input-secret" means the key in this environment
// is wrong, "timeout-or-duplicate" means the visitor sat on the page longer
// than the token's ~300s life (or resubmitted a spent one), and
// "invalid-input-response" means the token was never valid. Collapsing all of
// them into one message is what made this undiagnosable from production.
async function verifyHuman(token, ip) {
  if (!token) {
    console.warn('turnstile: submission carried no token');
    return { ok: false, codes: ['missing-input-response'] };
  }
  const body = new URLSearchParams({
    secret: process.env.TURNSTILE_SECRET_KEY || '',
    response: token,
  });
  if (ip) body.set('remoteip', ip);

  try {
    const res = await fetch(TURNSTILE_VERIFY, { method: 'POST', body });
    const data = await res.json();
    const codes = data['error-codes'] || [];
    if (data.success !== true) {
      console.warn('turnstile rejected: ' + JSON.stringify({
        codes: codes,
        hostname: data.hostname,
        challenge_ts: data.challenge_ts,
      }));
    }
    return { ok: data.success === true, codes: codes };
  } catch (err) {
    console.error('turnstile verify failed', err);
    return { ok: false, codes: ['internal-error'] };
  }
}

// What the table turned out not to accept, remembered across invocations.
// A serverless function keeps its module scope between warm requests, so the
// first submission after a cold start pays for discovering the schema and the
// rest reuse it. Without this every single lead re-learns the same shape, which
// measured at roughly two wasted seconds per submission.
//
// This is a cache of failures, not of schema: it only ever grows from real
// rejections, and a cold start re-checks from scratch. So adding a column still
// takes effect, just on the next cold start rather than instantly.
const unwritable = new Set();   // column absent, or computed by Airtable
const needsString = new Set();  // column exists but wants text, not a number

// Airtable rejects an entire write if it contains one field name the table does
// not have, which makes a partially-built table an all-or-nothing failure. So we
// send everything we know, drop whatever Airtable names in the error, and retry.
// The upshot: the table only needs the columns you care about today, and the
// moment you add "Priority" or "Services" they start filling in with no code
// change. Dropped fields are logged, never silently swallowed.
function toText(value) {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

async function writeFields(url, method, fields) {
  const payload = {};
  for (const key of Object.keys(fields)) {
    if (unwritable.has(key)) continue;
    payload[key] = needsString.has(key) ? toText(fields[key]) : fields[key];
  }
  const dropped = [];

  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await fetch(url, {
      method: method,
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: payload, typecast: true }),
    });

    if (res.ok) {
      if (dropped.length) {
        console.warn(`airtable: skipped ${dropped.join(', ')}`);
      }
      return res.json();
    }

    // Two ways a column can be unwritable, both worth surviving: it does not
    // exist, or it exists but Airtable computes it (a Created time field, a
    // formula, an autonumber). Either way, drop it and retry.
    const text = await res.text();
    const missing = text.match(/Unknown field name:\s*\\?"([^"\\]+)/i);
    const computed = text.match(/Field\s+\\?"([^"\\]+)\\?"\s+cannot accept a value/i);
    const hit = missing || computed;
    if (hit && hit[1] in payload) {
      delete payload[hit[1]];
      unwritable.add(hit[1]);
      dropped.push(`${hit[1]} (${missing ? 'no such column' : 'computed by Airtable'})`);
      continue;
    }

    // A third case: the column exists and is writable, but wants a different
    // type than we sent. A number going into a text column is the common one
    // (Airtable's typecast does not cover it). Retry that field as a string
    // rather than losing the value, so this works whether Score is a Number
    // field or a text one.
    const mistyped = text.match(/Cannot parse value for field ([^"\\]+)/i);
    if (mistyped && mistyped[1] in payload && !needsString.has(mistyped[1])) {
      payload[mistyped[1]] = toText(payload[mistyped[1]]);
      needsString.add(mistyped[1]);
      continue;
    }

    throw new Error(`airtable ${method} ${res.status}: ${text}`);
  }
  throw new Error('airtable: too many unknown field names');
}

async function createLead(fields) {
  const table = encodeURIComponent(process.env.AIRTABLE_TABLE || 'Leads');
  const url = `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${table}`;
  const record = await writeFields(url, 'POST', fields);
  return record.id;
}

async function updateLead(recordId, fields) {
  const table = encodeURIComponent(process.env.AIRTABLE_TABLE || 'Leads');
  const url = `${AIRTABLE_API}/${process.env.AIRTABLE_BASE_ID}/${table}/${recordId}`;
  await writeFields(url, 'PATCH', fields);
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

// Add the visitor to the Resend audience, but only if they are not already in
// it. The "only if" is the whole point, and it is not an optimization.
//
// POST /contacts is an idempotent upsert keyed on the email, so blindly
// posting every submission looks harmless and is not. Two things it does:
// it rewrites the contact from the request body, so a field this handler
// omits (last_name on a one-word submission) is nulled rather than left
// alone; and it resets `unsubscribed` to false. That second one silently
// puts someone who opted out back on the marketing list the next time they
// use the contact form, which is exactly the thing an unsubscribe is
// supposed to prevent.
//
// So: look them up first, and only create when the lookup 404s. An existing
// contact is left untouched, whatever their subscription state.
async function addContactIfNew(firstName, lastName, email, businessTypeLabel) {
  const audience = process.env.RESEND_AUDIENCE_ID;
  if (!audience) return 'no audience configured';

  const base = `${RESEND_AUDIENCES}/${audience}/contacts`;
  const auth = { Authorization: `Bearer ${process.env.RESEND_API_KEY}` };

  const found = await fetch(`${base}/${encodeURIComponent(email)}`, { headers: auth });
  if (found.ok) return 'already a contact';
  if (found.status !== 404) {
    throw new Error(`resend contacts lookup ${found.status}: ${await found.text()}`);
  }

  // business_type is a property defined on the audience. Resend validates
  // these: an undefined key is usually dropped silently, but it can also
  // reject the whole request with a 422, which would cost the contact over a
  // field that is only nice to have. So retry once without properties rather
  // than let a renamed or deleted property break the sync.
  const contact = {
    email: email,
    first_name: firstName,
    last_name: lastName,
    unsubscribed: false,
  };

  let res = await create(base, auth, Object.assign({
    properties: { business_type: businessTypeLabel },
  }, contact));

  if (res.status === 422) {
    console.warn(`resend contacts: 422 with properties, retrying plain: ${await res.text()}`);
    res = await create(base, auth, contact);
    if (res.ok) return 'added (without business_type)';
  }

  if (!res.ok) throw new Error(`resend contacts create ${res.status}: ${await res.text()}`);
  return 'added';
}

function create(base, auth, body) {
  return fetch(base, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
    body: JSON.stringify(body),
  });
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
  // An unchecked checkbox is absent from the form data entirely, so this is
  // only ever truthy when the visitor actually ticked it.
  const emailOptIn = body.emailOptIn === 'yes';
  const token = body['cf-turnstile-response'];

  if (!firstName || !lastName || !email || !businessType) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'That email address does not look right.' });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const verdict = await verifyHuman(token, ip);
  if (!verdict.ok) {
    // An expired token is the one failure the visitor can fix by simply trying
    // again, and it is the likeliest on a long page: the widget solves on
    // render, near the top, while the form sits at the bottom. script.js
    // already calls turnstile.reset() on failure, so a retry gets a fresh one.
    const stale = verdict.codes.indexOf('timeout-or-duplicate') !== -1;
    return res.status(403).json({
      error: stale
        ? 'That check expired while the page was open. Please swipe to send again.'
        : 'Could not verify you are human. Please reload and try again.',
    });
  }

  // The grid posts "Websites, Branding" and none of the option names contain a
  // comma, so splitting on it is safe.
  const serviceList = services
    ? services.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    : [];

  const businessTypeLabel = BUSINESS_LABELS[businessType] || businessType;
  const lead = { firstName, lastName, email, businessType, businessTypeLabel, services };

  // Step 2. The one step allowed to fail the request: if the lead is not
  // stored anywhere, there is nothing to tell the visitor was received.
  let recordId;
  try {
    recordId = await createLead({
      'First name': firstName,
      'Last name': lastName,
      Email: email,
      'Business type': businessTypeLabel,
      // Your "Submitted" column is a computed Airtable field, so it fills
      // itself and rejects writes. Sent anyway and dropped automatically, which
      // keeps working if you ever swap it for a plain date field.
      Submitted: new Date().toISOString(),
      // An array, not the comma-joined string, because Services is a Multiple
      // select: an array gives Airtable discrete options with no reliance on
      // typecast splitting a string. When nothing was picked this is [], which
      // clears the cell — sending '' instead made typecast mint a junk blank
      // option, which is what the first live lead did. If the column is ever
      // retyped to text, writeFields retries it joined.
      Services: serviceList,
      // The consent decision belongs on the durable record, not just in the
      // audience: it is the only evidence of what they agreed to and when.
      // Dropped automatically until the column exists.
      'Email opt-in': emailOptIn,
    });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'We could not save that. Please try again in a moment.' });
  }

  const fullName = `${firstName} ${lastName}`;
  const servicesLine = services || 'none specified';

  // Steps 3 and 4 in parallel; neither can fail the request.
  const sends = await Promise.allSettled([
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
  ]);
  sends.forEach(function (r) {
    if (r.status === 'rejected') console.error('email failed', r.reason);
  });

  // Only once the receipt actually went out. Gating on the send keeps the
  // audience clean: an address Resend rejected is one that should not be
  // collected, and this is the only place that knows the send succeeded.
  // Never fatal, like the emails above.
  if (!emailOptIn) {
    console.log(`resend audience: ${email} skipped (no opt-in)`);
  } else if (sends[1].status === 'fulfilled') {
    try {
      const outcome = await addContactIfNew(firstName, lastName, email, businessTypeLabel);
      console.log(`resend audience: ${email} ${outcome}`);
    } catch (err) {
      console.error('contact sync failed', err);
    }
  }

  // Step 6. Inline rather than after the response, for the freeze reason at
  // the top of this file. Never fatal: an unscored lead is still a lead.
  try {
    const score = await scoreLead(lead);
    await updateLead(recordId, {
      Score: score.score,
      // Same story: filled in automatically if these columns appear later.
      'Score Reason': score.reason,
      Priority: score.priority,
    });
  } catch (err) {
    console.error('scoring failed', err);
  }

  return res.status(200).json({ ok: true });
};
