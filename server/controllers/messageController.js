const Message = require('../models/Message');
const Ticket = require('../models/Ticket');
const ActivityLog = require('../models/ActivityLog');

// Add message to ticket
exports.addMessage = async (req, res) => {
  try {
    const { body, isInternalNote, subject, ccEmail, bccEmail, attachments } = req.body;
    const ticketId = req.params.ticketId;

    const ticket = await Ticket.findById(ticketId)
      .populate('customer', 'email');
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const message = new Message({
      ticket: ticketId,
      sender: req.user.userId,
      senderType: 'agent',
      body,
      attachments: attachments || [],
      isInternalNote: isInternalNote || false,
      subject: subject || ticket.subject,
      toEmail: ticket.customer?.email,
      ccEmail: ccEmail || [],
      bccEmail: bccEmail || []
    });

    await message.save();

    // Update ticket's updatedAt
    ticket.updatedAt = new Date();
    if (!isInternalNote && !ticket.firstResponseTime) {
      ticket.firstResponseTime = new Date();
    }
    await ticket.save();

    // Create activity log
    await ActivityLog.create({
      ticket: ticketId,
      user: req.user.userId,
      action: 'message_added',
      actionType: 'comment',
      description: isInternalNote ? 'Internal note added' : 'Reply sent'
    });

    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'name avatar');
    res.json({
      message: 'Message added successfully',
      data: populatedMessage
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get messages for ticket
exports.getMessages = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const query = { ticket: ticketId };

    // Only show internal notes to agents/admins; customers see public messages only
    if (req.user && req.user.role === 'customer') {
      query.isInternalNote = false;
    }

    const messages = await Message.find(query)
      .populate('sender', 'name avatar email')
      .sort({ createdAt: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Add customer reply (unauthenticated — called via email webhook or public link)
exports.addCustomerReply = async (req, res) => {
  try {
    const { body, email } = req.body;
    const ticketId = req.params.ticketId;

    if (!body || !body.trim()) {
      return res.status(400).json({ message: 'Message body is required' });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Customer email is required' });
    }

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const message = new Message({
      ticket: ticketId,
      senderType: 'customer',
      body,
      attachments: [],   // customer web replies don't have attachments; inbound email ones come from gmailService
      fromEmail: email,
      toEmail: process.env.GMAIL_USER
    });

    await message.save();

    // Re-open ticket when customer replies
    if (ticket.status === 'waiting-customer') {
      ticket.status = 'in-progress';
      ticket.updatedAt = new Date();
      await ticket.save();
    }

    res.json({
      message: 'Customer reply added successfully',
      data: message
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
