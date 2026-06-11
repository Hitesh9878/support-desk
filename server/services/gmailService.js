require('dotenv').config();
const Imap             = require('imap');
const { simpleParser } = require('mailparser');
const fs               = require('fs');
const path             = require('path');
const Brevo            = require('@getbrevo/brevo');

// ─── Brevo setup (reused for replies) ────────────────────────────────────────
const apiInstance = new Brevo.TransactionalEmailsApi();
if (process.env.BREVO_API_KEY) {
  apiInstance.setApiKey(
    Brevo.TransactionalEmailsApiApiKeys.apiKey,
    process.env.BREVO_API_KEY.trim()
  );
  console.log('[Gmail] ✅ Brevo initialised for reply sending');
} else {
  console.error('[Gmail] ❌ BREVO_API_KEY missing — email replies will fail');
}

// ─── Ensure upload directory exists ──────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '../../public/uploads/messages');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log('[Gmail] Created uploads dir:', UPLOADS_DIR);
}

const Ticket      = require('../models/Ticket');
const Message     = require('../models/Message');
const Customer    = require('../models/Customer');
const ActivityLog = require('../models/ActivityLog');
const User        = require('../models/User');
const notify      = require('./notificationService');

let ioInstance = null;
let rrIndex    = 0; // round-robin cursor for auto-assign

// ─── Server start time — only poll emails received on/after today ─────────────
const SERVER_START_DATE = new Date();
console.log(`[Gmail] Server start: ${SERVER_START_DATE.toISOString()}`);

// ─── In-memory processed set ──────────────────────────────────────────────────
// Two-layer dedup guard: in-memory (fast, within-run) + DB (across-run).
// We never mark emails as seen in Gmail so the Gmail UI stays intact.
const processedThisRun = new Set();

const setSocketIO = (io) => { ioInstance = io; };

// ─── Round-robin auto-assign ──────────────────────────────────────────────────
const getNextActiveAgent = async () => {
  const agents = await User.find({
    role:   { $in: ['agent', 'admin'] },
    status: 'active'
  })
    .select('_id name email notif_assignment notif_email notif_new_ticket notif_customer_reply notif_browser')
    .sort({ createdAt: 1 });

  if (!agents.length) return null;
  rrIndex      = rrIndex % agents.length;
  const agent  = agents[rrIndex];
  rrIndex      = (rrIndex + 1) % agents.length;
  return agent;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseEmailAddress = (str) => {
  if (!str) return '';
  const m = str.match(/<([^>]+)>/);
  return m ? m[1].trim() : str.trim();
};

const parseSenderName = (str) => {
  if (!str) return 'Unknown';
  const m = str.match(/^([^<]+)</);
  return m ? m[1].trim() : str.split('@')[0];
};

const htmlToPlainText = (html) => {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g,  ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g,   '<').replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g,  "'")
    .replace(/\n{3,}/g, '\n\n').trim();
};

const extractBody = (parsed) => {
  let text = '';
  if (parsed.text && parsed.text.trim()) {
    text = parsed.text.trim();
  } else if (parsed.html) {
    text = htmlToPlainText(parsed.html);
  }
  if (!text) return '(No message body)';

  // Strip quoted reply history — everything after common quote markers
  const quoteMarkers = [
    /^>.*$/m,                                          // > quoted lines
    /^On .+wrote:$/m,                                  // On Thu, Jun 11... wrote:
    /^-{3,}.*original message.*-{3,}$/im,              // --- Original Message ---
    /^From:.*$/m,                                      // From: someone
    /^_{3,}$/m,                                        // ___ separator
    /^Ticket:.*Reply to this email.*$/im,              // our own footer
  ];

  for (const marker of quoteMarkers) {
    const match = text.search(marker);
    if (match > 0) {
      text = text.substring(0, match).trim();
    }
  }

  return text || '(No message body)';
};

const findOrCreateCustomer = async (email, name = 'Unknown') => {
  let c = await Customer.findOne({ email: email.toLowerCase() });
  if (!c) {
    c = new Customer({ name, email: email.toLowerCase(), status: 'active' });
    await c.save();
    console.log(`[Gmail] New customer: ${email}`);
  }
  return c;
};

