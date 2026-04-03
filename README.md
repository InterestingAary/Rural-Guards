# Rural Guards

Web app for farmers in Andhra Pradesh: **crop disease scan** (AI), **live weather** + tips, contacts, and **dam alert** (voice demo).

## Quick run (for demo day)

1. Install **Node.js** (LTS) from [nodejs.org](https://nodejs.org/).
2. Install **Python 3** and use it for the AI part (see below).
3. Open a terminal in this project folder (`RuralGuards`).
4. Run:
   ```bash
   npm install
   ```
5. Create a file named `.env` in the project root (same folder as `package.json`) with:
   ```env
   OPENWEATHER_API_KEY=your_openweather_key_here
   ```
   Get a free key at [OpenWeather API keys](https://home.openweathermap.org/api_keys).  
   If you skip this, weather still works using a backup service (no key).
6. Start the server:
   ```bash
   npm start
   ```
7. In the browser, open **http://127.0.0.1:3000** (or the URL your host shows in the terminal).

---

## What each part needs

| Feature | What you need |
|--------|----------------|
| **Website UI** | Node.js + `npm install` + `npm start` |
| **Weather** | Optional `.env` with `OPENWEATHER_API_KEY` for OpenWeather; otherwise automatic fallback |
| **Nearby dealers** | No paid API key required. Uses Overpass (OpenStreetMap) + local fallback |
| **Disease scan** | Python 3 + TensorFlow + `ai-model/model.h5` + dependencies (see `ai-model/predict.py`) |

### Advanced model retraining (new datasets)

When you add new crop disease datasets (including nested folders), retrain with:

```bash
cd ai-model
python train.py --dataset ../dataset --epochs 20 --min-images-per-class 25
```

What this upgraded trainer does:

- Scans nested dataset folders and auto-discovers valid class folders
- Avoids noisy container folders from becoming fake classes
- Builds a prepared training set and saves updated `classes.json`
- Trains a stronger transfer-learning model (MobileNetV2 + fine-tuning)

After training, restart backend so `/api/crop-options` reflects newly learned crop filters in UI.

---

## Project layout (simple)

- `frontend/` — HTML/CSS/JS (the page you see).
- `backend/server.js` — Node server: serves the site, `/predict`, `/weather`, `/api/health`.
- `backend/weatherService.js` — weather logic.
- `ai-model/` — Python model and `predict.py`.

---

## Commands cheat sheet

| Command | Meaning |
|--------|---------|
| `npm install` | Download Node libraries (once, or after changing `package.json`). |
| `npm start` | Run the app (same as `node backend/server.js`). |
| Stop the server | In the terminal, press `Ctrl + C`. |

---

## Deploying on another port or cloud

- Many hosts set a `PORT` environment variable. This app uses `PORT` if set, otherwise **3000**.
- Open the URL your platform gives you; the frontend uses **relative** URLs (`/predict`, `/weather`) so it works on any host/port.

---

## Health check (for judges / testing)

After the server starts, visit: **http://127.0.0.1:3000/api/health**  
You should see JSON like: `{"ok":true,"name":"Rural Guards","port":3000}`.

---

## Twilio SMS & Voice Call Setup

### 1. Install Dependencies
```bash
npm install twilio
```

### 2. Get Twilio Credentials
1. Sign up at [twilio.com](https://twilio.com)
2. Get your Account SID, Auth Token, and Phone Number
3. Add to `.env` file:

```
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+1234567890
```

### 3. Test the Integration
- Use the Dam Alert section in the web app
- Enter a phone number and dam name
- Click "Simulate SMS" or "Play Telugu Alert"
- Check server logs for Twilio API calls

### 4. Telugu Language Support
- SMS: Unicode Telugu text supported
- Voice: Uses Hindi voice (hi-IN) for Telugu pronunciation
- Fallback: English if Telugu voice unavailable

### 5. API Endpoints
- `POST /send-sms` - Send Telugu SMS alert
- `POST /make-call` - Initiate Telugu voice call

### 6. Troubleshooting
- Check Twilio dashboard for message/call logs
- Verify phone number format (+country code)
- Ensure sufficient Twilio credits
- Check server console for detailed error logs

## ElevenLabs API Setup (Secure)

Do not hardcode your ElevenLabs API key in source files.

1. Add to `.env`:

```env
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_AGENT_ID=your_agent_id_here
```

2. Restart server:

```bash
npm start
```

3. Optional test endpoint for realtime agent read:

- `GET /api/elevenlabs/agent`
- `GET /api/elevenlabs/agent?agentId=agent_xxx`
- `GET /api/elevenlabs/agent?refresh=true` (force live fetch, bypass 60s cache)

This endpoint reads agent data from ElevenLabs using your server-side key.

4. `/voice-agent` now auto-attaches ElevenLabs realtime context:

- Every `/voice-agent` response includes `realtime.elevenLabs`.
- It reports whether realtime agent metadata was loaded, source (`live` or `cache`), and compact agent fields.

## Hackathon tips

- **Demo on one machine:** run `npm start`, use the browser on the same PC, test Weather and (if Python works) Disease scan.
- **Don’t commit secrets:** keep `.env` only on your computer; share `.env.example` without real keys.
- **If disease scan fails:** show Weather + UI; fix Python/path errors after the pitch.

Good luck with your hackathon.
