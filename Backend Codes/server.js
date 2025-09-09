const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const moment = require('moment-timezone');
const CryptoJS = require('crypto-js');
const dotenv = require('dotenv');


const fs = require("fs");
const qrcode = require("qrcode-terminal");
const { Client } = require("whatsapp-web.js");

require("dotenv").config();
// WhatsApp Web.js integration



// Database configuration
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};


// Create Express app
const app = express();
const port = process.env.PORT;





// Middleware
app.use(cors());
app.use(express.json());

// Test database connection
async function testConnection() {
  try {
    const pool = await sql.connect(dbConfig);
    console.log('Connected to SQL Server');
    return pool;
  } catch (err) {
    console.error('Database connection error:', err);
    throw err;
  }
}



async function checkAccess(token, page) {
    let connection;
    
    try {
        // Connect to the database
        connection = await sql.connect(dbConfig);
        
        // Step 1: Compare raw token with tokens in Users table
        const userQuery = `
            SELECT id, is_active 
            FROM Users 
            WHERE token = @token
        `;
        
        const userRequest = connection.request();
        userRequest.input('token', sql.VarChar(255), token);
        const userResult = await userRequest.query(userQuery);
        
        // If no user found with this token
        if (userResult.recordset.length === 0) {
            return {
                status: 'error',
                message: 'Unauthorized access: Invalid token'
            };
        }
        
        const user = userResult.recordset[0];
        
        // Step 2: Check if user is active
        if (user.is_active !== 'Active') {
            return {
                status: 'error',
                message: 'Unauthorized access: User account is inactive'
            };
        }
        
        // Step 3: Check if user has access to the requested page
        const accessQuery = `
            SELECT ua.id 
            FROM UserAccess ua
            WHERE ua.user_id = @userId AND ua.page = @page
        `;
        
        const accessRequest = connection.request();
        accessRequest.input('userId', sql.VarChar(20), user.id);
        accessRequest.input('page', sql.VarChar(25), page);
        const accessResult = await accessRequest.query(accessQuery);
        
        // If no access found for this user and page
        if (accessResult.recordset.length === 0) {
            return {
                status: 'error',
                message: 'Unauthorized access: No permission for this page'
            };
        }
        
        // All checks passed - user is authorized
        return {
            status: 'success',
            message: 'Access granted',
            userId: user.id
        };
        
    } catch (error) {
        console.error('Database error:', error);
        return {
            status: 'error',
            message: 'Internal server error'
        };
    } finally {
        // Close the connection
        if (connection) {
            //await connection.close();
        }
    }
}











// Admin APIs

// Helper function to execute queries
async function executeQuery(query, params = {}) {
  try {
    const request = pool.request();
    for (const key in params) {
      request.input(key, params[key]);
    }
    const result = await request.query(query);
    return result;
  } catch (error) {
    console.error('Query execution error:', error);
    throw error;
  }
}

// API Routes

