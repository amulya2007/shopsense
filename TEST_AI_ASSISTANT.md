# 🧪 Test AI Assistant - Step by Step

## Step 1: Start Fresh

### Stop Everything First
Press `Ctrl+C` in both terminal windows to stop server and client.

### Restart Server
```powershell
cd "c:\Users\Amulya\Downloads\shopsense (2)\server"
npm start
```

**Wait for this message:**
```
✅ Vector store refreshed: XX products indexed
Server running on port 3000
```

### Restart Client
```powershell
cd "c:\Users\Amulya\Downloads\shopsense (2)\client"
npm run dev
```

**Wait for:**
```
Local: http://localhost:5173
```

---

## Step 2: Login

1. Open: **http://localhost:5173/login**
2. Login as vendor:
   - Email: `vendor@demo.com`
   - Password: `vendor123`
3. Click "Login"

---

## Step 3: Go to AI Assistant

### Option A: Click Sidebar
- Look at left sidebar
- Click **"AI Assistant"**

### Option B: Direct Link
- Go to: **http://localhost:5173/vendor/assistant**

---

## Step 4: Test Simple Question

1. You should see:
   - Green header "AI Business Assistant"
   - "RAG System Active" badge
   - Suggested question buttons
   - Empty chat area

2. Click the suggested question: **"Show me products in Electronics"**

3. Wait for response (loading dots should appear)

---

## Expected Result

You should see:
```
✅ AI response with text
✅ Product cards below the text
✅ Product images (80x80px)
✅ Product names
✅ Prices
✅ Stock levels
✅ Categories
```

---

## If You Get An Error

### Error in Console?

**Open Browser Developer Tools:**
- Press `F12` in browser
- Click "Console" tab
- Look for red error messages
- Take a screenshot or copy the error text

### Common Errors & Fixes

#### Error: "user is undefined"
**Fix:** Make sure you're logged in
1. Go to http://localhost:5173/login
2. Login again
3. Then go to AI Assistant

#### Error: "Cannot read property 'id' of undefined"
**Fix:** AuthContext issue
- Refresh the page
- Clear browser cache (Ctrl+Shift+Delete)
- Login again

#### Error: "Network Error" or "Failed to fetch"
**Fix:** Server not running
- Check Terminal 1 (server)
- Make sure it says "Server running on port 3000"
- If not, restart: `npm start`

#### Error: "Vector store not ready"
**Fix:** Server needs restart
- Stop server (Ctrl+C)
- Start again: `npm start`
- Wait for "Vector store refreshed" message

#### Error: "401 Unauthorized"
**Fix:** Token expired
- Logout
- Login again
- Go to AI Assistant

---

## Check Server Logs

In the **server terminal**, you should see:
```
POST /api/ai/shopping-assistant 200
```

If you see:
```
POST /api/ai/shopping-assistant 500
Error: ...
```

That's the actual error! Copy that error message.

---

## Manual Test API

Test if the API works directly:

### 1. Make sure server is running

### 2. Open a new PowerShell and run:

```powershell
curl -X POST http://localhost:3000/api/ai/shopping-assistant `
  -H "Content-Type: application/json" `
  -d '{\"question\": \"Show me electronics\", \"vendorId\": 1}'
```

**Expected:** JSON response with products

**If error:** Copy the error message

---

## What to Send Me

If still not working, tell me:

1. **What error message do you see?**
   - In browser?
   - In console (F12)?
   - In server terminal?

2. **What step fails?**
   - Login?
   - Loading AI page?
   - Sending question?
   - Getting response?

3. **Screenshot or copy the exact error text**

---

## Quick Checklist

- [ ] Server is running (Terminal 1)
- [ ] Client is running (Terminal 2)
- [ ] Server shows "Vector store refreshed"
- [ ] Logged in as vendor
- [ ] On AI Assistant page (http://localhost:5173/vendor/assistant)
- [ ] Page title shows "AI Business Assistant"
- [ ] Suggested questions are visible
- [ ] Clicked a suggested question
- [ ] Error appeared → **What's the error?**

---

## Most Common Issue

**Problem:** Page loads but clicking questions shows error

**Cause:** Server didn't rebuild vector store with vendorId

**Fix:**
1. Stop server (Ctrl+C)
2. Restart: `cd server && npm start`
3. Wait for "Indexed XX products" message
4. Refresh browser
5. Try again

---

Let me know the exact error and I'll fix it! 🔧
