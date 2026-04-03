const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const express = require("express");
const app = express();
const multer = require("multer");
const cors = require("cors");
const twilio = require("twilio");

app.use(cors());
app.use(express.json());

const { exec } = require("child_process");
const {
    getWeatherPayload,
    getMockWeather,
    DEFAULT_LAT,
    DEFAULT_LON
} = require("./weatherService");

function parseWeatherCoords(query) {
    const lat = parseFloat(query.lat);
    const lon = parseFloat(query.lon);
    if (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
    ) {
        return { lat, lon };
    }
    return { lat: DEFAULT_LAT, lon: DEFAULT_LON };
}

const DEALER_FALLBACK = [
    { name: "Sri Seed Point", type: "seed", phone: "9876501123", dLat: 0.007, dLon: 0.005, area: "Market Road", stock: "Paddy, maize, vegetable seeds" },
    { name: "Rythu Fertilizer Depot", type: "fertilizer", phone: "9123404455", dLat: -0.006, dLon: 0.009, area: "Bus Stand Junction", stock: "Urea, DAP, NPK, micronutrients" },
    { name: "Coastal Fish Dealer", type: "fish", phone: "9012307788", dLat: 0.006, dLon: -0.008, area: "Harbor Link Road", stock: "Fish seed, feed, nets" },
    { name: "Green Crop Seeds", type: "seed", phone: "9490056781", dLat: -0.009, dLon: -0.006, area: "Rythu Bazar", stock: "Hybrid and native seeds" },
    { name: "Agri Nutrients Hub", type: "fertilizer", phone: "9701403344", dLat: 0.010, dLon: 0.011, area: "Village Main Road", stock: "Sprayers, fertilizers, pesticides" },
    { name: "BlueNet Fish Supply", type: "fish", phone: "9966112200", dLat: -0.010, dLon: 0.006, area: "Canal Side", stock: "Fish seed, probiotics, ice boxes" },
    { name: "Annapurna Seed House", type: "seed", phone: "9849011220", dLat: 0.003, dLon: 0.012, area: "Main Bazaar", stock: "Seed kits, vegetable seeds" },
    { name: "Kisan Fertilizers", type: "fertilizer", phone: "9032114455", dLat: -0.004, dLon: -0.011, area: "Mandi Road", stock: "DAP, potash, bio-fertilizers" },
    { name: "Aqua Fish Inputs", type: "fish", phone: "9010017788", dLat: 0.011, dLon: -0.004, area: "Canal Junction", stock: "Fish feed, probiotics, nets" }
];

function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371 * c;
}

function dealerTypeFromTags(tags) {
    const text = `${tags.name || ""} ${tags.shop || ""} ${tags.description || ""} ${tags.brand || ""}`.toLowerCase();
    if (text.includes("pet") || text.includes("spa")) {
        return null;
    }
    if (text.includes("fish") || text.includes("fisher") || text.includes("aqua") || text.includes("marine")) {
        return "fish";
    }
    if (text.includes("fertilizer") || text.includes("fertiliser") || text.includes("agro chemical") || text.includes("agri input")) {
        return "fertilizer";
    }
    if (
        text.includes("seed") ||
        text.includes("nursery") ||
        text.includes("agri") ||
        text.includes("farm") ||
        text.includes("rythu")
    ) {
        return "seed";
    }
    return null;
}

function stockByDealerType(type) {
    if (type === "fish") return "Fish seed, feed, nets";
    if (type === "fertilizer") return "Urea, DAP, NPK, micronutrients";
    return "Paddy, maize, vegetable seeds";
}

function fallbackDealersForLocation(lat, lon) {
    return DEALER_FALLBACK
        .map((dealer) => ({
            name: dealer.name,
            type: dealer.type,
            phone: dealer.phone,
            lat: Number(lat) + Number(dealer.dLat),
            lon: Number(lon) + Number(dealer.dLon),
            area: dealer.area,
            stock: dealer.stock
        }))
        .sort((a, b) => haversineKm(lat, lon, a.lat, a.lon) - haversineKm(lat, lon, b.lat, b.lon))
        .slice(0, 9);
}