// Get all pages
app.get('/api/pages', async (req, res) => {

  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }


  try {
    const result = await executeQuery('SELECT page as id, page as name FROM Pages');
    res.json(result.recordset);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

// Get all users
// In the backend API, update the /api/users endpoint:

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const usersResult = await executeQuery(`
      SELECT 
        id, 
        name as username, 
        receiver as role, 
        COALESCE(is_active, 'Active') as status
      FROM Users
    `);
    
    // Get access permissions for each user
    const usersWithPermissions = await Promise.all(
      usersResult.recordset.map(async (user) => {
        const permissionsResult = await executeQuery(
          'SELECT page FROM UserAccess WHERE user_id = @userId',
          { userId: user.id }
        );
        
        const accessPermissions = permissionsResult.recordset.map(item => item.page);
        
        return {
          id: user.id,
          username: user.username,
          role: user.role,
          status: user.status,
          accessPermissions: accessPermissions
        };
      })
    );
    
    res.json(usersWithPermissions);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Also update the /api/users/:id endpoint:
app.get('/api/users/:id', async (req, res) => {

  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }


  try {
    const { id } = req.params;
    
    const userResult = await executeQuery(
      `SELECT 
        id, 
        name as username, 
        receiver as role, 
        COALESCE(is_active, 'Active') as status 
       FROM Users WHERE id = @id`,
      { id }
    );
    
    if (userResult.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const permissionsResult = await executeQuery(
      'SELECT page FROM UserAccess WHERE user_id = @id',
      { id }
    );
    
    const user = userResult.recordset[0];
    const accessPermissions = permissionsResult.recordset.map(item => item.page);
    
    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status,
      accessPermissions: accessPermissions
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create a new user
app.post('/api/users', async (req, res) => {

  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }


  try {
    const { id, username, password, role, status, accessPermissions } = req.body;
    
    // Validate required fields
    if (!id || !username || !password) {
      return res.status(400).json({ error: 'ID, username, and password are required' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Start transaction
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    try {
      // Insert user
      const request = new sql.Request(transaction);
      request.input('id', sql.VarChar, id);
      request.input('name', sql.VarChar, username);
      request.input('password', sql.VarChar, hashedPassword);
      request.input('receiver', sql.VarChar, role);
      request.input('status', sql.VarChar, status || 'Active');
      
      await request.query(`
        INSERT INTO Users (id, name, password, receiver, is_active)
        VALUES (@id, @name, @password, @receiver, @status)
      `);
      
      // Insert access permissions
      if (accessPermissions && accessPermissions.length > 0) {
        for (const page of accessPermissions) {
          const permRequest = new sql.Request(transaction);
          permRequest.input('user_id', sql.VarChar, id);
          permRequest.input('page', sql.VarChar, page);
          
          await permRequest.query(`
            INSERT INTO UserAccess (user_id, page)
            VALUES (@user_id, @page)
          `);
        }
      }
      
      await transaction.commit();
      res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Error creating user:', error);
    if (error.number === 2627) { // SQL Server unique constraint violation
      res.status(400).json({ error: 'User ID already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
});

// Update a user
app.put('/api/users/:id', async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }


  
  try {
    const { id } = req.params;
    const { username, password, role, status, accessPermissions } = req.body;
    
    // Start transaction
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    try {
      // Update user
      const request = new sql.Request(transaction);
      request.input('id', sql.VarChar, id);
      request.input('name', sql.VarChar, username);
      request.input('receiver', sql.VarChar, role);
      request.input('status', sql.VarChar, status || 'Active');
      
      let query = `
        UPDATE Users 
        SET name = @name, receiver = @receiver, is_active = @status
        WHERE id = @id
      `;
      
      // Update password if provided
      if (password) {
        const hashedPassword = await bcrypt.hash(password, 10);
        request.input('password', sql.VarChar, hashedPassword);
        query = `
          UPDATE Users 
          SET name = @name, password = @password, receiver = @receiver, is_active = @status
          WHERE id = @id
        `;
      }
      
      await request.query(query);
      
      // Update access permissions
      // First, remove existing permissions
      const deleteRequest = new sql.Request(transaction);
      deleteRequest.input('user_id', sql.VarChar, id);
      await deleteRequest.query('DELETE FROM UserAccess WHERE user_id = @user_id');
      
      // Then add new permissions
      if (accessPermissions && accessPermissions.length > 0) {
        for (const page of accessPermissions) {
          const permRequest = new sql.Request(transaction);
          permRequest.input('user_id', sql.VarChar, id);
          permRequest.input('page', sql.VarChar, page);
          
          await permRequest.query(`
            INSERT INTO UserAccess (user_id, page)
            VALUES (@user_id, @page)
          `);
        }
      }
      
      await transaction.commit();
      res.json({ message: 'User updated successfully' });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete a user
app.delete('/api/users/:id', async (req, res) => {
  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }


  try {
    const { id } = req.params;
    
    // Start transaction
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    
    try {
      // First delete user permissions
      const permRequest = new sql.Request(transaction);
      permRequest.input('user_id', sql.VarChar, id);
      await permRequest.query('DELETE FROM UserAccess WHERE user_id = @user_id');
      
      // Then delete the user
      const userRequest = new sql.Request(transaction);
      userRequest.input('id', sql.VarChar, id);
      await userRequest.query('DELETE FROM Users WHERE id = @id');
      
      await transaction.commit();
      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

















// APIs for authentication
/*/ API endpoint to get allowed pages for a user
app.get('/api/allowed-pages', async (req, res) => {

const pagesWithType = {
  "dashboard": ["dashboard"],
  "complaints": [
    "all-complaints",
    "launch-complaints",
    "delay-complaints",
    "nature"
  ],
  "users": [
    "all-users",
    "colonies",
    "skillman"
  ],
  "reporting": [
    "daily-report",
    "complaints-report",
    "skillman-report",
    "rating-report"
  ]
};



  let pool;
  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }
    
    // Create database connection
    pool = await sql.connect(dbConfig);
    
    // Query to get user ID from token
    const userQuery = `
      SELECT id 
      FROM Users 
      WHERE token = @token AND is_active = 'Active'
    `;
    
    const userResult = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query(userQuery);
    
    if (userResult.recordset.length === 0) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    
    // Get user ID from result
    const userId = userResult.recordset[0].id;
    
    // Query to get allowed pages for the user
    const pagesQuery = `
      SELECT p.page 
      FROM Pages p
      INNER JOIN UserAccess ua ON p.page = ua.page
      WHERE ua.user_id = @userId
      ORDER BY p.page
    `;
    
    const pagesResult = await pool.request()
      .input('userId', sql.VarChar(20), userId)
      .query(pagesQuery);
    
    // Extract page names from result
    const allowedPages = pagesResult.recordset.map(row => row.page);
    
    res.json({
      success: true,
      allowedPages: allowedPages
    });
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  } finally {
    // Close the connection
    if (pool) {
      //await pool.close();
    }
  }
});*/
app.get('/api/allowed-pages', async (req, res) => {
  let pool;
  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }
    
    // Create database connection
    pool = await sql.connect(dbConfig);
    
    // Query to get user ID from token
    const userQuery = `
      SELECT id 
      FROM Users 
      WHERE token = @token AND is_active = 'Active'
    `;
    
    const userResult = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query(userQuery);
    
    if (userResult.recordset.length === 0) {
      return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    }
    
    // Get user ID from result
    const userId = userResult.recordset[0].id;
    
    // Query to get all allowed pages for the user
    const pagesQuery = `
      SELECT p.page 
      FROM Pages p
      INNER JOIN UserAccess ua ON p.page = ua.page
      WHERE ua.user_id = @userId
      ORDER BY p.page
    `;
    
    const pagesResult = await pool.request()
      .input('userId', sql.VarChar(20), userId)
      .query(pagesQuery);
    
    // Extract page names from result
    const userAllowedPages = pagesResult.recordset.map(row => row.page);
    
    // Define the page structure
    const pagesWithType = {
      "dashboard": ["dashboard"],
      "complaints": [
        "launch-complaints",
        "all-complaints",
        "delay-complaints",
        "nature"
      ],
      "users": [
        "all-users",
        "colonies",
        "skillman"
      ],
      "reporting": [
        "daily-report",
        "complaints-report",
        "skillman-report",
        "rating-report"
      ],
      "admin": [
        "admin-panel"
      ]
    };
    
    // Prepare response object
    const responseData = {
      // All individual pages the user has access to
      allowedPages: userAllowedPages,
      
      // Navigation items for header and hamburger menu
      navigationItems: {}
    };
    
    // For each category, find the first page the user has access to
    for (const [category, pages] of Object.entries(pagesWithType)) {
      // Find the first page in this category that the user has access to
      const accessiblePage = pages.find(page => userAllowedPages.includes(page));
      
      if (accessiblePage) {
        // Add the first accessible page for this category
        responseData.navigationItems[category] = accessiblePage;
      }
    }
    
    res.json({
      success: true,
      ...responseData
    });
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  } finally {
    // Close the connection
    if (pool) {
      //await pool.close();
    }
  }
});


















// Whatsapp login
// --- WhatsApp Client ---
let client = new Client();

client.on("qr", (qr) => {
    console.log("📱 Scan this QR code to log in:");
    qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
    console.log("✅ Authenticated with WhatsApp");
});

client.on("ready", () => {
    console.log("🤖 WhatsApp client is ready!");
});

client.on("disconnected", (reason) => {
    console.log("⚠️ WhatsApp disconnected:", reason);
});

client.initialize();

// --- Express Endpoints ---
app.get("/", (req, res) => {
    res.send("🚀 WhatsApp API running. Use /whatsapp-logout to log out manually.");
});

app.get("/whatsapp-logout", async (req, res) => {
    try {
        await client.logout();
        res.send("✅ Logged out from WhatsApp.");
    } catch (err) {
        console.error("❌ Error logging out:", err);
        res.status(500).send("Error logging out from WhatsApp.");
    }
});

// --- Graceful Shutdown ---
async function shutdown() {
    console.log("\n⏹️ Shutting down server...");
    if (client) {
        try {
            await client.logout();
            console.log("✅ Logged out from WhatsApp before exit.");
        } catch (err) {
            console.error("❌ Failed to log out:", err.message);
        }
    }
    process.exit(0);
}

process.on("SIGINT", shutdown);   // CTRL+C
process.on("SIGTERM", shutdown);  // kill command












// Whatsapp message listener
// WhatsApp message event handler
client.on('message', async (message) => {
    try {
        // Ignore messages sent by ourselves
        if (message.fromMe) return;

        const senderNumber = message.from.replace('@c.us', '');
        console.log(`Message received from: ${senderNumber}`);

        // Normalize the incoming WhatsApp number to match database format
        const normalizedSenderNumber = normalizeToLocalFormat(senderNumber);
        console.log(`Normalized sender number: ${normalizedSenderNumber}`);

        // Check if sender is a customer
        let pool;
        try {
            pool = await sql.connect(dbConfig);

            // Check if this phone number belongs to a customer (compare with normalized number)
            const customerQuery = `
                SELECT c.customer_id, c.full_name 
                FROM Customers c 
                WHERE c.phone_number = @phoneNumber
            `;

            const customerResult = await pool.request()
                .input('phoneNumber', sql.NVarChar(20), normalizedSenderNumber)
                .query(customerQuery);

            if (customerResult.recordset.length === 0) {
                console.log(`Number ${normalizedSenderNumber} is not a registered customer`);
                console.log(`Original WhatsApp number: ${senderNumber}`);
                return; // Not a customer, ignore message
            }

            const customer = customerResult.recordset[0];
            const messageBody = message.body.trim();

            console.log(`Processing message from customer: ${customer.full_name}, Message: ${messageBody}`);

            // Check if this is a reply to our message
            if (message.hasQuotedMsg) {
                const quotedMsg = await message.getQuotedMessage();
                
                // Check if the quoted message is from us and contains a review request
                if (quotedMsg.fromMe && (quotedMsg.body.includes('rating') || quotedMsg.body.includes('rate'))) {
                    // Extract complaint ID from quoted message
                    const complaintIdMatch = quotedMsg.body.match(/#(HT\d+-\d+)/) || quotedMsg.body.match(/#(\w+-\d+)/);
                    if (complaintIdMatch) {
                        const complaintId = complaintIdMatch[1];
                        console.log(`Found complaint ID in reply: ${complaintId}`);
                        await processRatingReview(pool, normalizedSenderNumber, messageBody, complaintId, customer);
                        return;
                    }
                }
            }

            // If not a reply, check if message starts with rating digit (0-5)
            const ratingMatch = messageBody.match(/^([0-5])\s*(.*)$/);
            if (ratingMatch) {
                console.log(`Rating message detected: ${messageBody}`);
                
                // Find awaiting feedback for this customer
                const awaitingFeedbackQuery = `
                    SELECT cf.complaint_id 
                    FROM ComplaintFeedback cf
                    INNER JOIN Complaints c ON cf.complaint_id = c.complaint_id
                    INNER JOIN Customers cust ON c.customer_id = cust.customer_id
                    WHERE cust.phone_number = @phoneNumber 
                    AND cf.status = 'awaiting'
                    ORDER BY cf.created_at DESC
                `;

                const feedbackResult = await pool.request()
                    .input('phoneNumber', sql.NVarChar(20), normalizedSenderNumber)
                    .query(awaitingFeedbackQuery);

                if (feedbackResult.recordset.length > 0) {
                    const complaintId = feedbackResult.recordset[0].complaint_id;
                    console.log(`Found awaiting feedback for complaint: ${complaintId}`);
                    await processRatingReview(pool, normalizedSenderNumber, messageBody, complaintId, customer);
                } else {
                    console.log(`No awaiting feedback found for customer ${normalizedSenderNumber}`);
                    await sendMessage(senderNumber, "Thank you for your message. We don't have any pending review requests for you.");
                }
            } else {
                console.log(`Message doesn't start with rating digit (0-5): ${messageBody}`);
            }

        } catch (error) {
            console.error('Error processing message:', error);
        } finally {
            if (pool) {
                //await pool.close();
            }
        }

    } catch (error) {
        console.error('Error in message handler:', error);
    }
});

// Helper function to convert international format to local format
function normalizeToLocalFormat(phoneNumber) {
    let digitsOnly = phoneNumber.replace(/\D/g, '');
    
    // If number is in international format (92XXXXXXXXX), convert to local (0XXXXXXXXXX)
    if (digitsOnly.startsWith('92') && digitsOnly.length === 12) {
        return '0' + digitsOnly.substring(2);
    }
    else if (digitsOnly.startsWith('92') && digitsOnly.length > 12) {
        return '0' + digitsOnly.substring(2, 13);
    }
    
    // If already in local format or other format, return as is (up to 11 digits)
    return digitsOnly.length > 11 ? digitsOnly.substring(0, 11) : digitsOnly;
}

// Helper function to process rating and review
async function processRatingReview(pool, phoneNumber, messageBody, complaintId, customer) {
    const ratingMatch = messageBody.match(/^([0-5])[.\s]+(.*)$/);
    
    //here 
    const statusCheckQuery = `
        SELECT status 
        FROM ComplaintFeedback
        WHERE complaint_id = @complaintId
    `;

    const statusResult = await pool.request()
        .input('complaintId', sql.VarChar(25), complaintId)
        .query(statusCheckQuery);

    if (statusResult.recordset.length > 0 && statusResult.recordset[0].status === 'reviewed') {
        console.log(`Complaint ${complaintId} already reviewed by ${phoneNumber}`);
        await sendMessage(formatPhoneNumber(phoneNumber), "Your review has already been processed. You cannot submit another review for this complaint.");
        return;
    }

    if (!ratingMatch) {
        console.log(`Invalid rating format from ${phoneNumber}: ${messageBody}`);
        await sendMessage(phoneNumber, "Please send your rating in the format: '5 (Your review here)'. Rating should be 0-5 followed by your comments.");
        return;
    }

    const rating = parseInt(ratingMatch[1]);
    const review = ratingMatch[2].trim();

    console.log(`Processing rating: ${rating}, review: ${review} for complaint: ${complaintId}`);

    // Validate complaint exists and belongs to this customer
    const complaintCheckQuery = `
        SELECT c.complaint_id 
        FROM Complaints c
        INNER JOIN Customers cust ON c.customer_id = cust.customer_id
        WHERE c.complaint_id = @complaintId 
        AND cust.phone_number = @phoneNumber
    `;

    const complaintResult = await pool.request()
        .input('complaintId', sql.VarChar(25), complaintId)
        .input('phoneNumber', sql.NVarChar(20), phoneNumber)
        .query(complaintCheckQuery);

    if (complaintResult.recordset.length === 0) {
        console.log(`Complaint ${complaintId} not found for customer ${phoneNumber}`);
        await sendMessage(formatPhoneNumber(phoneNumber), "We couldn't find the complaint you're trying to review. Please contact support.");
        return;
    }

    // Update the feedback record
    const updateQuery = `
        UPDATE ComplaintFeedback 
        SET rating = @rating, 
            review = @review, 
            status = 'reviewed',
            created_at = GETDATE()
        WHERE complaint_id = @complaintId 
        AND status = 'awaiting'
    `;

    const updateResult = await pool.request()
        .input('rating', sql.Int, rating)
        .input('review', sql.NVarChar(sql.MAX), review)
        .input('complaintId', sql.VarChar(25), complaintId)
        .query(updateQuery);

    console.log(`Rating received - Complaint: ${complaintId}, Rating: ${rating}, Review: ${review}`);
    console.log(`Rows affected: ${updateResult.rowsAffected}`);

    // Send confirmation message
    let confirmationMessage = `Thank you, ${customer.full_name}!\n\n`;
    confirmationMessage += `Your rating of ${rating} stars has been recorded for complaint #${complaintId}.\n\n`;
    
    if (review) {
        confirmationMessage += `Review: "${review}"\n\n`;
    }
    
    confirmationMessage += `We appreciate your feedback!`;

    await sendMessage(formatPhoneNumber(phoneNumber), confirmationMessage);
}

// Helper function to send messages (convert back to international format for WhatsApp)
async function sendMessage(phoneNumber, text) {
    try {
        const formattedNumber = formatPhoneNumber(phoneNumber);
        const chatId = `${formattedNumber}@c.us`;
        await client.sendMessage(chatId, text);
        console.log(`Confirmation sent to: ${formattedNumber}`);
    } catch (error) {
        console.error('Error sending confirmation message:', error);
    }
}

// Phone number formatting function for WhatsApp (local to international)
function formatPhoneNumber(phoneNumber) {
    let digitsOnly = phoneNumber.replace(/\D/g, '');
    
    // Convert local format to international
    if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
        return '92' + digitsOnly.substring(1);
    }
    else if (digitsOnly.startsWith('0') && digitsOnly.length > 11) {
        return '92' + digitsOnly.substring(1, 12);
    }
    else if (!digitsOnly.startsWith('92') && digitsOnly.length === 10) {
        return '92' + digitsOnly;
    }
    
    // If already in international format or other, return as is
    return digitsOnly.length > 12 ? digitsOnly.substring(0, 12) : digitsOnly;
}
















// Your secret key (store this securely in environment variables in production)
//const SECRET_KEY = process.env.ENCRYPTION_SECRET || 'your-super-secret-key-here-256-bit';
const SECRET_KEY = process.env.ENCRYPTION_SECRET; // Example key, replace with a strong key

// Encrypt ID endpoint
app.post('/api/encrypt-id', async (req, res) => {

  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }

  
  try {
    const { complaint_id } = req.body;
    
    if (!complaint_id) {
      return res.status(400).json({
        success: false,
        message: 'Complaint ID is required'
      });
    }
    
    // Encrypt the complaint ID
    const encryptedId = CryptoJS.AES.encrypt(complaint_id.toString(), SECRET_KEY).toString();
    
    // URL-safe encoding (replace characters that might cause issues in URLs)
    const urlSafeEncryptedId = encryptedId
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    res.json({
      success: true,
      encrypted_id: urlSafeEncryptedId,
      message: 'ID encrypted successfully'
    });
    
  } catch (error) {
    console.error('Encryption error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during encryption'
    });
  }
});


// Optional: Decryption endpoint (if needed elsewhere in your application)
app.post('/api/decrypt-id', async (req, res) => {

  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }


  let pool;
  try {
    const { encrypted_id } = req.body;
    
    if (!encrypted_id) {
      return res.status(400).json({
        success: false,
        message: 'Encrypted ID is required'
      });
    }
    
    // Convert URL-safe format back to standard Base64
    const standardEncryptedId = encrypted_id
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Decrypt the ID
    const bytes = CryptoJS.AES.decrypt(standardEncryptedId, SECRET_KEY);
    const decryptedId = bytes.toString(CryptoJS.enc.Utf8);
    
    // Validate that we got a proper decrypted ID
    if (!decryptedId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid encrypted ID provided'
      });
    }
    
    // Connect to database and check if complaint exists
    pool = await sql.connect(dbConfig);
    
    const result = await pool.request()
      .input('complaintId', sql.VarChar, decryptedId)
      .query('SELECT COUNT(*) as count FROM Complaints WHERE complaint_id = @complaintId');
    
    const complaintExists = result.recordset[0].count > 0;
    
    if (!complaintExists) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found in the database'
      });
    }
    
    res.json({
      success: true,
      decrypted_id: decryptedId,
      message: 'ID decrypted successfully and validated'
    });
    
  } catch (error) {
    console.error('Decryption error:', error);
    
    // Determine appropriate error message
    let errorMessage = 'Internal server error during decryption';
    if (error instanceof sql.ConnectionError) {
      errorMessage = 'Database connection error';
    } else if (error instanceof sql.RequestError) {
      errorMessage = 'Database query error';
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage
    });
  } finally {
    // Close database connection if it was opened
    if (pool) {
      try {
        //await pool.close();
      } catch (closeError) {
        console.error('Error closing database connection:', closeError);
      }
    }
  }
});







// Endpoint for complaint details
app.get(`/data`, async (req, res) => {
  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }


  const { complaintId } = req.query;

  if (!complaintId) {
    return res.status(400).json({ error: 'complaintId query parameter is required' });
  }

  try {
    // Connect to the database
    await sql.connect(dbConfig);
    
    // SQL query to fetch all required data with joins
    // Fixed the column names based on your table structure
    const query = `
      SELECT 
        comp.customer_id,
        cust.full_name as customer_name,
        cust.phone_number as customer_phone,
        s.id as skillman_id,
        s.name as skillman_name,
        s.phoneNumber as skillman_contact,
        u.id as user_id,
        u.name as user_account,
        u.receiver as user_name,
        comp.launched_at as initiate_time,
        comp.assigned_at as assign_time,
        comp.completed_at as completion_time,
        cf.rating,
        cf.review,
        -- Adjust this based on your actual Colonies table structure
        CONCAT('GE DP ', N'➜ ', col.Name, N' ➜ ', l.building_number) as location,
        comp.status,
        comp.priority
      FROM Complaints comp
      INNER JOIN Customers cust ON comp.customer_id = cust.customer_id
      INNER JOIN Location l ON comp.location_id = l.location_id
      INNER JOIN Colonies col ON l.colony_number = col.ColonyNumber
      LEFT JOIN Skillmen s ON comp.skillman_id = s.id
      LEFT JOIN Users u ON comp.receiver_id = u.id
      LEFT JOIN ComplaintFeedback cf ON comp.complaint_id = cf.complaint_id
      WHERE comp.complaint_id = @complaintId
    `;

    const request = new sql.Request();
    request.input('complaintId', sql.VarChar(25), complaintId);

    const result = await request.query(query);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    // Format the data as required
    const formattedData = result.recordset.map(item => ({
      customerId: item.customer_id,
      customerName: item.customer_name,
      customerPhone: item.customer_phone,
      skillmanId: item.skillman_id,
      skillmanName: item.skillman_name,
      skillmanContact: item.skillman_contact,
      userId: item.user_id,
      userAccount: item.user_account,
      userName: item.user_name,
      initiateTime: item.initiate_time,
      assignTime: item.assign_time,
      completionTime: item.completion_time,
      rating: item.rating,
      review: item.review,
      location: item.location,
      status: item.status,
      priority: item.priority
    }));

    res.json(formattedData);

  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    // Close the connection if needed
    // await sql.close();
  }
});








// Complaints data endpoint
// Complaints data endpoint for a customer's history
app.get('/api/users-history', async (req, res) => {
  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }
  let pool;
  //console.log('Received request for /api/users-history');
  try {
    // Get complaintId from query parameter (required)
    const complaintId = req.query.complaintId;
    
    if (!complaintId) {
      return res.status(400).json({ error: 'complaintId parameter is required' });
    }
    
    // Connect to the database
    pool = await sql.connect(dbConfig);
    
    // First, get the customer ID from the provided complaint ID
    const customerQuery = `
      SELECT customer_id 
      FROM Complaints 
      WHERE complaint_id = @complaintId
    `;
    
    const customerRequest = pool.request();
    customerRequest.input('complaintId', sql.VarChar(25), complaintId);
    const customerResult = await customerRequest.query(customerQuery);
    
    if (customerResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    
    const customerId = customerResult.recordset[0].customer_id;
    
    // Now get all complaints for this customer except the provided one
    let queryString = `
      SELECT 
        c.complaint_id as id,
        CONVERT(VARCHAR, c.launched_at, 23) as date,
        col.Name + ', ' + l.building_number as location,
        c.nature,
        c.type as natureType,
        ISNULL(s.name, 'Not Assigned') as skillman,
        c.status
      FROM Complaints c
      LEFT JOIN Location l ON c.location_id = l.location_id
      LEFT JOIN Colonies col ON l.colony_number = col.ColonyNumber
      LEFT JOIN Skillmen s ON c.skillman_id = s.id
      WHERE c.customer_id = @customerId
      AND c.complaint_id != @complaintId
      ORDER BY c.launched_at DESC
    `;
    
    // Create request
    const request = pool.request();
    request.input('customerId', sql.Int, customerId);
    request.input('complaintId', sql.VarChar(25), complaintId);
    
    // Execute query
    const result = await request.query(queryString);
    
    // Send the results as JSON
    res.json(result.recordset);
    
  } catch (error) {
    console.error('Database query error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    // Close the connection
    if (pool) {
      //await pool.close();
    }
  }
});






// Retrieve Helper skillmen for complaint details
app.get('/api/helpers', async (req, res) => {

  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }




  const { complaintId } = req.query;
  //console.log('Helper call with id: '+complaintId);
  

  // Validate complaintId parameter
  if (!complaintId) {
    console.log("ID not found");
    return res.status(400).json({
      success: false,
      message: 'complaintId parameter is required'
    });
  }

  try {
    // Create connection pool
    const pool = await sql.connect(dbConfig);
    
    //console.log('Creating query');
    // Query to get all skillmen assigned to the specific complaint
    const query = `
      SELECT 
        s.id,
        s.name,
        s.phoneNumber as phone,
        s.designation,
        s.subdivision,
        s.status
      FROM Skillmen s
      INNER JOIN ComplaintsHelpers ch ON s.id = ch.skillman_id
      WHERE ch.complaint_id = @complaintId
      ORDER BY s.name
    `;
    
    // Execute the query
    const result = await pool.request()
      .input('complaintId', sql.VarChar(25), complaintId)
      .query(query);
    
    // Close the connection
    //await pool.close();
    
    // Format the response
    const helpers = result.recordset.map(helper => ({
      id: helper.id,
      name: helper.name,
      phone: helper.phone,
      designation: helper.designation,
      subdivision: helper.subdivision,
      status: helper.status
    }));
    
    //console.log('Data sent');
    // Return the helpers data
    res.json(helpers);
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve helper data',
      error: error.message
    });
  }
});










// Whatsapp API to send reviewing request
app.post('/api/send-reviewing-request', async (req, res) => {

  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }


    
    const { phoneNumber, complaintId } = req.body;

    if (!phoneNumber || !complaintId) {
        return res.status(400).json({ message: 'Phone number and complaint ID are required' });
    }

    // Check if WhatsApp client is ready
    if (!client || !client.info) {
        console.error('WhatsApp client is not ready');
        return res.status(503).json({ 
            message: 'WhatsApp service is currently unavailable. Please try again later.' 
        });
    }

    let pool;
    try {
        // Connect to database
        pool = await sql.connect(dbConfig);
        
        // Check if complaint exists and get details
        const complaintQuery = `
            SELECT c.complaint_id, c.status, c.skillman_id, s.name as skillman_name,
                   cust.phone_number, cust.full_name
            FROM Complaints c
            LEFT JOIN Skillmen s ON c.skillman_id = s.id
            INNER JOIN Customers cust ON c.customer_id = cust.customer_id
            WHERE c.complaint_id = @complaintId
        `;

        const complaintResult = await pool.request()
            .input('complaintId', sql.VarChar(25), complaintId)
            .query(complaintQuery);

        if (complaintResult.recordset.length === 0) {
            return res.status(404).json({ message: 'Complaint not found' });
        }

        const complaint = complaintResult.recordset[0];
        const customerName = complaint.full_name;
        const skillmanName = complaint.skillman_name || 'our technician';

        // Check if complaint is completed - if not, return error to frontend
        if (complaint.status !== 'Completed') {
            return res.status(400).json({ 
                message: 'Complaint has not been completed yet',
                complaintStatus: complaint.status
            });
        }

        // Check if feedback already exists and is reviewed
        const existingFeedbackQuery = `
            SELECT feedback_id, status, rating 
            FROM ComplaintFeedback 
            WHERE complaint_id = @complaintId AND status = 'reviewed'
        `;

        const existingFeedbackResult = await pool.request()
            .input('complaintId', sql.VarChar(25), complaintId)
            .query(existingFeedbackQuery);

        // If complaint has already been reviewed, return error
        if (existingFeedbackResult.recordset.length > 0) {
            const feedback = existingFeedbackResult.recordset[0];
            return res.status(400).json({ 
                message: 'This complaint has already been reviewed',
                complaintStatus: complaint.status,
                existingRating: feedback.rating,
                feedbackStatus: feedback.status
            });
        }

        // Check for existing ComplaintFeedback records for this customer
        const customerFeedbackQuery = `
            SELECT cf.feedback_id, cf.status 
            FROM ComplaintFeedback cf
            INNER JOIN Complaints c ON cf.complaint_id = c.complaint_id
            INNER JOIN Customers cust ON c.customer_id = cust.customer_id
            WHERE cust.phone_number = @phoneNumber AND cf.status = 'awaiting'
        `;

        const customerFeedbackResult = await pool.request()
            .input('phoneNumber', sql.NVarChar(20), phoneNumber)
            .query(customerFeedbackQuery);

        // Update any existing 'awaiting' records for this customer to 'not_reviewed'
        if (customerFeedbackResult.recordset.length > 0) {
            await pool.request()
                .input('phoneNumber', sql.NVarChar(20), phoneNumber)
                .query(`
                    UPDATE cf 
                    SET cf.status = 'not_reviewed'
                    FROM ComplaintFeedback cf
                    INNER JOIN Complaints c ON cf.complaint_id = c.complaint_id
                    INNER JOIN Customers cust ON c.customer_id = cust.customer_id
                    WHERE cust.phone_number = @phoneNumber AND cf.status = 'awaiting'
                `);
        }

        // Check if feedback record already exists for this complaint (but not reviewed)
        const feedbackQuery = `
            SELECT feedback_id, status 
            FROM ComplaintFeedback 
            WHERE complaint_id = @complaintId AND status != 'reviewed'
        `;

        const feedbackResult = await pool.request()
            .input('complaintId', sql.VarChar(25), complaintId)
            .query(feedbackQuery);

        let feedbackExists = feedbackResult.recordset.length > 0;

        // Create or update feedback record
        if (feedbackExists) {
            // Update existing record to 'awaiting'
            await pool.request()
                .input('complaintId', sql.VarChar(25), complaintId)
                .query(`
                    UPDATE ComplaintFeedback 
                    SET status = 'awaiting', created_at = GETDATE()
                    WHERE complaint_id = @complaintId
                `);
        } else {
            // Create new feedback record
            await pool.request()
                .input('complaintId', sql.VarChar(25), complaintId)
                .query(`
                    INSERT INTO ComplaintFeedback (complaint_id, status)
                    VALUES (@complaintId, 'awaiting')
                `);
        }

        // Prepare WhatsApp message
        let message = `Respected ${customerName},\n\n`;
        message += `Your complaint #${complaintId} has been successfully resolved!\n\n`;
        message += `Please rate ${skillmanName}'s service:\n`;
        message += `0️⃣ - Not resolved\n`;
        message += `1️⃣ - Poor\n`;
        message += `2️⃣ - Fair\n`;
        message += `3️⃣ - Good\n`;
        message += `4️⃣ - Very Good\n`;
        message += `5️⃣ - Excellent\n\n`;
        message += `Reply with your rating (0-5) with a review.\n\n`;
        message += `4 (your review here)`;

        // Format phone number
        let digitsOnly = phoneNumber.replace(/\D/g, '');
        
        // Convert to international format for Pakistan numbers
        let internationalNumber;
        
        if (digitsOnly.startsWith('92') && digitsOnly.length === 12) {
            internationalNumber = digitsOnly;
        } else if (digitsOnly.startsWith('92') && digitsOnly.length > 12) {
            internationalNumber = digitsOnly.substring(0, 12);
        } else if (digitsOnly.startsWith('3') && digitsOnly.length === 10) {
            internationalNumber = '92' + digitsOnly;
        } else if (digitsOnly.startsWith('03') && digitsOnly.length === 11) {
            internationalNumber = '92' + digitsOnly.substring(1);
        } else if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
            internationalNumber = '92' + digitsOnly.substring(1);
        } else if (digitsOnly.length === 9 || digitsOnly.length === 10) {
            internationalNumber = '92' + digitsOnly;
        } else {
            internationalNumber = digitsOnly.length > 12 ? digitsOnly.substring(0, 12) : digitsOnly;
            console.warn(`Unknown phone number format: ${phoneNumber}, using: ${internationalNumber}`);
        }
        
        const whatsappId = `${internationalNumber}@c.us`;

        // Send WhatsApp message
        await client.sendMessage(whatsappId, message);
        
        console.log(`WhatsApp review request sent to ${internationalNumber} for complaint ${complaintId}`);

        res.json({ 
            message: 'Review request sent successfully',
            complaintStatus: complaint.status,
            feedbackUpdated: !feedbackExists
        });

    } catch (error) {
        console.error('Error in send-reviewing-request:', error);
        
        // Handle specific WhatsApp errors
        if (error.message.includes('Evaluation failed') || error.message.includes('not found')) {
            return res.status(503).json({ 
                message: 'WhatsApp service temporarily unavailable. Please try again later.',
                error: 'WhatsApp client error'
            });
        }
        
        res.status(500).json({ 
            message: 'Internal server error', 
            error: error.message 
        });
    } finally {
        if (pool) {
            //await pool.close();
        }
    }
});















//APIs for login

// 🔐 Generate a random token (256-bit = 64 hex chars)
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 📌 Login route
app.post('/login', async (req, res) => {
  const { id, password } = req.body;

  if (!id || !password) {
    return res.status(400).json({ error: 'ID and password are required' });
  }

  let pool;
  try {
    pool = await sql.connect(dbConfig);

    // Fetch user
    const result = await pool.request()
      .input('id', sql.VarChar(20), id)
      .query('SELECT * FROM dbo.Users WHERE id = @id');

    const user = result.recordset[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    console.log(`User ${user.name} logged in successfully`);
    // Generate and store token
    const token = generateToken();
    await pool.request()
      .input('id', sql.VarChar(20), id)
      .input('token', sql.VarChar(255), token)
      .query('UPDATE dbo.Users SET token = @token WHERE id = @id');

    return res.status(200).json({ token });

  } catch (err) {
    console.error('❌ Login error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    //but don't close the connection here
    //if (pool) await pool.close();
  }
});





// Token verification endpoint
app.post('/verify-token', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  try {
    await sql.connect(dbConfig);
    console.log('Connected to database');

    const result = await sql.query`
      SELECT id, name FROM Users WHERE token = ${token}
    `;

    if (result.recordset.length > 0) {
      console.log('Token verified for user:', result.recordset[0].name);
      return res.json({ 
        success: true, 
        user: {
          id: result.recordset[0].id,
          name: result.recordset[0].name
        }
      });
    } else {
      console.log('Invalid or expired token');
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
  } catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  } finally {
    //no need to close the connection here
    //sql.close();
  }
});




// Token verification endpoint with sending receiver name and access control
app.post('/verify-token-get-receiver', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  const { page_name: requestedPage } = req.body;

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  if (!requestedPage) {
    console.log('No page name provided');
    return res.status(400).json({ success: false, message: 'Page name is required' });
  }

  try {
    await sql.connect(dbConfig);
    console.log('Connected to database');

    // Check if user exists with this token and is active
    const userResult = await sql.query`
      SELECT id, name, receiver, is_active 
      FROM Users 
      WHERE token = ${token}
    `;

    if (userResult.recordset.length === 0) {
      console.log('Invalid or expired token');
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    const user = userResult.recordset[0];
    
    // Check if user is active
    if (user.is_active !== 'Active') {
      console.log('User account is inactive:', user.id);
      return res.status(401).json({ success: false, message: 'Account is inactive' });
    }

    // Check if user has access to the requested page
    const accessResult = await sql.query`
      SELECT ua.id 
      FROM UserAccess ua
      INNER JOIN Users u ON ua.user_id = u.id
      WHERE ua.user_id = ${user.id} AND ua.page = ${requestedPage} AND u.is_active = 'Active'
    `;

    if (accessResult.recordset.length === 0) {
      console.log('User does not have access to this page:', user.id, requestedPage);
      return res.status(403).json({ success: false, message: 'Access denied to this page' });
    }

    console.log('Token verified for user:', user.name);
    
    return res.json({ 
      success: true, 
      user: {
        id: user.id,
        name: user.name
      },
      receiver: {
        name: user.receiver || 'Administrator' // Fallback to 'Administrator' if receiver is null
      }
    });
  } catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({ success: false, message: 'Database error' });
  } finally {
    // No need to close the connection here
    // sql.close();
  }
});




// Logout functionality
app.post('/logout', async (req, res) => {
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }
  const token = authHeader.split(' ')[1];

  try {
    await sql.connect(dbConfig);

    const result = await sql.query`
      UPDATE Users SET token = NULL WHERE token = ${token}
    `;

    if (result.rowsAffected[0] > 0) {
      console.log('User logged out successfully');
      return res.json({ success: true, message: 'Logged out successfully' });
    } else {
      console.log('Invalid token, no user updated');
      return res.status(400).json({ success: false, message: 'Invalid token' });
    }

  } catch (err) {
    console.error('Error during logout:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    // Close the DB connection if needed
    if (sql.connected) {
      //await sql.close();
    }
  }
});








app.get('/api/count-based-on-priority', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);
    
    // Verify token validity
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    // Query to get counts by priority
    const result = await pool.request()
      .query(`
        SELECT 
          priority,
          COUNT(*) as count
        FROM Complaints
        GROUP BY priority
      `);

    // Format the results
    const counts = {
      immediate: 0,
      urgent: 0,
      routine: 0,
      deferred: 0
    };

    result.recordset.forEach(row => {
      const priority = row.priority.toLowerCase();
      if (counts.hasOwnProperty(priority)) {
        counts[priority] = row.count;
      }
    });

    res.json({
      success: true,
      counts: counts
    });

  } catch (error) {
    console.error('Error fetching priority counts:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  } finally {
    // Close the connection
    //await sql.close();
  }
});












