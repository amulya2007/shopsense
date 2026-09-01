# Testing Navigation in AI Assistant

## How to Test

1. **Start the servers:**
   ```bash
   # Terminal 1
   cd server
   npm start
   
   # Terminal 2
   cd client
   npm run dev
   ```

2. **Login and go to AI Assistant:**
   - Open http://localhost:5173
   - Login as vendor
   - Click "AI Assistant" in sidebar

3. **Ask for products:**
   - Type: "What products are available in Electronics?"
   - Press Send

4. **Open Browser Console (F12):**
   - Look for debug logs starting with 📦, 🖱️, 🔍, 🚀

5. **Click on a product card:**
   - Click anywhere on a product card
   - OR click the "View Product" button

6. **Check console output:**
   - Should see: `📦 Sample product:` with product details
   - Should see: `🖱️ Card clicked!` when you click
   - Should see: `🔍 handleProductClick called with:` 
   - Should see: `🚀 Navigating to:` with the URL

7. **Verify navigation:**
   - URL should change to `/vendor/catalog?product=<id>`
   - Product details modal should open

## Expected Console Output

```
📦 Sample product: {id: "123", name: "Sample Product", origin: "live_catalog", isLiveCatalog: true, isClickable: true}
🖱️ Card clicked! {id: "123", isClickable: true, event: "click"}
🔍 handleProductClick called with: 123 Type: string
🚀 Navigating to: /vendor/catalog?product=123
```

## Troubleshooting

### If products show but aren't clickable:
- Check console for `isClickable: false`
- This means products are from dataset (P001, P002, etc.)
- Only numeric IDs are clickable

### If no logs appear:
- Make sure browser console is open
- Refresh the page
- Try asking a different question

### If click doesn't navigate:
- Check for JavaScript errors in console
- Verify React Router is working
- Try clicking the "View Product" button instead

## What to Report

When reporting issues, please include:
1. Screenshot of console logs
2. Which product you clicked
3. What the product ID was
4. Whether URL changed
5. Any error messages
