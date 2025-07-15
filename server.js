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

// GET: Load all natures with categories and types
app.get('/natures', async (req, res) => {
  try {
    await sql.connect(dbConfig);
    console.log('[GET] Connected to SQL Server');

    const naturesQuery = `
      SELECT n.NatureID, n.Name 
      FROM Nature n
      ORDER BY n.Name
    `;

    const categoriesQuery = `
      SELECT c.CategoryID, c.NatureID, c.Name 
      FROM Categories c
    `;

    const typesQuery = `
      SELECT t.TypeID, t.NatureID, t.Description 
      FROM CategoryTypes t
    `;

    // Execute all queries in parallel
    const [naturesResult, categoriesResult, typesResult] = await Promise.all([
      sql.query(naturesQuery),
      sql.query(categoriesQuery),
      sql.query(typesQuery)
    ]);

    // Structure the data
    const natures = naturesResult.recordset.map(nature => ({
      id: nature.NatureID,
      nature: nature.Name,
      categories: []
    }));

    // Add categories to natures
    categoriesResult.recordset.forEach(category => {
      const nature = natures.find(n => n.id === category.NatureID);
      if (nature) {
        nature.categories.push({
          id: category.CategoryID,
          name: category.Name,
          types: []
        });
      }
    });

    // Add types to categories
    typesResult.recordset.forEach(type => {
      const nature = natures.find(n => n.id === type.NatureID);
      if (nature) {
        nature.categories.forEach(category => {
          // Since types are associated with nature, not directly with category
          // We'll add them to all categories under that nature
          category.types.push(type.Description);
        });
      }
    });

    console.log('[GET] Natures fetched successfully');
    res.json(natures);
  } catch (error) {
    console.error('[GET] Error fetching natures:', error.message);
    res.status(500).json({ message: 'Error fetching natures' });
  }
});

// POST: Add new nature
app.post('/natures', async (req, res) => {
  const { name } = req.body;

  if (!name) {
    console.log('[POST] Missing nature name');
    return res.status(400).json({ message: 'Missing nature name' });
  }

  try {
    await sql.connect(dbConfig);
    console.log('[POST] Connected to SQL Server');

    const request = new sql.Request();
    request.input('Name', sql.VarChar(100), name);

    const result = await request.query(`
      INSERT INTO Nature (Name)
      OUTPUT INSERTED.NatureID
      VALUES (@Name)
    `);

    const newNatureId = result.recordset[0].NatureID;

    console.log(`[POST] Nature added: ${name} (ID: ${newNatureId})`);
    res.json({ 
      id: newNatureId,
      nature: name,
      categories: []
    });
  } catch (error) {
    console.error('[POST] Error adding nature:', error.message);
    res.status(500).json({ message: 'Error adding nature' });
  }
});

// PUT: Update nature name
app.put('/natures/:id', async (req, res) => {
  const natureId = req.params.id;
  const { name } = req.body;

  if (!name) {
    console.log('[PUT] Missing nature name');
    return res.status(400).json({ message: 'Missing nature name' });
  }

  try {
    await sql.connect(dbConfig);
    console.log('[PUT] Connected to SQL Server');

    const request = new sql.Request();
    request.input('NatureID', sql.Int, natureId);
    request.input('Name', sql.VarChar(100), name);

    await request.query(`
      UPDATE Nature
      SET Name = @Name
      WHERE NatureID = @NatureID
    `);

    console.log(`[PUT] Nature updated: ID ${natureId} to ${name}`);
    res.json({ message: 'Nature updated successfully' });
  } catch (error) {
    console.error('[PUT] Error updating nature:', error.message);
    res.status(500).json({ message: 'Error updating nature' });
  }
});