async function fetchNearbyDealersFromOverpass(lat, lon, radiusMeters) {
    const radius = Math.min(Math.max(Number(radiusMeters) || 7000, 1000), 20000);
    const query = `
[out:json][timeout:10];
(
    node(around:${radius},${lat},${lon})[shop~"farm|agrarian|fertilizer|garden_centre|fishing|fish"];
    way(around:${radius},${lat},${lon})[shop~"farm|agrarian|fertilizer|garden_centre|fishing|fish"];
    node(around:${radius},${lat},${lon})[name~"seed|fertilizer|fertiliser|agri|fisher|fish",i];
    way(around:${radius},${lat},${lon})[name~"seed|fertilizer|fertiliser|agri|fisher|fish",i];
);
out center;
`;

    const overpassEndpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter"
    ];

    const overpassRequests = overpassEndpoints.map((endpoint) =>
        axios
            .post(endpoint, query, {
                headers: {
                    "Content-Type": "text/plain",
                    "User-Agent": "RuralGuards/1.0 (hackathon demo)"
                },
                timeout: 2500
            })
            .then((resp) => ({ endpoint, resp }))
            .catch((error) => {
                console.log(`Overpass endpoint failed (${endpoint}):`, error.message);
                return null;
            })
    );

    const results = await Promise.all(overpassRequests);
    const firstSuccess = results.find((entry) => entry && entry.resp);
    if (!firstSuccess) {
        throw new Error("All Overpass endpoints failed");
    }

    const response = firstSuccess.resp;

    const elements = Array.isArray(response.data && response.data.elements) ? response.data.elements : [];
    const dealers = elements
        .map((el) => {
            const tags = el.tags || {};
            const dLat = Number(el.lat || (el.center && el.center.lat));
            const dLon = Number(el.lon || (el.center && el.center.lon));
            if (!Number.isFinite(dLat) || !Number.isFinite(dLon)) return null;

            const type = dealerTypeFromTags(tags);
            if (!type) return null;
            const name = tags.name || tags.brand || `Nearby ${type} dealer`;
            const phone = tags.phone || tags["contact:phone"] || "";
            const area = tags["addr:suburb"] || tags["addr:city"] || tags["addr:street"] || tags.village || "Nearby area";

            return {
                name,
                type,
                phone,
                lat: dLat,
                lon: dLon,
                area,
                stock: stockByDealerType(type),
                distanceKm: haversineKm(lat, lon, dLat, dLon)
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 18)
        .map((d) => {
            const copy = { ...d };
            delete copy.distanceKm;
            return copy;
        });

    return dealers;
}

function getWeatherAdviceLines(payload, maxTips = 3) {
    const tips = Array.isArray(payload && payload.tips)
        ? payload.tips.filter((tip) => typeof tip === "string" && tip.trim())
        : [];
    return tips.slice(0, maxTips);
}

function formatWeatherVoiceAdvice(payload, scopeLabel = "your area") {
    const condition = payload && (payload.summary || payload.description) ? (payload.summary || payload.description) : "variable conditions";
    const temp = Number(payload && payload.temperature);
    const humidity = Number(payload && payload.humidity);
    const wind = Number(payload && payload.windSpeed);
    const advice = getWeatherAdviceLines(payload, 2);

    let message = `Current weather in ${scopeLabel}: ${condition}.`;
    if (Number.isFinite(temp)) message += ` Temperature is ${temp}°C.`;
    if (Number.isFinite(humidity)) message += ` Humidity is ${humidity}%.`;
    if (Number.isFinite(wind)) message += ` Wind speed is ${wind} km/h.`;
    if (advice.length) message += ` Advice: ${advice.join(" ")}`;
    return message;
}

function formatWeatherChatAdvice(payload) {
    const location = payload && payload.location ? payload.location : "your area";
    const condition = payload && (payload.summary || payload.description) ? (payload.summary || payload.description) : "variable conditions";
    const temp = Number(payload && payload.temperature);
    const humidity = Number(payload && payload.humidity);
    const wind = Number(payload && payload.windSpeed);
    const advice = getWeatherAdviceLines(payload, 3);

    let message = `Current weather in ${location}: ${condition}.`;
    if (Number.isFinite(temp)) message += ` Temperature ${temp}°C.`;
    if (Number.isFinite(humidity)) message += ` Humidity ${humidity}%.`;
    if (Number.isFinite(wind)) message += ` Wind ${wind} km/h.`;
    if (advice.length) {
        message += `\nAdvice:\n- ${advice.join("\n- ")}`;
    }
    return message;
}

async function generateGeminiReply(message, context = {}, voiceMode = false) {
    if (!GEMINI_API_KEY) {
        return "API Error: GEMINI_API_KEY is not configured";
    }

    try {
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const requestBody = {
            contents: [
                {
                    parts: [
                        {
                            text: `
User asked: ${message}

Crop Disease Info:
Disease: ${context?.disease}
Solution: ${context?.solution}

${voiceMode ? "Respond in short spoken sentences. Do not use markdown, bullet points, or bold text." : "Use easy language, short sentences, and clear steps."}
Focus on real-world advice they can follow immediately.
Do not say phrases like "As an AI", "I cannot extend my capabilities", "based on my training", or anything about model limitations.
If the user asks outside available tools, clearly suggest the nearest Rural Guards feature they should use next.
                            `
                        }
                    ]
                }
            ]
        };

        console.log("🚀 Calling Gemini API (gemini-2.5-flash)");

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            const errorMsg = data?.error?.message || data?.error || response.statusText;
            return `API Error: ${errorMsg}`;
        }

        if (data?.error) {
            return `API Error: ${data.error.message}`;
        }

        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return reply || "No response from AI";
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

function buildWeatherSmsMessage(payload) {
    const location = payload && payload.location ? payload.location : "your area";
    const condition = payload && (payload.summary || payload.description) ? (payload.summary || payload.description) : "variable conditions";
    const temp = Number(payload && payload.temperature);
    const humidity = Number(payload && payload.humidity);
    const wind = Number(payload && payload.windSpeed);
    const advice = getWeatherAdviceLines(payload, 2);

    let message = `Weather Alert (${location}): ${condition}.`;
    if (Number.isFinite(temp)) message += ` Temp ${temp}C.`;
    if (Number.isFinite(humidity)) message += ` Humidity ${humidity}%.`;
    if (Number.isFinite(wind)) message += ` Wind ${wind} km/h.`;
    if (advice.length) message += ` Advice: ${advice.join(" ")}`;
    return message;
}

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || "";
const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const ELEVENLABS_AGENT_CACHE_TTL_MS = 60 * 1000;
let elevenLabsAgentCache = {
    at: 0,
    agentId: "",
    payload: null
};
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });
const frontendDir = path.join(__dirname, "../frontend");
const indexHtml = path.join(frontendDir, "index.html");