// ─── Process one email ────────────────────────────────────────────────────────
const handleIncomingEmail = async (emailData) => {
  try {
    const { from, subject, body, messageId, attachments = [], references = [], inReplyTo = '' } = emailData;
    const safeBody  = (body && body.trim()) ? body.trim() : '(No message body)';
    const fromEmail = parseEmailAddress(from);
    const fromName  = parseSenderName(from);

    if (!fromEmail) {
      console.warn('[Gmail] Cannot parse sender, skipping.');
      return null;
    }

    // ── Skip emails sent FROM the support account itself (avoid self-loop) ────
    const supportEmail = (process.env.GMAIL_USER || '').toLowerCase();
    if (fromEmail.toLowerCase() === supportEmail) {
      console.log('[Gmail] Skipping — email is from support account itself:', fromEmail);
      return null;
    }

    // ── DEDUP LAYER 1: in-memory set (fast, catches within-run dupes) ────────
    if (messageId && processedThisRun.has(messageId)) {
      console.log('[Gmail] Already processed this run, skipping:', messageId);
      return null;
    }

    // ── DEDUP LAYER 2: database check (catches across-run dupes) ─────────────
    if (messageId) {
      const existing = await Message.findOne({ gmailMessageId: messageId });
      if (existing) {
        console.log('[Gmail] Already in DB, skipping:', messageId);
        processedThisRun.add(messageId);
        return null;
      }
    }

    // Mark immediately to prevent race conditions
    if (messageId) processedThisRun.add(messageId);

    // ── Thread matching: 3 strategies in order of confidence ─────────────────
    // 1. Subject contains ticket number  e.g. [TM-1042] or TM-1042
    // 2. References / In-Reply-To header matches a gmailMessageId in DB
    // 3. Same customer + open ticket with matching base subject
    let ticket = null;

    const ticketRef = subject.match(/\[?(TM-\d+)\]?/i);
    if (ticketRef) {
      ticket = await Ticket.findOne({ ticketNumber: ticketRef[1].toUpperCase() });
    }

    if (!ticket && (references.length || inReplyTo)) {
      const refIds = Array.isArray(references) ? [...references] : [];
      if (inReplyTo) refIds.push(inReplyTo);
      if (refIds.length) {
        const refMsg = await Message.findOne({ gmailMessageId: { $in: refIds } });
        if (refMsg) {
          ticket = await Ticket.findById(refMsg.ticket);
        }
      }
    }

    if (!ticket) {
      const baseSubject = subject.replace(/^(re|fwd?):\s*/i, '').replace(/\[?TM-\d+\]?\s*/gi, '').trim().toLowerCase();
      if (baseSubject) {
        const customer = await Customer.findOne({ email: fromEmail.toLowerCase() });
        if (customer) {
          const candidate = await Ticket.findOne({
            customer: customer._id,
            status: { $in: ['open', 'in-progress', 'waiting-customer'] }
          }).sort({ createdAt: -1 });
          if (candidate) {
            const tBase = candidate.subject.replace(/\[?TM-\d+\]?\s*/gi, '').trim().toLowerCase();
            if (tBase === baseSubject) ticket = candidate;
          }
        }
      }
    }

    if (ticket) {
      if (['resolved', 'closed', 'waiting-customer'].includes(ticket.status)) {
        ticket.status = 'open';
      }
      ticket.updatedAt = new Date();
      await ticket.save();
      console.log(`[Gmail] Reply on existing ticket ${ticket.ticketNumber}`);
    } else {
      // ── New ticket ──────────────────────────────────────────────────────────
      const customer = await findOrCreateCustomer(fromEmail, fromName);

      ticket = new Ticket({
        subject:       subject.replace(/^(re|fwd?):\s*/i, '').trim() || '(No Subject)',
        description:   safeBody,
        customer:      customer._id,
        channel:       'email',
        gmailMessageId: messageId,
        status:        'open',
        priority:      'medium'
      });
      await ticket.save();

      // ── Auto-assign (round-robin) ─────────────────────────────────────────
      const agent = await getNextActiveAgent();
      if (agent) {
        ticket.assignedAgent = agent._id;
        await ticket.save();

        await ActivityLog.create({
          ticket:      ticket._id,
          user:        null,
          action:      'auto_assigned',
          actionType:  'assign',
          description: `Auto-assigned to ${agent.name}`
        });
        console.log(`[Gmail] Ticket ${ticket.ticketNumber} auto-assigned → ${agent.name}`);

        // Send assignment notification email
        setImmediate(async () => {
          try {
            const [agentFull, ticketFull] = await Promise.all([
              User.findById(agent._id).select('name email notif_email notif_assignment'),
              Ticket.findById(ticket._id)
                .populate('customer',      'name email')
                .populate('assignedAgent', 'name email')
            ]);
            if (agentFull && ticketFull) {
              await notify.sendTicketAssignedEmail(agentFull, ticketFull, 'email_created');
            }
          } catch (e) {
            console.error('[Gmail] Assignment email error:', e.message);
          }
        });

        if (ioInstance) {
          ioInstance.emit('ticket:assigned', {
            ticketId:     ticket._id.toString(),
            agentId:      agent._id.toString(),
            agentName:    agent.name,
            ticketNumber: ticket.ticketNumber
          });
        }
      }

      customer.totalTickets = (customer.totalTickets || 0) + 1;
      await customer.save();

      await ActivityLog.create({
        ticket:      ticket._id,
        user:        null,
        action:      'created_from_email',
        actionType:  'create',
        description: `New ticket from ${fromEmail}`
      });
      console.log(`[Gmail] New ticket: ${ticket.ticketNumber} from ${fromEmail}`);
    }

    // ── Save Message record ───────────────────────────────────────────────────
    const message = new Message({
      ticket:         ticket._id,
      senderType:     'customer',
      body:           safeBody,
      subject,
      fromEmail,
      toEmail:        process.env.GMAIL_USER,
      gmailMessageId: messageId || `imap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      attachments
    });
    await message.save();
    console.log(`[Gmail] Message saved (${message._id}) for ${ticket.ticketNumber}`);

    await ActivityLog.create({
      ticket:      ticket._id,
      user:        null,
      action:      'customer_email',
      actionType:  'comment',
      description: `Email received from ${fromEmail}`
    });

    if (ioInstance) {
      const populated = await Ticket.findById(ticket._id)
        .populate('customer',      'name email')
        .populate('assignedAgent', 'name avatar status');
      ioInstance.emit('ticket:created',  populated);
      ioInstance.emit('message:added',   { ticketId: ticket._id.toString(), message });
    }

    return { ticket, message };
  } catch (err) {
    console.error('[Gmail] handleIncomingEmail error:', err.message, err.stack);
    throw err;
  }
};

// ─── IMAP fetch (INBOX) ───────────────────────────────────────────────────────
// Strategy: search UNSEEN + SINCE server-start-date.
// markSeen: false — Gmail read/unread flag is never touched.
// DB dedup + in-memory set prevent duplicate processing across polls.
const fetchNewEmails = () => new Promise((resolve, reject) => {
  const imap = new Imap({
    user:       process.env.GMAIL_USER,
    password:   process.env.GMAIL_APP_PASSWORD,
    host:       'imap.gmail.com',
    port:       993,
    tls:        true,
    tlsOptions: { rejectUnauthorized: false }
  });

  const rawEmails = [];

  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err) => {
      if (err) { imap.end(); return reject(err); }

      const months   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const d        = SERVER_START_DATE;
      const sinceStr = `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;

      imap.search(['UNSEEN', ['SINCE', sinceStr]], (err, uids) => {
        if (err) { imap.end(); return reject(err); }
        if (!uids || !uids.length) {
          console.log('[Gmail] No new unread emails since server start.');
          imap.end();
          return resolve([]);
        }
        console.log(`[Gmail] Found ${uids.length} unread email(s) — checking for new ones…`);

        const fetch = imap.fetch(uids, { bodies: '', markSeen: false }); // never marks read

        fetch.on('message', (msg) => {
          let raw = '';
          msg.on('body', (stream) => { stream.on('data', c => { raw += c.toString('utf8'); }); });
          msg.once('end', () => { rawEmails.push(raw); });
        });
        fetch.once('error', e => console.error('[Gmail] Fetch error:', e.message));
        fetch.once('end',   () => { imap.end(); });
      });
    });
  });

  imap.once('end', async () => {
    const results = [];
    for (const raw of rawEmails) {
      try {
        const parsed = await simpleParser(raw);

        // ── Save inbound attachments to disk ──────────────────────────────────
        const savedAttachments = [];
        for (const att of (parsed.attachments || [])) {
          if (!att.content || !att.filename) continue;
          try {
            const timestamp = Date.now();
            const random    = Math.random().toString(36).substring(2, 8);
            const ext       = path.extname(att.filename) || '';
            const safeName  = path.basename(att.filename, ext)
              .replace(/[^a-zA-Z0-9_-]/g, '_')
              .substring(0, 60);
            const diskName  = `${timestamp}-${random}-${safeName}${ext}`;
            const diskPath  = path.join(UPLOADS_DIR, diskName);
            fs.writeFileSync(diskPath, att.content);
            savedAttachments.push({
              url:          `/uploads/messages/${diskName}`,
              originalName: att.filename,
              mimeType:     att.contentType || 'application/octet-stream',
              size:         att.size || att.content.length
            });
            console.log(`[Gmail] Saved attachment: ${diskName} (${att.filename})`);
          } catch (attErr) {
            console.error('[Gmail] Failed to save attachment:', att.filename, attErr.message);
          }
        }

        // Parse References header into array of message-ids
        const referencesRaw = parsed.headers?.get('references') || '';
        const references = referencesRaw
          ? referencesRaw.split(/\s+/).map(s => s.trim()).filter(Boolean)
          : [];
        const inReplyTo = parsed.inReplyTo || '';

        results.push({
          from:        parsed.from?.text || '',
          subject:     parsed.subject || '(No Subject)',
          body:        extractBody(parsed),
          messageId:   parsed.messageId,
          attachments: savedAttachments,
          references,
          inReplyTo
        });
      } catch (e) {
        console.error('[Gmail] Parse error:', e.message);
      }
    }
    resolve(results);
  });

  imap.once('error', (err) => {
    console.error('[Gmail] IMAP error:', err.message);
    reject(err);
  });

  imap.connect();
});

