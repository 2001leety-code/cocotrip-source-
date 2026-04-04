---
description: Test the booking flow end-to-end via browser
---

## Test Booking Flow

### 1. Start development server
```
npm run dev
```
The dev server will start on `http://localhost:5173`.

### 2. Open browser and navigate
Open the browser and go to `http://localhost:5173`.

### 3. Test Charter Booking Flow
1. Navigate to `/charter`
2. Sign in with Google (Firebase Auth will prompt)
3. Select vehicle: **Staria**
4. Select service: **Airport Pickup**
5. Select destination: **서울 도심**
6. Pick a date
7. Set adults: 2
8. Verify price quote appears (₩124,800 / ~$90)
9. Click PayPal button
10. Verify PayPal sandbox payment modal appears
11. Complete test payment with PayPal sandbox credentials
12. Verify booking confirmation overlay modal appears with:
    - Order number
    - Payer info
    - Amount
    - Next steps (3 steps)
    - Contact and Done buttons

### 4. Test AI Planner Flow
1. Navigate to `/planner`
2. Sign in with Google
3. Wizard Step 1: Select area type (Seoul City / Day Trip / Provincial)
4. Select main city and activities
5. Wizard Step 2: Pick dates
6. Wizard Step 3: Set passenger count
7. Click "Generate" button
8. Wait for Quick Summary (15 seconds)
9. Verify Quick Summary card shows:
    - Themes
    - Marketing narrative
    - Day 1 preview table
10. Verify $4.90 Premium Plan section shows:
    - Price badge ($9.90 → $4.90, -50%)
    - Feature checklist (4 items)
    - Email input
    - PayPal button
    - Satisfaction guarantee

### 5. Test Language Switching
1. Click the language switcher in the Header
2. Switch to each language: EN → KO → JA → ZH
3. Verify all text updates correctly (no hardcoded Korean/English)

### 6. Take screenshots for verification
Use the browser tool to capture screenshots at each major step.

### 7. Stop development server
```
Ctrl+C
```
