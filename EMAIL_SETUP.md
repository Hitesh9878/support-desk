# 📧 Email-to-Ticket Integration — Setup Guide

## How It Works

```
Customer sends email
      ↓
Gmail Inbox (your support email)
      ↓  [IMAP polling every 30s]
gmailService.js reads unread emails
      ↓
Ticket auto-created in MongoDB
      ↓
Dashboard shows ticket in real-time (Socket.IO)
      ↓
Agent opens ticket, types reply, clicks "Send Reply"
      ↓
Reply sent via Gmail (Nodemailer) → Customer inbox
      ↓
Customer replies → Subject includes [TM-XXXX] → appended to same ticket
```

---

## Step 1 — Gmail App Password

Gmail blocks direct password login. You need an **App Password**:

1. Go to your Google Account → **Security**
2. Enable **2-Step Verification** (required)
3. Go to **App Passwords** (search "App Passwords" in Google Account)
4. Select app: **Mail** → device: **Other (custom)** → name it "SupportDesk"
5. Copy the 16-character password shown (e.g. `abcd efgh ijkl mnop`)

> ⚠️ Use a **dedicated Gmail account** for support (e.g. `support@yourcompany.com`).
> Do NOT use your personal Gmail.

---

## Step 2 — Configure .env

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/supportdesk
JWT_SECRET=change_this_to_a_random_string_in_production

GMAIL_USER=support@yourcompany.com
GMAIL_APP_PASSWORD=abcd efgh ijkl mnop   # paste App Password here

# Poll every 30 seconds (30000 ms). Minimum recommended: 10000
GMAIL_POLLING_INTERVAL=30000

CORS_ORIGIN=http://localhost:3000
NODE_ENV=development
```

---

## Step 3 — Install dependencies & run

```bash
cd server
npm install          # installs imap, mailparser, nodemailer, etc.
npm run dev          # starts with nodemon (auto-restart)
```

You should see:
```
[Server] Running on port 5000
[Gmail] Polling service started — every 30s
[Gmail] No new emails found.   ← (or processes any unread ones)
```

---

## Step 4 — Test it

### Option A — Send a real email
Send an email to your `GMAIL_USER` address from any email account.
Wait up to 30 seconds. The ticket should appear in the dashboard.

### Option B — Use the test endpoint (no email needed)
```bash
curl -X POST http://localhost:5000/api/gmail/test-incoming \
  -H "Content-Type: application/json" \
  -d '{
    "from": "John Doe <johndoe@example.com>",
    "subject": "My order is missing",
    "body": "Hi, I placed order #12345 last week and it has not arrived yet."
  }'
```

Response:
```json
{
  "message": "Test email processed",
  "ticket": { "ticketNumber": "TM-1001", "subject": "My order is missing", ... }
}
```

Open the dashboard → Tickets page. The new ticket appears instantly.

---

## Step 5 — Agent Reply Flow

1. Open any ticket by clicking **View**
2. The conversation thread shows all customer emails and agent replies
3. Type your reply in the text area
4. Click **📧 Send Reply** — this:
   - Sends an actual email to the customer via Gmail
   - Saves the message in the database
   - Shows the message instantly in the conversation (Socket.IO)
5. The customer's reply email will have `[TM-XXXX]` in the subject, so follow-up emails are automatically appended to the same ticket

---

## Ticket Lifecycle via Email

| Customer action | What happens |
|---|---|
| Sends a new email | New ticket created (status: open) |
| Replies to agent's email | Message appended to existing ticket |
| Replies to a closed/resolved ticket | Ticket reopened automatically |

---

## Architecture Changes Made

### Backend
| File | Change |
|---|---|
| `server/services/gmailService.js` | Full rewrite — real IMAP polling with `imap` + `mailparser`, deduplication, auto customer creation, Socket.IO broadcast |
| `server/server.js` | Passes `io` instance to gmail service for real-time events |
| `server/routes/gmail.js` | Added `/test-incoming` dev route, passes `agentUserId` to sendEmailReply |
| `server/package.json` | Added `imap` and `mailparser` dependencies |
| `server/.env.example` | Simplified and documented |

### Frontend
| File | Change |
|---|---|
| `public/js/tickets.js` | Socket.IO real-time updates, email reply via `gmailAPI`, toast notifications, channel icons, XSS-safe rendering |
| `public/js/api.js` | Added `gmailAPI` object |
| `public/tickets.html` | Socket.IO script tag, customer info panel, channel badge, improved reply composer |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `Invalid login` error | Make sure 2FA is on and you used the App Password, not your real password |
| `ECONNREFUSED` on IMAP | Check firewall; port 993 must be open outbound |
| Emails not detected | Check spam folder; ensure emails arrive in INBOX |
| Duplicate tickets | Already handled — `gmailMessageId` deduplication prevents this |
| Reply not delivered | Check `GMAIL_USER` in .env; check Gmail "Sent" folder |