// ─── IMAP fetch (Sent Mail) ───────────────────────────────────────────────────
// Fetches recent emails FROM the support address in [Gmail]/Sent Mail.
// This captures replies sent directly from the Gmail UI (not through the dashboard).
// These are stored as agent messages on the matching ticket.
const fetchSentEmails = () => new Promise((resolve, reject) => {
  const imap = new Imap({
    user:       process.env.GMAIL_USER,
    password:   process.env.GMAIL_APP_PASSWORD,
    host:       'imap.gmail.com',
    port:       993,
    tls:        true,
    tlsOptions: { rejectUnauthorized: false }
  });

  const rawEmails = [];

  imap.once('ready', () => {
    // Gmail's sent folder is [Gmail]/Sent Mail
    imap.openBox('[Gmail]/Sent Mail', true, (err) => {
      if (err) {
        console.log('[Gmail] Could not open Sent Mail folder (may not exist):', err.message);
        imap.end();
        return resolve([]);
      }

      const months   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const d        = SERVER_START_DATE;
      const sinceStr = `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;

      imap.search([['SINCE', sinceStr]], (err, uids) => {
        if (err) { imap.end(); return resolve([]); }
        if (!uids || !uids.length) {
          imap.end();
          return resolve([]);
        }
        console.log(`[Gmail] Found ${uids.length} sent email(s) since server start…`);

        const fetch = imap.fetch(uids, { bodies: '', markSeen: false });

        fetch.on('message', (msg) => {
          let raw = '';
          msg.on('body', (stream) => { stream.on('data', c => { raw += c.toString('utf8'); }); });
          msg.once('end', () => { rawEmails.push(raw); });
        });
        fetch.once('error', e => console.error('[Gmail] Sent fetch error:', e.message));
        fetch.once('end',   () => { imap.end(); });
      });
    });
  });

  imap.once('end', async () => {
    const results = [];
    for (const raw of rawEmails) {
      try {
        const parsed = await simpleParser(raw);
        const fromEmail = parseEmailAddress(parsed.from?.text || '');
        const supportEmail = (process.env.GMAIL_USER || '').toLowerCase();

        // Only include emails actually sent FROM the support account
        if (fromEmail.toLowerCase() !== supportEmail) continue;

        const referencesRaw = parsed.headers?.get('references') || '';
        const references = referencesRaw
          ? referencesRaw.split(/\s+/).map(s => s.trim()).filter(Boolean)
          : [];
        const inReplyTo = parsed.inReplyTo || '';

        results.push({
          from:        parsed.from?.text || '',
          to:          parsed.to?.text || '',
          subject:     parsed.subject || '(No Subject)',
          body:        extractBody(parsed),
          messageId:   parsed.messageId,
          attachments: [],
          references,
          inReplyTo,
          isSentBySupport: true
        });
      } catch (e) {
        console.error('[Gmail] Sent parse error:', e.message);
      }
    }
    resolve(results);
  });

  imap.once('error', (err) => {
    console.error('[Gmail] Sent IMAP error:', err.message);
    resolve([]); // Non-fatal — don't crash the whole poll
  });

  imap.connect();
});

// ─── Process one sent email (agent reply via Gmail UI) ────────────────────────
const handleSentEmail = async (emailData) => {
  try {
    const { subject, body, messageId, to, references = [], inReplyTo = '' } = emailData;
    if (!messageId) return null;

    // Dedup
    if (processedThisRun.has('sent:' + messageId)) return null;
    const existing = await Message.findOne({ gmailMessageId: messageId });
    if (existing) { processedThisRun.add('sent:' + messageId); return null; }
    processedThisRun.add('sent:' + messageId);

    // Find the ticket this sent email belongs to
    let ticket = null;

    // 1. Subject has ticket number
    const ticketRef = subject.match(/\[?(TM-\d+)\]?/i);
    if (ticketRef) {
      ticket = await Ticket.findOne({ ticketNumber: ticketRef[1].toUpperCase() });
    }

    // 2. References / In-Reply-To
    if (!ticket && (references.length || inReplyTo)) {
      const refIds = Array.isArray(references) ? [...references] : [];
      if (inReplyTo) refIds.push(inReplyTo);
      if (refIds.length) {
        const refMsg = await Message.findOne({ gmailMessageId: { $in: refIds } });
        if (refMsg) ticket = await Ticket.findById(refMsg.ticket);
      }
    }

    // 3. Match by recipient email (find customer → open ticket)
    if (!ticket && to) {
      const toEmail = parseEmailAddress(to).toLowerCase();
      const customer = await Customer.findOne({ email: toEmail });
      if (customer) {
        ticket = await Ticket.findOne({
          customer: customer._id,
          status: { $in: ['open', 'in-progress', 'waiting-customer'] }
        }).sort({ updatedAt: -1 });
      }
    }

    if (!ticket) {
      console.log('[Gmail] Sent email could not be matched to a ticket, skipping:', subject);
      return null;
    }

    const safeBody = (body && body.trim()) ? body.trim() : '(No message body)';
    const message = new Message({
      ticket:         ticket._id,
      senderType:     'agent',
      body:           safeBody,
      subject,
      toEmail:        parseEmailAddress(to),
      fromEmail:      process.env.GMAIL_USER,
      gmailMessageId: messageId
    });
    await message.save();

    ticket.updatedAt = new Date();
    if (!ticket.firstResponseTime) ticket.firstResponseTime = new Date();
    await ticket.save();

    await ActivityLog.create({
      ticket:      ticket._id,
      user:        null,
      action:      'email_reply_sent',
      actionType:  'comment',
      description: `Email reply sent via Gmail (direct) to ${parseEmailAddress(to)}`
    });

    if (ioInstance) {
      const pop = await Message.findById(message._id).populate('sender', 'name avatar');
      ioInstance.emit('message:added', { ticketId: ticket._id.toString(), message: pop });
    }

    console.log(`[Gmail] ✅ Stored direct-Gmail reply in ticket ${ticket.ticketNumber}`);
    return { ticket, message };
  } catch (err) {
    console.error('[Gmail] handleSentEmail error:', err.message);
    return null;
  }
};

const pollGmailForNewEmails = async () => {
  try {
    // Poll INBOX for customer emails
    const emails = await fetchNewEmails();
    let processed = 0;
    for (const email of emails) {
      const result = await handleIncomingEmail(email);
      if (result) processed++;
    }
    if (processed > 0) console.log(`[Gmail] Created/updated ${processed} ticket(s) from inbox.`);

    // Poll Sent Mail for direct agent replies from Gmail UI
    const sentEmails = await fetchSentEmails();
    let sentProcessed = 0;
    for (const email of sentEmails) {
      const result = await handleSentEmail(email);
      if (result) sentProcessed++;
    }
    if (sentProcessed > 0) console.log(`[Gmail] Stored ${sentProcessed} direct Gmail reply/replies in tickets.`);
  } catch (err) {
    console.error('[Gmail] Poll error:', err.message);
  }
};

// ─── Send reply via Brevo ─────────────────────────────────────────────────────
const sendEmailReply = async (
  ticketId,
  body,
  attachments = [],
  agentUserId = null,
  ccEmails    = [],
  bccEmails   = []
) => {
  const ticket = await Ticket.findById(ticketId).populate('customer');
  if (!ticket || !ticket.customer) throw new Error('Ticket or customer not found');

  const subject  = `RE: [${ticket.ticketNumber}] ${ticket.subject}`;
  const toEmail  = ticket.customer.email;
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#333;line-height:1.6;">
      <p>${body.replace(/\n/g, '<br>')}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
      <p style="color:#888;font-size:12px;">
        Ticket: <strong>${ticket.ticketNumber}</strong><br>
        Reply to this email to continue the conversation.
      </p>
    </div>`;

  // ── Build Brevo message ───────────────────────────────────────────────────
  const msg       = new Brevo.SendSmtpEmail();
  msg.sender      = {
    name:  process.env.BREVO_SENDER_NAME || 'TradeMAV Support',
    email: process.env.BREVO_SENDER_EMAIL
  };
  msg.to          = [{ email: toEmail }];
  msg.subject     = subject;
  msg.htmlContent = htmlBody;
  msg.textContent = body;
 msg.replyTo = { email: process.env.GMAIL_USER };

  if (ccEmails  && ccEmails.length)  msg.cc  = ccEmails.map(e  => ({ email: e }));
  if (bccEmails && bccEmails.length) msg.bcc = bccEmails.map(e => ({ email: e }));

  // ── Attachments: read from disk, encode as base64 for Brevo ──────────────
  if (attachments && attachments.length > 0) {
    msg.attachment = attachments
      .map(att => {
        const url      = typeof att === 'string' ? att : att.url;
        const name     = typeof att === 'object'
          ? (att.originalName || path.basename(url))
          : path.basename(url);
        if (!url) return null;

        const filePath = path.join(__dirname, '../../public', url);
        if (!fs.existsSync(filePath)) {
          console.warn('[Gmail] Attachment not found on disk, skipping:', filePath);
          return null;
        }
        return {
          name,
          content: fs.readFileSync(filePath).toString('base64')
        };
      })
      .filter(Boolean);
  }

  // ── Send via Brevo ────────────────────────────────────────────────────────
  let brevoMessageId;
  try {
    const result   = await apiInstance.sendTransacEmail(msg);
    brevoMessageId = result.messageId;
    console.log(`[Gmail] ✅ Reply sent via Brevo → ${toEmail} (msgId: ${brevoMessageId}, attachments: ${attachments.length})`);
  } catch (err) {
    console.error('[Gmail] ❌ Brevo reply failed:', err.message);
    if (err.response) console.error('[Gmail]    API response:', err.response.body || err.response);
    throw err;
  }

  // ── Normalise attachments for DB storage ──────────────────────────────────
  const normalizedAttachments = (attachments || []).map(att => {
    if (typeof att === 'string') {
      return { url: att, originalName: path.basename(att), mimeType: '', size: 0 };
    }
    return att;
  });

  // ── Persist Message record ────────────────────────────────────────────────
  const message = new Message({
    ticket:         ticketId,
    sender:         agentUserId,
    senderType:     'agent',
    body,
    attachments:    normalizedAttachments,
    subject,
    toEmail,
    ccEmail:        ccEmails,
    bccEmail:       bccEmails,
    gmailMessageId: brevoMessageId
  });
  await message.save();

  ticket.updatedAt = new Date();
  if (!ticket.firstResponseTime) ticket.firstResponseTime = new Date();
  await ticket.save();

  await ActivityLog.create({
    ticket:      ticketId,
    user:        agentUserId,
    action:      'email_reply_sent',
    actionType:  'comment',
    description: `Email reply sent to ${toEmail} via Brevo`
  });

  if (ioInstance) {
    const pop = await Message.findById(message._id).populate('sender', 'name avatar');
    ioInstance.emit('message:added', { ticketId: ticketId.toString(), message: pop });
  }

  return { success: true, messageId: brevoMessageId, message };
};

// ─── Start polling service ────────────────────────────────────────────────────
const startPollingService = (io) => {
  if (io) setSocketIO(io);
  const ms = parseInt(process.env.GMAIL_POLLING_INTERVAL, 10) || 30000;
  console.log(`[Gmail] Polling every ${ms / 1000}s — emails stay UNREAD in Gmail`);
  pollGmailForNewEmails();
  return setInterval(pollGmailForNewEmails, ms);
};

// ─── initializeTransporter kept as no-op for any legacy callers ──────────────
const initializeTransporter = () => {
  console.log('[Gmail] initializeTransporter: nodemailer removed — Brevo is used for all outbound mail.');
};

module.exports = {
  setSocketIO,
  initializeTransporter,
  sendEmailReply,
  handleIncomingEmail,
  startPollingService,
  parseEmailAddress,
  findOrCreateCustomer
};