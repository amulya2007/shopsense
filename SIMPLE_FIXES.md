# 🔧 Simple Fixes - Login & AI Assistant

## Problem 1: Login Page Not Working

### What "not working" means - tell me which one:

#### A. Page doesn't load at all
- **Fix:** Check if client is running
```powershell
cd "c:\Users\Amulya\Downloads\shopsense (2)\client"
npm run dev
```

#### B. Can't type in email/password
- **Fix:** Refresh browser (Ctrl+R)
- Clear cache (Ctrl+Shift+Delete)

#### C. Click Login button, nothing happens
- **Fix:** Check server is running
```powershell
cd "c:\Users\Amulya\Downloads\shopsense (2)\server"
npm start
```

#### D. Shows error message
- **Tell me what error message you see!**

#### E. Login succeeds but doesn't redirect
- **Fix:** Check App.jsx routes

---

## Quick Login Test

### Step 1: Make sure both are running

**Terminal 1 - Server:**
```powershell
cd "c:\Users\Amulya\Downloads\shopsense (2)\server"
npm start
```

Should show:
```
✅ Server running on port 3000
```

**Terminal 2 - Client:**
```powershell
cd "c:\Users\Amulya\Downloads\shopsense (2)\client"
npm run dev
```

Should show:
```
✅ Local: http://localhost:5173/
```

### Step 2: Test Login

1. Open: **http://localhost:5173/login**
2. Make sure you see:
   - Email input box
   - Password input box
   - "Login" button
3. Enter:
   - Email: `vendor@demo.com`
   - Password: `vendor123`
4. Click "Login"

### Step 3: What happens?

**A. Redirects to dashboard → ✅ WORKING!**

**B. Shows error "Invalid credentials" → Wrong email/password**
- Use exactly: `vendor@demo.com` / `vendor123`

**C. Shows error "Network Error" → Server not running**
- Go back to Terminal 1 and start server

**D. Nothing happens → Open browser console**
- Press F12
- Click Console tab
- Copy the error message
- Tell me what it says

**E. White/blank page → React error**
- Press F12
- Look for red errors
- Tell me what it says

---

## Problem 2: AI Assistant Errors

### After you successfully login:

1. You should be at: `http://localhost:5173/vendor/dashboard`
2. Look at left sidebar
3. Click "AI Assistant"
4. You should see "AI Business Assistant" page

### If clicking AI Assistant shows error:

**A. Page not found (404)**
- Check if route exists in App.jsx

**B. Blank page**
- Open F12 console
- Copy error message

**C. Page loads but clicking question shows error**
- What error message appears?
- Check server terminal for errors

---

## Complete Fresh Start

If nothing works, do this:

### 1. Stop Everything
- Press Ctrl+C in both terminals

### 2. Clear Everything
```powershell
cd "c:\Users\Amulya\Downloads\shopsense (2)\client"
Remove-Item -Recurse -Force node_modules\.vite -ErrorAction SilentlyContinue

cd ..\server
Remove-Item shopsense.db* -ErrorAction SilentlyContinue
```

### 3. Restart Server
```powershell
cd "c:\Users\Amulya\Downloads\shopsense (2)\server"
npm start
```

Wait for:
```
✅ Seeded admin
✅ Seeded demo vendor  
✅ Indexed XX products
✅ Server running on port 3000
```

### 4. Restart Client
```powershell
cd "c:\Users\Amulya\Downloads\shopsense (2)\client"
npm run dev
```

Wait for:
```
✅ Local: http://localhost:5173/
```

### 5. Test Login
- Go to: http://localhost:5173/login
- Login: `vendor@demo.com` / `vendor123`
- Should work!

---

## Debug Commands

### Check if server is running:
```powershell
curl http://localhost:3000/api/health
```

**Should return:** `{"status":"ok"}`

### Check if client is running:
Open browser to: http://localhost:5173

**Should show:** Login page

---

## Tell Me Exactly:

To help you, I need to know:

1. **Which step fails?**
   - Starting server?
   - Starting client?
   - Opening browser?
   - Typing credentials?
   - Clicking login button?
   - After login?

2. **What error do you see?**
   - In browser window?
   - In F12 console?
   - In server terminal?
   - In client terminal?

3. **Copy/paste the EXACT error message**

4. **Screenshot if possible**

---

## Most Common Issues

### Issue: "Port 3000 already in use"
**Fix:**
```powershell
# Find and kill the process
netstat -ano | findstr :3000
# Note the PID number, then:
taskkill /PID <number> /F
# Then restart server
```

### Issue: "Port 5173 already in use"
**Fix:**
```powershell
# Kill Vite
Get-Process -Name node | Where-Object {$_.Path -like "*vite*"} | Stop-Process -Force
# Then restart client
```

### Issue: "Cannot find module"
**Fix:**
```powershell
cd client
npm install
cd ../server
npm install
```

### Issue: Database locked
**Fix:**
```powershell
cd server
Remove-Item db/shopsense.db* -Force
npm start
# Database will recreate
```

---

## Quick Test Script

Copy and run this entire block:

```powershell
# Test if everything is working
Write-Host "Testing ShopSense..." -ForegroundColor Cyan

# Test server
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/api/health" -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Server is running" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Server is NOT running" -ForegroundColor Red
    Write-Host "Start with: cd server; npm start" -ForegroundColor Yellow
}

# Test client
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) {
        Write-Host "✅ Client is running" -ForegroundColor Green
    }
} catch {
    Write-Host "❌ Client is NOT running" -ForegroundColor Red
    Write-Host "Start with: cd client; npm run dev" -ForegroundColor Yellow
}

Write-Host "`nIf both are running, open: http://localhost:5173/login" -ForegroundColor Cyan
```

---

**Run this script and tell me what it shows!** 🔍
