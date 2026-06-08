/**
 * notificationService.js  –  TradeMAV Support Desk
 * Single source of truth for ALL outgoing notification emails.
 * Uses Brevo Transactional Email API (replaces nodemailer + Gmail SMTP).
 *
 * Required .env variables:
 *   BREVO_API_KEY                – your Brevo API key (xkeysib-…)
 *   BREVO_SENDER_EMAIL           – verified sender for transactional mail (e.g. noreply@trademav.online)
 *   BREVO_SENDER_EMAIL_NOTIFICATION – verified sender for alert/notification mail
 *   BREVO_SENDER_NAME            – display name for transactional (default: "TradeMAV")
 *   BREVO_SENDER_NAME_ALERT      – display name for alerts     (default: "TradeMAV Alerts")
 *   APP_URL                      – public URL of the app (e.g. https://trademav.online)
 */

require('dotenv').config();

// ─── Brevo SDK setup ──────────────────────────────────────────────────────────
const Brevo = require('@getbrevo/brevo');
const apiInstance = new Brevo.TransactionalEmailsApi();

// ─── Config helpers ───────────────────────────────────────────────────────────
const APP_URL = () => process.env.APP_URL || 'http://localhost:5000';

const validateConfig = () => {
  const missing = [];
  if (!process.env.BREVO_API_KEY)                    missing.push('BREVO_API_KEY');
  if (!process.env.BREVO_SENDER_EMAIL)               missing.push('BREVO_SENDER_EMAIL');
  if (!process.env.BREVO_SENDER_EMAIL_NOTIFICATION)  missing.push('BREVO_SENDER_EMAIL_NOTIFICATION');
  if (missing.length) {
    console.error('[Notify] ❌ Missing Brevo env vars:', missing.join(', '));
    return false;
  }
  return true;
};

// Initialise once on module load
let _brevoReady = false;
(() => {
  if (!validateConfig()) return;
  try {
    const key = process.env.BREVO_API_KEY.trim();
    apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, key);
    _brevoReady = true;
    console.log('[Notify] ✅ Brevo initialised —', key.substring(0, 20) + '…');
    console.log('[Notify]    Transactional sender :', process.env.BREVO_SENDER_EMAIL);
    console.log('[Notify]    Notification sender  :', process.env.BREVO_SENDER_EMAIL_NOTIFICATION);
  } catch (e) {
    console.error('[Notify] ❌ Brevo init error:', e.message);
  }
})();

// ─── Core send function ───────────────────────────────────────────────────────
/**
 * @param {'transactional'|'notification'} senderType
 * @param {string} to
 * @param {string} subject
 * @param {string} html
 * @param {string} [text]  – optional plain-text fallback
 */
async function sendMail(senderType, to, subject, html, text) {
  if (!_brevoReady) {
    console.warn(`[Notify] ⚠️ Brevo not configured — skipping: "${subject}"`);
    return false;
  }
  try {
    const isNotif = senderType === 'notification';
    const msg = new Brevo.SendSmtpEmail();

    msg.sender = {
      name : isNotif
        ? (process.env.BREVO_SENDER_NAME_ALERT || 'TradeMAV Alerts')
        : (process.env.BREVO_SENDER_NAME        || 'TradeMAV'),
      email: isNotif
        ? process.env.BREVO_SENDER_EMAIL_NOTIFICATION
        : process.env.BREVO_SENDER_EMAIL
    };
    msg.to          = [{ email: to }];
    msg.subject     = subject;
    msg.htmlContent = html;
    if (text) msg.textContent = text;

    const result = await apiInstance.sendTransacEmail(msg);
    console.log(`[Notify] ✅ "${subject}" → ${to} (msgId: ${result.messageId})`);
    return true;
  } catch (err) {
    console.error(`[Notify] ❌ FAILED "${subject}" → ${to}`);
    console.error(`[Notify]    ${err.message}`);
    if (err.response) console.error('[Notify]    API response:', err.response.body || err.response);
    return false;
  }
}

