// Quick script to refresh the AI RAG index
const http = require('http');

console.log('🔄 Refreshing AI Shopping Assistant index...\n');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/ai/refresh-index',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      if (response.success) {
        console.log('✅ SUCCESS!');
        console.log(`   ${response.message}`);
        console.log(`   Total products indexed: ${response.indexedProducts}`);
      } else {
        console.log('❌ FAILED:', response.error || 'Unknown error');
      }
    } catch (e) {
      console.log('❌ Error parsing response:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
  console.log('\n💡 Make sure the server is running on port 3000');
  console.log('   Run: cd server && npm start');
});

req.end();
