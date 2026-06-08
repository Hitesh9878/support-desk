const User       = require('../models/User');
const notify     = require('../services/notificationService');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const QRCode     = require('qrcode');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';
const generateToken = (userId, role) =>
  jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '7d' });

const getTransporter = () => nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});

// ─── Register ──────────────────────────────────────────────────────────────────
// Self-registered users start with status 'pending_approval'.
// Admin must approve them before they can log in.
exports.register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (await User.findOne({ email }))
      return res.status(400).json({ message: 'User already exists' });

    const user = new User({
      name, email, password,
      role: role || 'agent',
      status: 'pending_approval'   // ← must be approved by admin first
    });
    await user.save();

    // Email the user confirming their registration is pending
    // Email all admins asking them to review
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

// ─── Login ─────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    if (user.status === 'invited' || !user.password)
      return res.status(403).json({ message: 'Account not activated. Check your invite email.', invited: true });

    if (user.status === 'pending_approval')
      return res.status(403).json({ message: 'Your account is pending admin approval. You will be notified once approved.', pending: true });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(400).json({ message: 'Invalid credentials' });

    const token = generateToken(user._id, user.role);
    res.json({
      message: 'Login successful', token,
      user: { id: user._id, name: user.name, email: user.email,
              role: user.role, avatar: user.avatar, status: user.status }
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Forgot password: step 1 — check email, generate OTP, return QR ───────────
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });

    // Always respond the same way to prevent email enumeration
    if (!user || user.status === 'invited' || user.status === 'pending_approval') {
      return res.json({ message: 'If that email exists, a QR code has been generated.' });
    }

    // Generate a 6-digit OTP and its QR payload
    const { code, qrDataUrl, seed, expiry } = await generateOTP();

    user.otpSecret = seed;
    user.otpCode   = code;
    user.otpExpiry = expiry;
    await user.save();

    res.json({
      qrDataUrl,          // base64 PNG data URL — rendered in browser
      otpExpiry: expiry,  // JS timestamp — for countdown timer
      message: 'Scan the QR code with any authenticator app or read the code directly.'
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Forgot password: step 2 — verify OTP ─────────────────────────────────────
exports.verifyOTP = async (req, res) => {
  try {
    const { email, code } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });

    if (!user || !user.otpCode)
      return res.status(400).json({ message: 'No OTP found. Please request a new code.' });

    if (new Date() > new Date(user.otpExpiry))
      return res.status(400).json({ message: 'OTP expired. Please request a new code.', expired: true });

    if (String(user.otpCode) !== String(code).trim())
      return res.status(400).json({ message: 'Incorrect code. Please try again.' });

    // OTP valid — issue a short-lived reset token
    const resetToken = crypto.randomBytes(20).toString('hex');
    user.otpCode      = null;
    user.otpExpiry    = null;
    user.inviteToken  = resetToken;                                  // reuse invite token field
    user.inviteExpiry = new Date(Date.now() + 15 * 60 * 1000);      // 15 min to set new password
    await user.save();

    res.json({ resetToken, message: 'OTP verified. Set your new password.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Forgot password: step 3 — store pending reset (admin must approve) ──────
exports.resetPassword = async (req, res) => {
  try {
    const { resetToken, password } = req.body;
    if (!password || password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    const user = await User.findOne({ inviteToken: resetToken });
    if (!user || new Date() > new Date(user.inviteExpiry))
      return res.status(400).json({ message: 'Reset token invalid or expired.' });

    // Hash the new password and store it as PENDING — do NOT apply yet
    const bcrypt = require('bcryptjs');
    const salt   = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(password, salt);

    user.pendingPasswordReset = { hashedPassword: hashed, requestedAt: new Date() };
    user.inviteToken  = null;   // token consumed — can't be reused
    user.inviteExpiry = null;
    user.otpCode      = null;
    user.otpExpiry    = null;
    user.updatedAt    = new Date();
    await user.save();

    // Notify user that it's pending + notify all admins
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

// ─── Refresh OTP (called when 40s countdown hits zero) ────────────────────────
exports.refreshOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) return res.json({ message: 'OK' }); // silent fail

    const { code, qrDataUrl, seed, expiry } = await generateOTP();
    user.otpSecret = seed;
    user.otpCode   = code;
    user.otpExpiry = expiry;
    await user.save();

    res.json({ qrDataUrl, otpExpiry: expiry });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Get current user ──────────────────────────────────────────────────────────
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select('-password -inviteToken -otpCode -otpSecret')
      .populate('invitedBy', 'name email');
    res.json(user);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Update status ─────────────────────────────────────────────────────────────
exports.updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const user = await User.findByIdAndUpdate(req.user.userId, { status }, { new: true }).select('-password');
    res.json(user);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Submit profile changes (goes to admin for approval) ──────────────────────
exports.submitProfileChange = async (req, res) => {
  try {
    const { name, department, bio } = req.body;
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.pendingChanges = { name, department, bio };
    user.pendingChangesAt   = new Date();
    user.pendingChangesNote = req.body.note || null;
    await user.save();

    // Notify admins
    setImmediate(() => notifyAdminsOfPendingChange(user));

    res.json({ message: 'Changes submitted for admin approval.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Get pending approvals (admin) ────────────────────────────────────────────
exports.getPendingApprovals = async (req, res) => {
  try {
    const fields = '-password -inviteToken -otpCode -otpSecret';

    const [pendingRegistrations, pendingProfileChanges, pendingPasswordResets] = await Promise.all([
      User.find({ status: 'pending_approval' })
        .select(fields).sort({ createdAt: -1 }),
      User.find({ pendingChanges: { $ne: null }, status: { $nin: ['pending_approval'] } })
        .select(fields).sort({ pendingChangesAt: -1 }),
      User.find({ 'pendingPasswordReset.hashedPassword': { $ne: null } })
        .select(fields).sort({ 'pendingPasswordReset.requestedAt': -1 })
    ]);

    res.json({ pendingRegistrations, pendingProfileChanges, pendingPasswordResets });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Approve registration (admin) ──────────────────────────────────────────────
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

    // Send approval notification email to the user
    setImmediate(() => notify.sendApprovalEmail(user, 'approved'));

    // Also emit socket event
    const io = req.app?.get('io');
    if (io) io.emit('user:approved', { userId: user._id, name: user.name });

    res.json({ message: `${user.name}'s account has been approved.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Reject registration (admin) ───────────────────────────────────────────────
exports.rejectRegistration = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    setImmediate(() => notify.sendApprovalEmail(user, 'rejected'));
    await User.findByIdAndDelete(req.params.id);

    res.json({ message: `${user.name}'s registration has been rejected and removed.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Approve profile change (admin) ───────────────────────────────────────────
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

// ─── Reject profile change (admin) ────────────────────────────────────────────
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

// ─── Get agents ────────────────────────────────────────────────────────────────
exports.getAgents = async (req, res) => {
  try {
    const agents = await User.find(
      { role: { $in: ['agent', 'admin'] }, status: 'active' },
      'name email status avatar role'
    ).sort({ name: 1 });
    res.json(agents);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Get team members ──────────────────────────────────────────────────────────
exports.getTeamMembers = async (req, res) => {
  try {
    const members = await User.find({ role: { $in: ['agent', 'admin'] } })
      .select('-password -inviteToken -otpCode -otpSecret')
      .populate('invitedBy', 'name').sort({ createdAt: -1 });
    res.json(members);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Invite agent ──────────────────────────────────────────────────────────────
exports.inviteAgent = async (req, res) => {
  try {
    const { name, email, role = 'agent' } = req.body;
    if (!name || !email) return res.status(400).json({ message: 'Name and email are required.' });
    if (!['agent', 'admin'].includes(role))
      return res.status(400).json({ message: 'Role must be agent or admin.' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      if (existing.status === 'invited') return await resendInviteHelper(existing, req.user.userId, res);
      return res.status(400).json({ message: 'A user with this email already exists.' });
    }

    const rawToken    = crypto.randomBytes(24).toString('hex');
    const tokenExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const user = new User({
      name, email: email.toLowerCase(), password: null, role,
      status: 'invited', inviteToken: rawToken, inviteExpiry: tokenExpiry,
      invitedBy: req.user.userId, invitedAt: new Date()
    });
    await user.save();
    await sendInviteEmail(user, rawToken, req.user.userId);

    res.json({ message: `Invite sent to ${email}`, user: { id: user._id, name: user.name, email: user.email, role: user.role, status: user.status } });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Validate invite token ─────────────────────────────────────────────────────
exports.validateInviteToken = async (req, res) => {
  try {
    const user = await User.findOne({ inviteToken: req.params.token });
    if (!user)                          return res.status(404).json({ message: 'Invalid invite link.' });
    if (user.status !== 'invited')      return res.status(400).json({ message: 'This invite has already been used.' });
    if (new Date() > user.inviteExpiry) return res.status(400).json({ message: 'Invite link expired.' });
    res.json({ valid: true, name: user.name, email: user.email, role: user.role });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Set password ──────────────────────────────────────────────────────────────
exports.setPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    const user = await User.findOne({ inviteToken: req.params.token });
    if (!user)                          return res.status(404).json({ message: 'Invalid invite link.' });
    if (user.status !== 'invited')      return res.status(400).json({ message: 'Already used.' });
    if (new Date() > user.inviteExpiry) return res.status(400).json({ message: 'Expired.' });

    user.password = password; user.status = 'active';
    user.inviteToken = null; user.inviteExpiry = null;
    user.joinedAt = new Date(); user.updatedAt = new Date();
    await user.save();

    const token = generateToken(user._id, user.role);
    res.json({ message: 'Account activated!', token, user: { id: user._id, name: user.name, email: user.email, role: user.role, status: user.status } });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Resend invite ─────────────────────────────────────────────────────────────
exports.resendInvite = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user.status !== 'invited') return res.status(400).json({ message: 'User is already active.' });
    await resendInviteHelper(user, req.user.userId, res);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Approve password reset (admin) ───────────────────────────────────────────
exports.approvePasswordReset = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (!user.pendingPasswordReset?.hashedPassword)
      return res.status(400).json({ message: 'No pending password reset for this user.' });

    // Apply the stored hashed password directly (already hashed — skip pre-save hook)
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

// ─── Reject password reset (admin) ────────────────────────────────────────────
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

// ─── Delete team member ────────────────────────────────────────────────────────
exports.deleteTeamMember = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    if (user._id.toString() === req.user.userId) return res.status(400).json({ message: 'Cannot delete yourself.' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: `${user.name} removed from team.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

// Generate a 6-digit OTP valid for 40 seconds and its QR code PNG data URL
async function generateOTP() {
  const code   = String(Math.floor(100000 + Math.random() * 900000));  // 6 digits
  const seed   = crypto.randomBytes(16).toString('hex');
  const expiry = new Date(Date.now() + 40 * 1000);                     // 40 seconds

  // QR payload: just the code itself so any QR scanner shows the digit string
  const qrPayload = `TradeMAV OTP: ${code}`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: 'H',
    width: 220,
    margin: 2,
    color: { dark: '#111827', light: '#ffffff' }
  });

  return { code, seed, expiry, qrDataUrl };
}

async function resendInviteHelper(user, adminId, res) {
  const rawToken    = crypto.randomBytes(24).toString('hex');
  const tokenExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);
  user.inviteToken = rawToken; user.inviteExpiry = tokenExpiry;
  user.invitedBy = adminId; user.invitedAt = new Date();
  await user.save();
  await sendInviteEmail(user, rawToken, adminId);
  return res.json({ message: `Invite re-sent to ${user.email}` });
}

async function sendEmail(to, subject, html) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn('[Email] Gmail not configured — skipping:', subject);
    return;
  }
  try {
    await getTransporter().sendMail({ from: `TradeMAV <${process.env.GMAIL_USER}>`, to, subject, html });
    console.log(`[Email] Sent: "${subject}" → ${to}`);
  } catch (err) {
    console.error(`[Email] Failed "${subject}" → ${to}:`, err.message);
  }
}

const emailWrap = (content) => `
  <!DOCTYPE html><html><head><meta charset="UTF-8"></head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
      <table width="600" cellpadding="0" cellspacing="0"
        style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:600px;width:100%;">
        <tr><td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px 36px;text-align:center;">
          <div style="font-size:26px;margin-bottom:6px;">🎯</div>
          <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">TradeMAV</h1>
          <p style="color:rgba(255,255,255,.7);margin:4px 0 0;font-size:13px;">Support Desk</p>
        </td></tr>
        <tr><td style="padding:32px 36px;">${content}</td></tr>
        <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 36px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9ca3af;">© TradeMAV Support Desk — Automated notification</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

async function sendInviteEmail(user, token, adminId) {
  const appUrl    = process.env.APP_URL || 'http://localhost:5000';
  const inviteUrl = `${appUrl}/set-password.html?token=${token}`;
  const admin     = adminId ? await User.findById(adminId).select('name') : null;
  const adminName = admin?.name || 'The TradeMAV Admin';

  await sendEmail(user.email, `You're invited to join TradeMAV Support Desk`, emailWrap(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">You've been invited! 🎉</h2>
    <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
      Hi <strong>${user.name}</strong>, <strong>${adminName}</strong> has invited you to join
      <strong>TradeMAV Support Desk</strong> as a <strong>${user.role}</strong>.
    </p>
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Login email: <strong style="color:#111827;">${user.email}</strong></p>
      <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Role: <span style="background:#ede9fe;color:#5b21b6;font-size:12px;font-weight:700;padding:2px 8px;border-radius:20px;">${user.role}</span></p>
      <p style="margin:0;font-size:13px;color:#6b7280;">Expires: 72 hours</p>
    </div>
    <div style="text-align:center;margin-bottom:20px;">
      <a href="${inviteUrl}" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;
        text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:700;">
        Set Your Password →
      </a>
    </div>
    <p style="font-size:12px;color:#9ca3af;text-align:center;word-break:break-all;
      background:#f3f4f6;padding:8px;border-radius:6px;margin:0;">${inviteUrl}</p>`));
}

async function sendApprovalEmail(user, action) {
  const approved = action === 'approved';
  await sendEmail(user.email,
    approved ? '✅ Your TradeMAV account has been approved!' : '❌ Your TradeMAV registration was not approved',
    emailWrap(approved ? `
      <h2 style="margin:0 0 12px;font-size:20px;color:#111827;">Account Approved! 🎉</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
        Hi <strong>${user.name}</strong>, your TradeMAV Support Desk account has been approved.
        You can now log in and start working on tickets.
      </p>
      <div style="text-align:center;">
        <a href="${process.env.APP_URL || 'http://localhost:5000'}/login.html"
          style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;
          text-decoration:none;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:700;">
          Log In Now →
        </a>
      </div>` : `
      <h2 style="margin:0 0 12px;font-size:20px;color:#111827;">Registration Not Approved</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6;">
        Hi <strong>${user.name}</strong>, unfortunately your TradeMAV account registration was not approved at this time.
        Please contact your administrator for more information.
      </p>`));
}

async function sendProfileChangeEmail(user, action) {
  const approved = action === 'approved';
  await sendEmail(user.email,
    approved ? '✅ Your profile changes have been approved' : '❌ Your profile changes were not approved',
    emailWrap(`
      <h2 style="margin:0 0 12px;font-size:20px;color:#111827;">
        Profile Changes ${approved ? 'Approved ✅' : 'Rejected ❌'}
      </h2>
      <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6;">
        Hi <strong>${user.name}</strong>, your requested profile changes have been
        <strong>${approved ? 'approved and applied' : 'rejected'}</strong> by an administrator.
      </p>
      ${approved ? `<a href="${process.env.APP_URL || 'http://localhost:5000'}/dashboard.html"
        style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;
        text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;">
        Go to Dashboard →</a>` : ''}`));
}

async function notifyAdminsOfRegistration(newUser) {
  const admins = await User.find({ role: 'admin', status: 'active' }).select('email name');
  const appUrl = process.env.APP_URL || 'http://localhost:5000';
  for (const admin of admins) {
    await sendEmail(admin.email, `[TradeMAV] New registration pending approval: ${newUser.name}`,
      emailWrap(`
        <h2 style="margin:0 0 12px;font-size:18px;color:#111827;">New Registration Pending 👤</h2>
        <p style="margin:0 0 16px;font-size:14px;color:#374151;">
          Hi <strong>${admin.name}</strong>, a new user has registered and needs your approval.
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:20px;">
          <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Name: <strong style="color:#111827;">${newUser.name}</strong></p>
          <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">Email: <strong style="color:#111827;">${newUser.email}</strong></p>
          <p style="margin:0;font-size:13px;color:#6b7280;">Role requested: <strong style="color:#111827;">${newUser.role}</strong></p>
        </div>
        <a href="${appUrl}/dashboard.html" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);
          color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;">
          Review in Dashboard →</a>`));
  }
}

async function notifyAdminsOfPendingChange(user) {
  const admins = await User.find({ role: 'admin', status: 'active' }).select('email name');
  const appUrl = process.env.APP_URL || 'http://localhost:5000';
  for (const admin of admins) {
    await sendEmail(admin.email, `[TradeMAV] Profile change request from ${user.name}`,
      emailWrap(`
        <h2 style="margin:0 0 12px;font-size:18px;color:#111827;">Profile Change Request ✏️</h2>
        <p style="margin:0 0 16px;font-size:14px;color:#374151;">
          Hi <strong>${admin.name}</strong>, <strong>${user.name}</strong> has requested the following profile changes:
        </p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:20px;">
          ${Object.entries(user.pendingChanges || {}).map(([k,v]) =>
            `<p style="margin:0 0 6px;font-size:13px;color:#6b7280;">${k}: <strong style="color:#111827;">${v}</strong></p>`
          ).join('')}
        </div>
        <a href="${appUrl}/dashboard.html" style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);
          color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;">
          Review in Dashboard →</a>`));
  }
}

// ─── Update profile directly (name, phone, department, bio, avatar) ────────────
// No admin approval needed — these are non-sensitive fields.
exports.updateProfile = async (req, res) => {
  try {
    const { name, phone, department, bio, designation, employeeId } = req.body;
    const updates = { updatedAt: new Date() };
    if (name)        updates.name        = name.trim();
    if (phone !== undefined) updates.phone = phone;
    if (department !== undefined) updates.department = department;
    if (bio !== undefined)        updates.bio        = bio;
    if (designation !== undefined) updates.designation = designation;
    if (employeeId !== undefined)  updates.employeeId  = employeeId;

    const user = await User.findByIdAndUpdate(
      req.user.userId, updates, { new: true }
    ).select('-password -inviteToken -otpCode -otpSecret');

    res.json({ message: 'Profile updated successfully.', user });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Change password directly (no admin approval) ──────────────────────────────
// Agent changes their own password; they must supply the current password first.
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

    user.password  = newPassword;  // pre-save hook will hash it
    user.updatedAt = new Date();
    await user.save();

    res.json({ message: 'Password changed successfully.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Update notification preferences ──────────────────────────────────────────
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

    const user = await User.findByIdAndUpdate(
      req.user.userId, updates, { new: true }
    ).select('-password -inviteToken -otpCode -otpSecret');
    res.json({ message: 'Preferences saved.', user });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Get login activity / active sessions ─────────────────────────────────────
exports.getLoginActivity = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('loginActivity');
    res.json({ loginActivity: user?.loginActivity || [] });
  } catch (err) { res.status(500).json({ message: err.message }); }
};
