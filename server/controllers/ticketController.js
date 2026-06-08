const Ticket      = require('../models/Ticket');
const Message     = require('../models/Message');
const Customer    = require('../models/Customer');
const ActivityLog = require('../models/ActivityLog');
const User        = require('../models/User');
const notify      = require('../services/notificationService');

let rrIndex = 0;

const getNextActiveAgent = async () => {
  // Round-robin across active agents & admins
  const agents = await User.find({ 
    role: { $in: ['agent', 'admin'] }, 
    status: 'active'
  })
    .select('_id name email notif_assignment notif_email notif_new_ticket notif_customer_reply')
    .sort({ createdAt: 1 });
  if (!agents.length) return null;
  rrIndex = rrIndex % agents.length;
  const a = agents[rrIndex];
  rrIndex = (rrIndex + 1) % agents.length;
  return a;
};

// ─── Helper: fire assignment email for any scenario ───────────────────────────
// Fetches a fully populated ticket so customer.name/email are always available
// ALWAYS sends email regardless of agent online status
const fireAssignmentEmail = async (agentId, ticketId, type = 'assigned') => {
  try {
    const [agent, ticket] = await Promise.all([
      User.findById(agentId).select('name email notif_assignment notif_email notif_new_ticket notif_customer_reply'),
      Ticket.findById(ticketId)
        .populate('customer', 'name email')
        .populate('assignedAgent', 'name email')
    ]);
    if (!agent?.email) {
      console.warn(`[Notify] ⚠️ Agent ${agentId} has no email — CANNOT send assignment email`);
      return false;
    }
    if (!ticket) {
      console.warn(`[Notify] ⚠️ Ticket ${ticketId} not found — CANNOT send assignment email`);
      return false;
    }
    const result = await notify.sendTicketAssignedEmail(agent, ticket, type);
    if (result) {
      console.log(`[Notify] ✅ Assignment email sent to ${agent.email} for ticket ${ticket.ticketNumber}`);
    } else {
      console.warn(`[Notify] ⚠️ Assignment email failed for ${agent.email}`);
    }
    return result;
  } catch (err) {
    console.error('[Notify] ❌ fireAssignmentEmail error:', err.message);
    return false;
  }
};