// ─── Shared HTML components ───────────────────────────────────────────────────
const wrap = (body) =>
  `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:32px 16px;">
    <table width="600" cellpadding="0" cellspacing="0"
      style="background:#fff;border-radius:14px;overflow:hidden;
             box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:600px;width:100%;">
      <tr><td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:26px 36px;text-align:center;">
        <div style="font-size:24px;margin-bottom:5px;">🎯</div>
        <h1 style="color:#fff;margin:0;font-size:19px;font-weight:700;">TradeMAV</h1>
        <p style="color:rgba(255,255,255,.65);margin:3px 0 0;font-size:12px;">Support Desk</p>
      </td></tr>
      <tr><td style="padding:30px 36px;">${body}</td></tr>
      <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:14px 36px;text-align:center;">
        <p style="margin:0;font-size:11px;color:#9ca3af;">
          © TradeMAV Support Desk — Automated notification
        </p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;

const btn = (url, label) =>
  `<div style="text-align:center;margin-top:20px;">
     <a href="${url}"
        style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);
               color:#fff;text-decoration:none;padding:12px 30px;border-radius:8px;
               font-size:14px;font-weight:700;">${label}</a>
   </div>`;

const infoBox = (rows) =>
  `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;
               padding:16px 20px;margin:16px 0;">
     <table width="100%" cellpadding="0" cellspacing="0">
       ${rows.map(([k, v]) => `
         <tr>
           <td style="padding:5px 0;font-size:13px;color:#6b7280;
                      width:130px;vertical-align:top;">${k}</td>
           <td style="padding:5px 0;font-size:13px;color:#111827;
                      font-weight:600;">${v}</td>
         </tr>`).join('')}
     </table>
   </div>`;

const priorityColors = { low: '#6366f1', medium: '#f59e0b', high: '#ef4444', urgent: '#dc2626' };
const pBadge = (p) => {
  const c = priorityColors[p] || '#6366f1';
  return `<span style="background:${c}22;color:${c};font-size:11px;font-weight:700;
    padding:2px 8px;border-radius:20px;text-transform:uppercase;">${p}</span>`;
};