app.get("/", (req, res) => {
    res.sendFile(indexHtml);
});

// Routes defined before static middleware
const upload = multer({
    dest: uploadsDir,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    }
});

app.post("/predict", upload.single("image"), (req, res) => {
    console.log("🔥 Request received");

    if (!req.file) {
        return res.json({ error: "No file uploaded" });
    }

    const imagePath = req.file.path;
    const scriptPath = path.join(__dirname, "../ai-model/predict.py");
    const allowedCropTypes = new Set([
        "all",
        "apple",
        "blueberry",
        "cherry",
        "corn",
        "grape",
        "orange",
        "peach",
        "pepper_bell",
        "potato",
        "raspberry",
        "soybean",
        "squash",
        "tomato"
    ]);
    const cropTypeRaw = String(req.body && req.body.cropType ? req.body.cropType : "all").trim().toLowerCase();
    const cropType = allowedCropTypes.has(cropTypeRaw) ? cropTypeRaw : "all";

    console.log("📷 Image:", imagePath);
    console.log("🌱 Crop type:", cropType);

    exec(`python "${scriptPath}" "${imagePath}" "${cropType}"`, (error, stdout, stderr) => {
        console.log("STDOUT:", stdout);
        console.log("STDERR:", stderr);

        if (error) {
            console.log("❌ ERROR:", error);
            return res.json({ error: "Python failed" });
        }

        let result = stdout
            .split("\n")
            .filter(line =>
                line.includes("Crop filter") ||
                line.includes("Disease") ||
                line.includes("Confidence") ||
                line.includes("Next candidate") ||
                line.includes("Note:") ||
                line.includes("Solution") ||
                line.includes("Urgency")
            )
            .join("\n");

        console.log("✅ FINAL:", result);

        res.json({ result: result });
    });
});

// Weather: optional ?lat=&lon= from browser geolocation; else Andhra Pradesh default.
// OpenWeatherMap when OPENWEATHER_API_KEY is set; else Open-Meteo; else mock.
app.get("/weather", async (req, res) => {
    const { lat, lon } = parseWeatherCoords(req.query);
    try {
        const payload = await getWeatherPayload(lat, lon);
        res.json(payload);
    } catch (error) {
        console.log("Weather handler error:", error.message);
        res.json(getMockWeather());
    }
});

app.get("/api/health", (req, res) => {
    res.json({ ok: true, name: "Rural Guards", port: PORT });
});

app.get("/api/dealers-nearby", async (req, res) => {
    const { lat, lon } = parseWeatherCoords(req.query);
    const radius = Number(req.query.radius || 7000);

    try {
        const dealers = await fetchNearbyDealersFromOverpass(lat, lon, radius);
        if (dealers.length >= 3) {
            return res.json({ success: true, source: "overpass", lat, lon, dealers });
        }

        const fallback = fallbackDealersForLocation(lat, lon);
        return res.json({ success: true, source: "fallback", lat, lon, dealers: fallback });
    } catch (error) {
        console.log("Nearby dealers lookup failed:", error.message);
        const fallback = fallbackDealersForLocation(lat, lon);
        return res.json({ success: true, source: "fallback", lat, lon, dealers: fallback });
    }
});

function compactElevenLabsAgent(agentPayload) {
    if (!agentPayload || typeof agentPayload !== "object") {
        return null;
    }

    const agent = agentPayload.agent || agentPayload;
    const agentId = agent.agent_id || agent.id || null;
    const agentName = agent.name || agent.agent_name || null;

    return {
        id: agentId,
        name: agentName,
        hasKnowledgeBase: Boolean(agent.conversation_config && agent.conversation_config.agent && agent.conversation_config.agent.prompt),
        languageHint: agent.language || null,
        raw: agent
    };
}

