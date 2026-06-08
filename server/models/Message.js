const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Agent
  senderType: { type: String, enum: ['agent', 'customer'], default: 'customer' },
  body: { type: String, required: true },
  attachments: [{
    url:          { type: String, required: true },  // /uploads/messages/filename.ext
    originalName: { type: String, default: '' },     // original filename shown to user
    mimeType:     { type: String, default: 'application/octet-stream' },
    size:         { type: Number, default: 0 }       // bytes
  }],
  
  // Email specific
  subject: { type: String },
  fromEmail: { type: String },
  toEmail: { type: String },
  ccEmail: [{ type: String }],
  bccEmail: [{ type: String }],
  gmailMessageId: { type: String },
  
  // Internal notes (only visible to agents)
  isInternalNote: { type: Boolean, default: false },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', MessageSchema);
