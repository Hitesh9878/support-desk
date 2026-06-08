const Customer = require('../models/Customer');

// Create customer
exports.createCustomer = async (req, res) => {
  try {
    const { name, email, phone, company, notes } = req.body;

    // Check if customer exists
    let customer = await Customer.findOne({ email });
    if (customer) {
      return res.status(400).json({ message: 'Customer already exists' });
    }

    customer = new Customer({
      name,
      email,
      phone,
      company,
      notes
    });

    await customer.save();

    res.json({
      message: 'Customer created successfully',
      customer
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all customers
exports.getCustomers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    let query = {};

    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { company: { $regex: search, $options: 'i' } }
        ]
      };
    }

    const customers = await Customer.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Customer.countDocuments(query);

    res.json({
      customers,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get customer by ID
exports.getCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update customer
exports.updateCustomer = async (req, res) => {
  try {
    const { name, phone, company, notes, status } = req.body;
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      {
        name,
        phone,
        company,
        notes,
        status,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json({
      message: 'Customer updated successfully',
      customer
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete customer
exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