async function fetchElevenLabsAgentRealtime(agentIdOverride, forceRefresh) {
    if (!ELEVENLABS_API_KEY) {
        return { success: false, error: "ELEVENLABS_API_KEY is not configured in .env" };
    }

    const agentId = String(agentIdOverride || ELEVENLABS_AGENT_ID || "").trim();
    if (!agentId) {
        return { success: false, error: "Provide ELEVENLABS_AGENT_ID in .env or pass agentId" };
    }

    const now = Date.now();
    const cacheValid =
        !forceRefresh &&
        elevenLabsAgentCache.payload &&
        elevenLabsAgentCache.agentId === agentId &&
        now - elevenLabsAgentCache.at < ELEVENLABS_AGENT_CACHE_TTL_MS;

    if (cacheValid) {
        return {
            success: true,
            source: "cache",
            agent: compactElevenLabsAgent(elevenLabsAgentCache.payload)
        };
    }

    try {
        const response = await fetch(`${ELEVENLABS_BASE_URL}/convai/agents/${encodeURIComponent(agentId)}`, {
            method: "GET",
            headers: {
                "xi-api-key": ELEVENLABS_API_KEY,
                "Content-Type": "application/json"
            }
        });

        const data = await response.json();
        if (!response.ok) {
            return {
                success: false,
                status: response.status,
                error: data?.detail?.message || data?.detail || "Failed to fetch ElevenLabs agent"
            };
        }

        elevenLabsAgentCache = {
            at: now,
            agentId: agentId,
            payload: data
        };

        return {
            success: true,
            source: "live",
            agent: compactElevenLabsAgent(data)
        };
    } catch (error) {
        return {
            success: false,
            error: `ElevenLabs request failed: ${error.message}`
        };
    }
}

app.get("/api/elevenlabs/agent", async (req, res) => {
    const forceRefresh = String(req.query.refresh || "").toLowerCase() === "true";
    const result = await fetchElevenLabsAgentRealtime(req.query.agentId, forceRefresh);
    if (!result.success) {
        const status = result.status || 500;
        return res.status(status).json(result);
    }

    return res.json(result);
});

app.post("/chat", async (req, res) => {
    console.log("📤 /chat request received");
    console.log("Request body:", JSON.stringify(req.body, null, 2));

    if (!req.body || !req.body.message) {
        console.log("❌ Missing message in request");
        return res.json({ reply: "Error: No message provided" });
    }

    const { message, context } = req.body;
    const msgLower = String(message || "").toLowerCase();
    const contextLat = Number(context && context.lat);
    const contextLon = Number(context && context.lon);
    const lat = Number.isFinite(contextLat) ? contextLat : DEFAULT_LAT;
    const lon = Number.isFinite(contextLon) ? contextLon : DEFAULT_LON;

    // Serve real-time weather directly for weather-related asks.
    if (
        msgLower.includes("weather") ||
        msgLower.includes("temperature") ||
        msgLower.includes("rain") ||
        msgLower.includes("forecast") ||
        msgLower.includes("humidity") ||
        msgLower.includes("wind")
    ) {
        try {
            const weather = await getWeatherPayload(lat, lon);

            return res.json({
                reply: formatWeatherChatAdvice(weather)
            });
        } catch (err) {
            const fallback = getMockWeather();
            return res.json({
                reply: formatWeatherChatAdvice(fallback)
            });
        }
    }

    if (msgLower.includes("scheme") || msgLower.includes("pm-kisan") || msgLower.includes("insurance") || msgLower.includes("kcc")) {
        return res.json({
            reply: "Available government schemes in Rural Guards: PM-KISAN (income support), PMFBY (crop insurance), Kisan Credit Card (low-interest crop credit), PM Matsya Sampada (fishery support), and Fishermen Welfare benefits. Open the Govt Schemes panel for official links and eligibility details."
        });
    }

    if (msgLower.includes("dealer") || msgLower.includes("seller") || msgLower.includes("seed shop") || msgLower.includes("fertilizer")) {
        const dealers = [
            { name: "Sri Seed Point", type: "seed", phone: "9876501123", lat: lat + 0.0045, lon: lon + 0.0038 },
            { name: "Rythu Fertilizer Depot", type: "fertilizer", phone: "9123404455", lat: lat - 0.0035, lon: lon + 0.0052 },
            { name: "Coastal Fish Dealer", type: "fish", phone: "9012307788", lat: lat + 0.0058, lon: lon - 0.0041 }
        ];

        const reply = dealers
            .map((dealer, idx) => `${idx + 1}. ${dealer.name} (${dealer.type}) - ${dealer.phone}`)
            .join("\n");

        return res.json({
            reply: `Nearby dealers around your location:\n${reply}\n\nYou can use the map card for live tracking, directions, and route view.`
        });
    }

    if (msgLower.includes("dam") || msgLower.includes("alert")) {
        const alertInfo = getAlertContent("dam", "nearby", "en-IN");
        return res.json({
            reply: `Dam safety alert guidance: ${alertInfo.voiceMessage} Use the Dam Alert card to send SMS and call alerts to registered recipients.`
        });
    }

    if (msgLower.includes("cyclone") || msgLower.includes("storm") || msgLower.includes("rain alert")) {
        const rainInfo = getAlertContent("rain", null, "en-IN");
        return res.json({
            reply: `${rainInfo.voiceMessage} Use Weather Alert and Dam Safety sections for real-time updates.`
        });
    }

    if (msgLower.includes("disease") || msgLower.includes("leaf") || msgLower.includes("blight") || msgLower.includes("spot")) {
        const disease = context && context.disease ? context.disease : "not scanned yet";
        const solution = context && context.solution ? context.solution : "Upload a crop image in Disease Detection to get treatment.";
        return res.json({
            reply: `Disease support is ready. Last detected disease: ${disease}. Recommendation: ${solution}`
        });
    }

    const reply = await generateGeminiReply(message, context);
    res.json({ reply });
});