// ─── Create ticket ─────────────────────────────────────────────────────────────
exports.createTicket = async (req, res) => {
  try {
    const { subject, description, customerId, priority, category } = req.body;
    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(400).json({ message: 'Customer not found' });

    const ticket = new Ticket({
      subject, description, customer: customerId, priority, category, channel: 'web'
    });
    await ticket.save();

    await ActivityLog.create({
      ticket: ticket._id, user: req.user.userId,
      action: 'created', actionType: 'create', description: 'Ticket created'
    });
    customer.totalTickets += 1;
    await customer.save();

    res.json({ message: 'Ticket created', ticket });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Get tickets ───────────────────────────────────────────────────────────────
exports.getTickets = async (req, res) => {
  try {
    const { status, priority, customerId, assignedAgent, unassigned, search } = req.query;
    const page  = parseInt(req.query.page, 10)  || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const filters = {};

    if (status)        filters.status        = status;
    if (priority)      filters.priority      = priority;
    if (customerId)    filters.customer      = customerId;
    if (assignedAgent) filters.assignedAgent = assignedAgent;
    if (unassigned === 'true') filters.assignedAgent = { $exists: false };
    if (search) filters.$or = [
      { subject:     { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];

    const tickets = await Ticket.find(filters)
      .populate('customer', 'name email')
      .populate('assignedAgent', 'name avatar status')
      .sort({ createdAt: -1 }).limit(limit).skip((page - 1) * limit);

    const total = await Ticket.countDocuments(filters);
    res.json({ tickets, totalPages: Math.ceil(total / limit), currentPage: page, total });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Get single ticket ─────────────────────────────────────────────────────────
exports.getTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('customer')
      .populate('assignedAgent', 'name avatar status email')
      .populate('linkedTickets', 'ticketNumber subject');
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    const messages   = await Message.find({ ticket: req.params.id })
      .populate('sender', 'name avatar').sort({ createdAt: 1 });
    const activities = await ActivityLog.find({ ticket: req.params.id })
      .populate('user', 'name avatar').sort({ createdAt: -1 });

    res.json({ ticket, messages, activities });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Update ticket ─────────────────────────────────────────────────────────────
exports.updateTicket = async (req, res) => {
  try {
    const { status, priority, assignedAgent, category, autoAssign } = req.body;

    // Fetch WITHOUT populate so oldAgent is a clean string comparison
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    const oldStatus   = ticket.status;
    const oldPriority = ticket.priority;
    const oldAgent    = ticket.assignedAgent ? ticket.assignedAgent.toString() : null;

    if (status)   ticket.status   = status;
    if (priority) ticket.priority = priority;
    if (category) ticket.category = category;

    const assignable      = ['open', 'in-progress', 'waiting-customer'];
    const effectiveStatus = status || ticket.status;
    let assignedToId = null;   // the new agent's _id string, set in any assignment path
    let assignType   = 'assigned';

    // ── Manual assignment ──────────────────────────────────────────────────────
    if (assignedAgent !== undefined) {
      if (!assignable.includes(effectiveStatus))
        return res.status(400).json({ message: `Cannot assign a "${effectiveStatus}" ticket.` });
      ticket.assignedAgent = assignedAgent || null;
      if (assignedAgent) assignedToId = assignedAgent.toString();
    }

    // ── Auto-assign (admin button) ─────────────────────────────────────────────
    if (autoAssign) {
      if (req.user.role !== 'admin')
        return res.status(403).json({ message: 'Only admins can trigger auto-assign.' });
      if (!assignable.includes(effectiveStatus))
        return res.status(400).json({ message: `Cannot auto-assign a "${effectiveStatus}" ticket.` });
      const agent = await getNextActiveAgent();
      if (!agent) return res.status(400).json({ message: 'No active agents available.' });
      ticket.assignedAgent = agent._id;
      assignedToId = agent._id.toString();
      assignType   = 'auto_assigned';
    }

    ticket.updatedAt = new Date();
    await ticket.save();

    // Activity logs
    if (status && status !== oldStatus)
      await ActivityLog.create({
        ticket: ticket._id, user: req.user.userId,
        action: 'status_changed', actionType: 'status_change',
        oldValue: oldStatus, newValue: status
      });
    if (priority && priority !== oldPriority)
      await ActivityLog.create({
        ticket: ticket._id, user: req.user.userId,
        action: 'priority_changed', actionType: 'update',
        oldValue: oldPriority, newValue: priority
      });

    const newAgent = ticket.assignedAgent ? ticket.assignedAgent.toString() : null;

    if (newAgent && newAgent !== oldAgent) {
      const agentUser = await User.findById(newAgent).select('name');
      await ActivityLog.create({
        ticket: ticket._id, user: req.user.userId,
        action: assignType, actionType: 'assign',
        description: agentUser ? `Assigned to ${agentUser.name}` : 'Agent assigned',
        newValue: agentUser?.name || 'Unknown'
      });

      // ── Fire assignment email — ALWAYS send, with confirmation logging ────────
      // Use immediate callback to not delay response, but ensure email is attempted
      (async () => {
        try {
          const emailSent = await fireAssignmentEmail(newAgent, ticket._id, assignType);
          if (!emailSent) {
            console.warn(`[Assignment] Email notification failed for ticket ${ticket.ticketNumber} → agent ${newAgent}`);
          }
        } catch (emailErr) {
          console.error(`[Assignment] Email error for ticket ${ticket.ticketNumber}:`, emailErr.message);
        }
      })();
    }

    const populated = await Ticket.findById(ticket._id)
      .populate('customer', 'name email')
      .populate('assignedAgent', 'name avatar status email');

    const io = req.app.get('io');
    if (io) {
      io.emit('ticket:updated', populated);
      if (newAgent && newAgent !== oldAgent)
        io.emit('ticket:assigned', {
          ticketId: ticket._id.toString(),
          agentId:  newAgent,
          ticketNumber: ticket.ticketNumber
        });
    }

    res.json({ message: 'Ticket updated', ticket: populated });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Delete ticket (admin only) ────────────────────────────────────────────────
exports.deleteTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    await Promise.all([
      Message.deleteMany({ ticket: ticket._id }),
      ActivityLog.deleteMany({ ticket: ticket._id }),
      Ticket.findByIdAndDelete(ticket._id)
    ]);

    const io = req.app.get('io');
    if (io) io.emit('ticket:deleted', { ticketId: ticket._id.toString() });

    res.json({ message: `Ticket ${ticket.ticketNumber} deleted successfully` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Close ticket ──────────────────────────────────────────────────────────────
exports.closeTicket = async (req, res) => {
  try {
    const ticket = await Ticket.findByIdAndUpdate(
      req.params.id,
      { status: 'closed', resolvedAt: new Date(), updatedAt: new Date() },
      { new: true }
    );
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    await ActivityLog.create({
      ticket: ticket._id, user: req.user.userId,
      action: 'closed', actionType: 'status_change', newValue: 'closed'
    });
    res.json({ message: 'Ticket closed', ticket });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Reports (role-scoped) ─────────────────────────────────────────────────────
exports.getReports = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const query   = isAdmin ? {} : { assignedAgent: req.user.userId };

    const allTickets = await Ticket.find(query)
      .populate('assignedAgent', 'name')
      .populate('customer', 'name email')
      .lean();

    const total    = allTickets.length;
    const open     = allTickets.filter(t => t.status === 'open').length;
    const resolved = allTickets.filter(t => ['resolved','closed'].includes(t.status)).length;

    let totalMs = 0, resCount = 0;
    allTickets.forEach(t => {
      if (t.resolvedAt && t.createdAt) {
        totalMs += new Date(t.resolvedAt) - new Date(t.createdAt);
        resCount++;
      }
    });
    const avgResolutionHours = resCount > 0 ? Math.round(totalMs / resCount / 3600000) : 0;
    const slaCompliance = Math.round(
      (allTickets.filter(t => !t.slaBreached).length / Math.max(total, 1)) * 100
    );

    const priorities = { low: 0, medium: 0, high: 0, urgent: 0 };
    allTickets.forEach(t => { if (t.priority in priorities) priorities[t.priority]++; });

    const statuses = { open: 0, 'in-progress': 0, 'waiting-customer': 0, resolved: 0, closed: 0 };
    allTickets.forEach(t => { if (t.status in statuses) statuses[t.status]++; });

    const agentMap = {};
    allTickets.forEach(t => {
      if (!t.assignedAgent) return;
      const id   = t.assignedAgent._id?.toString();
      const name = t.assignedAgent.name || 'Unknown';
      if (!agentMap[id]) agentMap[id] = { name, assigned: 0, resolved: 0 };
      agentMap[id].assigned++;
      if (['resolved','closed'].includes(t.status)) agentMap[id].resolved++;
    });

    const customerMap = {};
    allTickets.forEach(t => {
      if (!t.customer) return;
      const id   = t.customer._id?.toString();
      const name = t.customer.name || 'Unknown';
      if (!customerMap[id]) customerMap[id] = { name, total: 0, active: 0, resolved: 0 };
      customerMap[id].total++;
      if (['resolved','closed'].includes(t.status)) customerMap[id].resolved++;
      else customerMap[id].active++;
    });

    const thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    const activity  = {};
    allTickets.forEach(t => {
      if (new Date(t.createdAt) >= thirtyAgo) {
        const key = new Date(t.createdAt).toISOString().split('T')[0];
        activity[key] = (activity[key] || 0) + 1;
      }
    });

    res.json({
      scope: isAdmin ? 'all' : 'mine',
      stats: { total, open, resolved, avgResolutionHours, slaCompliance },
      priorities, statuses,
      agents:    Object.values(agentMap).sort((a, b) => b.assigned - a.assigned),
      customers: Object.values(customerMap).sort((a, b) => b.total - a.total).slice(0, 10),
      activity
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ─── Dashboard stats (role-scoped) ────────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const userId  = req.user.userId;
    const myQuery = { assignedAgent: userId };

    const [myOpen, myInProgress, myResolved,
           totalOpen, totalInProgress, totalResolved, totalAll, customerCount] =
      await Promise.all([
        Ticket.countDocuments({ ...myQuery, status: 'open' }),
        Ticket.countDocuments({ ...myQuery, status: 'in-progress' }),
        Ticket.countDocuments({ ...myQuery, status: { $in: ['resolved','closed'] } }),
        Ticket.countDocuments({ status: 'open' }),
        Ticket.countDocuments({ status: 'in-progress' }),
        Ticket.countDocuments({ status: { $in: ['resolved','closed'] } }),
        Ticket.countDocuments({}),
        Customer.countDocuments({})
      ]);

    const recentQuery = isAdmin ? {} : myQuery;
    const recent = await Ticket.find(recentQuery)
      .populate('customer', 'name email')
      .populate('assignedAgent', 'name')
      .sort({ createdAt: -1 }).limit(8);

    res.json({
      role: isAdmin ? 'admin' : 'agent',
      my:    { open: myOpen, inProgress: myInProgress, resolved: myResolved },
      total: { open: totalOpen, inProgress: totalInProgress, resolved: totalResolved, all: totalAll },
      customerCount, recentTickets: recent
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};
