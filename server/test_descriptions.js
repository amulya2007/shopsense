/**
 * Test script for AI Product Description Generator
 * Tests the generateLocalDescription() function with user-specified test cases
 */

// Import the RAG service
const ragService = require('./services/ragService');

// Test cases from user requirements
const testCases = [
  { name: "Lipstick", category: "Beauty" },
  { name: "Wireless Headphones", category: "Audio" },
  { name: "Running Shoes", category: "Footwear" },
  { name: "Gaming Laptop", category: "Computing" },
  { name: "Water Bottle", category: "Home" }
];

console.log("\n========================================");
console.log("AI Product Description Generator - Test");
console.log("========================================\n");

async function runTests() {
  for (const test of testCases) {
    console.log(`Product: ${test.name}`);
    console.log(`Category: ${test.category}`);
    
    try {
      const description = await ragService.generateProductDescription(test.name, test.category);
      console.log(`Description: ${description}`);
      
      // Check for common invented features that should NOT appear
      const bannedPhrases = [
        'memory foam', 'breathable mesh', 'rubber sole', 'shock absorption',
        'matte finish', 'waterproof', 'moisturizing', 'long-lasting', 'SPF',
        'processor', 'RAM', 'graphics card', 'storage', 'refresh rate',
        'battery life', 'screen size', 'specific ingredients', 'brand'
      ];
      
      const foundIssues = bannedPhrases.filter(phrase => 
        description.toLowerCase().includes(phrase.toLowerCase())
      );
      
      if (foundIssues.length > 0) {
        console.log(`⚠️  WARNING: Found invented claims: ${foundIssues.join(', ')}`);
      } else {
        console.log(`✓ PASS: No invented specifications found`);
      }
      
    } catch (err) {
      console.log(`✗ ERROR: ${err.message}`);
    }
    
    console.log("----------------------------------------\n");
  }
}

// Run the tests
runTests().then(() => {
  console.log("Test completed.\n");
  process.exit(0);
}).catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
