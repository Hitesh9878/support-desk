const express = require('express');
const gmailService = require('../services/gmailService');
const { auth, authorize } = require('../middleware/auth');
const Message = require('../models/Message');
const Ticket  = require('../models/Ticket');

const router = express.Router();

// POST /api/gmail/send-reply/:ticketId  — Agent sends email reply from dashboard
router.post('/send-reply/:ticketId', auth, authorize(['admin', 'agent']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { body, attachments = [], ccEmails = [], bccEmails = [] } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({ message: 'Email body is required' });
    }

    const result = await gmailService.sendEmailReply(
      ticketId,
      body,
      attachments,
      req.user.userId,
      ccEmails,
      bccEmails
    );

    // Broadcast new message via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('message:added', { ticketId, message: result.message });
    }

    res.json({
      message: 'Email sent successfully',
      messageId: result.messageId,
      data: result.message
    });
  } catch (error) {
    console.error('[Route] send-reply error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/gmail/webhook/incoming  — Webhook endpoint (for external services e.g. SendGrid Inbound Parse)
router.post('/webhook/incoming', async (req, res) => {
  try {
    const { from, subject, body, messageId, attachments } = req.body;

    if (!from || !subject) {
      return res.status(400).json({ message: 'Missing required email fields (from, subject)' });
    }

    const result = await gmailService.handleIncomingEmail({
      from,
      subject,
      body: body || '',
      messageId: messageId || `webhook-${Date.now()}`,
      attachments: attachments || []
    });

    if (!result) {
      return res.json({ message: 'Email already processed (duplicate)', skipped: true });
    }

    res.json({
      message: 'Email processed successfully',
      ticketId: result.ticket._id,
      ticketNumber: result.ticket.ticketNumber
    });
  } catch (error) {
    console.error('[Route] webhook/incoming error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/gmail/:ticketId/emails  — Get all email messages for a ticket
router.get('/:ticketId/emails', auth, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.ticketId);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    const messages = await Message.find({
      ticket: req.params.ticketId,
      $or: [{ fromEmail: { $exists: true, $ne: null } }, { toEmail: { $exists: true, $ne: null } }]
    })
      .populate('sender', 'name avatar')
      .sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/gmail/test-incoming  — Dev helper to simulate an inbound email
router.post('/test-incoming', async (req, res) => {
  try {
    const testEmail = {
      from: req.body.from || 'testcustomer@example.com',
      subject: req.body.subject || 'Test support request',
      body: req.body.body || 'Hello, I need help with my order.',
      messageId: `test-${Date.now()}`,
      attachments: []
    };

    const result = await gmailService.handleIncomingEmail(testEmail);

    res.json({
      message: 'Test email processed',
      ticket: result?.ticket,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
