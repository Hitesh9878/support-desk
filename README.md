# SupportDesk Pro - Advanced Support Ticket Management System

A comprehensive, modular support ticket management system built with Node.js, Express, MongoDB, and vanilla JavaScript/HTML/CSS.

## Features

### Core Functionality
- **Ticket Management**: Create, assign, track, and resolve support tickets
- **Customer Management**: Maintain customer profiles with ticket history
- **Role-Based Access Control**: Admin, Agent, and Customer roles
- **Real-time Updates**: Socket.IO integration for live ticket updates
- **Activity Logging**: Complete audit trail of all ticket changes
- **SLA Management**: Set and track service level agreements

### Advanced Features
- **Gmail Integration**: Automatically convert emails to tickets
- **Email Reply**: Send customer responses via Gmail
- **Internal Notes**: Agent-only annotations on tickets
- **Conversation History**: Full email and message threading
- **Multi-Status Tracking**: Open, In Progress, Waiting Customer, Resolved, Closed
- **Priority Management**: Low, Medium, High, Urgent priority levels
- **Customer Search**: Full-text search for customers and tickets

### Technical Features
- **RESTful API**: Comprehensive REST API with JWT authentication
- **WebSocket Events**: Real-time ticket and message updates
- **Docker Support**: Complete Docker and Docker Compose setup
- **MongoDB**: Document-based data storage with relationships
- **JWT Authentication**: Secure token-based authentication
- **CORS Support**: Cross-origin resource sharing configured

## Project Structure

```
supportdesk-pro/
├── server/                          # Backend (Node.js/Express)
│   ├── models/                      # MongoDB models
│   │   ├── User.js
│   │   ├── Ticket.js
│   │   ├── Customer.js
│   │   ├── Message.js
│   │   └── ActivityLog.js
│   ├── routes/                      # API routes
│   │   ├── auth.js
│   │   ├── tickets.js
│   │   ├── customers.js
│   │   └── gmail.js
│   ├── controllers/                 # Request handlers
│   ├── middleware/                  # Custom middleware
│   ├── services/                    # Business logic
│   │   └── gmailService.js
│   ├── config/                      # Configuration
│   ├── package.json
│   ├── Dockerfile
│   └── server.js                    # Main server file
│
├── public/                          # Frontend (HTML/CSS/JS)
│   ├── css/
│   │   └── style.css               # All styles
│   ├── js/
│   │   ├── api.js                  # API client
│   │   ├── auth.js                 # Authentication logic
│   │   ├── dashboard.js            # Dashboard script
│   │   ├── tickets.js              # Tickets page script
│   │   └── customers.js            # Customers page script
│   ├── login.html                  # Login/Register page
│   ├── dashboard.html              # Dashboard page
│   ├── tickets.html                # Tickets page
│   └── customers.html              # Customers page
│
├── docker-compose.yml              # Docker Compose configuration
├── GMAIL_SETUP.md                  # Gmail integration guide
└── README.md                        # This file
```

## Installation & Setup

### Prerequisites
- Node.js 18+ or Docker & Docker Compose
- MongoDB 7+ (or MongoDB Atlas)
- Gmail account with 2-Factor Authentication (for email integration)

### Local Development (Without Docker)

1. **Install Backend Dependencies**
   ```bash
   cd server
   npm install
   ```

2. **Configure Environment Variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start MongoDB**
   ```bash
   # Using local MongoDB
   mongod
   # Or use MongoDB Atlas connection string
   ```

4. **Start Backend Server**
   ```bash
   npm run dev
   # Server runs on http://localhost:5000
   ```

5. **Serve Frontend**
   ```bash
   # In another terminal, from project root
   npx http-server public -p 3000
   # Frontend runs on http://localhost:3000
   ```

### Docker Setup

1. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings (especially Gmail credentials)
   ```

2. **Start Services**
   ```bash
   docker-compose up -d
   ```

3. **Access Application**
   - Frontend: http://localhost:3000
   - Backend: http://localhost:5000
   - MongoDB: localhost:27017

4. **Stop Services**
   ```bash
   docker-compose down
   ```

## Configuration

### Environment Variables

**Backend (.env)**
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/supportdesk
JWT_SECRET=your_super_secret_key_here
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
GMAIL_POLLING_INTERVAL=30000
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
```

**Important**: Never commit `.env` to version control!

### Gmail Integration Setup

See [GMAIL_SETUP.md](GMAIL_SETUP.md) for detailed instructions on:
- Enabling 2-Factor Authentication
- Generating Gmail App Passwords
- Configuring email polling
- Setting up email webhooks

## API Documentation

### Authentication

**Register**
```
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "role": "agent"
}
```

**Login**
```
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "password123"
}
```

### Tickets

**Create Ticket**
```
POST /api/tickets
Authorization: Bearer {token}
Content-Type: application/json

{
  "subject": "Issue with payment",
  "description": "Cannot process payment",
  "customerId": "customer_id",
  "priority": "high"
}
```

**Get Tickets**
```
GET /api/tickets?status=open&priority=high&page=1&limit=10
Authorization: Bearer {token}
```

**Get Ticket Details**
```
GET /api/tickets/:id
Authorization: Bearer {token}
```

**Update Ticket**
```
PUT /api/tickets/:id
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "in-progress",
  "priority": "urgent",
  "assignedAgent": "agent_id"
}
```

**Add Message**
```
POST /api/tickets/:ticketId/messages
Authorization: Bearer {token}
Content-Type: application/json

{
  "body": "This is my response...",
  "isInternalNote": false
}
```

### Customers