// APIs for launch-complaint

// API endpoint to get address data
app.get('/api/addresses', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    // Connect to the database
    await sql.connect(dbConfig);
    
    // Query to get location data with user information
    const query = `
      SELECT 
        ISNULL(u.full_name, 'Vacant') AS customer,
        l.building_number AS buildingNo,
        c.Name AS colony,
        l.building_type AS apartment
      FROM Location l
      LEFT JOIN Accomodation a ON l.location_id = a.location_id
      LEFT JOIN Customers u ON a.customer_id = u.customer_id
      LEFT JOIN Colonies c ON l.colony_number = c.ColonyNumber
      ORDER BY l.location_id
    `;
    
    // Execute the query
    const result = await sql.query(query);
    
    // Send the results
    res.json(result.recordset);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Failed to fetch address data' });
  } finally {
    // Don't Close the connection
    //sql.close();
  }
});

// API endpoint to get colonies
app.get('/api/colonies', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    await sql.connect(dbConfig);
    
    const query = `
      SELECT 
        ColonyNumber AS id,
        Name AS name
      FROM Colonies
      ORDER BY Name
    `;
    
    const result = await sql.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Failed to fetch colonies' });
  } finally {
    //dont close
    //sql.close();
  }
});

// API endpoint to get apartment/building types
app.get('/api/apartment-types', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    await sql.connect(dbConfig);
    
    const query = `
      SELECT 
        building_type AS id,
        building_type AS name
      FROM TypeOfBuilding
      ORDER BY building_type
    `;
    
    const result = await sql.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Failed to fetch apartment types' });
  } finally {
    //Dont Close
    // sql.close();
  }
});













//Code to add new customer

// Initialize database connection
let pool;
testConnection().then(p => {
  pool = p;
}).catch(err => {
  console.error('Failed to initialize database connection:', err);
});

// Routes
app.post('/api/customers', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    const { name, email, phone } = req.body;
    
    // Basic validation
    if (!name || !phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name and phone are required fields' 
      });
    }
    
    // Check if customer already exists
    const checkResult = await pool.request()
      .input('phone', sql.VarChar(20), phone)
      .query('SELECT COUNT(*) AS count FROM Customers WHERE phone_number = @phone');
    
    if (checkResult.recordset[0].count > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Customer with this phone number already exists' 
      });
    }
    
    // Insert new customer with OUTPUT clause
    const insertResult = await pool.request()
      .input('name', sql.VarChar(100), name)
      .input('email', sql.VarChar(100), email || null)
      .input('phone', sql.VarChar(20), phone)
      .query(`
        INSERT INTO Customers (full_name, phone_number, email)
        OUTPUT INSERTED.customer_id, INSERTED.full_name, INSERTED.phone_number, INSERTED.email
        VALUES (@name, @phone, @email)
      `);
    
    res.json({ 
      success: true, 
      message: 'Customer saved successfully',
      customer: insertResult.recordset[0]
    });
  } catch (error) {
    console.error('Error saving customer:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get all customers (for testing)
app.get('/api/customers', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    const result = await pool.request()
      .query('SELECT * FROM Customers ORDER BY customer_id DESC');
    
    res.json(result.recordset);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});
















// GET /api/categories - Returns concatenated categories
app.get('/api/categories', async (req, res) => {

  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    const result = await pool.request().query(`
      SELECT 
        ROW_NUMBER() OVER (ORDER BY CONCAT(c.subdivision_name, '->', c.nature_name)) AS id,
        CONCAT(c.subdivision_name, '->', c.nature_name) AS name,
        c.subdivision_name,
        c.nature_name
      FROM Category c
      ORDER BY CONCAT(c.subdivision_name, '->', c.nature_name)
    `);

    res.json(result.recordset);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// GET /api/categories/:categoryId/types - Returns types for a category
app.get('/api/categories/:categoryId/types', async (req, res) => {
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    
    // First get the category details
    const categoryResult = await pool.request()
      .input('categoryId', sql.Int, req.params.categoryId)
      .query(`
        WITH OrderedCategories AS (
          SELECT 
            ROW_NUMBER() OVER (ORDER BY CONCAT(subdivision_name, '->', nature_name)) AS row_num,
            subdivision_name,
            nature_name
          FROM Category
        )
        SELECT subdivision_name, nature_name
        FROM OrderedCategories
        WHERE row_num = @categoryId
      `);

    if (categoryResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const category = categoryResult.recordset[0];

    // Now get the types for this nature_name
    const typesResult = await pool.request()
      .input('nature_name', sql.VarChar(150), category.nature_name)
      .query(`
        SELECT 
          ROW_NUMBER() OVER (ORDER BY type) AS id,
          type AS name
        FROM NatureTypes
        WHERE nature_name = @nature_name
        ORDER BY type
      `);

    res.json(typesResult.recordset);
  } catch (error) {
    console.error('Error fetching category types:', error);
    res.status(500).json({ error: 'Failed to fetch category types' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});
















app.get('/api/customers/search', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    // Step 2: Proceed with search if token is valid
    const search = req.query.q;

    if (!search) {
      return res.status(400).json({ error: 'Search term is required' });
    }

    // Step 3: Find user by name or phone
    const userResult = await pool.request()
      .input('search', sql.VarChar(100), `%${search}%`)
      .query(`
        SELECT TOP 1 * 
        FROM Customers 
        WHERE full_name LIKE @search OR phone_number LIKE @search
      `);

    if (userResult.recordset.length === 0) {
      return res.json({ exists: false });
    }

    const user = userResult.recordset[0];

    // Step 4: Find user's locations with all required fields
    const locationResult = await pool.request()
      .input('userId', sql.Int, user.customer_id)
      .query(`
        SELECT 
          l.location_id AS id,
          l.building_number,
          c.Name AS colony_name,
          l.building_type AS apartment_type,
          u.full_name AS customer_name,
          u.phone_number AS customer_phone
        FROM Accomodation a
        JOIN Location l ON a.location_id = l.location_id
        JOIN Colonies c ON l.colony_number = c.ColonyNumber
        JOIN Customers u ON a.customer_id = u.customer_id
        WHERE a.customer_id = @userId
      `);

    const locations = locationResult.recordset.map(loc => ({
      id: loc.id,
      label: `Customer: ${loc.customer_name}, Phone: ${loc.customer_phone}, Building: ${loc.building_number}, Colony: ${loc.colony_name}`,
      buildingNo: loc.building_number,
      colony: loc.colony_name,
      apartment: loc.apartment_type
    }));

    return res.json({
      exists: true,
      customer: {
        id: user.customer_id,
        name: user.FullName,
        phone: user.PhoneNumber,
        email: user.Email
      },
      locations
    });

  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
















app.post('/api/assign-location', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  let pool;
  let transaction;

  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    console.log('\n=== STARTING LOCATION ASSIGNMENT ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    // Validate request body
    if (!req.body) {
      throw new Error('Request body is empty');
    }

    // Handle both apartment and apartmentType parameters
    const apartment = req.body.apartment || req.body.apartmentType;
    const { customer, type, buildingNo, colony } = req.body;
    const area = req.body.area;
    const residentialStatus = req.body.residentialStatus;

    // Basic validation for all assignment types
    if (!customer || !buildingNo || !colony || !apartment) {
      throw new Error('Customer, buildingNo, colony, and apartment are required');
    }

    // Additional validation for new buildings
    if (type === 'new' && (!area || !residentialStatus)) {
      throw new Error('Area and residentialStatus are required for new buildings');
    }

    // Get database connection
    pool = await sql.connect(dbConfig);
    console.log('Connected to database');

    // Begin transaction
    transaction = new sql.Transaction(pool);
    await transaction.begin();
    console.log('Database transaction started');

    // 1. Find user by name or phone
    console.log('\n[Step 1] Searching for customer:', customer);
    const userResult = await transaction.request()
      .input('customer', sql.VarChar(100), `%${customer}%`)
      .query(`
        SELECT TOP 1 customer_id, full_name, phone_number 
        FROM Customers 
        WHERE full_name LIKE @customer OR phone_number LIKE @customer
      `);

    if (userResult.recordset.length === 0) {
      throw new Error(`Customer not found: ${customer}`);
    }
    const user = userResult.recordset[0];
    console.log('Found user:', user);

    // 2. Find colony - handle both colony name and colony number
    console.log('\n[Step 2] Processing colony:', colony);
    let colonyNumber;
    if (/^\d+$/.test(colony)) {
      // If colony is a number, verify it exists
      const colonyCheck = await transaction.request()
        .input('colonyNumber', sql.VarChar(30), colony)
        .query('SELECT Name FROM Colonies WHERE ColonyNumber = @colonyNumber');
      
      if (colonyCheck.recordset.length === 0) {
        throw new Error(`Colony number not found: ${colony}`);
      }
      colonyNumber = colony;
    } else {
      // Search colony by name
      const colonyResult = await transaction.request()
        .input('colonyName', sql.VarChar(100), colony)
        .query('SELECT ColonyNumber FROM Colonies WHERE Name = @colonyName');

      if (colonyResult.recordset.length === 0) {
        throw new Error(`Colony not found: ${colony}`);
      }
      colonyNumber = colonyResult.recordset[0].ColonyNumber;
    }
    console.log('Using colony number:', colonyNumber);

    // 3. Find or create location
    console.log('\n[Step 3] Processing location:', { buildingNo, colonyNumber, apartment });
    let locationId;
    
    // Check if location exists
    const locationResult = await transaction.request()
      .input('buildingNo', sql.VarChar(100), buildingNo)
      .input('colonyNumber', sql.VarChar(30), colonyNumber)
      .input('apartmentType', sql.VarChar(25), apartment)
      .query(`
        SELECT location_id 
        FROM Location 
        WHERE building_number = @buildingNo 
          AND colony_number = @colonyNumber
          AND building_type = @apartmentType
      `);

    if (locationResult.recordset.length > 0) {
      // Existing location found
      locationId = locationResult.recordset[0].location_id;
      console.log('Found existing location ID:', locationId);
    } else if (type === 'new') {
      // Create new location
      console.log('Creating new location with:', { buildingNo, apartment, colonyNumber, area, residentialStatus });
      const locationInsert = await transaction.request()
        .input('buildingNo', sql.VarChar(100), buildingNo)
        .input('buildingType', sql.VarChar(25), apartment)
        .input('residentialStatus', sql.VarChar(10), residentialStatus)
        .input('colonyNumber', sql.VarChar(30), colonyNumber)
        .input('area', sql.VarChar(10), area)
        .query(`
          INSERT INTO Location (
            building_number, 
            building_type, 
            resdl, 
            colony_number, 
            area
          )
          OUTPUT INSERTED.location_id
          VALUES (
            @buildingNo, 
            @buildingType, 
            @residentialStatus, 
            @colonyNumber, 
            @area
          )
        `);
      locationId = locationInsert.recordset[0].location_id;
      console.log('Created new location ID:', locationId);
    } else {
      throw new Error(`Location not found: ${buildingNo}, ${colony}, ${apartment}`);
    }

    // 4. Update accommodation - FIXED: Using user.customer_id instead of user.UserID
    console.log('\n[Step 4] Updating accommodation');
    const accommodationCheck = await transaction.request()
      .input('locationId', sql.Int, locationId)
      .query('SELECT customer_id FROM Accomodation WHERE location_id = @locationId');

    if (accommodationCheck.recordset.length > 0) {
      // Update existing accommodation
      await transaction.request()
        .input('userId', sql.Int, user.customer_id)  // Fixed here
        .input('locationId', sql.Int, locationId)
        .query('UPDATE Accomodation SET customer_id = @userId WHERE location_id = @locationId');
      console.log('Updated existing accommodation record');
    } else {
      // Create new accommodation
      await transaction.request()
        .input('userId', sql.Int, user.customer_id)  // Fixed here
        .input('locationId', sql.Int, locationId)
        .query('INSERT INTO Accomodation (customer_id, location_id) VALUES (@userId, @locationId)');
      console.log('Created new accommodation record');
    }

    // 5. Get ALL locations for this user after assignment
    console.log('\n[Step 5] Fetching all user locations');
    const allLocations = await transaction.request()
      .input('userId', sql.Int, user.customer_id)  // Fixed here
      .query(`
        SELECT 
          l.location_id AS id,
          l.building_number,
          c.Name AS colony_name,
          l.building_type AS apartment_type,
          u.full_name AS customer_name,
          u.phone_number AS customer_phone,
          l.area,
          l.resdl AS residential_status
        FROM Accomodation a
        JOIN Location l ON a.location_id = l.location_id
        JOIN Colonies c ON l.colony_number = c.ColonyNumber
        JOIN Customers u ON a.customer_id = u.customer_id
        WHERE a.customer_id = @userId
        ORDER BY l.location_id DESC
      `);

    const locations = allLocations.recordset.map(loc => ({
      id: loc.id,
      label: `Customer: ${loc.customer_name}, Phone: ${loc.customer_phone}, Building: ${loc.building_number}, Colony: ${loc.colony_name}`,
      buildingNo: loc.building_number,
      colony: loc.colony_name,
      apartment: loc.apartment_type,
      area: loc.area,
      residentialStatus: loc.residential_status
    }));

    console.log(`Found ${locations.length} locations for user`);

    // Commit transaction
    await transaction.commit();
    console.log('\n[SUCCESS] Transaction committed');

    // Format response
    const response = {
      success: true,
      locations: locations
    };

    console.log('\n=== LOCATION ASSIGNMENT COMPLETE ===');
    res.json(response);

  } catch (error) {
    console.error('\n=== LOCATION ASSIGNMENT FAILED ===');
    console.error('Error details:', {
      message: error.message,
      stack: error.stack
    });

    // Rollback transaction if it was started
    if (transaction && transaction._started) {
      try {
        await transaction.rollback();
        console.log('Transaction rolled back');
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError);
      }
    }

    // Send error response
    res.status(error.status || 500).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? {
        stack: error.stack
      } : undefined
    });
  } finally {
    // Connection pooling handles the connection lifecycle
  }
});











// API Routes for Skillmen
app.get('/api/skillmen', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    let pool = await sql.connect(dbConfig);
    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    const result = await pool.request()
      .query(`
        SELECT 
          id, 
          name, 
          phoneNumber, 
          designation, 
          subdivision AS area
        FROM Skillmen
        WHERE status = 'Active'
        ORDER BY name
      `);
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching skillmen:', err);
    res.status(500).json({ error: 'Failed to fetch skillmen' });
  }
});








// Additional API for getting skillmen by area (optional)
app.get('/api/skillmen/area/:area', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const { area } = req.params;
    
    const result = await pool.request()
      .input('area', sql.VarChar(50), area)
      .query(`
        SELECT 
          id, 
          name, 
          phoneNumber, 
          designation, 
          subdivision AS area
        FROM Skillmen
        WHERE status = 'Active' AND subdivision = @area
        ORDER BY name
      `);
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching skillmen by area:', err);
    res.status(500).json({ error: 'Failed to fetch skillmen by area' });
  }
});


