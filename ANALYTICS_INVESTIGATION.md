# Analytics Investigation Report

## Current State Analysis

### ✅ What's Already Working

1. **Chart is connected to parent state**
   - `reportingTimeframe` state drives the chart
   - Buttons trigger `onTimeframeChange` callback
   - This triggers API refetch with new timeframe

2. **Backend API structure**
   - `/reporting/sales-over-time` endpoint exists
   - Accepts `timeframe` and `scope` parameters
   - Returns `{ scope, timeframe, vendorId, summary, data }`

3. **Data flow is correct**
   - Parent component fetches data based on `reportingTimeframe`
   - Chart receives `reportingData.salesOverTime` or falls back to `data.sales`
   - Chart has `timeframe` and `onTimeframeChange` props

### 🔍 Current Button Configuration

```javascript
Buttons: [
  { id: "30d", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" }
]
```

### 🔍 Backend Timeframe Handling

**For vendor scope:**
- `timeframe === "month"` → Groups by `strftime('%Y-%m', sold_at)`
- `timeframe === "week"` → Groups by Monday-based week start date
- `else` (includes "30d") → Groups by date, limited to last N days

**For marketplace scope:**
- `timeframe === "month"` → Groups by month number (returns "Jan", "Feb", etc.)
- `timeframe === "week"` → Groups by day of week ("Monday", "Tuesday", etc.)
- `else` → Returns `salesByDate` from cache

### 🐛 Potential Issues to Investigate

1. **"No recorded sales for this period"** - Need to check if:
   - Query is correctly filtering data
   - Data exists in the `sales` table for the vendor
   - Date ranges are correct

2. **₹0 / ₹1 mismatch** - Need to verify:
   - How summary values (Total, Peak, Average) are calculated
   - If chart values match summary calculations
   - Where the ₹1 value comes from

3. **Week ordering** - Backend query for week:
   - Uses `date(sold_at, '-' || ((CAST(strftime('%w', sold_at) AS INTEGER) + 6) % 7) || ' days')`
   - This calculates Monday-based week start
   - Should aggregate correctly but need to verify order

4. **Month ordering** - Backend query for month:
   - Uses `strftime('%Y-%m', sold_at)` for vendor
   - Uses month names for marketplace
   - Should be chronological but need to verify

## Required Minimal Fixes

### DO NOT CHANGE:
- ❌ Chart component structure
- ❌ Backend database queries (unless proven broken)
- ❌ Data flow architecture
- ❌ Other Insights sections
- ❌ Visual design/styling

### ONLY FIX IF BROKEN:
1. Date filtering logic (if queries return wrong data)
2. Week day ordering (if not Monday-Sunday)
3. Month chronological ordering (if alphabetical)
4. Summary calculations (if don't match chart data)
5. Display of "No data" message (if data exists but doesn't show)

## Testing Plan

1. **Check database directly**
   ```sql
   SELECT * FROM sales WHERE vendor_id = ? LIMIT 10;
   ```
   Verify data exists

2. **Test API endpoint directly**
   ```
   GET /analytics/reporting/sales-over-time?timeframe=30d&scope=vendor
   GET /analytics/reporting/sales-over-time?timeframe=week&scope=vendor
   GET /analytics/reporting/sales-over-time?timeframe=month&scope=vendor
   ```
   Check responses

3. **Verify chart receives correct data**
   - Add console.log in component
   - Check series array
   - Verify values match backend response

4. **Test with real data**
   - Use existing dataset
   - Don't create fake sales
   - Verify calculations are correct

## Next Steps

1. ✅ Restored original working code
2. ⏭️ Test current implementation with real data
3. ⏭️ Identify ACTUAL broken behavior (not assumptions)
4. ⏭️ Make MINIMAL targeted fixes
5. ⏭️ Verify fixes don't break other sections
