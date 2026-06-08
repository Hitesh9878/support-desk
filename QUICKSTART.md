# SupportDesk Pro - Quick Start Guide

Get SupportDesk Pro up and running in 5 minutes!

## Option 1: Docker (Recommended - Easiest)

### Prerequisites
- Docker and Docker Compose installed
- 5 minutes of your time

### Step 1: Clone/Download Project
```bash
cd supportdesk-pro
```

### Step 2: Create Environment File
```bash
cp .env.example .env
```

Edit `.env` if you want to enable Gmail integration:
```env
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-app-password
```

### Step 3: Start Everything
```bash
docker-compose up -d
```

### Step 4: Access the Application
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **MongoDB**: localhost:27017

### Step 5: Create First Account
1. Go to http://localhost:3000
2. Click "Register"
3. Fill in details:
   - Name: Your Name
   - Email: admin@example.com
   - Password: password123
   - Role: Administrator
4. Click "Create Account"

### Done!
You're now logged in to the dashboard. Start creating tickets!

### Stop the Services
```bash
docker-compose down
```

---

## Option 2: Local Development (Manual Setup)

### Prerequisites
- Node.js 18+
- MongoDB running locally
- 10 minutes of your time

### Step 1: Install Backend
```bash
cd server
npm install
```

### Step 2: Configure Backend
```bash
cp .env.example .env
# Edit .env with your settings
```

### Step 3: Start Backend
```bash
npm run dev
# Server will run on http://localhost:5000
```

### Step 4: Serve Frontend
In a new terminal:
```bash
npx http-server public -p 3000
# Frontend will run on http://localhost:3000
```

### Step 5: Create Your Account
Same as Docker option above.

---

## First Steps After Login

### 1. Create a Customer
- Click "New Customer" button
- Fill in customer details
- Click "Create Customer"

### 2. Create a Support Ticket
- Click "New Ticket"
- Select the customer
- Enter subject and description
- Select priority
- Click "Create Ticket"

### 3. Assign Ticket to Agent
- Go to Tickets page
- Click on a ticket
- Select an agent from "Assigned To" dropdown
- Ticket is now assigned

### 4. Add Message to Ticket
- In ticket detail view
- Type in the "Type your reply" box
- Click "Send Reply"
- Message appears in conversation

### 5. Close a Ticket
- In ticket detail, change status to "Closed"
- Activity log automatically updates
- Ticket moves to closed status

---

## Key Features to Explore

### Dashboard
- Quick statistics overview
- Recent tickets list
- Create ticket/customer buttons

### Tickets Page
- Filter by status and priority
- Pagination support
- Full conversation view
- Activity timeline
- Status management

### Customers Page
- Customer directory
- Search functionality
- View customer ticket history
- Edit customer info

### Reports
- Ticket statistics
- Priority distribution
- Status breakdown
- Agent performance
- Customer activity

---

## Default Test Account (Docker)

After starting with Docker:

**Admin Account:**
- Email: admin@test.com
- Password: admin123
- Role: Administrator

*You can create this account during the initial registration step*

---

## Useful Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + K` | Quick search (coming soon) |
| `Escape` | Close modals |
| `Tab` | Navigate form fields |

---

## Need More Help?

- **README.md** - Full documentation
- **GMAIL_SETUP.md** - Email integration guide
- **API_DOCS.md** - Complete API reference (check server/API_DOCS.md)

---

## Common Issues

### Port Already in Use
```bash
# Port 3000 or 5000 already in use?
# Change ports in docker-compose.yml or startup command

# Local: Use different port
npx http-server public -p 8000
```

### MongoDB Connection Error
```bash
# Ensure MongoDB is running
mongod

# Or use MongoDB Atlas connection string in .env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/supportdesk
```

### Gmail Not Working
See GMAIL_SETUP.md for detailed instructions

---

## Troubleshooting Checklist

Before reporting an issue, check:
- [ ] All required ports are available (3000, 5000, 27017)
- [ ] MongoDB is running
- [ ] Backend server started without errors
- [ ] Frontend loads at http://localhost:3000
- [ ] Can log in with test account
- [ ] Browser console shows no errors (F12)
- [ ] .env file is correctly configured

---

## Next Steps

1. **Configure Gmail** (optional)
   - Follow GMAIL_SETUP.md
   - Enable email-to-ticket conversion

2. **Customize Branding**
   - Edit app name in sidebar
   - Customize colors in CSS
   - Update logo/favicon

3. **Deploy to Production**
   - See README.md deployment section
   - Configure HTTPS/SSL
   - Set strong JWT_SECRET

4. **Backup Your Data**
   - Export MongoDB regularly
   - Set up automated backups
   - Test restore procedures

---

## Project Structure Overview

```
supportdesk-pro/
├── server/              # Backend (Node.js/Express)
├── public/              # Frontend (HTML/CSS/JS)
├── docker-compose.yml   # Docker setup
├── README.md           # Full documentation
└── GMAIL_SETUP.md      # Email integration
```

---

## Performance Tips

1. **Database Indexing**: Already configured for main fields
2. **Caching**: Implement Redis for frequently accessed data
3. **Pagination**: Using 10 items per page by default
4. **Query Limits**: Fetching max 1000 items at once

---

## Security Reminders

- Change JWT_SECRET for production
- Use environment variables for secrets
- Enable HTTPS in production
- Keep dependencies updated
- Regular security audits

---

**Ready to support your customers? Let's go! 🚀**

For detailed information, see README.md or GMAIL_SETUP.md
