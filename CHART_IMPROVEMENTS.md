# Sales Performance Chart Improvements

## Changes Made

### ✅ Backend API Improvements (server/routes/analytics.js)

**Week View Fix:**
- Changed from: Multiple weeks grouped by Monday start date
- Changed to: Exactly 7 days (Monday–Sunday) with aggregated sales
- Uses LEFT JOIN to ensure all 7 days are represented (even if 0 sales)
- Proper day ordering: Monday (0) → Sunday (6)

```sql
WITH days AS (
  SELECT 0 AS day_offset, 'Monday' AS day_name
  UNION SELECT 1, 'Tuesday'
  ...
  UNION SELECT 6, 'Sunday'
)
SELECT days.day_name AS label, ...
LEFT JOIN sales ON day_offset matches
```

**Month View:**
- Already correctly groups by YYYY-MM format
- Returns chronological months (not alphabetical)
- Each point = one calendar month total

**Day View (30d):**
- Shows last 30 days of daily aggregated data
- One point per date

### ✅ Frontend Chart Improvements (client/src/pages/vendor/VendorInsights.jsx)

**1. Better Label Formatting:**
- Month labels: "2025-09" → "Sep '25"
- Week labels: Clear day names (Monday, Tuesday, etc.)
- Day labels: MM-DD format

**2. Improved Y-Axis Scaling:**
- No more repeated "₹0k" labels
- Smart formatting based on value range:
  - < ₹1,000: "₹500"
  - < ₹100,000: "₹25k" or "₹50.5k"
  - ≥ ₹100,000: "₹2.5L"
- Added 10% padding above max value for visual spacing
- Uses `chartMax` instead of `maxValue` for calculations

**3. Better X-Axis Labels:**
- Week view: Shows all 7 day labels
- Month view: Shows all month labels if ≤ 12 months
- Day view: Intelligently spaces labels (max 8 visible)
- Always includes first and last labels

**4. Chart Dimensions:**
- Height: 300px → 280px (slightly more compact)
- Left padding: 60px → 70px (more room for Y-axis labels)
- Bottom padding: 44px → 48px (more room for X-axis labels)
- Font size: 10px → 11px for Y-axis (more readable)

**5. Metric Labels:**
- "Total Orders" → "Sales" (clearer terminology)
- "Avg Order Value" → "Avg Sale Value"

**6. Empty State:**
- "No sales trend data available" → "No recorded sales for this period"

### ✅ What Was NOT Changed

- ❌ Chart type (still line/area chart for all views)
- ❌ Database schema
- ❌ Existing sales data
- ❌ Other Insights sections
- ❌ Overall page layout
- ❌ Color scheme or visual design
- ❌ Summary calculation logic (Total, Peak, Average)

## How It Works Now

### Day Button (timeframe="30d"):
- **Data:** Last 30 days, grouped by date
- **Granularity:** One point per day
- **X-axis:** MM-DD labels (e.g., "08-01", "08-15")
- **Use case:** See daily sales trend

### Week Button (timeframe="week"):
- **Data:** All 7 days of the week aggregated across all time
- **Granularity:** One point per day of week
- **X-axis:** Monday, Tuesday, Wednesday, ..., Sunday
- **Use case:** See which days of the week perform best

### Month Button (timeframe="month"):
- **Data:** All calendar months with sales
- **Granularity:** One point per month
- **X-axis:** Sep '25, Oct '25, Nov '25, ..., Aug '26
- **Use case:** See monthly performance trend

## Testing Checklist

Run the application and verify:

**Day View:**
- [ ] Shows up to 30 daily data points
- [ ] X-axis shows readable date labels (MM-DD)
- [ ] Y-axis shows proper currency formatting (no ₹0k repetition)
- [ ] Line chart connects all points smoothly
- [ ] Hover shows correct date and values

**Week View:**
- [ ] Shows exactly 7 points (Mon-Sun)
- [ ] X-axis shows: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday
- [ ] All 7 days visible even if some have ₹0
- [ ] Line chart connects all 7 points
- [ ] Represents aggregated data (total for each day of week across all time)

**Month View:**
- [ ] Shows multiple months chronologically
- [ ] X-axis shows: Sep '25, Oct '25, Nov '25, ..., Aug '26 (NOT alphabetical)
- [ ] Each point = one calendar month's total
- [ ] Line chart connects all month points
- [ ] Labels don't overlap

**All Metrics:**
- [ ] Revenue: Shows ₹ values with proper K/L notation
- [ ] Units Sold: Shows integer counts
- [ ] Sales: Shows transaction counts
- [ ] Avg Sale Value: Shows ₹ per transaction

**Summary Stats:**
- [ ] Total Volume = sum of all visible points
- [ ] Peak Point = highest value in chart
- [ ] Average = correct average of points
- [ ] Observed Points = number of data points

**Edge Cases:**
- [ ] Period with no data shows "No recorded sales for this period"
- [ ] Single data point renders correctly
- [ ] Very large values format properly (₹5L, not ₹500000)
- [ ] Very small values format properly (₹150, not ₹0k)

## Expected Data Flow

1. User clicks "Week" button
2. Frontend calls: `onTimeframeChange("week")`
3. Parent component updates: `setReportingTimeframe("week")`
4. useEffect triggers: Fetches `/reporting/sales-over-time?timeframe=week&scope=vendor`
5. Backend returns: 7 rows (Mon-Sun) with aggregated sales
6. Chart receives: `data.data` array with 7 items
7. Chart renders: 7-point line chart with day labels

## Files Modified

- `server/routes/analytics.js` - Week query rewritten for 7-day aggregation
- `client/src/pages/vendor/VendorInsights.jsx` - Chart formatting and display improvements

## Lines Changed

- Backend: ~30 lines (week query logic)
- Frontend: ~80 lines (label formatting, Y-axis scaling, axis tick logic)

**Total:** ~110 lines modified in 2 files
