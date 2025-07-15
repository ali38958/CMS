const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

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

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Test SQL connection on startup
sql.connect(dbConfig)
  .then(() => {
    console.log('✅ Connected to SQL Server successfully');
    sql.close(); // Close after initial test
  })
  .catch((err) => {
    console.error('❌ Failed to connect to SQL Server:', err.message);
  });

// Middleware
app.use(cors());
app.use(bodyParser.json());

// GET: Load all colonies
app.get('/getColonies', async (req, res) => {
  try {
    await sql.connect(dbConfig);
    console.log('[GET] Connected to SQL Server');

    const result = await sql.query(`
      SELECT 
        Name AS name,
        ColonyNumber AS colonyNumber,
        ISNULL(NumberOfBuildings, 0) AS buildings
      FROM Colonies
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
      INSERT INTO Colonies (Name, ColonyNumber, NumberOfBuildings)
      VALUES (@Name, @ColonyNumber, 0)
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
});
