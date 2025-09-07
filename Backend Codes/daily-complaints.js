
// API: Daily stats 
app.get('/api/complaints/daily-stats', async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  console.log(`📡 API Called: /api/complaints/daily-stats?date=${date}`);

  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 10;
  const offset = (page - 1) * pageSize;

  try {
    console.log(`📊 Fetching data for ${date}...`);

    // 1️⃣ Status by Category - FIXED STATUS SPELLINGS
    const statusResult = await runQuery(
      `
      SELECT 
        category AS Category,
        SUM(CASE WHEN status = 'Un-Assigned' THEN 1 ELSE 0 END) AS unassigned,
        SUM(CASE WHEN status = 'In-Progress' THEN 1 ELSE 0 END) AS inProgress,
        SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'Deffered' THEN 1 ELSE 0 END) AS deferred,
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
        SUM(CASE WHEN status = 'Deffered' THEN 1 ELSE 0 END) AS deferred,
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
        ISNULL(col.Name, 'Unknown') + ' / ' + ISNULL(loc.building_number, 'N/A') AS Address,
        c.nature AS Nature,
        c.type AS Type,
        DATEDIFF(HOUR, c.launched_at, GETDATE()) AS Hours
      FROM Complaints c
      LEFT JOIN Location loc ON c.location_id = loc.location_id
      LEFT JOIN Colonies col ON loc.colony_number = col.ColonyNumber
      WHERE c.status = 'Deffered'
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
      WHERE status = 'Deffered'
        AND CONVERT(DATE, launched_at) = CONVERT(DATE, @date)
      `,
      [{ name: 'date', type: sql.Date, value: date }]
    );

    const totalDeferred = deferredCountResult.recordset[0].totalCount;

    console.log("Deferred complaints rows:", deferredResult.recordset);

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

    console.log(`✅ Data retrieved successfully for ${date}`);
  } catch (err) {
    console.error('❌ Database error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