// Additional API for getting skillmen by designation (optional)
app.get('/api/skillmen/designation/:designation', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
 
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const { designation } = req.params;
    
    const result = await pool.request()
      .input('designation', sql.VarChar(100), designation)
      .query(`
        SELECT 
          id, 
          name, 
          phoneNumber, 
          designation, 
          subdivision AS area
        FROM Skillmen
        WHERE status = 'Active' AND designation = @designation
        ORDER BY name
      `);
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching skillmen by designation:', err);
    res.status(500).json({ error: 'Failed to fetch skillmen by designation' });
  }
});









// Get all natures with their categories and types
app.get('/natures', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const request = pool.request();
    
    const result = await request.query(`
      SELECT 
        n.name AS id,
        n.name,
        ISNULL((
          SELECT STRING_AGG(s.name, ', ') 
          FROM Category c
          JOIN Subdivision s ON c.subdivision_name = s.name
          WHERE c.nature_name = n.name
        ), '') AS categories,
        ISNULL((
          SELECT STRING_AGG(nt.type, ', ') 
          FROM NatureTypes nt
          WHERE nt.nature_name = n.name
        ), '') AS types
      FROM Natures n
    `);

    const natures = result.recordset.map(row => ({
      id: row.id,
      name: row.name,
      categories: row.categories ? 
        [...new Set(row.categories.split(', '))].filter(Boolean) : [],
      types: row.types ? 
        [...new Set(row.types.split(', '))].filter(Boolean) : []
    }));

    res.json(natures);
  } catch (err) {
    handleDatabaseError(err, res);
  }
});

// Create a new nature
app.post('/createNewNatures', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ message: 'Nature name is required' });
  }

  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const request = pool.request();
    await request.input('name', sql.VarChar(150), name)
      .query('INSERT INTO Natures (name) VALUES (@name)');
    
    res.json({ 
      message: 'Nature created successfully',
      id: name
    });
  } catch (err) {
    handleDatabaseError(err, res);
  }
});

// Update a nature (name and categories)
app.put('/natures/:name', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  const oldName = decodeURIComponent(req.params.name);
  const { name: newName, categories } = req.body;

  if (!newName) {
    return res.status(400).json({ message: 'Nature name is required' });
  }

  const transaction = new sql.Transaction(pool);
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    await transaction.begin();
    
    // 1. Update nature name if changed
    if (newName !== oldName) {
      const updateRequest = new sql.Request(transaction);
      await updateRequest.input('oldName', sql.VarChar(150), oldName)
        .input('newName', sql.VarChar(150), newName)
        .query('UPDATE Natures SET name = @newName WHERE name = @oldName');
    }

    // 2. Update categories
    if (Array.isArray(categories) && categories.length >= 0) {
      const uniqueCategories = [...new Set(categories)];
      
      // First delete all existing categories
      const deleteRequest = new sql.Request(transaction);
      await deleteRequest.input('natureName', sql.VarChar(150), newName)
        .query('DELETE FROM Category WHERE nature_name = @natureName');
      
      // Then insert new categories using a new request for each insertion
      for (const category of uniqueCategories) {
        const insertRequest = new sql.Request(transaction);
        await insertRequest
          .input('natureName', sql.VarChar(150), newName)
          .input('subdivisionName', sql.VarChar(10), category)
          .query(`
            IF EXISTS (SELECT 1 FROM Subdivision WHERE name = @subdivisionName)
            BEGIN
              INSERT INTO Category (nature_name, subdivision_name) 
              VALUES (@natureName, @subdivisionName)
            END
          `);
      }
    }

    await transaction.commit();
    res.json({ 
      message: 'Nature updated successfully',
      id: newName
    });
  } catch (err) {
    await transaction.rollback();
    handleDatabaseError(err, res);
  }
});

// Delete a nature
app.delete('/natures/:name', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
   
  const name = decodeURIComponent(req.params.name);

  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const request = pool.request();
    await request.input('name', sql.VarChar(150), name)
      .query('DELETE FROM Natures WHERE name = @name');
    
    res.json({ message: 'Nature deleted successfully' });
  } catch (err) {
    handleDatabaseError(err, res);
  }
});

// Add a type to a nature
app.post('/natures/:name/types', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  const natureName = decodeURIComponent(req.params.name);
  const { type } = req.body;

  if (!type) {
    return res.status(400).json({ message: 'Type is required' });
  }

  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const request = pool.request();
    
    // Check if nature exists
    const natureCheck = await request.input('name', sql.VarChar(150), natureName)
      .query('SELECT 1 FROM Natures WHERE name = @name');
    
    if (natureCheck.recordset.length === 0) {
      return res.status(404).json({ message: 'Nature not found' });
    }
    
    // Insert new type
    await request.input('natureName', sql.VarChar(150), natureName)
      .input('type', sql.VarChar(150), type)
      .query(`
        IF NOT EXISTS (
          SELECT 1 
          FROM NatureTypes 
          WHERE nature_name = @natureName AND type = @type
        )
        BEGIN
          INSERT INTO NatureTypes (nature_name, type) 
          VALUES (@natureName, @type)
        END
      `);
    
    // Check if any rows were inserted
    const inserted = await request.query('SELECT @@ROWCOUNT AS rowsAffected');
    
    if (inserted.recordset[0].rowsAffected === 0) {
      return res.status(409).json({ message: 'Type already exists for this nature' });
    }
    
    res.json({ message: 'Type added successfully' });
  } catch (err) {
    handleDatabaseError(err, res);
  }
});

// Remove a type from a nature
app.delete('/natures/:name/types/:type', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
 
  const natureName = decodeURIComponent(req.params.name);
  const type = req.params.type;

  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const request = pool.request();
    
    // Check if type exists
    const typeCheck = await request
      .input('natureName', sql.VarChar(150), natureName)
      .input('type', sql.VarChar(150), type)
      .query('SELECT 1 FROM NatureTypes WHERE nature_name = @natureName AND type = @type');
    
    if (typeCheck.recordset.length === 0) {
      return res.status(404).json({ message: 'Type not found for this nature' });
    }
    
    // Delete the type
    await request.query(`
      DELETE FROM NatureTypes 
      WHERE nature_name = @natureName AND type = @type
    `);
    
    res.json({ message: 'Type removed successfully' });
  } catch (err) {
    handleDatabaseError(err, res);
  }
});

// Get all available subdivisions (categories)
app.get('/subdivisions', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
   
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const request = pool.request();
    const result = await request.query('SELECT name FROM Subdivision');
    res.json(result.recordset.map(row => row.name));
  } catch (err) {
    handleDatabaseError(err, res);
  }
});








//Below APIs are for Skillmen and Designations
//Skillmen Management

// Skillmen Endpoints
app.get('/skillmen', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const { page = 1, limit = 10, search = '' } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT s.*, d.name AS designation_name 
      FROM Skillmen s
      JOIN Designation d ON s.designation = d.name
    `;

    // Add search condition if search term is provided
    if (search) {
      query += `
        WHERE s.name LIKE '%' + @search + '%'
        OR s.phoneNumber LIKE '%' + @search + '%'
        OR s.email LIKE '%' + @search + '%'
        OR s.designation LIKE '%' + @search + '%'
        OR s.subdivision LIKE '%' + @search + '%'
      `;
    }

    query += `
      ORDER BY s.id
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    const request = pool.request()
      .input('offset', sql.Int, offset)
      .input('limit', sql.Int, parseInt(limit));

    if (search) {
      request.input('search', sql.VarChar, search);
    }

    const result = await request.query(query);

    // Count query with same search conditions
    let countQuery = 'SELECT COUNT(*) AS total FROM Skillmen s';
    if (search) {
      countQuery += `
        WHERE s.name LIKE '%' + @search + '%'
        OR s.phoneNumber LIKE '%' + @search + '%'
        OR s.email LIKE '%' + @search + '%'
        OR s.designation LIKE '%' + @search + '%'
        OR s.subdivision LIKE '%' + @search + '%'
      `;
    }

    const countRequest = pool.request();
    if (search) {
      countRequest.input('search', sql.VarChar, search);
    }
    const countResult = await countRequest.query(countQuery);

    res.json({
      skillmen: result.recordset,
      total: countResult.recordset[0].total
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/skillmen', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const { name, phone, email, designation, subdivision, status } = req.body;
    
    const result = await pool.request()
      .input('name', sql.VarChar, name)
      .input('phoneNumber', sql.VarChar, phone)
      .input('email', sql.VarChar, email)
      .input('designation', sql.VarChar, designation)
      .input('subdivision', sql.VarChar, subdivision)
      .input('status', sql.VarChar, status)
      .query(`
        INSERT INTO Skillmen (name, phoneNumber, email, designation, subdivision, status)
        OUTPUT INSERTED.*
        VALUES (@name, @phoneNumber, @email, @designation, @subdivision, @status)
      `);

    res.status(201).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/skillmen/:id', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
 
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const { id } = req.params;
    const { name, phone, email, designation, subdivision, status } = req.body;
    
    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('name', sql.VarChar, name)
      .input('phoneNumber', sql.VarChar, phone)
      .input('email', sql.VarChar, email)
      .input('designation', sql.VarChar, designation)
      .input('subdivision', sql.VarChar, subdivision)
      .input('status', sql.VarChar, status)
      .query(`
        UPDATE Skillmen SET
          name = @name,
          phoneNumber = @phoneNumber,
          email = @email,
          designation = @designation,
          subdivision = @subdivision,
          status = @status
        WHERE id = @id;
        SELECT * FROM Skillmen WHERE id = @id;
      `);

    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




// Designation Endpoints
app.get('/designations', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const result = await pool.request()
      .query('SELECT * FROM Designation');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});




app.post('/designations', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const { name } = req.body;
    const result = await pool.request()
      .input('name', sql.VarChar, name)
      .query(`
        INSERT INTO Designation (name)
        OUTPUT INSERTED.*
        VALUES (@name)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/designations/:oldName', async (req, res) => { 
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const { oldName } = req.params;
    const { name: newName } = req.body;

    // First check if the new name already exists
    const checkResult = await pool.request()
      .input('newName', sql.VarChar, newName)
      .query('SELECT name FROM Designation WHERE name = @newName');

    if (checkResult.recordset.length > 0) {
      return res.status(400).json({ error: 'Designation with this name already exists' });
    }

    // Update the designation
    const result = await pool.request()
      .input('oldName', sql.VarChar, oldName)
      .input('newName', sql.VarChar, newName)
      .query(`
        UPDATE Designation
        SET name = @newName
        WHERE name = @oldName
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Designation not found' });
    }

    res.json({ message: 'Designation updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update all designation endpoints to use name instead of id
app.delete('/designations/:name', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const { name } = req.params;

    // Check if any skillmen are using this designation
    const checkResult = await pool.request()
      .input('designationName', sql.VarChar, name)
      .query('SELECT COUNT(*) AS skillmenCount FROM Skillmen WHERE designation = @designationName');

    if (checkResult.recordset[0].skillmenCount > 0) {
      return res.status(400).json({ 
        error: `Cannot delete designation "${name}" - it is being used by ${checkResult.recordset[0].skillmenCount} skillmen` 
      });
    }

    await pool.request()
      .input('name', sql.VarChar, name)
      .query('DELETE FROM Designation WHERE name = @name');

    res.json({ message: `Designation "${name}" deleted successfully` });
  } catch (err) {
    console.error('Error deleting designation:', err);
    res.status(500).json({ error: err.message });
  }
});



// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: pool.connected ? 'Connected' : 'Disconnected'
  });
});













// GET: Load all users
app.get('/getUsers', async (req, res) => {
  // Verify Authorization header exists
  const page = 'all-users'; 
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
 
  try {
    let pool = await sql.connect(dbConfig);

    const accessiblity = await checkAccess(token, page);
    
    if (accessiblity.status !== 'success') {
      return res.status(401).json({ error: 'Unauthorized - Invalid token please login again.' });
    }

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    await sql.connect(dbConfig);
    console.log('[GET] Connected to SQL Server for users');

    const result = await sql.query(`
      SELECT 
        customer_id AS id,
        full_name AS name,
        phone_number AS phone,
        email AS email
      FROM Customers
    `);

    console.log(`[GET] Users fetched: ${result.recordset.length}`);
    res.json(result.recordset);
  } catch (error) {
    console.error('[GET] Error fetching users:', error.message);
    res.status(500).json({ 
      message: 'Error fetching users',
      error: error.message
    });
  }
});
















//Colonies Page

// GET: Load all colonies
app.get('/getColonies', async (req, res) => {

  const page = 'colonies';
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
 
  try {
    let pool = await sql.connect(dbConfig);
    

    const accessiblity = await checkAccess(token, page);
    
    if (accessiblity.status !== 'success') {
      return res.status(401).json({ error: 'Unauthorized - Invalid token please login again.' });
    }

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    await sql.connect(dbConfig);
    console.log('[GET] Connected to SQL Server');

    const result = await sql.query(`
      SELECT 
          c.Name AS name,
          c.ColonyNumber AS colonyNumber,
          COUNT(l.colony_number) AS buildings
      FROM Colonies c
      LEFT JOIN Location l
          ON c.ColonyNumber = l.colony_number
      GROUP BY c.Name, c.ColonyNumber;
    `);

    console.log('[GET] Colonies fetched:', result.recordset.length);
    res.json(result.recordset);
  } catch (error) {
    console.error('[GET] Error fetching colonies:', error.message);
    res.status(500).json({ message: 'Error fetching colonies' });
  }
});

// POST: Add new colony
app.post('/addColony', async (req, res) => {

  const page = 'colonies';
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];

    const accessiblity = await checkAccess(token, page);
    
    if (accessiblity.status !== 'success') {
      return res.status(401).json({ error: 'Unauthorized - Invalid token please login again.' });
    }
  
  const { name, colonyNumber } = req.body;

  if (!name || !colonyNumber) {
    return res.status(400).json({ message: 'Name and ColonyNumber are required' });
  }

  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    await sql.connect(dbConfig);
    const request = new sql.Request();
    request.input('Name', sql.VarChar(100), name);
    request.input('ColonyNumber', sql.VarChar(30), colonyNumber);

    await request.query(`
      INSERT INTO Colonies (Name, ColonyNumber)
      VALUES (@Name, @ColonyNumber)
    `);

    console.log(`[POST] Colony added: ${name} (${colonyNumber})`);
    res.json({ message: 'Colony added successfully' });
  } catch (error) {
    console.error('[POST] Error adding colony:', error.message);
    res.status(500).json({ message: 'Error adding colony' });
  }
});

// PUT: Edit a colony
app.put('/editColony', async (req, res) => {

  const page = 'colonies';
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];

    const accessiblity = await checkAccess(token, page);
    
    if (accessiblity.status !== 'success') {
      return res.status(401).json({ error: 'Unauthorized - Invalid token please login again.' });
    }
  
  const { previous, new: updated } = req.body;

  if (!previous || !updated) {
    return res.status(400).json({ message: 'Missing previous or new colony data' });
  }

  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    await sql.connect(dbConfig);
    const request = new sql.Request();
    request.input('PrevColonyNumber', sql.VarChar(30), previous.colonyNumber);
    request.input('NewName', sql.VarChar(100), updated.name);
    request.input('NewColonyNumber', sql.VarChar(30), updated.colonyNumber);

    await request.query(`
      UPDATE Colonies
      SET Name = @NewName, ColonyNumber = @NewColonyNumber
      WHERE ColonyNumber = @PrevColonyNumber
    `);

    console.log(`[PUT] Colony updated: ${previous.colonyNumber} → ${updated.colonyNumber}`);
    res.json({ message: 'Colony updated successfully' });
  } catch (error) {
    console.error('[PUT] Error updating colony:', error.message);
    res.status(500).json({ message: 'Error updating colony' });
  }
});












//Generate Complaint ID based on category and current month/year
async function generateComplaintId(category, pool) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  
  // Map category to code
  const categoryCodes = {
    'E&M-I': '1',
    'E&M-II': '2',
    'B&R-I': '3',
    'B&R-II': '4',
    'B&R-III': '5',
    'F&S-I': '6'
  };
  
  const categoryCode = categoryCodes[category] || '0';
  
  // Get count of existing complaints for this month+category
  const result = await pool.request()
    .query(`
      SELECT COUNT(*) AS complaintCount 
      FROM Complaints
      WHERE MONTH(launched_at) = ${now.getMonth() + 1}
        AND YEAR(launched_at) = ${now.getFullYear()}
    `);

  const newNumber = (result.recordset[0].complaintCount || 0) + 1;
  return `HT${month}${year}${categoryCode}-${newNumber}`;
}

