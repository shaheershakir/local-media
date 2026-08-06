# LocalFeed — Start Script (PowerShell)
# Run this from the f:\local-media\ directory

# Start backend
Write-Host "Starting LocalFeed backend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; pip install -r requirements.txt; python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"

Start-Sleep -Seconds 2

# Start frontend
Write-Host "Starting LocalFeed frontend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm install; npm run dev"

Write-Host ""
Write-Host "LocalFeed is starting up!" -ForegroundColor Green
Write-Host "  Backend:  http://127.0.0.1:8000" -ForegroundColor Yellow
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor Yellow
Write-Host ""
Write-Host "Once both are running, open http://localhost:5173 in your browser." -ForegroundColor White
