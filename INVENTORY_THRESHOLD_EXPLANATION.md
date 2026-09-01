# Inventory Threshold Explanation & Fix

## Current Situation

**Your Database:**
- Bluetooth: **0 units** → OUT OF STOCK ❌
- Neoprene Dumbbell Pair: **5 units** → LOW STOCK ⚠️
- All other products: > 5 units → HEALTHY ✅

**Threshold Setting:** 5 (default)

## How Thresholds Work

### Current Logic:
```
Stock = 0         → OUT OF STOCK (critical)
Stock 1-5         → LOW STOCK (warning)
Stock > 5         → HEALTHY (good)
```

**This means:**
- Product with stock = 5 is considered **LOW STOCK** (at the threshold)
- Product with stock = 6 is considered **HEALTHY** (above threshold)

## Why Notifications Match Inventory Health

Both systems use the EXACT same logic:
- Inventory Health: `stock <= 5` = low stock
- Notifications: `stock <= 5` = show alert

**So they ARE consistent!**

## Your Product "Neoprene Dumbbell Pair"

- Stock: **5 units**
- Since 5 <= 5 (threshold), it's **LOW STOCK**
- Notification shows: ⚠️ "Low stock: 5 remaining"
- Inventory Health counts it as: Low Stock

**This is CORRECT behavior!**

## If You Think 5 is NOT Low

You have two options:

### Option 1: Increase the Threshold (Recommended)
Change the low stock threshold to a lower number:
- Current: 5
- Recommended: 3 or 2

Then:
- Stock 0 = OUT OF STOCK
- Stock 1-3 = LOW STOCK
- Stock 4+ = HEALTHY

Product with 5 units would be HEALTHY.

### Option 2: Restock the Product
If 5 units IS low for this product, restock it to 6+ units.

## How to Change Threshold

### In the UI:
1. Go to **Insights** page
2. Scroll to **Inventory Intelligence** section
3. Look for threshold settings (usually shows "Low threshold: 5")
4. Change to 3 or 2
5. Save/Apply

### Default Threshold Values:
```javascript
// Current default
lowThreshold: 5

// Recommended for most businesses
lowThreshold: 3  // More reasonable for "low stock"
```

## Current Counts (Threshold = 5)

```
Total Products: 17

✅ Healthy Stock: 15 (stock > 5)
⚠️  Low Stock: 1 (stock 1-5)
❌ Out of Stock: 1 (stock = 0)

Math: 15 + 1 + 1 = 17 ✅
```

### If Threshold = 3:
```
Total Products: 17

✅ Healthy Stock: 16 (stock > 3)
⚠️  Low Stock: 0 (stock 1-3)
❌ Out of Stock: 1 (stock = 0)

Math: 16 + 0 + 1 = 17 ✅
```

## Recommendations

### For Better UX:

**Change default threshold from 5 to 3:**
- More intuitive (1-3 units = truly low)
- Stock of 4-5 feels more "safe"
- Reduces false alarms

**Or explain clearly in UI:**
- "Low Stock Threshold: Products with 5 or fewer units"
- "Products at or below this number trigger alerts"

## Summary

✅ **System is working correctly**
✅ **Notifications match Inventory Health**
✅ **Both use stock <= 5 logic**

The confusion is:
- Threshold = 5
- Product has exactly 5 units
- User thinks "5 is not low"

**Solution:** Lower the threshold to 3 or 2 for more intuitive behavior.

## Test Current Behavior

Run this to see current status:
```bash
node check_low_stock_products.js
```

Shows:
- Which products are low stock
- What Inventory Health should display
- Confirms math adds up correctly