// Function to send WhatsApp message to customer
// Function to send WhatsApp message to customer
async function sendWhatsAppMessageToCustomer(customerId, complaintId, skillmanName, pool) {
  try {
    // Check if WhatsApp client is ready
    if (!client || !client.info) {
      console.error('WhatsApp client is not ready');
      return;
    }
    
    // Get customer details from database
    const customerResult = await pool.request()
      .input('customerId', sql.Int, customerId)
      .query('SELECT full_name, phone_number FROM Customers WHERE customer_id = @customerId');
    
    if (customerResult.recordset.length === 0) {
      console.error('Customer not found for ID:', customerId);
      return;
    }
    
    const customer = customerResult.recordset[0];
    let phoneNumber = customer.phone_number;
    const customerName = customer.full_name;
    
    // Normalize phone number - remove all non-digit characters
    let digitsOnly = phoneNumber.replace(/\D/g, '');
    
    // Convert to international format for Pakistan numbers
    let internationalNumber;
    
    if (digitsOnly.startsWith('92') && digitsOnly.length === 12) {
      // Already in international format: 923001234567
      internationalNumber = digitsOnly;
    } else if (digitsOnly.startsWith('92') && digitsOnly.length > 12) {
      // International format with extra digits, take first 12
      internationalNumber = digitsOnly.substring(0, 12);
    } else if (digitsOnly.startsWith('3') && digitsOnly.length === 10) {
      // Local format without zero: 3001234567 -> 923001234567
      internationalNumber = '92' + digitsOnly;
    } else if (digitsOnly.startsWith('03') && digitsOnly.length === 11) {
      // Local format with zero: 03001234567 -> 923001234567
      internationalNumber = '92' + digitsOnly.substring(1);
    } else if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
      // Other local formats starting with 0
      internationalNumber = '92' + digitsOnly.substring(1);
    } else if (digitsOnly.length === 9 || digitsOnly.length === 10) {
      // Assume it's a local number without country code
      internationalNumber = '92' + digitsOnly;
    } else {
      // Unknown format, try to use as is but limit to 12 digits
      internationalNumber = digitsOnly.length > 12 ? digitsOnly.substring(0, 12) : digitsOnly;
      console.warn(`Unknown phone number format: ${phoneNumber}, using: ${internationalNumber}`);
    }
    
    const whatsappId = `${internationalNumber}@c.us`;
    
    // Create appropriate message based on whether skillman is assigned
    let message;
    if (skillmanName && skillmanName !== "will be assigned shortly") {
      //message = `${customerName}, your complaint (ID: ${complaintId}) has been launched successfully. Our skillman ${skillmanName} is on the way to solve your problem.`;
      message = `${customerName}, your complaint (ID: ${complaintId}) 
Has been launched successfully. ✅
Our skillman ${skillmanName} is on the way to solve your problem.👨🏻‍🔧
        `;
    } else {
      //message = `${customerName}, your complaint (ID: ${complaintId}) has been launched successfully. We will assign a skillman to your problem shortly and keep you updated.`;
      message = `${customerName}, your complaint (ID: ${complaintId})
Has been launched successfully.✅
We will assign a skillman to your problem shortly and keep you updated.👍🏻
        `;
    }
    
    // Send WhatsApp message using the direct method
    await client.sendMessage(whatsappId, message);
    
    console.log(`WhatsApp message sent to ${phoneNumber} (international: ${internationalNumber})`);
  } catch (error) {
    console.error('Error sending WhatsApp message:', error.message);
    // Don't throw error to avoid affecting the main complaint creation flow
  }
}

// POST endpoint for creating complaints
app.post('/complaints', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const {
      customerId,
      locationId,
      category,
      categoryType,
      description,
      priority,
      receiver,
      primarySkillmanId,
      helperSkillmenIds = []
    } = req.body;

    const [categoryName, nature] = category.name.includes('->')
      ? category.name.split('->')
      : [category.name, ''];

    let status;
    if (priority === 'deferred') {
      status = 'Deferred';
    } else {
      status = (primarySkillmanId || helperSkillmenIds.length > 0)
        ? 'In-Progress'
        : 'Un-Assigned';
    }

    pool = await sql.connect(dbConfig);
    const complaintId = await generateComplaintId(categoryName, pool);

    // Get Islamabad time using UTC offset (+05:00)
    const launchedAt = new Date();

    await pool.request()
      .input('complaint_id', sql.VarChar(25), complaintId)
      .input('customer_id', sql.Int, customerId)
      .input('location_id', sql.Int, locationId)
      .input('nature', sql.VarChar(50), nature.trim())
      .input('category', sql.VarChar(10), categoryName.trim())
      .input('type', sql.VarChar(75), categoryType.name)
      .input('description', sql.VarChar(300), description)
      .input('priority', sql.VarChar(15), priority)
      .input('launched_at', sql.DateTime, launchedAt) // PKT time
      .input('receiver_id', sql.VarChar(20), receiver.id)
      .input('skillman_id', sql.Int, primarySkillmanId || null)
      .input('status', sql.NVarChar(20), status)
      .query(`
        INSERT INTO Complaints (
          complaint_id, customer_id, location_id, nature, category, 
          type, description, priority, launched_at, receiver_id, 
          skillman_id, status
        ) VALUES (
          @complaint_id, @customer_id, @location_id, @nature, @category,
          @type, @description, @priority, GETDATE(), @receiver_id, 
          @skillman_id, @status
        )
      `);// replace @launched_at with GETDATE()

    if (helperSkillmenIds.length > 0) {
      for (const helperId of helperSkillmenIds) {
        await pool.request()
          .input('complaint_id', sql.VarChar(25), complaintId)
          .input('skillman_id', sql.Int, helperId)
          .query(`
            INSERT INTO ComplaintsHelpers (complaint_id, skillman_id)
            VALUES (@complaint_id, @skillman_id)
          `);
      }
    }

    const assignedSkillmen = [];
    if (primarySkillmanId) assignedSkillmen.push(primarySkillmanId);
    assignedSkillmen.push(...helperSkillmenIds);

    if (assignedSkillmen.length > 0 && priority !== 'deferred') {
      for (const skillmanId of assignedSkillmen) {
        await pool.request()
          .input('skillmanId', sql.Int, skillmanId)
          .query(`
            UPDATE Skillmen 
            SET status = 'In-Progress' 
            WHERE id = @skillmanId AND status = 'Active'
          `);
      }
    }

    // Get skillman name for the message
    let skillmanName = "will be assigned shortly";
    if (primarySkillmanId) {
      const skillmanResult = await pool.request()
        .input('skillmanId', sql.Int, primarySkillmanId)
        .query('SELECT name FROM Skillmen WHERE id = @skillmanId');
      
      if (skillmanResult.recordset.length > 0) {
        skillmanName = skillmanResult.recordset[0].name;
      }
    }

    // Send WhatsApp message to customer (non-blocking)
    sendWhatsAppMessageToCustomer(customerId, complaintId, skillmanName, pool)
      .catch(error => console.error('Error in sending WhatsApp message:', error));

    res.status(201).json({
      success: true,
      message: 'Complaint created successfully',
      complaintId,
      status,
      launchedAt: launchedAt.toISOString()
    });

  } catch (error) {
    console.error('Error creating complaint:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create complaint',
      error: error.message
    });
  }
});



// Add this endpoint to your Express server
app.get('/api/customers/:customerId/complaints', async (req, res) => {
  try {
    // Verify Authorization header exists
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized - No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const { customerId } = req.params;
    
    // Validate customer ID
    if (!customerId || isNaN(parseInt(customerId))) {
      return res.status(400).json({ error: 'Valid customer ID is required' });
    }

    const pool = await sql.connect(dbConfig);
    
    // Verify token validity
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    // Query to get complaints for the specific customer
    const query = `
      SELECT 
        c.complaint_id as id,
        CONVERT(DATE, c.launched_at) as date,
        CONCAT(loc.building_number, ', ', col.Name) as location,
        c.nature,
        c.type as natureType,
        s.name as skillman,
        c.status
      FROM Complaints c
      LEFT JOIN Location loc ON c.location_id = loc.location_id
      LEFT JOIN Colonies col ON loc.colony_number = col.ColonyNumber
      LEFT JOIN Skillmen s ON c.skillman_id = s.id
      WHERE c.customer_id = @customerId
      ORDER BY c.launched_at DESC
    `;
    
    const result = await pool.request()
      .input('customerId', sql.Int, parseInt(customerId))
      .query(query);
    
    res.json(result.recordset);
  } catch (error) {
    console.error('Error fetching customer complaints:', error);
    res.status(500).json({ error: 'Failed to fetch complaint history' });
  }
});














// All complaint's API endpoints

// Complaints endpoint with pagination
app.get('/api/complaints', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
   
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const {
      page = 1,
      pageSize = 10,
      receiver,
      receiverId,
      colony,
      category,
      status,
      search
    } = req.query;

    const offset = (page - 1) * pageSize;
    await sql.connect(dbConfig);

    // Dynamic filters
    const filters = [];
    if (receiver) {
      if (isNaN(receiver)) {
        filters.push(`u.name LIKE '%' + @receiver + '%'`);
      } else {
        filters.push(`u.id = @receiver`);
      }
    }
    if (receiverId) filters.push(`u.id = @receiverId`);
    if (colony) filters.push(`loc.colony_number = @colony`);
    if (category) filters.push(`c.category = @category`);
    if (status) filters.push(`c.status = @status`);
    if (search) {
      filters.push(`(
        c.complaint_id LIKE '%' + @search + '%' OR
        cust.full_name LIKE '%' + @search + '%' OR
        c.description LIKE '%' + @search + '%' OR
        loc.building_number LIKE '%' + @search + '%' OR
        c.category LIKE '%' + @search + '%' OR
        c.type LIKE '%' + @search + '%' OR
        s.name LIKE '%' + @search + '%' OR
        u.name LIKE '%' + @search + '%' OR
        loc.colony_number LIKE '%' + @search + '%'
      )`);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    // Main query with fixed date formatting in +05:00
    const query = `
      WITH FilteredComplaints AS (
        SELECT 
          c.complaint_id,
          c.nature,
          c.category,
          c.type,
          c.description,
          c.priority,
          FORMAT(c.launched_at, 'yyyy-MM-dd HH:mm:ss') AS launched_at,
          FORMAT(c.completed_at, 'yyyy-MM-dd HH:mm:ss') AS completed_at,
          c.status,
          cust.full_name AS customer_name,
          cust.phone_number AS customer_phone,
          cust.email AS customer_email,
          loc.building_number AS location_building_number,
          loc.building_type AS location_building_type,
          loc.resdl AS location_resdl,
          loc.colony_number AS location_colony_number,
          col.Name AS location_colony_name,
          loc.area AS location_area,
          u.name AS receiver_name,
          u.id AS receiver_id,
          s.name AS skillman_name,
          ROW_NUMBER() OVER (ORDER BY c.launched_at DESC) AS row_num
        FROM Complaints c
        LEFT JOIN Customers cust ON c.customer_id = cust.customer_id
        LEFT JOIN Location loc ON c.location_id = loc.location_id
        LEFT JOIN Colonies col ON loc.colony_number = col.ColonyNumber
        LEFT JOIN Users u ON c.receiver_id = u.id
        LEFT JOIN Skillmen s ON c.skillman_id = s.id
        ${whereClause}
      )
      SELECT * FROM FilteredComplaints
      WHERE row_num BETWEEN ${offset + 1} AND ${offset + parseInt(pageSize)}
    `;

    const request = new sql.Request();
    if (receiver) request.input('receiver', sql.VarChar, receiver);
    if (receiverId) request.input('receiverId', sql.VarChar, receiverId);
    if (colony) request.input('colony', sql.VarChar, colony);
    if (category) request.input('category', sql.VarChar, category);
    if (status) request.input('status', sql.VarChar, status);
    if (search) request.input('search', sql.VarChar, search);

    const result = await request.query(query);

    // Count query
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM Complaints c
      LEFT JOIN Customers cust ON c.customer_id = cust.customer_id
      LEFT JOIN Location loc ON c.location_id = loc.location_id
      LEFT JOIN Colonies col ON loc.colony_number = col.ColonyNumber
      LEFT JOIN Users u ON c.receiver_id = u.id
      LEFT JOIN Skillmen s ON c.skillman_id = s.id
      ${whereClause}
    `;

    const countRequest = new sql.Request();
    if (receiver) countRequest.input('receiver', sql.VarChar, receiver);
    if (receiverId) countRequest.input('receiverId', sql.VarChar, receiverId);
    if (colony) countRequest.input('colony', sql.VarChar, colony);
    if (category) countRequest.input('category', sql.VarChar, category);
    if (status) countRequest.input('status', sql.VarChar, status);
    if (search) countRequest.input('search', sql.VarChar, search);

    const countResult = await countRequest.query(countQuery);
    const total = countResult.recordset[0].total;

    res.json({
      success: true,
      data: result.recordset,
      pagination: {
        total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (err) {
    console.error('Error fetching complaints:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch complaints',
      error: err.message
    });
  }
});















// API endpoint to update complaint status
/*
app.post('/api/complaints/update-status', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const { complaint_id, status } = req.body;

    // Validate input
    if (!complaint_id || !status) {
      return res.status(400).json({
        success: false,
        message: 'complaint_id and status are required'
      });
    }

    // Check if status is valid
    const validStatuses = ['In-Progress', 'Completed', 'Deferred', 'Un-Assigned'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    await sql.connect(dbConfig);

    // Get complaint + helper info
    const checkResult = await sql.query`
      SELECT c.complaint_id, c.skillman_id, ch.skillman_id AS helper_id
      FROM Complaints c
      LEFT JOIN ComplaintsHelpers ch ON c.complaint_id = ch.complaint_id
      WHERE c.complaint_id = ${complaint_id}
    `;

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    const skillmanId = checkResult.recordset[0].skillman_id;
    const helperIds = checkResult.recordset.map(r => r.helper_id).filter(id => id !== null);

    // Update complaint status and set completed_at if status is 'Completed'
    if (status === 'Completed') {
      await sql.query`
        UPDATE Complaints
        SET status = ${status},
            completed_at = GETDATE()
        WHERE complaint_id = ${complaint_id}
      `;
    } else {
      await sql.query`
        UPDATE Complaints
        SET status = ${status}
        WHERE complaint_id = ${complaint_id}
      `;
    }

    // If status is NOT Deferred → set skillman and helpers to Active
    if (status !== 'Deferred') {
      if (skillmanId) {
        await sql.query`
          UPDATE Skillmen
          SET status = 'Active'
          WHERE id = ${skillmanId}
        `;
      }
      if (helperIds.length > 0) {
        await sql.query`
          UPDATE Skillmen
          SET status = 'Active'
          WHERE id IN (${helperIds})
        `;
      }
    }

    res.json({
      success: true,
      message: `Complaint status updated to ${status} successfully`
    });

  } catch (error) {
    console.error('Error updating complaint status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});
*/
// API endpoint to update complaint status
app.post('/api/complaints/update-status', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    
    const { complaint_id, status } = req.body;

    // Validate input
    if (!complaint_id || !status) {
      return res.status(400).json({
        success: false,
        message: 'complaint_id and status are required'
      });
    }

    // Check if status is valid (including SNA)
    const validStatuses = ['In-Progress', 'Completed', 'Deferred', 'Un-Assigned', 'SNA'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value'
      });
    }

    // Get complaint + helper info
    const checkResult = await pool.request()
      .input('complaint_id', sql.VarChar(25), complaint_id)
      .query(`
        SELECT c.complaint_id, c.skillman_id, ch.skillman_id AS helper_id
        FROM Complaints c
        LEFT JOIN ComplaintsHelpers ch ON c.complaint_id = ch.complaint_id
        WHERE c.complaint_id = @complaint_id
      `);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    const skillmanId = checkResult.recordset[0].skillman_id;
    const helperIds = checkResult.recordset.map(r => r.helper_id).filter(id => id !== null);

    // Update complaint status and set completed_at if status is 'Completed'
    if (status === 'Completed') {
      await pool.request()
        .input('complaint_id', sql.VarChar(25), complaint_id)
        .input('status', sql.NVarChar(20), status)
        .query(`
          UPDATE Complaints
          SET status = @status,
              completed_at = GETDATE()
          WHERE complaint_id = @complaint_id
        `);
    } else {
      await pool.request()
        .input('complaint_id', sql.VarChar(25), complaint_id)
        .input('status', sql.NVarChar(20), status)
        .query(`
          UPDATE Complaints
          SET status = @status
          WHERE complaint_id = @complaint_id
        `);
    }


    // If status is Deferred or SNA → set skillman and helpers to Active
    if (status === 'Deferred' || status === 'SNA' || status === 'Completed') {
      if (skillmanId) {
        await pool.request()
          .input('skillman_id', sql.Int, skillmanId)
          .query(`
            UPDATE Skillmen
            SET status = 'Active'
            WHERE id = @skillman_id
          `);
      }
      
      if (helperIds.length > 0) {
        // Create a parameterized query for multiple helper IDs
        const helperIdList = helperIds.map((id, index) => `@helper_id_${index}`).join(',');
        const request = pool.request();
        
        helperIds.forEach((id, index) => {
          request.input(`helper_id_${index}`, sql.Int, id);
        });
        
        await request.query(`
          UPDATE Skillmen
          SET status = 'Active'
          WHERE id IN (${helperIdList})
        `);
      }
    }
    
    //Whatsapp call for Complaints
    sendWhatsappToCustomerForStatusUpdate(complaint_id, pool);

    res.json({
      success: true,
      message: `Complaint status updated to ${status} successfully`
    });

  } catch (error) {
    console.error('Error updating complaint status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  } finally {
    // Close the connection pool
    try {
      //await sql.close();
    } catch (err) {
      console.error('Error closing connection:', err);
    }
  }
});



async function sendWhatsappToCustomerForStatusUpdate(complaintId, pool) {
    try {
        // Check if client is available and ready - more comprehensive check
        if (!client || typeof client.sendMessage !== 'function' || !client.info || !client.pupPage) {
            console.log('WhatsApp client not available, skipping message sending');
            return { success: false, message: 'WhatsApp client not available' };
        }

        // Additional check to see if client is actually connected and authenticated
        if (client.pupPage && client.pupPage.isClosed()) {
            console.log('WhatsApp client page is closed, skipping message sending');
            return { success: false, message: 'WhatsApp client not connected' };
        }

        // Query to get customer phone number, complaint status, and skillman name
        const query = `
            SELECT c.phone_number, comp.status, comp.complaint_id, s.name as skillman_name
            FROM Complaints comp
            INNER JOIN Customers c ON comp.customer_id = c.customer_id
            LEFT JOIN Skillmen s ON comp.skillman_id = s.id
            WHERE comp.complaint_id = @complaintId
        `;

        const request = pool.request();
        request.input('complaintId', complaintId);
        
        const result = await request.query(query);
        
        if (result.recordset.length === 0) {
            console.error(`Complaint with ID ${complaintId} not found`);
            return { success: false, message: 'Complaint not found' };
        }

        const { phone_number, status, complaint_id, skillman_name } = result.recordset[0];
        
        // Format the phone number using the existing function
        const formattedPhoneNumber = formatPhoneNumber(phone_number);
        
        // Create the message based on status
        let message = '';
        
        switch (status) {
            case 'Completed':
                message = `Your complaint #${complaint_id} has been resolved. Thank you for your patience!`;
                break;
                
            case 'Deferred':
                message = `Your complaint #${complaint_id} has been rescheduled. We'll notify you of the new timing shortly.`;
                break;
                
            case 'SNA':
                message = `Due to technical issues, your complaint #${complaint_id} will be rescheduled. We apologize for the inconvenience.`;
                break;
                
            case 'In-Progress':
                const skillmanInfo = skillman_name ? ` Our technician ${skillman_name} is on the way.` : '';
                message = `Your complaint #${complaint_id} is now in progress.${skillmanInfo} Thank you for your patience!`;
                break;
                
            default:
                console.error(`Unknown status: ${status}`);
                return { success: false, message: `Unknown status: ${status}` };
        }

        // Send the WhatsApp message using the existing client
        const chatId = `${formattedPhoneNumber}@c.us`;
        
        // Final check before sending
        if (!client.sendMessage || typeof client.sendMessage !== 'function') {
            console.error('WhatsApp client sendMessage function not available');
            return { success: false, message: 'WhatsApp client not ready' };
        }

        // Send the message with error handling
        try {
            await client.sendMessage(chatId, message);
            console.log(`WhatsApp message sent successfully to ${formattedPhoneNumber} for complaint ${complaint_id}`);
            return { success: true, message: 'Message sent successfully' };
        } catch (sendError) {
            console.error('Error sending WhatsApp message:', sendError);
            return { success: false, message: 'Failed to send message' };
        }
        
    } catch (error) {
        console.error('Error in sendWhatsappToCustomerForStatusUpdate:', error);
        // Don't throw the error, just return a failure response
        return { success: false, message: error.message };
    }
}