**Create Customer**
```
POST /api/customers
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "Acme Corp",
  "email": "contact@acme.com",
  "phone": "+1-555-0123",
  "company": "Acme Corporation"
}
```

**Get Customers**
```
GET /api/customers?page=1&limit=10&search=acme
Authorization: Bearer {token}
```

**Update Customer**
```
PUT /api/customers/:id
Authorization: Bearer {token}
Content-Type: application/json

{
  "status": "inactive",
  "notes": "VIP customer"
}
```

### Gmail Integration

**Send Email Reply**
```
POST /api/gmail/send-reply/:ticketId
Authorization: Bearer {token}
Content-Type: application/json

{
  "body": "Thank you for your inquiry...",
  "ccEmails": ["cc@example.com"],
  "bccEmails": []
}
```

**Receive Webhook Email**
```
POST /api/gmail/webhook/incoming
Content-Type: application/json

{
  "from": "customer@email.com",
  "subject": "[TM-1001] Support request",
  "body": "Email content...",
  "messageId": "unique-id",
  "attachments": []
}
```

## User Roles & Permissions

### Admin
- Full access to all features
- User management
- System settings
- View all reports
- Delete customers and tickets

### Agent
- Create and manage tickets
- Add messages and replies
- Update ticket status and priority
- View customer information
- Send email replies
- View activity logs

### Customer
- Create tickets
- View own tickets
- Add messages to own tickets
- View ticket status

## Frontend Pages

### Login/Register (`login.html`)
- User authentication
- Account registration
- Tab-based form switching

### Dashboard (`dashboard.html`)
- Quick statistics overview
- Recent tickets list
- Quick action buttons
- Create ticket modal
- Create customer modal

### Tickets (`tickets.html`)
- Filterable ticket table
- Pagination
- Ticket detail modal
- Message conversation view
- Activity timeline
- Status and priority management

### Customers (`customers.html`)
- Customer directory
- Search and pagination
- Customer detail view
- Customer ticket history
- Edit customer information

## Real-Time Features

### WebSocket Events

**Broadcasting**
- `ticket:created` - New ticket created
- `ticket:updated` - Ticket status changed
- `message:added` - New message added
- `user:statusChanged` - Agent status changed

**Connection**
```javascript
const socket = io('http://localhost:5000');
socket.on('ticket:updated', (data) => {
  console.log('Ticket updated:', data);
});
```

## Styling

The application uses vanilla CSS (no CSS frameworks) with:
- CSS Variables for theming
- Flexbox and Grid layouts
- Mobile-responsive design
- Semantic HTML structure
- Accessibility best practices

**Color Scheme**
- Primary: #2563eb (Blue)
- Success: #10b981 (Green)
- Warning: #f59e0b (Amber)
- Danger: #ef4444 (Red)
- Neutral: #64748b (Slate)

## Deployment

### Docker Deployment

1. **Build Images**
   ```bash
   docker-compose build
   ```

2. **Push to Registry** (optional)
   ```bash
   docker tag supportdesk-backend your-registry/supportdesk-backend
   docker push your-registry/supportdesk-backend
   ```

3. **Deploy**
   ```bash
   docker-compose -f docker-compose.yml up -d
   ```

### Production Considerations

1. **Security**
   - Change JWT_SECRET to a strong random value
   - Use HTTPS/SSL certificates
   - Enable MongoDB authentication
   - Set CORS_ORIGIN to your domain
   - Use environment variables for all secrets

2. **Database**
   - Use MongoDB Atlas or managed database
   - Enable backups and replication
   - Configure connection pooling

3. **Email**
   - Use dedicated email service (SendGrid, Mailgun, etc.)
   - Implement rate limiting
   - Monitor email delivery

4. **Monitoring**
   - Set up error tracking (Sentry)
   - Monitor server health
   - Log all requests
   - Track performance metrics

5. **Scaling**
   - Use load balancer for multiple backend instances
   - Implement caching (Redis)
   - Configure database indexing
   - Use CDN for static files

## Troubleshooting

### Backend Won't Start
- Check MongoDB connection string
- Verify PORT is not in use
- Check .env file exists and is valid
- Review server logs for errors

### Frontend Can't Connect
- Verify backend is running on port 5000
- Check CORS_ORIGIN setting
- Verify JWT token is being sent
- Check browser console for errors

### Gmail Integration Not Working
- Verify GMAIL_USER and GMAIL_APP_PASSWORD are correct
- Check 2-Factor Authentication is enabled
- Enable IMAP in Gmail settings
- Review server logs for polling errors

### Docker Issues
- Ensure Docker daemon is running
- Check port availability (3000, 5000, 27017)
- View logs: `docker-compose logs -f`
- Restart services: `docker-compose restart`

## Development

### Adding New Features

1. **Backend**
   - Create model in `server/models/`
   - Create controller in `server/controllers/`
   - Create routes in `server/routes/`
   - Add to `server.js`

2. **Frontend**
   - Add HTML to respective page
   - Add CSS to `public/css/style.css`
   - Add JavaScript to `public/js/`
   - Update API calls in `public/js/api.js`

### Code Style
- Use camelCase for variables
- Use PascalCase for classes/models
- Add comments for complex logic
- Keep functions under 50 lines
- Use descriptive variable names

## License

MIT License - See LICENSE file for details

## Support & Contribution

For issues, feature requests, or contributions:
- Open an issue on GitHub
- Submit a pull request with improvements
- Contact support for urgent matters

## Changelog

### Version 1.0.0 (Initial Release)
- Complete ticket management system
- Customer management module
- Gmail integration
- Docker support
- Comprehensive documentation

---

**Built with ❤️ for support teams worldwide**