// DELETE: Delete nature and related data
app.delete('/natures/:id', async (req, res) => {
  const natureId = req.params.id;

  try {
    await sql.connect(dbConfig);
    console.log('[DELETE] Connected to SQL Server');

    const transaction = new sql.Transaction();
    await transaction.begin();

    try {
      const request = new sql.Request(transaction);
      request.input('NatureID', sql.Int, natureId);

      // Delete related types
      await request.query(`
        DELETE FROM CategoryTypes
        WHERE NatureID = @NatureID
      `);

      // Delete related categories
      await request.query(`
        DELETE FROM Categories
        WHERE NatureID = @NatureID
      `);

      // Delete the nature
      await request.query(`
        DELETE FROM Nature
        WHERE NatureID = @NatureID
      `);

      await transaction.commit();
      console.log(`[DELETE] Nature deleted: ID ${natureId}`);
      res.json({ message: 'Nature deleted successfully' });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('[DELETE] Error deleting nature:', error.message);
    res.status(500).json({ message: 'Error deleting nature' });
  }
});

// POST: Add category to nature
app.post('/natures/:natureId/categories', async (req, res) => {
  const natureId = req.params.natureId;
  const { name } = req.body;

  if (!name) {
    console.log('[POST] Missing category name');
    return res.status(400).json({ message: 'Missing category name' });
  }

  try {
    await sql.connect(dbConfig);
    console.log('[POST] Connected to SQL Server');

    const request = new sql.Request();
    request.input('NatureID', sql.Int, natureId);
    request.input('Name', sql.VarChar(100), name);

    const result = await request.query(`
      INSERT INTO Categories (NatureID, Name)
      OUTPUT INSERTED.CategoryID
      VALUES (@NatureID, @Name)
    `);

    const newCategoryId = result.recordset[0].CategoryID;

    console.log(`[POST] Category added: ${name} (ID: ${newCategoryId}) for Nature ID: ${natureId}`);
    res.json({ 
      id: newCategoryId,
      name: name,
      types: []
    });
  } catch (error) {
    console.error('[POST] Error adding category:', error.message);
    res.status(500).json({ message: 'Error adding category' });
  }
});

// DELETE: Delete category
app.delete('/categories/:id', async (req, res) => {
  const categoryId = req.params.id;

  try {
    await sql.connect(dbConfig);
    console.log('[DELETE] Connected to SQL Server');

    const transaction = new sql.Transaction();
    await transaction.begin();

    try {
      const request = new sql.Request(transaction);
      request.input('CategoryID', sql.Int, categoryId);

      // Delete related types
      await request.query(`
        DELETE FROM CategoryTypes
        WHERE CategoryID = @CategoryID
      `);

      // Delete the category
      await request.query(`
        DELETE FROM Categories
        WHERE CategoryID = @CategoryID
      `);

      await transaction.commit();
      console.log(`[DELETE] Category deleted: ID ${categoryId}`);
      res.json({ message: 'Category deleted successfully' });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('[DELETE] Error deleting category:', error.message);
    res.status(500).json({ message: 'Error deleting category' });
  }
});

// POST: Add type to nature/category
app.post('/natures/:natureId/types', async (req, res) => {
  const natureId = req.params.natureId;
  const { description } = req.body;

  if (!description) {
    console.log('[POST] Missing type description');
    return res.status(400).json({ message: 'Missing type description' });
  }

  try {
    await sql.connect(dbConfig);
    console.log('[POST] Connected to SQL Server');

    const request = new sql.Request();
    request.input('NatureID', sql.Int, natureId);
    request.input('Description', sql.VarChar(255), description);

    const result = await request.query(`
      INSERT INTO CategoryTypes (NatureID, Description)
      OUTPUT INSERTED.TypeID
      VALUES (@NatureID, @Description)
    `);

    const newTypeId = result.recordset[0].TypeID;

    console.log(`[POST] Type added: ${description} (ID: ${newTypeId}) for Nature ID: ${natureId}`);
    res.json({ 
      id: newTypeId,
      description: description
    });
  } catch (error) {
    console.error('[POST] Error adding type:', error.message);
    res.status(500).json({ message: 'Error adding type' });
  }
});

// DELETE: Delete type
app.delete('/types/:id', async (req, res) => {
  const typeId = req.params.id;

  try {
    await sql.connect(dbConfig);
    console.log('[DELETE] Connected to SQL Server');

    const request = new sql.Request();
    request.input('TypeID', sql.Int, typeId);

    await request.query(`
      DELETE FROM CategoryTypes
      WHERE TypeID = @TypeID
    `);

    console.log(`[DELETE] Type deleted: ID ${typeId}`);
    res.json({ message: 'Type deleted successfully' });
  } catch (error) {
    console.error('[DELETE] Error deleting type:', error.message);
    res.status(500).json({ message: 'Error deleting type' });
  }
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
