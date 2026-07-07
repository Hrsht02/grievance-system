# Start all three processes

Open 3 terminal tabs and run:

**Terminal 1 — API:**
```
cd i:\grievance-system\backend
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 — Bot:**
```
cd i:\grievance-system\backend
python bot/bot.py
```

**Terminal 3 — Dashboard:**
```
cd i:\grievance-system\dashboard
npm run dev
```

Then open http://localhost:5173
