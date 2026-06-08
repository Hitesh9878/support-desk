require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');
const connectDB = require('./config/db');

// Routes
const authRoutes    = require('./routes/auth');
const ticketRoutes  = require('./routes/tickets');
const customerRoutes = require('./routes/customers');
const gmailRoutes   = require('./routes/gmail');
const uploadRoutes  = require('./routes/upload');

// Services
const gmailService = require('./services/gmailService');

const app    = express();
const server = http.createServer(app);
const io     = socketIO(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// DB
connectDB();

// Pass io to gmail routes so they can emit events
app.set('io', io);

// Start email polling (pass io for real-time events)
if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
  gmailService.startPollingService(io);
} else {
  console.warn('[Server] Gmail credentials not set — email integration disabled.');
}

// Routes
app.use('/api/auth',      authRoutes);
app.use('/api/auth',      uploadRoutes);   // avatar upload lives at /api/auth/avatar
app.use('/api/tickets',   ticketRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/gmail',     gmailRoutes);
app.use('/api/upload',    uploadRoutes);

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Socket.IO events
io.on('connection', (socket) => {
  console.log('[Socket] Client connected:', socket.id);

  socket.on('ticket:update',  (data) => io.emit('ticket:updated',  data));
  socket.on('ticket:new',     (data) => io.emit('ticket:created',  data));
  socket.on('message:new',    (data) => io.emit('message:added',   data));
  socket.on('user:status',    (data) => io.emit('user:statusChanged', data));

  socket.on('disconnect', () => {
    console.log('[Socket] Client disconnected:', socket.id);
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!', error: err.message });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`[Server] Running on port ${PORT}`));

module.exports = { app, io };
