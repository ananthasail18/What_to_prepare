import http from 'http';
import fs from 'fs';

const DB_FILE = './db.json';
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '{}');

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.end();

  if (req.url === '/ai' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const options = {
        hostname: '127.0.0.1',
        port: 1234,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      };
      
      const aiReq = http.request(options, aiRes => {
        let aiBody = '';
        aiRes.on('data', chunk => aiBody += chunk);
        aiRes.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          res.end(aiBody);
        });
      });
      
      aiReq.on('error', err => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: { message: "Local LM Studio is not running or accessible. Error: " + err.message } }));
      });
      
      aiReq.write(body);
      aiReq.end();
    });
    return;
  }

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
