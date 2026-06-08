const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false }, // Optional: null for system-generated activities (e.g., email→ticket, auto-assign)
  action: { type: String, required: true }, // 'assigned', 'status_changed', 'priority_changed', etc.
  actionType: { type: String, enum: ['create', 'update', 'comment', 'status_change', 'assign'], default: 'update' },
  oldValue: { type: String },
  newValue: { type: String },
  description: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);
