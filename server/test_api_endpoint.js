/**
 * Test the actual /api/ai/generate-description endpoint
 * This simulates what the frontend "Generate with AI" button does
 */

const fetch = require('node-fetch');

const API_BASE = 'http://localhost:3000';

const testCases = [
  { name: "Lipstick", category: "Beauty" },
  { name: "Wireless Headphones", category: "Audio" },
  { name: "Running Shoes", category: "Footwear" },
  { name: "Gaming Laptop", category: "Computing" },
  { name: "Water Bottle", category: "Home" }
];

async function testEndpoint() {
  console.log("\n============================================");
  console.log("Testing /api/ai/generate-description Endpoint");
  console.log("============================================\n");
  console.log("⚠️  NOTE: Server must be running on port 3000\n");
  
  for (const test of testCases) {
    try {
      console.log(`Testing: ${test.name} (${test.category})`);
      
      const response = await fetch(`${API_BASE}/api/ai/generate-description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: test.name,
          category: test.category
        })
      });
      
      if (!response.ok) {
        console.log(`✗ HTTP ${response.status}: ${response.statusText}`);
        const errorText = await response.text();
        console.log(`  Error: ${errorText}`);
      } else {
        const result = await response.json();
        console.log(`✓ Success`);
        console.log(`  Description: ${result.description}`);
      }
      
    } catch (err) {
      console.log(`✗ Request failed: ${err.message}`);
      if (err.code === 'ECONNREFUSED') {
        console.log(`  → Make sure the server is running: cd server && node index.js`);
        break;
      }
    }
    console.log("--------------------------------------------\n");
  }
}

testEndpoint().then(() => {
  console.log("API endpoint testing completed.\n");
}).catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
