# Gmail Integration Setup Guide

## Overview
SupportDesk Pro includes Gmail integration to automatically convert incoming emails into support tickets and send replies to customers.

## Prerequisites
- A Gmail account (personal or workspace)
- Google Account access for generating App Passwords

## Setup Instructions

### Step 1: Enable 2-Factor Authentication
1. Go to [myaccount.google.com](https://myaccount.google.com)
2. Click on "Security" in the left sidebar
3. Under "How you sign in to Google", enable "2-Step Verification"
4. Follow the prompts to complete setup

### Step 2: Generate Gmail App Password
1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Select "Mail" and "Windows Computer" (or your setup)
3. Click "Generate"
4. Google will show a 16-character password
5. Copy this password (you'll use it for GMAIL_APP_PASSWORD)

### Step 3: Configure Environment Variables

Create a `.env` file in the `server/` directory with:

```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/supportdesk
JWT_SECRET=your_super_secret_key_here
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
GMAIL_POLLING_INTERVAL=30000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
```

**Important:** Never commit your `.env` file to version control!

### Step 4: Enable IMAP/POP (Optional)
If using Gmail API polling:
1. Go to [mail.google.com/mail/u/0/#settings/fwdandpop](https://mail.google.com/mail/u/0/#settings/fwdandpop)
2. Enable "IMAP" under "IMAP access"
3. Save changes

## Features

### Automatic Email-to-Ticket Conversion
- Incoming emails to your Gmail account automatically create new tickets
- Existing ticket replies are automatically linked by ticket number (TM-XXXX format)
- Customer information is automatically extracted and saved

### Sending Email Replies
- Agents can reply to tickets via email
- Replies are sent using your Gmail account
- CC and BCC recipients can be added

### Email Webhooks (Alternative)
If you prefer not to use polling, you can set up email webhooks:

1. Configure your email provider to send webhooks to:
   ```
   http://your-server.com/api/gmail/webhook/incoming
   ```

2. POST Body Format:
   ```json
   {
     "from": "customer@email.com",
     "subject": "[TM-1001] Need help with billing",
     "body": "Can you help me with my invoice?",
     "messageId": "unique-message-id",
     "attachments": ["file1.pdf"]
   }
   ```

## API Endpoints

### Send Email Reply
```
POST /api/gmail/send-reply/:ticketId
Authorization: Bearer {token}
Content-Type: application/json

{
  "body": "Thank you for your inquiry...",
  "ccEmails": ["cc@example.com"],
  "bccEmails": ["bcc@example.com"]
}
```

### Receive Incoming Email (Webhook)
```
POST /api/gmail/webhook/incoming
Content-Type: application/json

{
  "from": "customer@email.com",
  "subject": "[TM-1001] Support Request",
  "body": "Email content here...",
  "messageId": "gmail-message-id",
  "attachments": []
}
```

### Get Ticket Email History
```
GET /api/gmail/:ticketId/emails
Authorization: Bearer {token}
```

## Ticket Number Format

Emails are linked to tickets using the format: `[TM-XXXX]` or `TM-XXXX`

Examples:
- Subject: `[TM-1001] Need help with billing` → Links to TM-1001
- Subject: `RE: TM-1001 - Invoice issue` → Links to TM-1001
- Subject: `Question about product` → Creates new ticket

## Troubleshooting

### "Gmail service is not initialized"
- Check that GMAIL_USER and GMAIL_APP_PASSWORD are set in `.env`
- Verify 2-Factor Authentication is enabled
- Ensure the app password was generated correctly

### Emails not being received
- Check GMAIL_POLLING_INTERVAL (default 30 seconds)
- Verify IMAP is enabled in Gmail settings
- Check server logs for polling errors
- Ensure inbox has incoming emails

### Email sending fails
- Verify GMAIL_USER is correct
- Check GMAIL_APP_PASSWORD is the 16-character app password (not your Gmail password)
- Ensure customer email address is valid
- Check server logs for SMTP errors

### Duplicate tickets created
- Check if the same email is being received multiple times
- Verify GMAIL_POLLING_INTERVAL is not too short
- Check for webhook duplicates if using webhook method

## Security Notes

1. **Never use your actual Gmail password** - Always use an App Password
2. **Keep credentials secure** - Use environment variables, never hardcode
3. **Limit permissions** - App password is mail-only, cannot access other Google services
4. **Monitor access** - Check Gmail security notifications for suspicious activity

## Advanced Configuration

### Custom Email Templates
Modify the email template in `gmailService.js`:
```javascript
html: `
  <p>${body}</p>
  <hr>
  <p><strong>Your Company</strong></p>
  <p>Ticket: ${ticket.ticketNumber}</p>
`
```

### Rate Limiting
Gmail API has rate limits. Default polling is every 30 seconds. Adjust if needed:
```
GMAIL_POLLING_INTERVAL=60000  // Poll every 60 seconds
```

## Support
For issues or questions, please refer to:
- [Gmail App Passwords Help](https://support.google.com/accounts/answer/185833)
- [Gmail IMAP Setup](https://support.google.com/mail/answer/7126229)
- [Nodemailer Documentation](https://nodemailer.com/)
