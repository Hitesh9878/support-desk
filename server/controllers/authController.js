const User       = require('../models/User');
const notify     = require('../services/notificationService');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
// nodemailer, QRCode removed — Brevo handles all outbound mail via notificationService

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';
const generateToken = (userId, role) =>
  jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '7d' });

// ─── In-memory OTP store ───────────────────────────────────────────────────────
// Keyed by "purpose:email" e.g. "reg:user@x.com" or "fp:user@x.com"
// For multi-instance deployments, swap this Map for Redis.
const otpStore = new Map();

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function generateOTPCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════

// Step 1 — POST /api/auth/send-registration-otp
// Validates email isn't taken, sends 6-digit OTP via Brevo.
exports.sendRegistrationOTP = async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !name)
      return res.status(400).json({ message: 'Email and name are required.' });

    const normalised = email.toLowerCase().trim();

    if (await User.findOne({ email: normalised }))
      return res.status(409).json({ message: 'An account with this email already exists.' });

    const otp = generateOTPCode();
    otpStore.set(`reg:${normalised}`, {
      otp,
      name,
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS)
    });

    const sent = await notify.sendRegistrationOTPEmail(normalised, name, otp);
    if (!sent)
      return res.status(500).json({ message: 'Failed to send verification email. Please try again.' });

    console.log(`[Auth] Registration OTP sent → ${normalised}`);
    res.json({ success: true, message: 'Verification code sent to your email.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// Step 2 — POST /api/auth/verify-registration-otp
// Verifies OTP, returns a short-lived verificationToken the front-end
// passes along with the full registration payload.
exports.verifyRegistrationOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return res.status(400).json({ message: 'Email and code are required.' });

    const normalised = email.toLowerCase().trim();
    const record     = otpStore.get(`reg:${normalised}`);

    if (!record)
      return res.status(400).json({ message: 'No verification code found. Please request a new one.', expired: true });

    if (new Date() > record.expiresAt) {
      otpStore.delete(`reg:${normalised}`);
      return res.status(400).json({ message: 'Code has expired. Please request a new one.', expired: true });
    }

    if (record.otp !== String(otp).trim())
      return res.status(400).json({ message: 'Invalid code. Please check and try again.' });

    otpStore.delete(`reg:${normalised}`);

    const verificationToken = jwt.sign(
      { email: normalised, purpose: 'email_verified' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({ verified: true, verificationToken });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// Step 3 — POST /api/auth/register
// Accepts verificationToken to confirm the email was OTP-verified.
exports.register = async (req, res) => {
  try {
    const { name, email, password, role, verificationToken } = req.body;

    // Validate the email-verification JWT
    if (!verificationToken)
      return res.status(400).json({ message: 'Email verification required. Please verify your email first.' });

    let payload;
    try {
      payload = jwt.verify(verificationToken, JWT_SECRET);
    } catch (_) {
      return res.status(400).json({ message: 'Verification token expired. Please start registration again.' });
    }

    if (payload.purpose !== 'email_verified')
      return res.status(400).json({ message: 'Invalid verification token.' });

    const normalised = email.toLowerCase().trim();
    if (payload.email !== normalised)
      return res.status(400).json({ message: 'Email mismatch. Please restart the registration.' });

    if (await User.findOne({ email: normalised }))
      return res.status(400).json({ message: 'User already exists.' });

    const user = new User({
      name,
      email: normalised,
      password,
      role: role || 'agent',
      status: 'pending_approval'
    });
    await user.save();

    setImmediate(async () => {
      try {
        const admins = await User.find({ role: 'admin', status: 'active' }).select('name email');
        await notify.sendRegistrationPendingEmail(user);
        await notify.notifyAdminsNewRegistration(admins, user);
      } catch (e) { console.error('[Auth] Registration notify error:', e.message); }
    });

    res.json({
      message: 'Registration successful. An admin will review and approve your account shortly.',
      pending: true
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════════

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase().trim() });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    if (user.status === 'invited' || !user.password)
      return res.status(403).json({ message: 'Account not activated. Check your invite email.', invited: true });

    if (user.status === 'pending_approval')
      return res.status(403).json({
        message: 'Your account is pending admin approval. You will be notified once approved.',
        pending: true
      });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(400).json({ message: 'Invalid credentials' });

    const token = generateToken(user._id, user.role);
    res.json({
      message: 'Login successful',
      token,
      user: { id: user._id, name: user.name, email: user.email,
              role: user.role, avatar: user.avatar, status: user.status }
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// FORGOT PASSWORD  (QR/TOTP completely removed — email OTP only)
// ══════════════════════════════════════════════════════════════════════════════

// Step 1 — POST /api/auth/forgot-password
// Sends a 6-digit OTP to the user's email via Brevo.
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required.' });

    const normalised = email.toLowerCase().trim();
    const user       = await User.findOne({ email: normalised });

    // Always return 200 — don't reveal whether the email exists
    if (!user || user.status === 'invited' || user.status === 'pending_approval') {
      return res.json({ success: true, message: 'If that email is registered, a code has been sent.' });
    }

    const otp = generateOTPCode();
    otpStore.set(`fp:${normalised}`, {
      otp,
      userId:    user._id.toString(),
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS)
    });

    await notify.sendPasswordResetOTPEmail(normalised, user.name, otp);

    console.log(`[Auth] Password reset OTP sent → ${normalised}`);
    res.json({ success: true, message: 'Verification code sent to your email.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// Step 2 — POST /api/auth/verify-otp
// Verifies the OTP and returns a short-lived resetToken JWT.
exports.verifyOTP = async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code)
      return res.status(400).json({ message: 'Email and code are required.' });

    const normalised = email.toLowerCase().trim();
    const record     = otpStore.get(`fp:${normalised}`);

    if (!record)
      return res.status(400).json({ message: 'No reset code found. Please start over.', expired: true });

    if (new Date() > record.expiresAt) {
      otpStore.delete(`fp:${normalised}`);
      return res.status(400).json({ message: 'Code has expired. Please request a new one.', expired: true });
    }

    if (record.otp !== String(code).trim())
      return res.status(400).json({ message: 'Incorrect code. Please try again.' });

    otpStore.delete(`fp:${normalised}`);

    const resetToken = jwt.sign(
      { userId: record.userId, purpose: 'password_reset' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({ success: true, resetToken });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// Step 3 — POST /api/auth/reset-password
// Stores a pending hashed password — admin must approve before it's applied.
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, password } = req.body;
    if (!resetToken || !password)
      return res.status(400).json({ message: 'Token and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    let payload;
    try {
      payload = jwt.verify(resetToken, JWT_SECRET);
    } catch (_) {
      return res.status(400).json({ message: 'Reset link has expired. Please start over.' });
    }

    if (payload.purpose !== 'password_reset')
      return res.status(400).json({ message: 'Invalid reset token.' });

    const user = await User.findById(payload.userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const bcrypt = require('bcryptjs');
    const hashed = await bcrypt.hash(password, 10);

    user.pendingPasswordReset = { hashedPassword: hashed, requestedAt: new Date() };
    // Clear any leftover OTP fields from old system
    user.otpCode   = null;
    user.otpExpiry = null;
    user.otpSecret = null;
    user.updatedAt = new Date();
    await user.save();

    setImmediate(async () => {
      try {
        const admins = await User.find({ role: 'admin', status: 'active' }).select('name email');
        await notify.sendPasswordResetPendingEmail(user);
        await notify.notifyAdminsPasswordReset(admins, user);
      } catch (e) { console.error('[Auth] Password reset notify error:', e.message); }
    });

    res.json({
      message: 'Password reset submitted for admin approval. You will receive an email once approved.',
      pending: true
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// refreshOTP removed — no longer needed (email OTP replaces QR/TOTP)

// ══════════════════════════════════════════════════════════════════════════════
// INVITE AGENT  (now uses Brevo via notificationService)
// ══════════════════════════════════════════════════════════════════════════════

exports.inviteAgent = async (req, res) => {
  try {
    const { name, email, role = 'agent' } = req.body;
    if (!name || !email)
      return res.status(400).json({ message: 'Name and email are required.' });
    if (!['agent', 'admin'].includes(role))
      return res.status(400).json({ message: 'Role must be agent or admin.' });

    const normalised = email.toLowerCase().trim();
    const existing   = await User.findOne({ email: normalised });

    if (existing) {
      // If already invited (but not activated), just resend
      if (existing.status === 'invited') return await resendInviteHelper(existing, req.user, res);
      return res.status(400).json({ message: 'A user with this email already exists.' });
    }

    const rawToken    = crypto.randomBytes(24).toString('hex');
    const tokenExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const user = new User({
      name,
      email: normalised,
      password:     null,
      role,
      status:       'invited',
      inviteToken:  rawToken,
      inviteExpiry: tokenExpiry,
      invitedBy:    req.user.userId,
      invitedAt:    new Date()
    });
    await user.save();

    await sendInviteViaBrevo(user, rawToken, req.user);

    res.json({
      message: `Invite sent to ${email}`,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, status: user.status }
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.resendInvite = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user.status !== 'invited')
      return res.status(400).json({ message: 'User is already active.' });
    await resendInviteHelper(user, req.user, res);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// INVITE TOKEN + SET PASSWORD  (unchanged)
// ══════════════════════════════════════════════════════════════════════════════

exports.validateInviteToken = async (req, res) => {
  try {
    const user = await User.findOne({ inviteToken: req.params.token });
    if (!user)                          return res.status(404).json({ message: 'Invalid invite link.', valid: false });
    if (user.status !== 'invited')      return res.status(400).json({ message: 'This invite has already been used.', valid: false });
    if (new Date() > user.inviteExpiry) return res.status(400).json({ message: 'Invite link expired.', valid: false });
    res.json({ valid: true, name: user.name, email: user.email, role: user.role });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.setPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    const user = await User.findOne({ inviteToken: req.params.token });
    if (!user)                          return res.status(404).json({ message: 'Invalid invite link.' });
    if (user.status !== 'invited')      return res.status(400).json({ message: 'Already used.' });
    if (new Date() > user.inviteExpiry) return res.status(400).json({ message: 'Expired.' });

    user.password     = password; // pre-save hook hashes it
    user.status       = 'active';
    user.inviteToken  = null;
    user.inviteExpiry = null;
    user.joinedAt     = new Date();
    user.updatedAt    = new Date();
    await user.save();

    const token = generateToken(user._id, user.role);
    res.json({
      message: 'Account activated!',
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, status: user.status }
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN — APPROVALS
// ══════════════════════════════════════════════════════════════════════════════

exports.getPendingApprovals = async (req, res) => {
  try {
    const fields = '-password -inviteToken -otpCode -otpSecret';
    const [pendingRegistrations, pendingProfileChanges, pendingPasswordResets] = await Promise.all([
      User.find({ status: 'pending_approval' }).select(fields).sort({ createdAt: -1 }),
      User.find({ pendingChanges: { $ne: null }, status: { $nin: ['pending_approval'] } }).select(fields).sort({ pendingChangesAt: -1 }),
      User.find({ 'pendingPasswordReset.hashedPassword': { $ne: null } }).select(fields).sort({ 'pendingPasswordReset.requestedAt': -1 })
    ]);
    res.json({ pendingRegistrations, pendingProfileChanges, pendingPasswordResets });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.approveRegistration = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.status !== 'pending_approval')
      return res.status(400).json({ message: 'User is not pending approval' });

    user.status     = 'active';
    user.approvedBy = req.user.userId;
    user.approvedAt = new Date();
    await user.save();

    setImmediate(() => notify.sendApprovalEmail(user, 'approved'));

    const io = req.app?.get('io');
    if (io) io.emit('user:approved', { userId: user._id, name: user.name });

    res.json({ message: `${user.name}'s account has been approved.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.rejectRegistration = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    setImmediate(() => notify.sendApprovalEmail(user, 'rejected'));
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: `${user.name}'s registration has been rejected and removed.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.approveProfileChange = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || !user.pendingChanges)
      return res.status(404).json({ message: 'No pending changes found' });

    const changes = user.pendingChanges;
    if (changes.name)       user.name       = changes.name;
    if (changes.department) user.department = changes.department;
    if (changes.bio)        user.bio        = changes.bio;

    user.pendingChanges     = null;
    user.pendingChangesAt   = null;
    user.pendingChangesNote = null;
    user.updatedAt          = new Date();
    await user.save();

    setImmediate(() => notify.sendProfileChangeEmail(user, 'approved'));

    const io = req.app?.get('io');
    if (io) io.emit('profile:approved', { userId: user._id });

    res.json({ message: `Profile changes for ${user.name} approved.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.rejectProfileChange = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.pendingChanges     = null;
    user.pendingChangesAt   = null;
    user.pendingChangesNote = null;
    await user.save();

    setImmediate(() => notify.sendProfileChangeEmail(user, 'rejected'));
    res.json({ message: `Profile changes for ${user.name} rejected.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.approvePasswordReset = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (!user.pendingPasswordReset?.hashedPassword)
      return res.status(400).json({ message: 'No pending password reset for this user.' });

    // Apply the already-hashed password directly (bypass pre-save hook)
    await User.findByIdAndUpdate(user._id, {
      password: user.pendingPasswordReset.hashedPassword,
      pendingPasswordReset: { hashedPassword: null, requestedAt: null },
      updatedAt: new Date()
    });

    setImmediate(() => notify.sendPasswordResetApprovedEmail(user));

    const io = req.app?.get('io');
    if (io) io.emit('passwordReset:approved', { userId: user._id.toString() });

    res.json({ message: `Password reset approved for ${user.name}.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.rejectPasswordReset = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    await User.findByIdAndUpdate(user._id, {
      pendingPasswordReset: { hashedPassword: null, requestedAt: null },
      updatedAt: new Date()
    });

    setImmediate(() => notify.sendPasswordResetRejectedEmail(user));
    res.json({ message: `Password reset rejected for ${user.name}.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// TEAM / USER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('-password -inviteToken -otpCode -otpSecret')
      .populate('invitedBy', 'name email');
    res.json(user);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const user = await User.findByIdAndUpdate(req.user.userId, { status }, { new: true }).select('-password');
    res.json(user);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.getAgents = async (req, res) => {
  try {
    const agents = await User.find(
      { role: { $in: ['agent', 'admin'] }, status: 'active' },
      'name email status avatar role'
    ).sort({ name: 1 });
    res.json(agents);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.getTeamMembers = async (req, res) => {
  try {
    const members = await User.find({ role: { $in: ['agent', 'admin'] } })
      .select('-password -inviteToken -otpCode -otpSecret')
      .populate('invitedBy', 'name')
      .sort({ createdAt: -1 });
    res.json(members);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.deleteTeamMember = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user._id.toString() === req.user.userId)
      return res.status(400).json({ message: 'Cannot delete yourself.' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: `${user.name} removed from team.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.submitProfileChange = async (req, res) => {
  try {
    const { name, department, bio } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.pendingChanges     = { name, department, bio };
    user.pendingChangesAt   = new Date();
    user.pendingChangesNote = req.body.note || null;
    await user.save();

    setImmediate(() => notifyAdminsOfPendingChange(user));
    res.json({ message: 'Changes submitted for admin approval.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, department, bio, designation, employeeId } = req.body;
    const updates = { updatedAt: new Date() };
    if (name)                         updates.name        = name.trim();
    if (phone !== undefined)          updates.phone       = phone;
    if (department !== undefined)     updates.department  = department;
    if (bio !== undefined)            updates.bio         = bio;
    if (designation !== undefined)    updates.designation = designation;
    if (employeeId !== undefined)     updates.employeeId  = employeeId;

    const user = await User.findByIdAndUpdate(req.user.userId, updates, { new: true })
      .select('-password -inviteToken -otpCode -otpSecret');
    res.json({ message: 'Profile updated successfully.', user });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Both current and new password are required.' });
    if (newPassword.length < 6)
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const match = await user.comparePassword(currentPassword);
    if (!match) return res.status(400).json({ message: 'Current password is incorrect.' });

    user.password  = newPassword; // pre-save hook hashes it
    user.updatedAt = new Date();
    await user.save();

    res.json({ message: 'Password changed successfully.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.updatePreferences = async (req, res) => {
  try {
    const allowed = [
      'notif_new_ticket','notif_customer_reply','notif_assignment',
      'notif_email','notif_browser',
      'pref_default_view','pref_default_filter','pref_per_page','pref_sort_order',
      'pref_theme','pref_compact','pref_language','pref_timezone',
      'pref_signature','pref_availability'
    ];
    const updates = { updatedAt: new Date() };
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const user = await User.findByIdAndUpdate(req.user.userId, updates, { new: true })
      .select('-password -inviteToken -otpCode -otpSecret');
    res.json({ message: 'Preferences saved.', user });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

exports.getLoginActivity = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('loginActivity');
    res.json({ loginActivity: user?.loginActivity || [] });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ══════════════════════════════════════════════════════════════════════════════

async function resendInviteHelper(user, reqUser, res) {
  const rawToken    = crypto.randomBytes(24).toString('hex');
  const tokenExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);
  user.inviteToken  = rawToken;
  user.inviteExpiry = tokenExpiry;
  user.invitedBy    = reqUser.userId;
  user.invitedAt    = new Date();
  await user.save();
  await sendInviteViaBrevo(user, rawToken, reqUser);
  return res.json({ message: `Invite re-sent to ${user.email}` });
}

async function sendInviteViaBrevo(user, token, reqUser) {
  const appUrl     = process.env.APP_URL || 'http://localhost:5000';
  const inviteUrl  = `${appUrl}/set-password.html?token=${token}`;
  const admin      = reqUser?.userId
    ? await User.findById(reqUser.userId).select('name')
    : null;
  const adminName  = admin?.name || 'The TradeMAV Admin';

  const sent = await notify.sendAgentInviteEmail(
    { name: user.name, email: user.email, role: user.role },
    inviteUrl,
    adminName
  );

  if (!sent) {
    console.error(`[Auth] Brevo invite failed for ${user.email}`);
    throw new Error('Failed to send invite email via Brevo.');
  }

  console.log(`[Auth] Invite sent via Brevo → ${user.email}`);
}

async function notifyAdminsOfPendingChange(user) {
  try {
    const admins = await User.find({ role: 'admin', status: 'active' }).select('email name');
    const appUrl = process.env.APP_URL || 'http://localhost:5000';
    for (const admin of admins) {
      // Re-use the Brevo notificationService sendMail indirectly via a local helper
      // since notificationService doesn't have a dedicated pendingChange template.
      // This keeps the pattern consistent — all mail through Brevo.
      const Brevo       = require('@getbrevo/brevo');
      const apiInstance = new Brevo.TransactionalEmailsApi();
      apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY.trim());

      const msg         = new Brevo.SendSmtpEmail();
      msg.sender        = {
        name:  process.env.BREVO_SENDER_NAME_ALERT || 'TradeMAV Alerts',
        email: process.env.BREVO_SENDER_EMAIL_NOTIFICATION
      };
      msg.to            = [{ email: admin.email }];
      msg.subject       = `[TradeMAV] Profile change request from ${user.name}`;
      msg.htmlContent   = `
        <p>Hi ${admin.name},</p>
        <p><strong>${user.name}</strong> has requested profile changes:</p>
        <ul>${Object.entries(user.pendingChanges || {}).map(([k,v]) => `<li><strong>${k}:</strong> ${v}</li>`).join('')}</ul>
        <p><a href="${appUrl}/dashboard.html">Review in Dashboard →</a></p>`;
      await apiInstance.sendTransacEmail(msg);
    }
  } catch (e) {
    console.error('[Auth] notifyAdminsOfPendingChange error:', e.message);
  }
}