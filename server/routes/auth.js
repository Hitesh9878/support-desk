const express        = require('express');
const authController = require('../controllers/authController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// ── Public ───────────────────────────────────────────────────────────────────

// Registration — 3-step: send OTP → verify OTP → register
router.post('/send-registration-otp',   authController.sendRegistrationOTP);
router.post('/verify-registration-otp', authController.verifyRegistrationOTP);
router.post('/register',                authController.register);

router.post('/login',                   authController.login);
router.get('/invite/:token',            authController.validateInviteToken);
router.post('/set-password/:token',     authController.setPassword);

// Forgot password — 3 steps: email → verify OTP → set new password
// (QR/TOTP and /refresh-otp removed — email OTP only)
router.post('/forgot-password',         authController.forgotPassword);
router.post('/verify-otp',              authController.verifyOTP);
router.post('/reset-password',          authController.resetPassword);

// ── Protected ────────────────────────────────────────────────────────────────
router.get('/me',              auth, authController.getCurrentUser);
router.put('/status',          auth, authController.updateUserStatus);
router.get('/agents',          auth, authController.getAgents);
router.post('/profile-change', auth, authController.submitProfileChange);

// Profile & Settings (self-service, no approval needed)
router.put('/profile',         auth, authController.updateProfile);
router.put('/change-password', auth, authController.changePassword);
router.put('/preferences',     auth, authController.updatePreferences);
router.get('/login-activity',  auth, authController.getLoginActivity);

// ── Admin only ───────────────────────────────────────────────────────────────
router.get('/team',               auth, authorize(['admin']), authController.getTeamMembers);
router.post('/invite',            auth, authorize(['admin']), authController.inviteAgent);
router.post('/resend-invite/:id', auth, authorize(['admin']), authController.resendInvite);
router.delete('/team/:id',        auth, authorize(['admin']), authController.deleteTeamMember);

// Approval workflow
router.get('/pending-approvals',           auth, authorize(['admin']), authController.getPendingApprovals);
router.post('/approve-registration/:id',   auth, authorize(['admin']), authController.approveRegistration);
router.post('/reject-registration/:id',    auth, authorize(['admin']), authController.rejectRegistration);
router.post('/approve-profile/:id',        auth, authorize(['admin']), authController.approveProfileChange);
router.post('/reject-profile/:id',         auth, authorize(['admin']), authController.rejectProfileChange);
router.post('/approve-password-reset/:id', auth, authorize(['admin']), authController.approvePasswordReset);
router.post('/reject-password-reset/:id',  auth, authorize(['admin']), authController.rejectPasswordReset);

module.exports = router;