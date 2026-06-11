const express = require('express');
const ticketController  = require('../controllers/ticketController');
const messageController = require('../controllers/messageController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/reports',        auth,                              ticketController.getReports);
router.get('/dashboard-stats',auth,                              ticketController.getDashboardStats);
router.post('/',              auth,                              ticketController.createTicket);
router.get('/',               auth,                              ticketController.getTickets);
router.get('/:id',            auth,                              ticketController.getTicket);
router.put('/:id',            auth, authorize(['admin','agent']),ticketController.updateTicket);
router.put('/:id/close',      auth, authorize(['admin','agent']),ticketController.closeTicket);
router.delete('/:id',         auth, authorize(['admin']),        ticketController.deleteTicket);

router.post('/merge',                     auth, authorize(['admin','agent']), ticketController.mergeTickets);
router.post('/:ticketId/messages',       auth, messageController.addMessage);
router.get('/:ticketId/messages',        auth, messageController.getMessages);
router.post('/:ticketId/customer-reply', messageController.addCustomerReply);

module.exports = router;