// Twilio Configuration
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
    twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
    );
    console.log("✅ Twilio client initialized successfully");
} else {
    console.log("⚠️  Twilio credentials not configured - SMS/Voice features disabled");
}

function escapeXml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function getDamAlertByLanguage(damName, language = "en-IN") {
    const lang = String(language || "en-IN").toLowerCase();
    const safeDam = damName || "the nearby";

    if (lang.startsWith("te")) {
        return {
            smsMessage: `⚠️ హెచ్చరిక: ${safeDam} డ్యామ్ గేట్లు తెరుచుకుంటున్నాయి. దయచేసి వెంటనే సురక్షిత ప్రాంతానికి వెళ్లండి.`,
            voiceMessage: `హెచ్చరిక: ${safeDam} డ్యామ్ గేట్లు తెరుచుకుంటున్నాయి. దయచేసి వెంటనే సురక్షిత ప్రాంతానికి వెళ్లండి.`,
            twimlLanguage: "te-IN"
        };
    }

    if (lang.startsWith("hi")) {
        return {
            smsMessage: `⚠️ चेतावनी: ${safeDam} बांध के गेट खोले जा रहे हैं। कृपया तुरंत सुरक्षित स्थान पर जाएं।`,
            voiceMessage: `चेतावनी: ${safeDam} बांध के गेट खोले जा रहे हैं। कृपया तुरंत सुरक्षित स्थान पर जाएं।`,
            twimlLanguage: "hi-IN"
        };
    }

    return {
        smsMessage: `⚠️ Alert: ${safeDam} dam gates are being opened. Please move to a safe location immediately.`,
        voiceMessage: `Alert: ${safeDam} dam gates are being opened. Please move to a safe location immediately.`,
        twimlLanguage: "en-IN"
    };
}

function getAlertContent(type, damName, language = "en-IN") {
    if (type === "dam") {
        return getDamAlertByLanguage(damName, language);
    }

    const lang = String(language || "en-IN").toLowerCase();
    if (lang.startsWith("hi")) {
        if (type === "rain") {
            return {
                smsMessage: "🌧️ भारी बारिश आने वाली है। सावधान रहें और सुरक्षित रहें।",
                voiceMessage: "भारी बारिश आने वाली है। सावधान रहें और सुरक्षित रहें।",
                twimlLanguage: "hi-IN"
            };
        }
        return {
            smsMessage: "🌪️ चक्रवात चेतावनी। कृपया घर के अंदर रहें और बाहर न जाएं।",
            voiceMessage: "चक्रवात चेतावनी। कृपया घर के अंदर रहें और बाहर न जाएं।",
            twimlLanguage: "hi-IN"
        };
    }

    if (lang.startsWith("te")) {
        if (type === "rain") {
            return {
                smsMessage: "🌧️ భారీ వర్షం రాబోతోంది. జాగ్రత్తగా ఉండండి మరియు సురక్షితంగా ఉండండి.",
                voiceMessage: "భారీ వర్షం రాబోతోంది. జాగ్రత్తగా ఉండండి మరియు సురక్షితంగా ఉండండి.",
                twimlLanguage: "te-IN"
            };
        }
        return {
            smsMessage: "🌪️ తుఫాను హెచ్చరిక. దయచేసి ఇంట్లో ఉండండి మరియు బయటకు వెళ్లవద్దు.",
            voiceMessage: "తుఫాను హెచ్చరిక. దయచేసి ఇంట్లో ఉండండి మరియు బయటకు వెళ్లవద్దు.",
            twimlLanguage: "te-IN"
        };
    }

    if (type === "rain") {
        return {
            smsMessage: "🌧️ Heavy rain expected. Stay alert and stay safe.",
            voiceMessage: "Heavy rain expected. Stay alert and stay safe.",
            twimlLanguage: "en-IN"
        };
    }

    return {
        smsMessage: "🌪️ Cyclone warning. Please stay indoors and avoid travel.",
        voiceMessage: "Cyclone warning. Please stay indoors and avoid travel.",
        twimlLanguage: "en-IN"
    };
}