app.get('/api/complaints/:complaintId/previous-skillman', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  const { complaintId } = req.params;
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    // Connect to DB if not already connected
    // await sql.connect(dbConfig); // Not needed if using pool

    // Get the skillman_id from Complaints
    const complaintResult = await pool.request()
      .input('complaintId', sql.VarChar(25), complaintId)
      .query(`
        SELECT skillman_id 
        FROM Complaints 
        WHERE complaint_id = @complaintId
      `);

    if (complaintResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    const skillmanId = complaintResult.recordset[0].skillman_id;

    if (!skillmanId) {
      // No skillman assigned
      return res.json({ success: true, skillman: null });
    }

    // Fetch skillman details
    const skillmanResult = await pool.request()
      .input('id', sql.Int, skillmanId)
      .query(`
        SELECT 
          id, 
          name, 
          phoneNumber AS phone, 
          designation, 
          subdivision AS area
        FROM Skillmen
        WHERE id = @id
      `);

    if (skillmanResult.recordset.length === 0) {
      // Skillman not found (shouldn't happen)
      return res.json({ success: true, skillman: null });
    }

    // Return as array for consistency
    res.json({ success: true, skillman: skillmanResult.recordset });
  } catch (err) {
    console.error('Error fetching previous skillman:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch previous skillman' });
  }
});






// Function to send WhatsApp message when skillman is assigned/changed
async function sendSkillmanAssignmentMessage(customerId, complaintId, skillmanName, isReassignment, pool) {
  try {
    // Check if WhatsApp client is ready
    if (!client || !client.info) {
      console.error('WhatsApp client is not ready');
      return;
    }
    
    // Get customer details from database
    const customerResult = await pool.request()
      .input('customerId', sql.Int, customerId)
      .query('SELECT full_name, phone_number FROM Customers WHERE customer_id = @customerId');
    
    if (customerResult.recordset.length === 0) {
      console.error('Customer not found for ID:', customerId);
      return;
    }
    
    const customer = customerResult.recordset[0];
    let phoneNumber = customer.phone_number;
    const customerName = customer.full_name;
    
    // Normalize phone number - remove all non-digit characters
    let digitsOnly = phoneNumber.replace(/\D/g, '');
    
    // Convert to international format for Pakistan numbers
    let internationalNumber;
    
    if (digitsOnly.startsWith('92') && digitsOnly.length === 12) {
      // Already in international format: 923001234567
      internationalNumber = digitsOnly;
    } else if (digitsOnly.startsWith('92') && digitsOnly.length > 12) {
      // International format with extra digits, take first 12
      internationalNumber = digitsOnly.substring(0, 12);
    } else if (digitsOnly.startsWith('3') && digitsOnly.length === 10) {
      // Local format without zero: 3001234567 -> 923001234567
      internationalNumber = '92' + digitsOnly;
    } else if (digitsOnly.startsWith('03') && digitsOnly.length === 11) {
      // Local format with zero: 03001234567 -> 923001234567
      internationalNumber = '92' + digitsOnly.substring(1);
    } else if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
      // Other local formats starting with 0
      internationalNumber = '92' + digitsOnly.substring(1);
    } else if (digitsOnly.length === 9 || digitsOnly.length === 10) {
      // Assume it's a local number without country code
      internationalNumber = '92' + digitsOnly;
    } else {
      // Unknown format, try to use as is but limit to 12 digits
      internationalNumber = digitsOnly.length > 12 ? digitsOnly.substring(0, 12) : digitsOnly;
      console.warn(`Unknown phone number format: ${phoneNumber}, using: ${internationalNumber}`);
    }
    
    const whatsappId = `${internationalNumber}@c.us`;
    
    // Create appropriate message based on whether it's a new assignment or reassignment
    let message;
    if (isReassignment) {
      //message = `${customerName}, your complaint (ID: ${complaintId}) has been reassigned. Our new skillman ${skillmanName} is on the way to solve your problem.`;
      message = `${customerName}, your complaint (ID: ${complaintId}) 
Has been reassigned to our new skillman ${skillmanName}.👨🏻‍🔧
They are on the way to solve your problem.`;
    } else {
      //message = `${customerName}, your complaint (ID: ${complaintId}) has been assigned to our skillman ${skillmanName}. They are on the way to solve your problem.`;
      message = `${customerName}, your complaint (ID: ${complaintId}) 
Has been assigned to our skillman ${skillmanName}.👨🏻‍🔧 
They are on the way to solve your problem.`;
    }
    
    // Send WhatsApp message using the direct method
    await client.sendMessage(whatsappId, message);
    
    console.log(`WhatsApp assignment message sent to ${phoneNumber} (international: ${internationalNumber})`);
  } catch (error) {
    console.error('Error sending WhatsApp assignment message:', error.message);
    // Don't throw error to avoid affecting the main assignment flow
  }
}

app.post('/api/complaints/assign-skillman', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  
  const { complaintId, skillmanId } = req.body;

  if (!complaintId || !skillmanId) {
    return res.status(400).json({ success: false, message: 'complaintId and skillmanId are required' });
  }

  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }

    // 1. Get the previous skillman assigned to this complaint and customer ID
    const prevResult = await pool.request()
      .input('complaintId', sql.VarChar(25), complaintId)
      .query(`
        SELECT skillman_id, customer_id FROM Complaints WHERE complaint_id = @complaintId
      `);

    if (prevResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }

    const prevSkillmanId = prevResult.recordset[0].skillman_id;
    const customerId = prevResult.recordset[0].customer_id;

    // 2. Set previous skillman status to 'Active' (if there was one and it's different from the new one)
    if (prevSkillmanId && prevSkillmanId !== skillmanId) {
      await pool.request()
        .input('prevSkillmanId', sql.Int, prevSkillmanId)
        .query(`
          UPDATE Skillmen
          SET status = 'Active'
          WHERE id = @prevSkillmanId
        `);
    }

    // 3. Get the new skillman's name for the WhatsApp message
    const skillmanResult = await pool.request()
      .input('skillmanId', sql.Int, skillmanId)
      .query('SELECT name FROM Skillmen WHERE id = @skillmanId');
    
    if (skillmanResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Skillman not found' });
    }
    
    const skillmanName = skillmanResult.recordset[0].name;

    // 4. Update the complaint's skillman and set status to 'In-Progress'
    const result = await pool.request()
      .input('complaintId', sql.VarChar(25), complaintId)
      .input('skillmanId', sql.Int, skillmanId)
      .query(`
        UPDATE Complaints
        SET skillman_id = @skillmanId, status = 'In-Progress'
        WHERE complaint_id = @complaintId
      `);

    // 5. Set new skillman's status to 'In-Progress'
    await pool.request()
      .input('skillmanId', sql.Int, skillmanId)
      .query(`
        UPDATE Skillmen
        SET status = 'In-Progress'
        WHERE id = @skillmanId
      `);

    // 6. Send WhatsApp message to customer about the assignment
    const isReassignment = prevSkillmanId !== null && prevSkillmanId !== skillmanId;
    sendSkillmanAssignmentMessage(customerId, complaintId, skillmanName, isReassignment, pool)
      .catch(error => console.error('Error in sending WhatsApp assignment message:', error));

    if (result.rowsAffected[0] > 0) {
      res.json({ success: true, message: 'Skillman assigned successfully' });
    } else {
      res.status(404).json({ success: false, message: 'Complaint not found or not updated' });
    }
  } catch (error) {
    console.error('Error assigning skillman:', error);
    res.status(500).json({ success: false, message: 'Failed to assign skillman' });
  }
});











// APIs to retrieve complaints based on priority
app.post('/api/complaints-by-priority', async (req, res) => {
  // Verify Authorization header exists
  console.log("fetched");
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {

    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
   
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    const { page = 1, pageSize = 10, priority } = req.query;
    const offset = (page - 1) * pageSize;

    if (!priority) {
      return res.status(400).json({ success: false, message: 'Priority is required' });
    }

    await sql.connect(dbConfig);

    const query = `
      SELECT 
        c.complaint_id,
        c.nature,
        c.category,
        c.type,
        c.description,
        c.priority,
        c.launched_at,
        c.status,
        cust.full_name AS customer_name,
        cust.phone_number AS customer_phone,
        cust.email AS customer_email,
        loc.building_number AS location_building_number,
        loc.building_type AS location_building_type,
        loc.resdl AS location_resdl,
        loc.colony_number AS location_colony_number,
        col.Name AS location_colony_name,
        loc.area AS location_area,
        u.name AS receiver_name,
        s.name AS skillman_name
      FROM Complaints c
      LEFT JOIN Customers cust ON c.customer_id = cust.customer_id
      LEFT JOIN Location loc ON c.location_id = loc.location_id
      LEFT JOIN Colonies col ON loc.colony_number = col.ColonyNumber
      LEFT JOIN Users u ON c.receiver_id = u.id
      LEFT JOIN Skillmen s ON c.skillman_id = s.id
      WHERE c.priority = @priority
      ORDER BY c.launched_at DESC
      OFFSET @offset ROWS
      FETCH NEXT @pageSize ROWS ONLY
    `;

    const request = new sql.Request();
    request.input('priority', sql.VarChar(20), priority);
    request.input('offset', sql.Int, offset);
    request.input('pageSize', sql.Int, parseInt(pageSize));

    const result = await request.query(query);

    // Get total count for pagination info
    const countQuery = `
      SELECT COUNT(*) AS total FROM Complaints WHERE priority = @priority
    `;
    const countResult = await new sql.Request()
      .input('priority', sql.VarChar(20), priority)
      .query(countQuery);
    const total = countResult.recordset[0].total;

    res.json({
      success: true,
      data: result.recordset,
      pagination: {
        total,
        page: parseInt(page),
        pageSize: parseInt(pageSize),
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (err) {
    console.error('Error fetching complaints by priority:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch complaints',
      error: err.message
    });
  }
});















app.get('/api/receivers', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
   
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    // Connect to database
    await sql.connect(dbConfig);

    // Query distinct receiver names from Users
    const result = await sql.query(`
      SELECT DISTINCT id, name
      FROM Users
      ORDER BY name
    `);

    res.json(result.recordset);
  } catch (error) {
    console.error('Error fetching receivers:', error);
    res.status(500).json({ error: 'Failed to fetch receivers' });
  } finally {
    //sql.close();
  }
});







//API for delay complaints
/*
app.post('/api/delay-complaints', async (req, res) => {
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
   
  let connection;
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    connection = new sql.ConnectionPool(dbConfig);
    await connection.connect();

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(Math.min(parseInt(req.query.limit) || 10, 100), 1);
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    let baseQuery = `
      SELECT 
        c.complaint_id,
        CONVERT(VARCHAR(10), c.launched_at, 120) AS date,
        c.nature + ' / ' + c.type AS category,
        l.building_number AS building,
        col.Name AS colony,
        u.name AS launched_by,
        s.name AS skillman,
        c.priority AS type,
        c.status,
        CASE 
          WHEN c.priority = 'Immediate' THEN 
            ROUND(
              CASE 
                WHEN c.status = 'Completed' THEN 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 2, c.launched_at), c.completed_at) / 60.0
                ELSE 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 2, c.launched_at), SWITCHOFFSET(SYSDATETIMEOFFSET(), '+05:00')) / 60.0
              END, 1)
          WHEN c.priority = 'Urgent' THEN 
            ROUND(
              CASE 
                WHEN c.status = 'Completed' THEN 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 6, c.launched_at), c.completed_at) / 60.0
                ELSE 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 6, c.launched_at), SWITCHOFFSET(SYSDATETIMEOFFSET(), '+05:00')) / 60.0
              END, 1)
          WHEN c.priority = 'Routine' THEN 
            ROUND(
              CASE 
                WHEN c.status = 'Completed' THEN 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 24, c.launched_at), c.completed_at) / 60.0
                ELSE 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 24, c.launched_at), SWITCHOFFSET(SYSDATETIMEOFFSET(), '+05:00')) / 60.0
              END, 1)
        END AS delay_time_hours
      FROM Complaints c
      LEFT JOIN Location l ON c.location_id = l.location_id
      LEFT JOIN Colonies col ON l.colony_number = col.ColonyNumber
      LEFT JOIN Users u ON c.receiver_id = u.id
      LEFT JOIN Skillmen s ON c.skillman_id = s.id
      WHERE c.status IN ('Completed', 'In-Progress')   -- ✅ Include in-progress
      AND c.status != 'Deferred'
      AND (
        (c.priority = 'Immediate' AND 
          DATEDIFF(MINUTE, DATEADD(HOUR, 2, c.launched_at), 
            CASE WHEN c.status = 'Completed' THEN c.completed_at ELSE SWITCHOFFSET(SYSDATETIMEOFFSET(), '+05:00') END) > 0
        )
        OR
        (c.priority = 'Urgent' AND 
          DATEDIFF(MINUTE, DATEADD(HOUR, 6, c.launched_at), 
            CASE WHEN c.status = 'Completed' THEN c.completed_at ELSE SWITCHOFFSET(SYSDATETIMEOFFSET(), '+05:00') END) > 0
        )
        OR
        (c.priority = 'Routine' AND 
          DATEDIFF(MINUTE, DATEADD(HOUR, 24, c.launched_at), 
            CASE WHEN c.status = 'Completed' THEN c.completed_at ELSE SWITCHOFFSET(SYSDATETIMEOFFSET(), '+05:00') END) > 0
        )
      )
    `;

    if (search) {
      const safeSearch = search.replace(/'/g, "''");
      baseQuery += `
        AND (
          c.complaint_id LIKE '%${safeSearch}%' OR
          c.nature + ' / ' + c.type LIKE '%${safeSearch}%' OR
          l.building_number LIKE '%${safeSearch}%' OR
          col.Name LIKE '%${safeSearch}%' OR
          u.name LIKE '%${safeSearch}%' OR
          s.name LIKE '%${safeSearch}%' OR
          c.priority LIKE '%${safeSearch}%' OR
          c.status LIKE '%${safeSearch}%'
        )
      `;
    }

    const countResult = await connection.request().query(`
      SELECT COUNT(*) as total FROM (${baseQuery.replace(/SELECT.*FROM/, 'SELECT c.complaint_id FROM')}) AS temp
    `);
    const total = countResult.recordset[0].total;

    const result = await connection.request().query(`
      ${baseQuery}
      ORDER BY delay_time_hours DESC
      OFFSET ${offset} ROWS
      FETCH NEXT ${limit} ROWS ONLY
    `);

    const complaints = result.recordset.map(complaint => ({
      complaintId: complaint.complaint_id,
      date: complaint.date,
      category: complaint.category,
      building: complaint.building,
      colony: complaint.colony,
      launchedBy: complaint.launched_by,
      skillman: complaint.skillman || 'Unassigned',
      type: complaint.type,
      delayTime: `${parseFloat(complaint.delay_time_hours).toFixed(1)} hours`,
      status: complaint.status
    }));

    res.json({
      success: true,
      data: complaints,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching delayed complaints'
    });
  } finally {
    if (connection && connection.connected) {
      //await connection.close();
    }
  }
});*/
app.post('/api/delay-complaints', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
   
  let connection;
  try {
    let pool = await sql.connect(dbConfig);

    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
    connection = new sql.ConnectionPool(dbConfig);
    await connection.connect();

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(Math.min(parseInt(req.query.limit) || 10, 100), 1);
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    let baseQuery = `
      SELECT 
        c.complaint_id,
        CONVERT(VARCHAR(10), c.launched_at, 120) AS date,
        c.nature + ' / ' + c.type AS category,
        l.building_number AS building,
        col.Name AS colony,
        u.name AS launched_by,
        s.name AS skillman,
        c.priority AS type,
        c.status,
        CASE 
          WHEN c.priority = 'Immediate' THEN 
            ROUND(
              CASE 
                WHEN c.status = 'Completed' THEN 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 2, c.launched_at), c.completed_at) / 60.0
                ELSE 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 2, c.launched_at), GETDATE()) / 60.0
              END, 1)
          WHEN c.priority = 'Urgent' THEN 
            ROUND(
              CASE 
                WHEN c.status = 'Completed' THEN 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 6, c.launched_at), c.completed_at) / 60.0
                ELSE 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 6, c.launched_at), GETDATE()) / 60.0
              END, 1)
          WHEN c.priority = 'Routine' THEN 
            ROUND(
              CASE 
                WHEN c.status = 'Completed' THEN 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 24, c.launched_at), c.completed_at) / 60.0
                ELSE 
                  DATEDIFF(MINUTE, DATEADD(HOUR, 24, c.launched_at), GETDATE()) / 60.0
              END, 1)
        END AS delay_time_hours,
        c.launched_at
      FROM Complaints c
      LEFT JOIN Location l ON c.location_id = l.location_id
      LEFT JOIN Colonies col ON l.colony_number = col.ColonyNumber
      LEFT JOIN Users u ON c.receiver_id = u.id
      LEFT JOIN Skillmen s ON c.skillman_id = s.id
      WHERE c.status IN ('Completed', 'In-Progress')
      AND c.status != 'Deferred'
      AND (
        (c.priority = 'Immediate' AND 
          DATEDIFF(MINUTE, DATEADD(HOUR, 2, c.launched_at), 
            CASE WHEN c.status = 'Completed' THEN c.completed_at ELSE GETDATE() END) > 0
        )
        OR
        (c.priority = 'Urgent' AND 
          DATEDIFF(MINUTE, DATEADD(HOUR, 6, c.launched_at), 
            CASE WHEN c.status = 'Completed' THEN c.completed_at ELSE GETDATE() END) > 0
        )
        OR
        (c.priority = 'Routine' AND 
          DATEDIFF(MINUTE, DATEADD(HOUR, 24, c.launched_at), 
            CASE WHEN c.status = 'Completed' THEN c.completed_at ELSE GETDATE() END) > 0
        )
      )
    `;

    if (search) {
      const safeSearch = search.replace(/'/g, "''");
      baseQuery += `
        AND (
          c.complaint_id LIKE '%${safeSearch}%' OR
          c.nature + ' / ' + c.type LIKE '%${safeSearch}%' OR
          l.building_number LIKE '%${safeSearch}%' OR
          col.Name LIKE '%${safeSearch}%' OR
          u.name LIKE '%${safeSearch}%' OR
          s.name LIKE '%${safeSearch}%' OR
          c.priority LIKE '%${safeSearch}%' OR
          c.status LIKE '%${safeSearch}%'
        )
      `;
    }

    const countResult = await connection.request().query(`
      SELECT COUNT(*) as total FROM (${baseQuery.replace(/SELECT.*FROM/, 'SELECT c.complaint_id FROM')}) AS temp
    `);
    const total = countResult.recordset[0].total;

    const result = await connection.request().query(`
      ${baseQuery}
      ORDER BY c.launched_at DESC
      OFFSET ${offset} ROWS
      FETCH NEXT ${limit} ROWS ONLY
    `);

    const complaints = result.recordset.map(complaint => ({
      complaintId: complaint.complaint_id,
      date: complaint.date,
      category: complaint.category,
      building: complaint.building,
      colony: complaint.colony,
      launchedBy: complaint.launched_by,
      skillman: complaint.skillman || 'Unassigned',
      type: complaint.type,
      delayTime: `${parseFloat(complaint.delay_time_hours).toFixed(1)} hours`,
      status: complaint.status
    }));

    res.json({
      success: true,
      data: complaints,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });

  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({
      success: false,
      message: 'Error fetching delayed complaints'
    });
  } finally {
    if (connection && connection.connected) {
      // await connection.close();
    }
  }
});











//APIs for reports


// API endpoint to get colonies with their buildings
app.get('/api/colonies-with-buildings', async (req, res) => {
  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }

  let pool;
  try {
    // Connect to the database
    pool = await sql.connect(dbConfig);
    
    // Query to get colonies and their buildings
    // Using the exact column names from your database schema
    const query = `
      SELECT 
        c.ColonyNumber as id, 
        c.Name as name,
        l.location_id as buildingId, 
        l.building_number as buildingName
      FROM Colonies c
      LEFT JOIN Location l ON c.ColonyNumber = l.colony_number
      ORDER BY c.Name, l.building_number
    `;
    
    // Execute the query
    const result = await pool.request().query(query);
    
    // Log the raw result to check what's coming from the database
    //console.log('Raw database result:', result.recordset);
    
    // Process the data to group buildings by colony
    const coloniesMap = new Map();
    
    result.recordset.forEach(row => {
      const colonyId = row.id;
      
      // If colony doesn't exist in map, add it
      if (!coloniesMap.has(colonyId)) {
        coloniesMap.set(colonyId, {
          id: colonyId,
          name: row.name,
          buildings: []
        });
      }
      
      // Add building to colony if it exists
      if (row.buildingId && row.buildingName) {
        coloniesMap.get(colonyId).buildings.push({
          id: row.buildingId,
          name: row.buildingName
        });
      }
    });
    
    // Convert map to array
    const colonies = Array.from(coloniesMap.values());
    
    // Log the final processed data
    //console.log('Processed colonies data:', colonies);
    
    // Send the response
    res.json(colonies);
  } catch (err) {
    console.error('Database query error:', err);
    res.status(500).json({ error: 'Failed to fetch colonies and buildings' });
  } finally {
    // Close the database connection
    if (pool) {
      //await pool.close();
    }
  }
});




