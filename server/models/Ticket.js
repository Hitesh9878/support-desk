const mongoose = require('mongoose');

const TicketSchema = new mongoose.Schema({
  ticketNumber: { type: String, unique: true }, // TM-1001 format
  subject: { type: String, required: true },
  description: { type: String, required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  status: { type: String, enum: ['open', 'in-progress', 'waiting-customer', 'resolved', 'closed'], default: 'open' },
  category: { type: String },
  tags: [{ type: String }],
  
  // SLA
  slaDeadline: { type: Date },
  slaBreached: { type: Boolean, default: false },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date },
  firstResponseTime: { type: Date },
  
  // Attachments
  attachments: [{ type: String }], // File paths
  
  // Metadata
  channel: { type: String, enum: ['email', 'web', 'phone', 'chat'], default: 'email' },
  gmailMessageId: { type: String }, // For Gmail integration
  linkedTickets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' }]
});

// Auto-generate ticket number
TicketSchema.pre('save', async function(next) {
  if (!this.ticketNumber) {
    const count = await this.constructor.countDocuments();
    this.ticketNumber = `TM-${1001 + count}`;
  }
  next();
});

module.exports = mongoose.model('Ticket', TicketSchema);