function getSafeTwilioSayConfig(twimlLanguage) {
    // Twilio trial call-screening can drop calls if language/voice pairs are not fully supported.
    // Keep call playback on a stable baseline voice-language pair.
    return { language: "en-US", voice: "alice", fallbackToEnglish: true };
}

function getEnglishDamVoiceFallback(damName) {
    const safeDam = damName || "the nearby";
    return `Alert: ${safeDam} dam gates are being opened. Please move to a safe location immediately.`;
}

// Test route
app.post("/test", (req, res) => {
    console.log("📝 Test route called");
    res.json({ success: true, message: "Test route works" });
});

// SMS Alert Route
console.log("📝 Registering /send-sms route");
app.post("/send-sms", async (req, res) => {
    console.log("📱 SMS Alert Request:", req.body);

    if (!twilioClient) {
        console.log("❌ Twilio not configured");
        return res.status(500).json({
            success: false,
            error: "Twilio not configured. Please set up TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env"
        });
    }

    const { phoneNumber, damName, language } = req.body;

    if (!phoneNumber || !damName) {
        console.log("❌ Missing phone number or dam name");
        return res.status(400).json({
            success: false,
            error: "Phone number and dam name are required"
        });
    }

    try {
        const { smsMessage: message } = getDamAlertByLanguage(damName, language);

        console.log("📤 Sending SMS to:", phoneNumber);
        console.log("📝 Message:", message);

        const sms = await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phoneNumber
        });

        console.log("✅ SMS sent successfully:", sms.sid);

        res.json({
            success: true,
            message: "SMS sent successfully",
            sid: sms.sid
        });

    } catch (error) {
        console.log("❌ SMS Error:", error.message);
        res.status(500).json({
            success: false,
            error: "Failed to send SMS: " + error.message
        });
    }
});

app.post("/send-weather-alert-sms", async (req, res) => {
    console.log("🌦️ Weather SMS Alert Request:", req.body);

    if (!twilioClient) {
        console.log("❌ Twilio not configured");
        return res.status(500).json({
            success: false,
            error: "Twilio not configured. Please set up TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env"
        });
    }

    const { phoneNumber } = req.body || {};
    const reqLat = Number(req.body && req.body.lat);
    const reqLon = Number(req.body && req.body.lon);
    const lat = Number.isFinite(reqLat) && reqLat >= -90 && reqLat <= 90 ? reqLat : DEFAULT_LAT;
    const lon = Number.isFinite(reqLon) && reqLon >= -180 && reqLon <= 180 ? reqLon : DEFAULT_LON;

    if (!phoneNumber) {
        return res.status(400).json({ success: false, error: "Phone number is required" });
    }

    try {
        const weatherPayload = await getWeatherPayload(lat, lon);
        const message = buildWeatherSmsMessage(weatherPayload);

        const sms = await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phoneNumber
        });

        return res.json({
            success: true,
            sid: sms.sid,
            message: "Weather alert SMS sent"
        });
    } catch (error) {
        console.log("❌ Weather SMS Error:", error.message);
        return res.status(500).json({
            success: false,
            error: "Failed to send weather alert SMS: " + error.message
        });
    }
});

// Voice Call Alert Route
app.post("/make-call", async (req, res) => {
    console.log("📞 Voice Call Request:", req.body);

    if (!twilioClient) {
        console.log("❌ Twilio not configured");
        return res.status(500).json({
            success: false,
            error: "Twilio not configured. Please set up TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env"
        });
    }

    const { phoneNumber, damName, language } = req.body;

    if (!phoneNumber || !damName) {
        console.log("❌ Missing phone number or dam name");
        return res.status(400).json({
            success: false,
            error: "Phone number and dam name are required"
        });
    }

    try {
        const { voiceMessage, twimlLanguage } = getDamAlertByLanguage(damName, language);
        const sayConfig = getSafeTwilioSayConfig(twimlLanguage);
        const callVoiceMessage = sayConfig.fallbackToEnglish
            ? getEnglishDamVoiceFallback(damName)
            : voiceMessage;

        // Create minimal TwiML (strict formatting helps avoid parser issues on trial call handoff)
        const twiml = `<Response><Say voice="${sayConfig.voice}" language="${sayConfig.language}">${escapeXml(callVoiceMessage)}</Say></Response>`;

        console.log("📞 Making call to:", phoneNumber);
        console.log("🎤 Voice message:", voiceMessage);

        const call = await twilioClient.calls.create({
            twiml: twiml,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phoneNumber
        });

        console.log("✅ Call initiated successfully:", call.sid);

        res.json({
            success: true,
            message: "Voice call initiated successfully",
            sid: call.sid
        });

    } catch (error) {
        console.log("❌ Call Error:", error.message);
        res.status(500).json({
            success: false,
            error: "Failed to initiate call: " + error.message
        });
    }
});

