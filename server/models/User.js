const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, default: null },
  role:     { type: String, enum: ['admin', 'agent', 'customer'], default: 'agent' },
  avatar:   { type: String },
  status:   { type: String, enum: ['active', 'inactive', 'busy', 'invited', 'pending_approval'], default: 'active' },
  department: { type: String },
  bio:        { type: String },

  // Extra profile fields
  phone:       { type: String, default: null },
  designation: { type: String, default: null },
  employeeId:  { type: String, default: null },

  // Notification preferences
  notif_new_ticket:      { type: Boolean, default: true },
  notif_customer_reply:  { type: Boolean, default: true },
  notif_assignment:      { type: Boolean, default: true },
  notif_email:           { type: Boolean, default: true },
  notif_browser:         { type: Boolean, default: false },

  // Appearance / ticket preferences
  pref_theme:           { type: String, default: 'light' },
  pref_compact:         { type: Boolean, default: false },
  pref_language:        { type: String, default: 'en' },
  pref_timezone:        { type: String, default: 'UTC' },
  pref_signature:       { type: String, default: '' },
  pref_default_view:    { type: String, default: 'all' },
  pref_default_filter:  { type: String, default: '' },
  pref_per_page:        { type: Number, default: 20 },
  pref_sort_order:      { type: String, default: 'newest' },
  pref_availability:    { type: String, default: 'online' },

  // Login activity log (last 10 logins)
  loginActivity: [{ ip: String, ua: String, ts: Date }],
  inviteToken:  { type: String,  default: null },
  inviteExpiry: { type: Date,    default: null },
  invitedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  invitedAt:    { type: Date,    default: null },
  joinedAt:     { type: Date,    default: null },

  // Forgot-password OTP (stored as plain TOTP seed; we generate time-based codes)
  otpSecret:    { type: String,  default: null },  // random seed per request
  otpCode:      { type: String,  default: null },  // current 6-digit code
  otpExpiry:    { type: Date,    default: null },   // when the current code expires

  // Admin-approval: pending profile changes waiting for admin to accept/reject
  pendingChanges: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  pendingChangesAt: { type: Date, default: null },
  pendingChangesNote: { type: String, default: null },

  // Pending password reset — stored hashed new password awaiting admin approval
  pendingPasswordReset: {
    hashedPassword: { type: String, default: null },
    requestedAt:    { type: Date,   default: null }
  },

  // Registration approval — self-registered users start as pending_approval
  approvedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt:   { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) { next(err); }
});

UserSchema.methods.comparePassword = async function (pw) {
  if (!this.password) return false;
  return bcrypt.compare(pw, this.password);
};

module.exports = mongoose.model('User', UserSchema);
