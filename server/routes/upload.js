const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { auth: verifyToken } = require('../middleware/auth');
const multer = require('multer');

// Ensure upload directories exist
const uploadsDir = path.join(__dirname, '../../public/uploads');
const messageUploadsDir = path.join(uploadsDir, 'messages');

[uploadsDir, messageUploadsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure multer for message attachments
const messageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, messageUploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${timestamp}-${random}-${name}${ext}`);
  }
});

const messageUpload = multer({
  storage: messageStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    // Allow common file types for support tickets
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'text/plain',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/zip', 'application/x-rar-compressed'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  }
});

// Upload message attachments
router.post('/message-attachments', verifyToken, messageUpload.array('files', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.json({ uploadedFiles: [] });
    }

    const uploadedFiles = req.files.map(file => ({
      url:          `/uploads/messages/${file.filename}`,
      originalName: file.originalname,
      mimeType:     file.mimetype,
      size:         file.size
    }));

    res.json({
      message: 'Files uploaded successfully',
      uploadedFiles,
      count: uploadedFiles.length
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Upload failed: ' + error.message });
  }
});


// ── Avatar upload storage ───────────────────────────────────────────────────
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const avatarDir = path.join(__dirname, '../../public/uploads/avatars');
    if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });
    cb(null, avatarDir);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.userId || 'unknown';
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `avatar-${userId}${ext}`);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for avatars'));
    }
  }
});

// Upload avatar
router.post('/avatar', verifyToken, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // Update user record
    const User = require('../models/User');
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      { avatar: avatarUrl, updatedAt: new Date() },
      { new: true }
    ).select('-password -inviteToken -otpCode -otpSecret');

    res.json({ message: 'Avatar updated successfully', avatar: avatarUrl, user });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ message: 'Avatar upload failed: ' + error.message });
  }
});

module.exports = router;
