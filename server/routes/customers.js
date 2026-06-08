const express = require('express');
const customerController = require('../controllers/customerController');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

router.post('/', auth, authorize(['admin', 'agent']), customerController.createCustomer);
router.get('/', auth, customerController.getCustomers);
router.get('/:id', auth, customerController.getCustomer);
router.put('/:id', auth, authorize(['admin', 'agent']), customerController.updateCustomer);
router.delete('/:id', auth, authorize(['admin']), customerController.deleteCustomer);

module.exports = router;
