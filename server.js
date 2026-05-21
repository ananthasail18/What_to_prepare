const http = require('http');
const fs = require('fs');

const DB_FILE = './db.json';
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}');

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.end();

  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(fs.readFileSync(DB_FILE));
  } else if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      fs.writeFileSync(DB_FILE, body);
      res.end(JSON.stringify({ success: true }));
    });
  } else {
    res.statusCode = 404;
    res.end();
  }
}).listen(3001, () => console.log('Local Database Server running on port 3001'));