// Endpoint to get categories(subdivision) and natures
// API endpoint to get categories with their natures
app.get('/api/categories-with-natures', async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }




  let pool;
  try {
    // Connect to the database
    pool = await sql.connect(dbConfig);
    
    // Query to get categories and their natures from the Category table
    const query = `
      SELECT 
        subdivision_name as category,
        nature_name as nature
      FROM Category
      ORDER BY subdivision_name, nature_name
    `;
    
    // Execute the query
    const result = await pool.request().query(query);
    
    // Process the data to group natures by category
    const categoriesMap = new Map();
    
    result.recordset.forEach(row => {
      const categoryName = row.category;
      
      // If category doesn't exist in map, add it
      if (!categoriesMap.has(categoryName)) {
        categoriesMap.set(categoryName, {
          name: categoryName,
          natures: []
        });
      }
      
      // Add nature to category
      if (row.nature) {
        categoriesMap.get(categoryName).natures.push(row.nature);
      }
    });
    
    // Convert map to array
    const categories = Array.from(categoriesMap.values());
    
    // Send the response
    res.json(categories);
  } catch (err) {
    console.error('Database query error:', err);
    res.status(500).json({ error: 'Failed to fetch categories and natures' });
  } finally {
    // Close the database connection
    if (pool) {
      //await pool.close();
    }
  }
});












// Subdivision Reporting API

// API endpoint for sub division report
app.post('/api/subdiv-report', async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }



  const { fromDate, toDate, category } = req.body;
  
  try {
    // Connect to the database
    await sql.connect(dbConfig);
    
    // Build the WHERE clause based on the provided filters
    let whereClause = `WHERE launched_at BETWEEN @fromDate AND @toDate`;
    if (category && category !== '') {
      // Handle the special case for '-' category
      if (category === '-') {
        whereClause += ` AND (category IS NULL OR category = '-')`;
      } else {
        whereClause += ` AND category = @category`;
      }
    }
    
    // Query for status data (Inprogress, Completed, SNA, Deferred)
    const statusQuery = `
      SELECT 
        COALESCE(category, '-') AS subDivision,
        COUNT(CASE WHEN status = 'In-Progress' THEN 1 END) AS inprogress,
        COUNT(CASE WHEN status = 'Completed' THEN 1 END) AS completed,
        COUNT(CASE WHEN status = 'Un-Assigned' THEN 1 END) AS sna,
        COUNT(CASE WHEN status = 'Deferred' THEN 1 END) AS deferred,
        COUNT(*) AS total
      FROM Complaints
      ${whereClause}
      GROUP BY COALESCE(category, '-')
      ORDER BY COALESCE(category, '-')
    `;
    
    // Query for priority data (Immediate, Urgent, Routine, Deferred)
    // Note: Using priority deferred, not status deferred
    const priorityQuery = `
      SELECT 
        COALESCE(category, '-') AS subDivision,
        COUNT(CASE WHEN priority = 'Immediate' THEN 1 END) AS immediate,
        COUNT(CASE WHEN priority = 'Urgent' THEN 1 END) AS urgent,
        COUNT(CASE WHEN priority = 'Routine' THEN 1 END) AS routine,
        COUNT(CASE WHEN priority = 'Deferred' THEN 1 END) AS deferred,
        COUNT(*) AS total
      FROM Complaints
      ${whereClause}
      GROUP BY COALESCE(category, '-')
      ORDER BY COALESCE(category, '-')
    `;
    
    // Create request object
    const request = new sql.Request();
    
    // Add parameters to the request
    request.input('fromDate', sql.DateTime, new Date(fromDate));
    request.input('toDate', sql.DateTime, new Date(toDate));
    if (category && category !== '' && category !== '-') {
      request.input('category', sql.VarChar(10), category);
    }
    
    // Execute both queries in parallel
    const [statusResult, priorityResult] = await Promise.all([
      request.query(statusQuery),
      request.query(priorityQuery)
    ]);
    
    // Send the response
    res.json({
      statusData: statusResult.recordset,
      priorityData: priorityResult.recordset
    });
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    // Close the connection
    //sql.close && await sql.close();
  }
});








// API for summary reporting

app.get('/api/summary-report', async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }



  const { year } = req.query;
  
  if (!year || isNaN(year)) {
    return res.status(400).json({ error: 'Valid year parameter is required' });
  }

  let pool;
  try {
    pool = await sql.connect(dbConfig);
    
    // Get start and end dates for the year
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    // Get all natures and colonies first
    const [naturesResult, coloniesResult] = await Promise.all([
      pool.request().query('SELECT name FROM Natures'),
      pool.request().query('SELECT Name, ColonyNumber FROM Colonies')
    ]);

    const allNatures = naturesResult.recordset;
    const allColonies = coloniesResult.recordset;

    // Query for complaints by nature
    const natureQuery = `
      SELECT 
        n.name as nature,
        COUNT(c.complaint_id) as total,
        CASE 
          WHEN (SELECT COUNT(*) FROM Complaints WHERE YEAR(launched_at) = @year) > 0 
          THEN (COUNT(c.complaint_id) * 100.0 / (SELECT COUNT(*) FROM Complaints WHERE YEAR(launched_at) = @year))
          ELSE 0 
        END as percentage
      FROM Natures n
      LEFT JOIN Complaints c ON n.name = c.nature AND YEAR(c.launched_at) = @year
      GROUP BY n.name
      ORDER BY total DESC, n.name
    `;

    // Query for complaints by colony
    const colonyQuery = `
      SELECT 
        col.Name as colony,
        COUNT(c.complaint_id) as total,
        CASE 
          WHEN (SELECT COUNT(*) FROM Complaints WHERE YEAR(launched_at) = @year) > 0 
          THEN (COUNT(c.complaint_id) * 100.0 / (SELECT COUNT(*) FROM Complaints WHERE YEAR(launched_at) = @year))
          ELSE 0 
        END as percentage
      FROM Colonies col
      LEFT JOIN Location l ON col.ColonyNumber = l.colony_number
      LEFT JOIN Complaints c ON l.location_id = c.location_id AND YEAR(c.launched_at) = @year
      GROUP BY col.Name, col.ColonyNumber
      ORDER BY total DESC, col.Name
    `;

    const natureRequest = pool.request();
    natureRequest.input('year', sql.Int, parseInt(year));
    
    const colonyRequest = pool.request();
    colonyRequest.input('year', sql.Int, parseInt(year));

    const [natureComplaints, colonyComplaints] = await Promise.all([
      natureRequest.query(natureQuery),
      colonyRequest.query(colonyQuery)
    ]);

    // Ensure all natures are included (even with 0 complaints)
    const natureData = allNatures.map(natureItem => {
      const found = natureComplaints.recordset.find(item => item.nature === natureItem.name);
      return found || {
        nature: natureItem.name,
        total: 0,
        percentage: 0
      };
    });

    // Ensure all colonies are included (even with 0 complaints)
    const colonyData = allColonies.map(colonyItem => {
      const found = colonyComplaints.recordset.find(item => item.colony === colonyItem.Name);
      return found || {
        colony: colonyItem.Name,
        total: 0,
        percentage: 0
      };
    });

    res.json({
      nature: natureData,
      colony: colonyData
    });

  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (pool) {
      //await pool.close();
    }
  }
});






















// Endpoints for Default Reporting
// Complaints endpoint
app.get('/complaints-report', async (req, res) => {



  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }




  try {
    // Extract query parameters
    const {
      colony,
      building,
      category,
      nature,
      status,
      priority,
      fromDate,
      toDate
    } = req.query;

    // Base query with joins
    let query = `
      SELECT 
        c.complaint_id as id,
        CAST(c.launched_at as DATE) as date,
        c.category as subdiv,
        c.nature,
        c.type as ntype,
        col.Name as colony,
        l.building_number as building,
        u.receiver as launchedBy,
        s.name as skillman,
        cust.full_name as customer,
        c.priority as ptype,
        c.status
      FROM Complaints c
      LEFT JOIN Location l ON c.location_id = l.location_id
      LEFT JOIN Colonies col ON l.colony_number = col.ColonyNumber
      LEFT JOIN Users u ON c.receiver_id = u.id
      LEFT JOIN Skillmen s ON c.skillman_id = s.id
      LEFT JOIN Customers cust ON c.customer_id = cust.customer_id
      WHERE 1=1
    `;

    // Add filters based on query parameters
    if (colony) query += ` AND col.ColonyNumber LIKE '%${colony}%'`;
    if (building) query += ` AND l.building_number LIKE '%${building}%'`;
    if (category) query += ` AND c.category = '${category}'`;
    if (nature) query += ` AND c.nature = '${nature}'`;
    if (status) query += ` AND c.status = '${status}'`;
    if (priority) query += ` AND c.priority = '${priority}'`;
    if (fromDate) query += ` AND CAST(c.launched_at as DATE) >= '${fromDate}'`;
    if (toDate) query += ` AND CAST(c.launched_at as DATE) <= '${toDate}'`;

    // Order by date (most recent first)
    query += ` ORDER BY c.launched_at DESC`;

    // Execute query
    const result = await pool.request().query(query);
    
    // Send response
    res.json(result.recordset);
  } catch (err) {
    console.error('Error fetching complaints:', err);
    res.status(500).json({ error: 'Failed to fetch complaints data' });
  }
});
















// Rating Report
// API endpoint to get rating reports
app.get('/ratings', async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }




  try {
    // Connect to the database
    await sql.connect(dbConfig);
    
    // SQL query to get rating data
    const query = `
      SELECT 
        c.complaint_id,
        c.launched_at as date,
        cu.full_name as [user],
        cu.phone_number as number,
        c.category as type,
        CONCAT(c.nature, '/', c.type) as complaint_category,
        col.Name as colony,
        loc.building_number as building,
        cf.rating,
        cf.review,
        cf.created_at as feedback_date
      FROM Complaints c
      INNER JOIN Customers cu ON c.customer_id = cu.customer_id
      INNER JOIN Location loc ON c.location_id = loc.location_id
      INNER JOIN Colonies col ON loc.colony_number = col.ColonyNumber
      INNER JOIN ComplaintFeedback cf ON c.complaint_id = cf.complaint_id
      WHERE cf.rating IS NOT NULL
      ORDER BY cf.created_at DESC
    `;
    
    // Execute the query
    const result = await sql.query(query);
    
    // Format the data for the frontend
    const ratingsData = result.recordset.map(item => ({
      date: item.date,
      complaintNumber: item.complaint_id,
      user: item.user,
      number: item.number,
      type: item.type,
      category: item.complaint_category,
      colony: item.colony,
      building: item.building,
      rating: item.rating,
      review: item.review || 'No review provided'
    }));
    
    // Send the response
    res.json(ratingsData);
    
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to fetch rating data' });
  } finally {
    // Close the connection
    //await sql.close();
  }
});








// API endpoint to get all skillman summary data
app.get('/api/all-skillman-summary', async (req, res) => {



  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }



  try {
    // Connect to the database
    await sql.connect(dbConfig);
    
    // Query to get skillman performance data - only count reviewed feedback for rating
    const query = `
      SELECT 
        s.id,
        s.name,
        s.phoneNumber as phone,
        s.designation,
        COUNT(c.complaint_id) as totalComplaints,
        SUM(CASE WHEN c.status = 'In-Progress' THEN 1 ELSE 0 END) as inProgress,
        SUM(CASE WHEN c.status = 'Completed' THEN 1 ELSE 0 END) as completed,
        AVG(CASE WHEN cf.status = 'reviewed' THEN ISNULL(cf.rating, 0) ELSE NULL END) as rating,
        SUM(CASE 
            WHEN c.completed_at IS NOT NULL AND c.assigned_at IS NOT NULL 
            THEN DATEDIFF(MINUTE, c.assigned_at, c.completed_at) / 60.0
            ELSE 0 
        END) as totalHours,
        CASE 
            WHEN SUM(CASE WHEN c.status = 'Completed' THEN 1 ELSE 0 END) > 0
            THEN SUM(CASE 
                    WHEN c.completed_at IS NOT NULL AND c.assigned_at IS NOT NULL 
                    THEN DATEDIFF(MINUTE, c.assigned_at, c.completed_at) / 60.0
                    ELSE 0 
                END) / NULLIF(SUM(CASE WHEN c.status = 'Completed' THEN 1 ELSE 0 END), 0)
            ELSE 0
        END as averageHours,
        CASE 
            WHEN COUNT(c.complaint_id) > 0
            THEN (SUM(CASE WHEN c.status = 'Completed' THEN 1 ELSE 0 END) * 100.0) / COUNT(c.complaint_id)
            ELSE 0
        END as productivity,
        COUNT(CASE WHEN cf.status = 'reviewed' THEN 1 ELSE NULL END) as reviewedFeedbacks
      FROM Skillmen s
      LEFT JOIN Complaints c ON s.id = c.skillman_id
      LEFT JOIN ComplaintFeedback cf ON c.complaint_id = cf.complaint_id
      WHERE s.status = 'Active'
      GROUP BY s.id, s.name, s.phoneNumber, s.designation
      ORDER BY s.name
    `;
    
    const result = await sql.query(query);
    
    // Format the data for the frontend
    const skillmanData = result.recordset.map(row => {
      // Format time values to 1 decimal place
      const totalHours = parseFloat(row.totalHours).toFixed(1);
      const averageHours = parseFloat(row.averageHours).toFixed(1);
      
      // Handle rating - if no reviewed feedbacks, set rating to 0, otherwise format to 1 decimal place
      const rating = row.reviewedFeedbacks > 0 ? parseFloat(row.rating).toFixed(1) : '0.0';
      
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        designation: row.designation,
        totalComplaints: row.totalComplaints,
        inProgress: row.inProgress,
        completed: row.completed,
        rating: rating,
        timeSpent: `${totalHours}h`,
        averageTime: `${averageHours}hrs`,
        productivity: parseFloat(row.productivity).toFixed(1) + '%'
      };
    });
    
    res.json(skillmanData);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to fetch skillman data' });
  } finally {
    // Close the connection
    //await sql.close();
  }
});







// POST endpoint to retrieve complaints for a specific skillman with filters
app.post('/api/retrieve-complaints-for-one-skillman', async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }



  const { skillmanName, status, type, fromDate, toDate } = req.body;

  try {
    // Validate required parameter
    if (!skillmanName) {
      return res.status(400).json({ error: 'Skillman name is required' });
    }

    // Create database connection pool
    const pool = await sql.connect(dbConfig);

    // Build the base query
    let query = `
      SELECT 
        c.complaint_id,
        CONVERT(VARCHAR, c.launched_at, 23) as launched_date,
        CONVERT(VARCHAR, c.completed_at, 23) as completion_date,
        c.nature as category,
        l.building_number as building,
        u.name as launched_by,
        cust.full_name as customer,
        c.status,
        -- Calculate hours taken from assigned time to completion time
        CASE 
          WHEN c.assigned_at IS NOT NULL AND c.completed_at IS NOT NULL 
          THEN ROUND(DATEDIFF(SECOND, c.assigned_at, c.completed_at) / 3600.0, 2)
          ELSE NULL 
        END as hours_taken,
        -- Format the time values for display
        FORMAT(c.assigned_at, 'yyyy-MM-dd HH:mm:ss') as assigned_time,
        FORMAT(c.completed_at, 'yyyy-MM-dd HH:mm:ss') as completed_time,
        -- Include the original launched_at for proper sorting
        c.launched_at
      FROM Complaints c
      INNER JOIN Skillmen s ON c.skillman_id = s.id
      INNER JOIN Users u ON c.receiver_id = u.id
      INNER JOIN Customers cust ON c.customer_id = cust.customer_id
      INNER JOIN Location l ON c.location_id = l.location_id
      INNER JOIN Colonies col ON l.colony_number = col.ColonyNumber
      WHERE s.name = @skillmanName
        AND c.status NOT IN ('Deferred', 'SNA')
    `;

    // Add filters based on request parameters
    const params = [{ name: 'skillmanName', type: sql.VarChar, value: skillmanName }];

    if (status && status !== '') {
      query += ` AND c.status = @status`;
      params.push({ name: 'status', type: sql.VarChar, value: status });
    }

    if (type && type !== '') {
      query += ` AND c.type = @type`;
      params.push({ name: 'type', type: sql.VarChar, value: type });
    }

    if (fromDate && fromDate !== '') {
      query += ` AND c.launched_at >= @fromDate`;
      params.push({ name: 'fromDate', type: sql.DateTime, value: fromDate });
    }

    if (toDate && toDate !== '') {
      // Add one day to include the entire end date
      const nextDay = new Date(toDate);
      nextDay.setDate(nextDay.getDate() + 1);
      
      query += ` AND c.launched_at < @toDate`;
      params.push({ name: 'toDate', type: sql.DateTime, value: nextDay.toISOString().split('T')[0] });
    }

    // Order by launch date (newest first) - This ensures ALL results are in descending order
    query += ` ORDER BY c.launched_at DESC`;

    // Execute the query
    const request = pool.request();
    
    // Add all parameters to the request
    params.forEach(param => {
      request.input(param.name, param.type, param.value);
    });
    
    const result = await request.query(query);

    // Remove the raw launched_at from the response since we don't need to expose it
    const cleanedResults = result.recordset.map(item => {
      const { launched_at, ...rest } = item;
      return rest;
    });

    // Return the results
    res.json(cleanedResults);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});













