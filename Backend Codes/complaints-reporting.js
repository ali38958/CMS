const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Dummy data
const complaintsData = [
  { id: 1, colony: 'North Colony', building: 'Building A', category: 'electrical', nature: 'urgent', status: 'resolved', priority: 'high', date: '2023-10-01' },
  { id: 2, colony: 'South Colony', building: 'Building B', category: 'plumbing', nature: 'major', status: 'in-progress', priority: 'medium', date: '2023-10-02' },
  { id: 3, colony: 'East Colony', building: 'Building C', category: 'ac', nature: 'minor', status: 'open', priority: 'low', date: '2023-10-03' },
  { id: 4, colony: 'West Colony', building: 'Building D', category: 'carpentry', nature: 'routine', status: 'closed', priority: 'low', date: '2023-10-04' },
  { id: 5, colony: 'North Colony', building: 'Building A', category: 'electrical', nature: 'urgent', status: 'resolved', priority: 'high', date: '2023-09-15' },
  { id: 6, colony: 'South Colony', building: 'Building B', category: 'plumbing', nature: 'major', status: 'resolved', priority: 'medium', date: '2023-09-20' },
  { id: 7, colony: 'East Colony', building: 'Building C', category: 'ac', nature: 'minor', status: 'closed', priority: 'low', date: '2023-09-25' },
  { id: 8, colony: 'West Colony', building: 'Building D', category: 'carpentry', nature: 'routine', status: 'closed', priority: 'low', date: '2023-09-30' }
];

// Helper function to filter complaints by date range
function filterByDateRange(data, fromDate, toDate) {
  if (!fromDate || !toDate) return data;
  return data.filter(complaint => {
    const complaintDate = new Date(complaint.date);
    const from = new Date(fromDate);
    const to = new Date(toDate);
    return complaintDate >= from && complaintDate <= to;
  });
}

// API Endpoints

// Get all complaints with optional filtering
app.get('/api/complaints', (req, res) => {
  const { colony, building, category, nature, status, priority, fromDate, toDate } = req.query;
  
  let filteredData = [...complaintsData];
  
  if (colony) filteredData = filteredData.filter(c => c.colony === colony);
  if (building) filteredData = filteredData.filter(c => c.building === building);
  if (category) filteredData = filteredData.filter(c => c.category === category);
  if (nature) filteredData = filteredData.filter(c => c.nature === nature);
  if (status) filteredData = filteredData.filter(c => c.status === status);
  if (priority) filteredData = filteredData.filter(c => c.priority === priority);
  
  filteredData = filterByDateRange(filteredData, fromDate, toDate);
  
  res.json(filteredData);
});

// Get sector-wise complaints summary
app.get('/api/complaints/sector', (req, res) => {
  const { fromDate, toDate } = req.query;
  
  let filteredData = filterByDateRange(complaintsData, fromDate, toDate);
  
  const sectors = [
    { name: 'Sector A', total: 0, resolved: 0 },
    { name: 'Sector B', total: 0, resolved: 0 },
    { name: 'Sector C', total: 0, resolved: 0 },
    { name: 'Sector D', total: 0, resolved: 0 }
  ];
  
  // Assign complaints to sectors (simplified logic)
  filteredData.forEach((complaint, index) => {
    const sectorIndex = index % sectors.length;
    sectors[sectorIndex].total++;
    if (complaint.status === 'resolved' || complaint.status === 'closed') {
      sectors[sectorIndex].resolved++;
    }
  });
  
  res.json({ sectors });
});

// Get sub-division wise complaints summary
app.get('/api/complaints/subdivision', (req, res) => {
  const { fromDate, toDate, category } = req.query;
  
  let filteredData = filterByDateRange(complaintsData, fromDate, toDate);
  
  if (category) {
    filteredData = filteredData.filter(c => c.category === category);
  }
  
  const subdivisions = [
    { name: 'Electrical', inprogress: 0, completed: 0, sna: 0, deferred: 0, total: 0 },
    { name: 'Plumbing', inprogress: 0, completed: 0, sna: 0, deferred: 0, total: 0 },
    { name: 'Air Conditioning', inprogress: 0, completed: 0, sna: 0, deferred: 0, total: 0 },
    { name: 'Carpentry', inprogress: 0, completed: 0, sna: 0, deferred: 0, total: 0 }
  ];
  
  // Categorize complaints by type
  filteredData.forEach(complaint => {
    let subdiv;
    switch(complaint.category) {
      case 'electrical':
        subdiv = subdivisions[0];
        break;
      case 'plumbing':
        subdiv = subdivisions[1];
        break;
      case 'ac':
        subdiv = subdivisions[2];
        break;
      case 'carpentry':
        subdiv = subdivisions[3];
        break;
      default:
        return;
    }
    
    subdiv.total++;
    
    if (complaint.status === 'in-progress') {
      subdiv.inprogress++;
    } else if (complaint.status === 'resolved' || complaint.status === 'closed') {
      subdiv.completed++;
    } else if (complaint.status === 'sna') {
      subdiv.sna++;
    } else if (complaint.status === 'deferred') {
      subdiv.deferred++;
    }
  });
  
  res.json({ subdivisions });
});

// Get yearly summary report
app.get('/api/complaints/summary', (req, res) => {
  const { year } = req.query;
  
  // Filter data by year (simplified)
  const yearPrefix = year || '2023';
  const filteredData = complaintsData.filter(c => c.date.startsWith(yearPrefix));
  
  // Complaints by nature
  const natures = [
    { name: 'Urgent', total: 0 },
    { name: 'Major', total: 0 },
    { name: 'Minor', total: 0 },
    { name: 'Routine', total: 0 }
  ];
  
  filteredData.forEach(complaint => {
    switch(complaint.nature) {
      case 'urgent':
        natures[0].total++;
        break;
      case 'major':
        natures[1].total++;
        break;
      case 'minor':
        natures[2].total++;
        break;
      case 'routine':
        natures[3].total++;
        break;
    }
  });
  
  // Calculate percentages
  const totalComplaints = filteredData.length;
  natures.forEach(nature => {
    nature.percentage = totalComplaints > 0 
      ? Math.round((nature.total / totalComplaints) * 100) 
      : 0;
  });
  
  // Complaints by colony
  const colonies = [
    { name: 'North Colony', total: 0 },
    { name: 'South Colony', total: 0 },
    { name: 'East Colony', total: 0 },
    { name: 'West Colony', total: 0 }
  ];
  
  filteredData.forEach(complaint => {
    switch(complaint.colony) {
      case 'North Colony':
        colonies[0].total++;
        break;
      case 'South Colony':
        colonies[1].total++;
        break;
      case 'East Colony':
        colonies[2].total++;
        break;
      case 'West Colony':
        colonies[3].total++;
        break;
    }
  });
  
  // Calculate percentages
  colonies.forEach(colony => {
    colony.percentage = totalComplaints > 0 
      ? Math.round((colony.total / totalComplaints) * 100) 
      : 0;
  });
  
  res.json({ 
    natures, 
    colonies,
    year: year || '2023',
    totalComplaints
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