// Unified Alert Route - Sends both SMS and Voice Call
app.post("/send-alert", async (req, res) => {
    console.log("🚨 Alert Request:", req.body);

    if (!twilioClient) {
        console.log("❌ Twilio not configured");
        return res.status(500).json({
            success: false,
            error: "Twilio not configured. Please set up TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env"
        });
    }

    const { phone, type, language, damName } = req.body;

    if (!phone || !type) {
        console.log("❌ Missing phone number or alert type");
        return res.status(400).json({
            success: false,
            error: "Phone number and alert type are required"
        });
    }

    // Validate alert type
    const validTypes = ['dam', 'rain', 'cyclone'];
    if (!validTypes.includes(type)) {
        console.log("❌ Invalid alert type:", type);
        return res.status(400).json({
            success: false,
            error: "Invalid alert type. Must be 'dam', 'rain', or 'cyclone'"
        });
    }

        const { smsMessage, voiceMessage, twimlLanguage } = getAlertContent(type, damName, language);
        const sayConfig = getSafeTwilioSayConfig(twimlLanguage);
        const callVoiceMessage = sayConfig.fallbackToEnglish && type === "dam"
            ? getEnglishDamVoiceFallback(damName)
            : voiceMessage;

    try {
        // Create minimal TwiML (strict formatting helps avoid parser issues on trial call handoff)
        const twiml = `<Response><Say voice="${sayConfig.voice}" language="${sayConfig.language}">${escapeXml(callVoiceMessage)}</Say></Response>`;
        let sms = null;
        let call = null;
        let smsError = null;
        let callError = null;

        try {
            console.log(`📱 Sending ${type.toUpperCase()} SMS to:`, phone);
            console.log("📝 SMS Message:", smsMessage);
            sms = await twilioClient.messages.create({
                body: smsMessage,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: phone
            });
            console.log("✅ SMS sent successfully:", sms.sid);
        } catch (err) {
            smsError = err.message;
            console.log("❌ SMS failed during combined alert:", smsError);
        }

        try {
            console.log(`📞 Making ${type.toUpperCase()} voice call to:`, phone);
            console.log("🎤 Voice message:", voiceMessage);
            call = await twilioClient.calls.create({
                twiml: twiml,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: phone
            });
            console.log("✅ Voice call initiated successfully:", call.sid);
        } catch (err) {
            callError = err.message;
            console.log("❌ Call failed during combined alert:", callError);
        }

        if (!sms && !call) {
            return res.status(500).json({
                success: false,
                error: `SMS failed: ${smsError}; Call failed: ${callError}`
            });
        }

        const parts = [];
        if (sms) parts.push("SMS sent");
        if (call) parts.push("Call placed");
        if (!sms && smsError) parts.push(`SMS failed: ${smsError}`);
        if (!call && callError) parts.push(`Call failed: ${callError}`);

        res.json({
            success: true,
            smsSid: sms ? sms.sid : null,
            callSid: call ? call.sid : null,
            alertType: type,
            message: parts.join(" | ")
        });

    } catch (error) {
        console.log("❌ Alert Error:", error.message);
        res.status(500).json({
            success: false,
            error: "Failed to send alert: " + error.message
        });
    }
});

