const http = require('http');

console.log('\n🔍 Testing /api/analytics/inventory endpoint\n');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/analytics/inventory',
  method: 'GET',
  headers: {
    'Cookie': 'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJkZW1vIiwicm9sZSI6InZlbmRvciIsImlhdCI6MTczNTQ4ODQwMH0.p_Dpy9GzN8jPgXu8Hx_ueWlDU4qZOLwu-mVWLqiCfZM' // Replace with actual token
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
      console.log('API Response Summary:');
      console.log(JSON.stringify(response.summary, null, 2));
      console.log(`\nTotal products in response: ${response.products?.length || 0}`);
      console.log(`\nBreakdown check:`);
      console.log(`  ${response.summary.outOfStock} + ${response.summary.lowStock} + ${response.summary.mediumStock} + ${response.summary.healthyStock} = ${response.summary.outOfStock + response.summary.lowStock + response.summary.mediumStock + response.summary.healthyStock}`);
    } catch (e) {
      console.log('Error parsing response:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('Request failed:', error.message);
  console.log('\n💡 Make sure:');
  console.log('   1. Server is running (cd server && npm start)');
  console.log('   2. You are logged in');
});

req.end();