// ══════════════════════════════════════════════════════════════════════════════
// TICKET ASSIGNMENT
// Sent for every assignment type: manual, auto-assign, email-triggered.
// Respects agent notification preferences.
// ══════════════════════════════════════════════════════════════════════════════
async function sendTicketAssignedEmail(agent, ticket, assignmentType = 'assigned') {
  if (!agent?.email) {
    console.warn('[Notify] ⚠️ Agent has no email — cannot send assignment notification');
    return false;
  }
  if (!ticket?.ticketNumber) {
    console.warn('[Notify] ⚠️ Ticket data incomplete — cannot send assignment notification');
    return false;
  }
  if (agent.notif_email === false) {
    console.log(`[Notify] ⏭️ Email notifications disabled for ${agent.email}`);
    return false;
  }
  if (agent.notif_assignment === false) {
    console.log(`[Notify] ⏭️ Assignment notifications disabled for ${agent.email}`);
    return false;
  }

  const custName  = ticket.customer?.name  || 'Unknown';
  const custEmail = ticket.customer?.email || '';
  const desc      = String(ticket.description || '').substring(0, 300);

  const typeLabels = {
    auto_assigned: '🤖 Auto-Assigned (Round-Robin)',
    assigned:      '👤 Manually Assigned',
    email_created: '📧 Email Ticket — Auto-Assigned'
  };
  const typeLabel = typeLabels[assignmentType] || '🎫 Assigned';

  return sendMail(
    'notification',
    agent.email,
    `[TradeMAV] Ticket Assigned to You: ${ticket.ticketNumber} — ${ticket.subject}`,
    wrap(`
      <h2 style="margin:0 0 6px;font-size:19px;color:#111827;">🎫 Ticket Assigned to You</h2>
      <p style="margin:0 0 18px;font-size:13px;color:#6b7280;">${typeLabel}</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;">
        Hi <strong>${agent.name}</strong>, a support ticket has been assigned to you.
        Please review it and respond to the customer promptly.
      </p>
      ${infoBox([
        ['Ticket ID',  `<span style="font-family:monospace;font-size:13px;">${ticket.ticketNumber}</span>`],
        ['Subject',    ticket.subject],
        ['Priority',   pBadge(ticket.priority)],
        ['Status',     ticket.status],
        ['Customer',   custName + (custEmail ? ` &lt;${custEmail}&gt;` : '')],
        ...(desc ? [['Message', desc + (ticket.description?.length > 300 ? '…' : '')]] : [])
      ])}
      ${btn(`${APP_URL()}/tickets.html`, 'Open Ticket in Dashboard →')}`)
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// REGISTRATION / APPROVAL
// ══════════════════════════════════════════════════════════════════════════════
async function sendRegistrationPendingEmail(user) {
  return sendMail(
    'transactional',
    user.email,
    '[TradeMAV] Registration received — pending admin approval',
    wrap(`
      <h2 style="margin:0 0 12px;font-size:19px;color:#111827;">Registration Received ✅</h2>
      <p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
        Hi <strong>${user.name}</strong>, your registration for TradeMAV Support Desk
        has been received and is <strong>pending admin approval</strong>.
      </p>
      <p style="font-size:14px;color:#374151;margin:0 0 20px;line-height:1.6;">
        You will receive another email once an administrator reviews your request.
        This usually takes a short time.
      </p>
      <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;
        padding:12px 16px;font-size:13px;color:#92400e;">
        ⏳ Please do not try to log in yet — you will be notified when your account is activated.
      </div>`)
  );
}

async function notifyAdminsNewRegistration(admins, newUser) {
  for (const admin of admins) {
    await sendMail(
      'notification',
      admin.email,
      `[TradeMAV] New registration pending approval: ${newUser.name}`,
      wrap(`
        <h2 style="margin:0 0 12px;font-size:19px;color:#111827;">New Registration Pending 👤</h2>
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">
          Hi <strong>${admin.name}</strong>, a new user has registered and is awaiting your approval.
        </p>
        ${infoBox([
          ['Name',  newUser.name],
          ['Email', newUser.email],
          ['Role',  newUser.role]
        ])}
        ${btn(`${APP_URL()}/dashboard.html`, 'Review in Dashboard →')}`)
    );
  }
}

async function sendApprovalEmail(user, action) {
  const ok = action === 'approved';
  return sendMail(
    'transactional',
    user.email,
    ok ? '✅ TradeMAV account approved — you can now log in'
       : '❌ TradeMAV registration not approved',
    wrap(ok
      ? `<h2 style="margin:0 0 12px;font-size:19px;color:#111827;">Account Approved! 🎉</h2>
         <p style="font-size:14px;color:#374151;margin:0 0 20px;line-height:1.6;">
           Hi <strong>${user.name}</strong>, your TradeMAV Support Desk account has been approved.
           You can now log in and start working on tickets.
         </p>
         ${btn(`${APP_URL()}/login.html`, 'Sign In Now →')}`
      : `<h2 style="margin:0 0 12px;font-size:19px;color:#111827;">Registration Not Approved</h2>
         <p style="font-size:14px;color:#374151;line-height:1.6;">
           Hi <strong>${user.name}</strong>, unfortunately your TradeMAV registration
           was not approved. Please contact your administrator for more information.
         </p>`)
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PASSWORD RESET
// ══════════════════════════════════════════════════════════════════════════════
async function sendPasswordResetPendingEmail(user) {
  return sendMail(
    'transactional',
    user.email,
    '[TradeMAV] Password reset request — pending admin approval',
    wrap(`
      <h2 style="margin:0 0 12px;font-size:19px;color:#111827;">Password Reset Requested 🔐</h2>
      <p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
        Hi <strong>${user.name}</strong>, your password reset request has been submitted
        and is <strong>pending admin approval</strong>.
      </p>
      <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;
        padding:12px 16px;font-size:13px;color:#92400e;margin-bottom:16px;">
        ⏳ An administrator will review your request shortly.
        You will receive an email once it is approved or rejected.
      </div>
      <p style="font-size:13px;color:#6b7280;margin:0;">
        If you did not request a password reset, please ignore this email and
        contact your administrator immediately.
      </p>`)
  );
}

async function notifyAdminsPasswordReset(admins, user) {
  for (const admin of admins) {
    await sendMail(
      'notification',
      admin.email,
      `[TradeMAV] Password reset approval needed: ${user.name}`,
      wrap(`
        <h2 style="margin:0 0 12px;font-size:19px;color:#111827;">Password Reset Approval Needed 🔐</h2>
        <p style="font-size:14px;color:#374151;margin:0 0 16px;">
          Hi <strong>${admin.name}</strong>, a user has requested a password reset and needs your approval.
        </p>
        ${infoBox([
          ['Name',      user.name],
          ['Email',     user.email],
          ['Role',      user.role],
          ['Requested', new Date().toLocaleString()]
        ])}
        ${btn(`${APP_URL()}/dashboard.html`, 'Review in Dashboard →')}`)
    );
  }
}

async function sendPasswordResetApprovedEmail(user) {
  return sendMail(
    'transactional',
    user.email,
    '✅ TradeMAV — password reset approved',
    wrap(`
      <h2 style="margin:0 0 12px;font-size:19px;color:#111827;">Password Reset Approved ✅</h2>
      <p style="font-size:14px;color:#374151;margin:0 0 16px;line-height:1.6;">
        Hi <strong>${user.name}</strong>, your password has been reset successfully.
        You can now log in with your new password.
      </p>
      ${btn(`${APP_URL()}/login.html`, 'Sign In Now →')}`)
  );
}

async function sendPasswordResetRejectedEmail(user) {
  return sendMail(
    'transactional',
    user.email,
    '❌ TradeMAV — password reset not approved',
    wrap(`
      <h2 style="margin:0 0 12px;font-size:19px;color:#111827;">Password Reset Not Approved</h2>
      <p style="font-size:14px;color:#374151;line-height:1.6;">
        Hi <strong>${user.name}</strong>, your password reset request was not approved by
        an administrator. Your current password remains unchanged.
      </p>
      <p style="font-size:14px;color:#374151;margin-top:12px;">
        If you believe this is a mistake, please contact your administrator directly.
      </p>`)
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE CHANGES
// ══════════════════════════════════════════════════════════════════════════════
async function sendProfileChangeEmail(user, action) {
  const ok = action === 'approved';
  return sendMail(
    'transactional',
    user.email,
    ok ? '✅ TradeMAV — profile changes approved' : '❌ TradeMAV — profile changes not approved',
    wrap(`
      <h2 style="margin:0 0 12px;font-size:19px;color:#111827;">
        Profile Changes ${ok ? 'Approved ✅' : 'Rejected ❌'}
      </h2>
      <p style="font-size:14px;color:#374151;line-height:1.6;">
        Hi <strong>${user.name}</strong>, your requested profile changes have been
        <strong>${ok ? 'approved and applied' : 'rejected'}</strong> by an administrator.
      </p>
      ${ok ? btn(`${APP_URL()}/dashboard.html`, 'Go to Dashboard →') : ''}`)
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  sendTicketAssignedEmail,
  sendRegistrationPendingEmail,
  notifyAdminsNewRegistration,
  sendApprovalEmail,
  sendPasswordResetPendingEmail,
  notifyAdminsPasswordReset,
  sendPasswordResetApprovedEmail,
  sendPasswordResetRejectedEmail,
  sendProfileChangeEmail
};