// Voice Agent Integration Route - Allows ElevenLabs ConvAI to interact with system features
app.post("/voice-agent", async (req, res) => {
    console.log("🎤 Voice Agent Request:", req.body);

    const { action, query, location, damName, language, pageContext } = req.body;
    const requestedLat = Number(location && location.lat);
    const requestedLon = Number(location && location.lon);
    const hasValidLocation =
        Number.isFinite(requestedLat) &&
        Number.isFinite(requestedLon) &&
        requestedLat >= -90 &&
        requestedLat <= 90 &&
        requestedLon >= -180 &&
        requestedLon <= 180;
    const lat = hasValidLocation ? requestedLat : DEFAULT_LAT;
    const lon = hasValidLocation ? requestedLon : DEFAULT_LON;

    try {
        const elevenLabsRealtime = await fetchElevenLabsAgentRealtime();
        const withRealtimeContext = (payload) => ({
            ...payload,
            realtime: {
                elevenLabs: elevenLabsRealtime.success
                    ? {
                        enabled: true,
                        source: elevenLabsRealtime.source,
                        agent: elevenLabsRealtime.agent
                    }
                    : {
                        enabled: false,
                        error: elevenLabsRealtime.error
                    }
            },
            pageContext: pageContext || null
        });

        // Action: Get weather information
        const voiceQuery = String(query || "").toLowerCase();
        const isWeatherIntent =
            action === "weather" ||
            voiceQuery.includes("weather") ||
            voiceQuery.includes("temperature") ||
            voiceQuery.includes("rain") ||
            voiceQuery.includes("humidity") ||
            voiceQuery.includes("wind") ||
            voiceQuery.includes("hot") ||
            voiceQuery.includes("cold");

        if (isWeatherIntent) {
            try {
                const weatherPayload = await getWeatherPayload(lat, lon);
                return res.json(withRealtimeContext({
                    success: true,
                    type: "weather",
                    data: weatherPayload,
                    advice: getWeatherAdviceLines(weatherPayload, 3),
                    voice: formatWeatherVoiceAdvice(weatherPayload, weatherPayload.location || "your area")
                }));
            } catch (err) {
                const mockWeather = getMockWeather();
                return res.json(withRealtimeContext({
                    success: true,
                    type: "weather",
                    data: mockWeather,
                    advice: getWeatherAdviceLines(mockWeather, 3),
                    voice: formatWeatherVoiceAdvice(mockWeather, mockWeather.location || "your area")
                }));
            }
        }

        // Action: Get government schemes information
        if (action === "schemes" || query?.toLowerCase().includes("scheme")) {
            const schemes = [
                { name: "PM-KISAN", desc: "Direct income support for farmer families, credited in installments" },
                { name: "PMFBY", desc: "Crop insurance protection against drought, flood, and weather events" },
                { name: "Kisan Credit Card", desc: "Short-term credit for crop cultivation at lower interest rates" },
                { name: "PM Matsya Sampada", desc: "Support for fishery, fish seed, and pond development" },
                { name: "Fishermen Welfare", desc: "Accident support and seasonal welfare benefits for fishermen" }
            ];
            return res.json(withRealtimeContext({
                success: true,
                type: "schemes",
                data: schemes,
                voice: `Available government schemes: ${schemes.map(s => s.name).join(", ")}. Each provides financial support or insurance for farmers and fishermen. Visit your local agriculture office for eligibility and application.`
            }));
        }

        if (action === "dealers" || query?.toLowerCase().includes("dealer") || query?.toLowerCase().includes("seller")) {
            const dealers = [
                { name: "Sri Seed Point", type: "seed", phone: "9876501123", lat: lat + 0.012, lon: lon + 0.010 },
                { name: "Rythu Fertilizer Depot", type: "fertilizer", phone: "9123404455", lat: lat - 0.010, lon: lon + 0.014 },
                { name: "Coastal Fish Dealer", type: "fish", phone: "9012307788", lat: lat + 0.015, lon: lon - 0.012 }
            ];

            return res.json(withRealtimeContext({
                success: true,
                type: "dealers",
                data: dealers,
                voice: `Nearby dealers loaded for your location. I found seed, fertilizer, and fish dealers. You can open the map card to view exact positions and phone numbers.`
            }));
        }

        // Action: Dam alert information
        if (action === "dam-alert" || query?.toLowerCase().includes("dam")) {
            const safeDam = damName || "nearby";
            const alertInfo = getAlertContent("dam", safeDam, language || "en-IN");
            return res.json(withRealtimeContext({
                success: true,
                type: "dam-alert",
                data: alertInfo,
                voice: alertInfo.voiceMessage,
                urgent: true
            }));
        }

        // Action: Disease detection info
        if (action === "disease-detection" || query?.toLowerCase().includes("disease")) {
            return res.json(withRealtimeContext({
                success: true,
                type: "disease-detection",
                data: {
                    crops: ["Corn/Maize", "Pepper (Bell)", "Potato", "Tomato"],
                    description: "Upload a crop image to get AI-powered disease detection, resistance recommendations, and treatment solutions"
                },
                voice: "You can scan crop images for disease detection. Supported crops include corn, pepper, potato, and tomato. Upload an image to get treatment advice."
            }));
        }

        // Action: Rainfall and cyclone alerts
        if (action === "rain-alert" || query?.toLowerCase().includes("rain") || query?.toLowerCase().includes("cyclone")) {
            const rainInfo = getAlertContent("rain", null, language || "en-IN");
            return res.json(withRealtimeContext({
                success: true,
                type: "rain-alert",
                data: rainInfo,
                voice: rainInfo.voiceMessage,
                urgent: false
            }));
        }

        // Default: general conversational copilot fallback through Gemini
        const geminiReply = await generateGeminiReply(query || "Help me with farming, weather, or safety.", {
            disease: null,
            solution: null,
            pageContext: pageContext || null
        }, true);

        return res.json(withRealtimeContext({
            success: true,
            type: "general",
            data: {
                features: ["Disease Detection", "Weather Alerts", "Dam Monitoring", "Government Schemes", "Seller Directory"],
                description: "Rural Guards provides AI-powered crop disease detection, real-time weather alerts, dam safety monitoring, government scheme information, and a directory of nearby seed and fertilizer sellers."
            },
            voice: geminiReply
        }));

    } catch (error) {
        console.log("❌ Voice Agent Error:", error.message);
        res.status(500).json({
            success: false,
            type: "error",
            voice: "Sorry, I encountered an error. Please try again later.",
            error: error.message
        });
    }
});

app.use(express.static(frontendDir));

app.listen(PORT, () => {
    console.log(`🚀 Server running — open http://127.0.0.1:${PORT} in your browser`);
});