async function runQuery(query, params = []) {
  try {
    const pool = await sql.connect(dbConfig);
    const request = pool.request();
    
    // Add parameters if provided
    params.forEach(param => {
      request.input(param.name, param.type, param.value);
    });
    
    const result = await request.query(query);
    return result;
  } catch (error) {
    console.error('Query execution error:', error);
    throw error;
  }
}


// daily-complaints

app.get('/api/complaints/daily-stats', async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }



  const date = req.query.date || new Date().toISOString().split('T')[0];
  //console.log(`📡 API Called: /api/complaints/daily-stats?date=${date}`);

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;

  try {
    //console.log(`📊 Fetching data for ${date}...`);

    // 1️⃣ Status by Category - FIXED STATUS SPELLINGS
    const statusResult = await runQuery(
      `
      SELECT 
        category AS Category,
        SUM(CASE WHEN status = 'Un-Assigned' THEN 1 ELSE 0 END) AS unassigned,
        SUM(CASE WHEN status = 'In-Progress' THEN 1 ELSE 0 END) AS inProgress,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'Deferred' THEN 1 ELSE 0 END) AS deferred,
        COUNT(*) AS total
      FROM Complaints
      WHERE CONVERT(DATE, launched_at) = CONVERT(DATE, @date)
      GROUP BY category
      `,
      [{ name: 'date', type: sql.Date, value: date }]
    );

    const statusLabels = statusResult.recordset.map(r => r.Category);
    const statusByCategory = {
      labels: statusLabels,
      datasets: [
        { label: 'Unassigned', data: statusResult.recordset.map(r => r.unassigned), backgroundColor: '#e74c3c' },
        { label: 'In-Progress', data: statusResult.recordset.map(r => r.inProgress), backgroundColor: '#f39c12' },
        { label: 'Completed', data: statusResult.recordset.map(r => r.completed), backgroundColor: '#2ecc71' },
        { label: 'Deferred', data: statusResult.recordset.map(r => r.deferred), backgroundColor: '#9b59b6' }
      ]
    };

    // 2️⃣ Category Ratio
    const categoryRatio = {
      labels: statusLabels,
      data: statusResult.recordset.map(r => r.total)
    };

    // 3️⃣ Priority Table (category → priority counts) - FIXED PRIORITY SPELLINGS
    const priorityResult = await runQuery(
      `
      SELECT 
        category,
        SUM(CASE WHEN priority = 'immediate' THEN 1 ELSE 0 END) AS immediate,
        SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) AS urgent,
        SUM(CASE WHEN priority = 'routine' THEN 1 ELSE 0 END) AS routine,
        SUM(CASE WHEN priority = 'deferred' THEN 1 ELSE 0 END) AS deferred,
        COUNT(*) AS total
      FROM Complaints
      WHERE CONVERT(DATE, launched_at) = CONVERT(DATE, @date)
      GROUP BY category
      ORDER BY category
      `,
      [{ name: 'date', type: sql.Date, value: date }]
    );

    // 4️⃣ Productivity Chart (priority → status breakdown) - FIXED PRIORITY SPELLINGS
    const productivityResult = await runQuery(
      `
      SELECT 
        priority,
        SUM(CASE WHEN status = 'Un-Assigned' THEN 1 ELSE 0 END) AS unassigned,
        SUM(CASE WHEN status = 'In-Progress' THEN 1 ELSE 0 END) AS inProgress,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'Deferred' THEN 1 ELSE 0 END) AS deferred,
        COUNT(*) AS total
      FROM Complaints
      WHERE CONVERT(DATE, launched_at) = CONVERT(DATE, @date)
      GROUP BY priority
      ORDER BY 
        CASE 
          WHEN priority = 'immediate' THEN 1
          WHEN priority = 'urgent' THEN 2
          WHEN priority = 'routine' THEN 3
          WHEN priority = 'deferred' THEN 4
          ELSE 5
        END
      `,
      [{ name: 'date', type: sql.Date, value: date }]
    );

    // Prepare productivity chart data
    const productivityData = {
      labels: productivityResult.recordset.map(r => r.priority),
      datasets: [
        { label: 'Unassigned', data: productivityResult.recordset.map(r => r.unassigned), backgroundColor: '#e74c3c' },
        { label: 'In-Progress', data: productivityResult.recordset.map(r => r.inProgress), backgroundColor: '#f39c12' },
        { label: 'Completed', data: productivityResult.recordset.map(r => r.completed), backgroundColor: '#2ecc71' },
        { label: 'Deferred', data: productivityResult.recordset.map(r => r.deferred), backgroundColor: '#9b59b6' }
      ]
    };

    // 5️⃣ Deferred Complaints List - FIXED STATUS MATCHING
    const deferredResult = await runQuery(
      `
      SELECT 
        c.category AS Category,
        CONVERT(VARCHAR(10), c.launched_at, 23) AS Date,
        c.complaint_id AS ComplaintNo,
        ISNULL(col.Name, 'Unknown') + ', ' + ISNULL(loc.building_number, 'N/A') AS Address,
        c.nature AS Nature,
        c.type AS Type,
        DATEDIFF(HOUR, c.launched_at, GETDATE()) AS Hours
      FROM Complaints c
      LEFT JOIN Location loc ON c.location_id = loc.location_id
      LEFT JOIN Colonies col ON loc.colony_number = col.ColonyNumber
      WHERE c.status = 'Deferred'
        AND CONVERT(DATE, c.launched_at) = CONVERT(DATE, @date)
      ORDER BY c.launched_at DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `,
      [
        { name: 'date', type: sql.Date, value: date },
        { name: 'offset', type: sql.Int, value: offset },
        { name: 'pageSize', type: sql.Int, value: pageSize }
      ]
    );

    // Get total count for deferred complaints for pagination
    const deferredCountResult = await runQuery(
      `
      SELECT COUNT(*) AS totalCount
      FROM Complaints
      WHERE status = 'Deferred'
        AND CONVERT(DATE, launched_at) = CONVERT(DATE, @date)
      `,
      [{ name: 'date', type: sql.Date, value: date }]
    );

    const totalDeferred = deferredCountResult.recordset[0].totalCount;

    //console.log("Deferred complaints rows:", deferredResult.recordset);

    // ✅ Send response
    res.json({
      success: true,
      statusByCategory,
      categoryRatio,
      productivityData,
      tables: {
        statusTable: statusResult.recordset,
        priorityTable: priorityResult.recordset,
        deferredTable: deferredResult.recordset
      },
      pagination: {
        page,
        pageSize,
        total: totalDeferred,
        totalPages: Math.ceil(totalDeferred / pageSize)
      }
    });

    //console.log(`✅ Data retrieved successfully for ${date}`);
  } catch (err) {
    console.error('❌ Database error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});













// Dashboard APIs

// Endpoint to get monthly complaints data for the current year
app.get('/api/monthly-complaints', async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }




  try {
    // Connect to the database
    await sql.connect(dbConfig);
    
    // Get current year
    const currentYear = new Date().getFullYear();
    
    // SQL query to get monthly complaints count by status for the current year
    const query = `
      SELECT 
        MONTH(launched_at) as month,
        status,
        COUNT(*) as count
      FROM Complaints
      WHERE YEAR(launched_at) = @currentYear
      GROUP BY MONTH(launched_at), status
      ORDER BY month, status
    `;
    
    // Execute the query
    const result = await sql.query`
      SELECT 
        MONTH(launched_at) as month,
        status,
        COUNT(*) as count
      FROM Complaints
      WHERE YEAR(launched_at) = ${currentYear}
      GROUP BY MONTH(launched_at), status
      ORDER BY month, status
    `;
    
    // Initialize arrays for each status with zeros for all months
    const monthlyData = {
      pending: new Array(12).fill(0),
      inprogress: new Array(12).fill(0),
      completed: new Array(12).fill(0)
    };
    
    // Process the result and populate the monthlyData object
    result.recordset.forEach(row => {
      const monthIndex = row.month - 1; // Convert month (1-12) to array index (0-11)
      
      switch(row.status) {
        case 'Un-Assigned':
        case 'Deferred':
        case 'SNA':
          monthlyData.pending[monthIndex] = row.count;
          break;
        case 'In-Progress':
          monthlyData.inprogress[monthIndex] = row.count;
          break;
        case 'Completed':
          monthlyData.completed[monthIndex] = row.count;
          break;
      }
    });
    
    // Send the response
    res.json(monthlyData);
    
  } catch (error) {
    console.error('Error fetching monthly complaints data:', error);
    res.status(500).json({ error: 'Failed to fetch monthly complaints data' });
  } finally {
    // Close the connection
    //await sql.close();
  }
});







// Category complaints endpoint
app.get('/api/category-complaints', async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }



  try {
    await sql.connect(dbConfig);
    
    // Get all subdivisions first
    const subdivisionsResult = await sql.query`SELECT name FROM Subdivision`;
    const subdivisions = subdivisionsResult.recordset.map(row => row.name);
    
    // Get complaint counts by category
    const result = await sql.query`
      SELECT 
        category, 
        COUNT(*) as count,
        status
      FROM Complaints 
      WHERE category IS NOT NULL
      GROUP BY category, status
    `;
    
    // Initialize counts for all categories
    const categoryCounts = {};
    subdivisions.forEach(category => {
      categoryCounts[category] = {
        InProgress: 0,
        Completed: 0,
        Deffered: 0,
        UnAssigned: 0,
        SNA: 0
      };
    });
    
    // Process the results
    result.recordset.forEach(row => {
      const statusKey = row.status.replace('-', ''); // Convert "In-Progress" to "InProgress"
      if (categoryCounts[row.category]) {
        categoryCounts[row.category][statusKey] = row.count;
      }
    });
    
    // Calculate total for each category
    const categoryData = subdivisions.map(category => {
      const counts = categoryCounts[category];
      const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
      
      return {
        name: category,
        value: total,
        // Generate a color based on category name for consistency
        details: counts
      };
    });
    
    res.json(categoryData);
  } catch (error) {
    console.error('Error fetching category complaints:', error);
    res.status(500).json({ error: 'Failed to fetch category complaints data' });
  }
});







// Nature complaints endpoint
app.get('/api/nature-complaints', async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }




  try {
    await sql.connect(dbConfig);
    
    // Get all natures first
    const naturesResult = await sql.query`SELECT name FROM Natures`;
    const natures = naturesResult.recordset.map(row => row.name);
    
    // Get complaint counts by nature
    const result = await sql.query`
      SELECT 
        nature, 
        COUNT(*) as count,
        status
      FROM Complaints 
      WHERE nature IS NOT NULL
      GROUP BY nature, status
    `;
    
    // Initialize counts for all natures
    const natureCounts = {};
    natures.forEach(nature => {
      natureCounts[nature] = {
        InProgress: 0,
        Completed: 0,
        Deffered: 0,
        UnAssigned: 0,
        SNA: 0
      };
    });
    
    // Process the results
    result.recordset.forEach(row => {
      const statusKey = row.status.replace('-', ''); // Convert "In-Progress" to "InProgress"
      if (natureCounts[row.nature]) {
        natureCounts[row.nature][statusKey] = row.count;
      }
    });
    
    // Calculate total for each nature
    const natureData = natures.map(nature => {
      const counts = natureCounts[nature];
      const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
      
      return {
        name: nature,
        value: total,
        // Generate a color based on nature name for consistency
        details: counts
      };
    });
    
    res.json(natureData);
  } catch (error) {
    console.error('Error fetching nature complaints:', error);
    res.status(500).json({ error: 'Failed to fetch nature complaints data' });
  } finally {
    if(pool) {
      //await pool.close();
    }
  }
});






app.get('/api/stats', async (req, res) => {



  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }



  try {
    // Connect to the database
    const pool = await sql.connect(dbConfig);
    
    // Execute all count queries in parallel
    const [coloniesResult, customersResult, apartmentsResult, skillmenResult] = await Promise.all([
      pool.request().query('SELECT COUNT(*) as count FROM Colonies'),
      pool.request().query('SELECT COUNT(*) as count FROM Customers'),
      pool.request().query(`SELECT COUNT(*) as count FROM Location WHERE resdl = 'Resdl'`),
      pool.request().query(`SELECT COUNT(*) as count FROM Skillmen`)
    ]);
    
    // Extract counts from results
    const coloniesCount = coloniesResult.recordset[0].count;
    const customersCount = customersResult.recordset[0].count;
    const apartmentsCount = apartmentsResult.recordset[0].count;
    const skillmenCount = skillmenResult.recordset[0].count;
    
    // Send the response
    res.json({
      colonies: coloniesCount,
      customers: customersCount,
      apartments: apartmentsCount,
      skillman: skillmenCount
    });
    
  } catch (error) {
    console.error('Database query error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch statistics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    // Close the connection
    if (pool) {
      //await pool.close();
    }
  }
});










app.get("/api/get-categories-for-dashboard", async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }



  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool
      .request()
      .query("SELECT ColonyNumber, Name FROM Colonies");

    res.json(result.recordset);
  } catch (err) {
    console.error("Error fetching colonies:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Categories endpoint
app.get('/get-categories-for-dashboard', async (req, res) => {
  try {
    // Connect to the database
    await sql.connect(dbConfig);
    
    // Query the Natures table
    const result = await sql.query('SELECT name FROM Natures ORDER BY name');
    
    // Format the results and encode the values
    const categories = result.recordset.map(row => {
      const encodedName = encodeURIComponent(row.name);
      return {
        id: encodedName,
        name: encodedName
      };
    });
    
    // Send response
    res.json(categories);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  } finally {
    // Close the database connection
    //await sql.close();
  }
});





app.get('/api/trends-data', async (req, res) => {
  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }


  try {
    const { colony, category } = req.query;
    
    // Decode the parameters if they were encoded
    const decodedColony = colony ? decodeURIComponent(atob(colony)) : '';
    const decodedCategory = category ? decodeURIComponent(atob(category)) : '';
    
    // Connect to the database
    const pool = await sql.connect(dbConfig);
    
    // Build the query with parameters
    let query = `
      SELECT 
        MONTH(c.launched_at) as month,
        c.status,
        COUNT(*) as count
      FROM Complaints c
      INNER JOIN Location l ON c.location_id = l.location_id
      WHERE c.launched_at >= DATEADD(MONTH, -11, GETDATE())
    `;
    
    // Add parameters
    const params = [];
    
    if (decodedColony) {
      query += ` AND l.colony_number = @colony`;
      params.push({ name: 'colony', value: decodedColony });
    }
    
    if (decodedCategory) {
      query += ` AND c.category = @category`;
      params.push({ name: 'category', value: decodedCategory });
    }
    
    query += `
      GROUP BY MONTH(c.launched_at), c.status
      ORDER BY MONTH(c.launched_at), c.status
    `;
    
    // Create request
    const request = pool.request();
    
    // Add parameters to request
    params.forEach(param => {
      request.input(param.name, sql.VarChar, param.value);
    });
    
    // Execute the query
    const result = await request.query(query);
    
    // Initialize data structure
    const trendsData = {
      categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      pending: new Array(12).fill(0),
      inprogress: new Array(12).fill(0),
      completed: new Array(12).fill(0)
    };
    
    // Process the results
    result.recordset.forEach(row => {
      const monthIndex = row.month - 1; // Convert to 0-based index
      const status = row.status.toLowerCase().replace('-', '');
      const count = row.count;
      
      if (status === 'unassigned' || status === 'sna') {
        trendsData.pending[monthIndex] += count;
      } else if (status === 'inprogress' || status === 'deferred') {
        trendsData.inprogress[monthIndex] += count;
      } else if (status === 'completed') {
        trendsData.completed[monthIndex] += count;
      }
    });
    
    res.json(trendsData);
    
  } catch (error) {
    console.error('Error fetching trends data:', error);
    res.status(500).json({ error: 'Failed to fetch trends data' });
  } finally {
    // Close the connection
    if (pool) {
      //await pool.close();
    }
  }
});




app.get('/api/complaints-summary-count', async (req, res) => {


  
  
  // Verify Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized - No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    let pool = await sql.connect(dbConfig);

    // Step 1: Verify token exists in Users table
    const tokenCheck = await pool.request()
      .input('token', sql.VarChar(255), token)
      .query('SELECT id FROM Users WHERE token = @token');

    if (tokenCheck.recordset.length === 0) {
      return res.status(401).json({ error: 'Unauthorized - Invalid token. Please login again.' });
    }
  } catch(error) {
    console.err('Error: '+error);
  }



  try {
    // Create pool for this request
    const pool = await sql.connect(dbConfig);

    const result = await pool.request().query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('Un-Assigned') THEN 1 ELSE 0 END) AS unassigned,
        SUM(CASE WHEN status IN ('In-Progress', 'Deffered', 'SNA') THEN 1 ELSE 0 END) AS inprogress,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed
      FROM Complaints
    `);

    const stats = result.recordset[0];

    res.json({
      total: stats.total,
      unassigned: stats.unassigned,
      inprogress: stats.inprogress,
      completed: stats.completed
    });

  } catch (error) {
    console.error('Error fetching complaints summary:', error);
    res.status(500).json({ error: 'Failed to fetch complaints summary' });
  } finally {
    // Close pool after each request
    if (pool) {
      //await pool.close();
    }
  }
});














// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});


// Handle database connection errors
sql.on('error', err => {
  console.error('SQL Server connection error:', err);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  if (pool) {
    await pool.close();
    console.log('Database connection closed');
  }
  process.exit();
});
