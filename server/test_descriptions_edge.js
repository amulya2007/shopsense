/**
 * Edge case tests for AI Product Description Generator
 */

const ragService = require('./services/ragService');

const edgeCases = [
  // No category provided
  { name: "Lipstick", category: "" },
  { name: "Wireless Headphones", category: "" },
  
  // Unusual product names
  { name: "RGB Gaming Keyboard", category: "Computing" },
  { name: "Bluetooth Wireless Earbuds", category: "Audio" },
  { name: "Ceramic Coffee Mug", category: "Home" },
  { name: "Fitness Tracker Watch", category: "Wearables" },
  
  // Products not in predefined list
  { name: "Umbrella", category: "Accessories" },
  { name: "Notebook", category: "Stationery" },
  
  // Multi-word complex names
  { name: "Ultra HD 4K Gaming Monitor", category: "Electronics" },
  { name: "Professional DSLR Camera", category: "Electronics" }
];

console.log("\n================================================");
console.log("AI Description Generator - Edge Case Tests");
console.log("================================================\n");

async function runEdgeCaseTests() {
  for (const test of edgeCases) {
    console.log(`Product: "${test.name}"`);
    console.log(`Category: "${test.category || '(none)'}"`);
    
    try {
      const description = await ragService.generateProductDescription(test.name, test.category);
      console.log(`Description: ${description}`);
      console.log(`✓ Generated successfully`);
    } catch (err) {
      console.log(`✗ ERROR: ${err.message}`);
    }
    
    console.log("------------------------------------------------\n");
  }
}

runEdgeCaseTests().then(() => {
  console.log("Edge case testing completed.\n");
  process.exit(0);
}).catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
