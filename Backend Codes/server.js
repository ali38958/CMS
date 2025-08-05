const express = require('express');
const sql = require('mssql');
const cors = require('cors');

// Database configuration
const dbConfig = {
  user: 'cms_user2',
  password: 'StrongPassword456',
  server: 'localhost',
  database: 'CMS',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

// Create Express app
const app = express();
const port = 3000;

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

// API endpoint to get address data
app.get('/api/addresses', async (req, res) => {
  try {
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
  try {
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
  try {
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
  try {
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
  try {
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
  try {
    const pool = await sql.connect(dbConfig);
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
  try {
    const pool = await sql.connect(dbConfig);
    
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
  const search = req.query.q;

  if (!search) {
    return res.status(400).json({ error: 'Search term is required' });
  }

  try {
    const pool = await sql.connect(dbConfig);

    // Step 1: Find user by name or phone
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

    // Step 2: Find user's locations with all required fields
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
  let pool;
  let transaction;

  try {
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
  try {
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

app.post('/api/assign-skillman', async (req, res) => {
  try {
    const { priority, primarySkillman, helperSkillmen } = req.body;
    
    // Validate request
    if (!primarySkillman || !primarySkillman.id) {
      return res.status(400).json({ error: 'Primary skillman is required' });
    }
    
    // Here you would typically:
    // 1. Create a new complaint assignment record
    // 2. Link the primary skillman and helpers to the complaint
    // 3. Update any relevant statuses
    
    // For now, we'll just return a success response
    const response = {
      success: true,
      message: 'Skillman assigned successfully',
      data: {
        complaintId: Math.floor(Math.random() * 1000), // Mock complaint ID
        assignedAt: new Date().toISOString(),
        primarySkillman,
        helperSkillmen,
        priority
      }
    };
    
    res.json(response);
  } catch (err) {
    console.error('Error assigning skillman:', err);
    res.status(500).json({ error: 'Failed to assign skillman' });
  }
});

// Additional API for getting skillmen by area (optional)
app.get('/api/skillmen/area/:area', async (req, res) => {
  try {
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
  try {
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
  try {
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
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ message: 'Nature name is required' });
  }

  try {
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
  const oldName = decodeURIComponent(req.params.name);
  const { name: newName, categories } = req.body;

  if (!newName) {
    return res.status(400).json({ message: 'Nature name is required' });
  }

  const transaction = new sql.Transaction(pool);
  
  try {
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
  const name = decodeURIComponent(req.params.name);

  try {
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
  const natureName = decodeURIComponent(req.params.name);
  const { type } = req.body;

  if (!type) {
    return res.status(400).json({ message: 'Type is required' });
  }

  try {
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
  const natureName = decodeURIComponent(req.params.name);
  const type = req.params.type;

  try {
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
  try {
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
  try {
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
  try {
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
  try {
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
  try {
    const result = await pool.request()
      .query('SELECT * FROM Designation');
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/designations', async (req, res) => {
  try {
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
  try {
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
  try {
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
  try {
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
  try {
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
  const { name, colonyNumber } = req.body;

  if (!name || !colonyNumber) {
    return res.status(400).json({ message: 'Name and ColonyNumber are required' });
  }

  try {
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
  const { previous, new: updated } = req.body;

  if (!previous || !updated) {
    return res.status(400).json({ message: 'Missing previous or new colony data' });
  }

  try {
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

