const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DEFAULT_LAT = 15.9129;
const DEFAULT_LON = 79.74;
const LOCATION_LABEL = "Andhra Pradesh (Central)";
const HISTORICAL_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const HISTORICAL_FAILURE_CACHE_TTL_MS = 60 * 60 * 1000;
const HISTORICAL_COORD_PRECISION = 2;
const HISTORICAL_VALIDATION_ENABLED =
    String(process.env.HISTORICAL_VALIDATION_ENABLED || "true").trim().toLowerCase() !== "false";
const HISTORICAL_WARMUP_ENABLED =
    String(process.env.HISTORICAL_WARMUP_ENABLED || "true").trim().toLowerCase() !== "false";
const WEATHER_CACHE_DIR = path.join(__dirname, "cache");
const HISTORICAL_CACHE_FILE = path.join(WEATHER_CACHE_DIR, "weatherValidationCache.json");
const HISTORICAL_CACHE_WRITE_DEBOUNCE_MS = 500;

const historicalValidationCache = new Map();
const historicalValidationInFlight = new Map();
let historicalCacheWriteTimer = null;

const DEFAULT_WARMUP_LOCATIONS = [
    { name: "Andhra Pradesh Central", lat: DEFAULT_LAT, lon: DEFAULT_LON },
    { name: "Visakhapatnam", lat: 17.6868, lon: 83.2185 },
    { name: "Vijayawada", lat: 16.5062, lon: 80.648 },
    { name: "Guntur", lat: 16.3067, lon: 80.4365 },
    { name: "Kurnool", lat: 15.8281, lon: 78.0373 },
    { name: "Tirupati", lat: 13.6288, lon: 79.4192 }
];

function scheduleHistoricalCachePersist() {
    if (historicalCacheWriteTimer) return;
    historicalCacheWriteTimer = setTimeout(() => {
        historicalCacheWriteTimer = null;
        try {
            persistHistoricalCacheToDisk();
        } catch (error) {
            console.log("Historical cache persist failed:", error.message);
        }
    }, HISTORICAL_CACHE_WRITE_DEBOUNCE_MS);
}

function persistHistoricalCacheToDisk() {
    const now = Date.now();
    const entries = [];
    for (const [key, value] of historicalValidationCache.entries()) {
        if (!value || !Number.isFinite(value.expiresAt) || value.expiresAt <= now) continue;
        entries.push({
            key,
            expiresAt: value.expiresAt,
            payload: value.payload
        });
    }

    fs.mkdirSync(WEATHER_CACHE_DIR, { recursive: true });
    fs.writeFileSync(
        HISTORICAL_CACHE_FILE,
        JSON.stringify({
            version: 1,
            generatedAt: new Date().toISOString(),
            entries
        }, null, 2),
        "utf-8"
    );
}

function loadHistoricalCacheFromDisk() {
    if (!fs.existsSync(HISTORICAL_CACHE_FILE)) return;
    try {
        const text = fs.readFileSync(HISTORICAL_CACHE_FILE, "utf-8");
        const data = JSON.parse(text);
        const entries = Array.isArray(data && data.entries) ? data.entries : [];
        const now = Date.now();
        for (const entry of entries) {
            if (!entry || typeof entry.key !== "string") continue;
            const expiresAt = Number(entry.expiresAt);
            if (!Number.isFinite(expiresAt) || expiresAt <= now) continue;
            historicalValidationCache.set(entry.key, {
                expiresAt,
                payload: entry.payload
            });
        }
    } catch (error) {
        console.log("Historical cache load skipped:", error.message);
    }
}

function setHistoricalCacheEntry(cacheKey, ttlMs, payload) {
    historicalValidationCache.set(cacheKey, {
        expiresAt: Date.now() + ttlMs,
        payload
    });
    scheduleHistoricalCachePersist();
}

loadHistoricalCacheFromDisk();

function generateWeatherTips(temp, humidity, windSpeed, mainWeather, description) {
    let tips = [];

    if (temp > 35) {
        tips.push("🔥 High temperature! Water crops early morning. Avoid working during peak sun hours.");
        tips.push("🌾 Consider shade nets for vegetable crops. Monitor for heat stress in plants.");
    } else if (temp < 20) {
        tips.push("❄️ Cooler temperatures. Good for planting winter crops like wheat, peas.");
        tips.push("🐟 Fishing boats should check weather before venturing out.");
    } else {
        tips.push("🌡️ Optimal temperature for most crops. Good conditions for field work.");
    }

    if (humidity > 80) {
        tips.push("💧 High humidity. Monitor for fungal diseases in crops.");
        tips.push("🌱 Ensure proper spacing between plants for air circulation.");
    } else if (humidity < 40) {
        tips.push("🏜️ Low humidity. Increase irrigation frequency. Consider mulching.");
    }

    if (windSpeed > 15) {
        tips.push("🌪️ Strong winds detected. Secure fishing nets and equipment.");
        tips.push("🌾 Protect young plants from wind damage. Avoid spraying pesticides.");
    }

    const main = String(mainWeather || "").toLowerCase();
    if (main.includes("rain")) {
        tips.push("🌧️ Rain expected. Delay pesticide spraying. Prepare for water harvesting.");
        tips.push("🐟 Coastal areas: Monitor wave conditions. Fishing boats should stay ashore.");
        tips.push("🌱 Good for natural irrigation. Monitor soil moisture levels.");
    } else if (main.includes("clear") || main.includes("sunny")) {
        tips.push("☀️ Sunny weather. Good for drying harvested crops and fishing activities.");
        tips.push("💧 Irrigate crops if no rain. Monitor soil moisture.");
    } else if (main.includes("cloud")) {
        tips.push("☁️ Cloudy conditions. Good for transplanting and weeding activities.");
        tips.push("🐟 Fishing: Check visibility and sea conditions.");
    }

    const currentMonth = new Date().getMonth() + 1;
    if (currentMonth >= 6 && currentMonth <= 9) {
        tips.push("🌧️ Monsoon season: Prepare for Kharif crops. Monitor for waterlogging.");
    } else if (currentMonth >= 10 && currentMonth <= 12) {
        tips.push("🌾 Harvest season: Ensure proper drying of grains before storage.");
    } else if (currentMonth >= 1 && currentMonth <= 3) {
        tips.push("❄️ Winter crops: Good time for Rabi sowing. Protect from frost if any.");
    }

    if (tips.length === 0) {
        tips = [
            "🌱 Monitor crop health regularly",
            "💧 Maintain proper irrigation schedule",
            "🐟 Check local fishing advisories",
            "⚠️ Stay updated with weather forecasts"
        ];
    }

    return tips;
}

function getMockWeather() {
    return {
        location: LOCATION_LABEL,
        source: "mock",
        temperature: 32,
        humidity: 65,
        windSpeed: 12,
        description: "Partly cloudy",
        tips: [
            "🌱 Good conditions for paddy transplantation",
            "💧 Irrigate crops in early morning or evening",
            "🐟 Favorable weather for coastal fishing",
            "⚠️ Monitor for sudden weather changes"
        ]
    };
}

function dateToIsoUtc(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function dateToNasaKey(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}${m}${d}`;
}

function getFiveYearWindowUtc() {
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
    const start = new Date(Date.UTC(end.getUTCFullYear() - 5, end.getUTCMonth(), end.getUTCDate() + 1));
    return {
        startIso: dateToIsoUtc(start),
        endIso: dateToIsoUtc(end),
        startNasa: dateToNasaKey(start),
        endNasa: dateToNasaKey(end)
    };
}

function toFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function sanitizeNasaValue(value, min, max) {
    const n = toFiniteNumber(value);
    if (n === null) return null;
    // NASA POWER uses negative sentinels (for example -999) for missing data.
    if (n <= -900) return null;
    if (Number.isFinite(min) && n < min) return null;
    if (Number.isFinite(max) && n > max) return null;
    return n;
}

function roundNumber(value, decimals = 2) {
    if (!Number.isFinite(value)) return null;
    const p = 10 ** decimals;
    return Math.round(value * p) / p;
}

function pearsonCorrelation(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    if (n < 3) return null;

    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumYY = 0;
    let sumXY = 0;

    for (let i = 0; i < n; i += 1) {
        const x = xs[i];
        const y = ys[i];
        sumX += x;
        sumY += y;
        sumXX += x * x;
        sumYY += y * y;
        sumXY += x * y;
    }

    const numerator = n * sumXY - sumX * sumY;
    const denomX = n * sumXX - sumX * sumX;
    const denomY = n * sumYY - sumY * sumY;
    const denominator = Math.sqrt(denomX * denomY);
    if (!Number.isFinite(denominator) || denominator <= 0) return null;
    return numerator / denominator;
}

function computeValidationStats(points) {
    if (!Array.isArray(points) || points.length === 0) {
        return {
            count: 0,
            mae: null,
            rmse: null,
            bias: null,
            correlation: null
        };
    }

    let absErrSum = 0;
    let sqErrSum = 0;
    let biasSum = 0;
    const nasaValues = [];
    const referenceValues = [];

    for (const row of points) {
        const nasa = Number(row.nasa);
        const reference = Number(row.reference);
        const diff = reference - nasa;
        absErrSum += Math.abs(diff);
        sqErrSum += diff * diff;
        biasSum += diff;
        nasaValues.push(nasa);
        referenceValues.push(reference);
    }

    const n = points.length;
    return {
        count: n,
        mae: roundNumber(absErrSum / n, 3),
        rmse: roundNumber(Math.sqrt(sqErrSum / n), 3),
        bias: roundNumber(biasSum / n, 3),
        correlation: roundNumber(pearsonCorrelation(nasaValues, referenceValues), 3)
    };
}

async function fetchNasaPowerDaily(lat, lon, startNasa, endNasa) {
    const url = "https://power.larc.nasa.gov/api/temporal/daily/point";
    const { data } = await axios.get(url, {
        params: {
            community: "AG",
            latitude: lat,
            longitude: lon,
            start: startNasa,
            end: endNasa,
            parameters: "T2M,PRECTOTCORR,WS2M,RH2M",
            format: "JSON"
        },
        timeout: 15000
    });

    const parameter = data && data.properties && data.properties.parameter;
    if (!parameter || typeof parameter !== "object") {
        throw new Error("NASA POWER response missing parameter payload");
    }

    const t2m = parameter.T2M || {};
    const prectot = parameter.PRECTOTCORR || {};
    const ws2m = parameter.WS2M || {};
    const rh2m = parameter.RH2M || {};

    const allDates = new Set([...Object.keys(t2m), ...Object.keys(prectot), ...Object.keys(ws2m), ...Object.keys(rh2m)]);
    const rows = [];
    for (const key of allDates) {
        if (!/^\d{8}$/.test(key)) continue;
        const iso = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
        const temperatureC = sanitizeNasaValue(t2m[key], -60, 70);
        const precipitationMm = sanitizeNasaValue(prectot[key], 0, 500);
        const windSpeedMs = sanitizeNasaValue(ws2m[key], 0, 80);
        const humidityPct = sanitizeNasaValue(rh2m[key], 0, 100);
        rows.push({
            date: iso,
            temperatureC,
            precipitationMm,
            windSpeedMs,
            humidityPct
        });
    }
    return rows;
}

async function fetchOpenMeteoArchiveDaily(lat, lon, startIso, endIso) {
    const url = "https://archive-api.open-meteo.com/v1/archive";
    const { data } = await axios.get(url, {
        params: {
            latitude: lat,
            longitude: lon,
            start_date: startIso,
            end_date: endIso,
            daily: "temperature_2m_mean,precipitation_sum,wind_speed_10m_mean",
            wind_speed_unit: "ms",
            timezone: "UTC"
        },
        timeout: 15000
    });

    const daily = data && data.daily;
    if (!daily || !Array.isArray(daily.time)) {
        throw new Error("Open-Meteo archive response missing daily arrays");
    }

    const rows = [];
    for (let i = 0; i < daily.time.length; i += 1) {
        rows.push({
            date: String(daily.time[i]),
            temperatureC: toFiniteNumber(daily.temperature_2m_mean && daily.temperature_2m_mean[i]),
            precipitationMm: toFiniteNumber(daily.precipitation_sum && daily.precipitation_sum[i]),
            windSpeedMs: toFiniteNumber(daily.wind_speed_10m_mean && daily.wind_speed_10m_mean[i])
        });
    }
    return rows;
}

function alignSeriesByDate(nasaRows, referenceRows, variableName) {
    const nasaMap = new Map();
    for (const row of nasaRows) {
        const value = toFiniteNumber(row && row[variableName]);
        if (row && row.date && value !== null) nasaMap.set(row.date, value);
    }

    const aligned = [];
    for (const row of referenceRows) {
        if (!row || !row.date) continue;
        const nasaValue = nasaMap.get(row.date);
        const refValue = toFiniteNumber(row[variableName]);
        if (nasaValue === undefined || refValue === null) continue;
        aligned.push({ date: row.date, nasa: nasaValue, reference: refValue });
    }
    return aligned;
}

function computeMonthlyTempBiasNasaMinusReference(tempAlignedRows) {
    const bucket = {};
    for (const row of tempAlignedRows) {
        const month = String(row.date).slice(5, 7);
        const bias = row.nasa - row.reference;
        if (!bucket[month]) bucket[month] = [];
        bucket[month].push(bias);
    }

    const out = {};
    for (const [month, values] of Object.entries(bucket)) {
        if (!values.length) continue;
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        out[month] = roundNumber(avg, 3);
    }
    return out;
}

function scoreFromMae(mae) {
    if (!Number.isFinite(mae)) return null;
    return Math.max(0, Math.min(100, Math.round((1 - mae / 5) * 100)));
}

function validationCacheKey(lat, lon) {
    return `${Number(lat).toFixed(HISTORICAL_COORD_PRECISION)},${Number(lon).toFixed(HISTORICAL_COORD_PRECISION)}`;
}

async function buildHistoricalValidation(lat, lon) {
    const window = getFiveYearWindowUtc();
    const [nasaRows, openMeteoRows] = await Promise.all([
        fetchNasaPowerDaily(lat, lon, window.startNasa, window.endNasa),
        fetchOpenMeteoArchiveDaily(lat, lon, window.startIso, window.endIso)
    ]);

    const tempAligned = alignSeriesByDate(nasaRows, openMeteoRows, "temperatureC");
    const rainAligned = alignSeriesByDate(nasaRows, openMeteoRows, "precipitationMm");
    const windAligned = alignSeriesByDate(nasaRows, openMeteoRows, "windSpeedMs");

    const temperatureStats = computeValidationStats(tempAligned);
    const rainfallStats = computeValidationStats(rainAligned);
    const windStats = computeValidationStats(windAligned);
    const monthlyTempBiasNasaMinusReference = computeMonthlyTempBiasNasaMinusReference(tempAligned);

    return {
        enabled: true,
        status: "ok",
        provider: "nasa-power",
        referenceProvider: "open-meteo-archive",
        years: 5,
        period: {
            start: window.startIso,
            end: window.endIso
        },
        points: {
            temperature: temperatureStats.count,
            precipitation: rainfallStats.count,
            wind: windStats.count
        },
        metrics: {
            temperatureC: temperatureStats,
            precipitationMm: rainfallStats,
            windSpeedMs: windStats
        },
        monthlyTempBiasNasaMinusReference,
        reliabilityScore: {
            temperature: scoreFromMae(temperatureStats.mae),
            precipitation: scoreFromMae(rainfallStats.mae),
            wind: scoreFromMae(windStats.mae)
        },
        generatedAt: new Date().toISOString()
    };
}

async function getHistoricalValidation(lat, lon) {
    if (!HISTORICAL_VALIDATION_ENABLED) {
        return {
            enabled: false,
            status: "disabled"
        };
    }

    const cacheKey = validationCacheKey(lat, lon);
    const now = Date.now();
    const cached = historicalValidationCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
        return cached.payload;
    }

    const existingPromise = historicalValidationInFlight.get(cacheKey);
    if (existingPromise) {
        return existingPromise;
    }

    const task = (async () => {
        try {
            const payload = await buildHistoricalValidation(lat, lon);
            setHistoricalCacheEntry(cacheKey, HISTORICAL_CACHE_TTL_MS, payload);
            return payload;
        } catch (error) {
            const payload = {
                enabled: true,
                status: "unavailable",
                reason: error.message,
                generatedAt: new Date().toISOString()
            };
            setHistoricalCacheEntry(cacheKey, HISTORICAL_FAILURE_CACHE_TTL_MS, payload);
            return payload;
        } finally {
            historicalValidationInFlight.delete(cacheKey);
        }
    })();

    historicalValidationInFlight.set(cacheKey, task);
    return task;
}

function applyHistoricalTemperatureCorrection(currentTemperature, validationPayload) {
    const temp = toFiniteNumber(currentTemperature);
    if (temp === null || !validationPayload || validationPayload.status !== "ok") {
        return null;
    }

    const monthKey = String(new Date().getUTCMonth() + 1).padStart(2, "0");
    const rawBias = toFiniteNumber(
        validationPayload.monthlyTempBiasNasaMinusReference &&
        validationPayload.monthlyTempBiasNasaMinusReference[monthKey]
    );
    if (rawBias === null) return null;

    // Keep correction bounded to avoid over-adjusting real-time values.
    const boundedBias = Math.max(-2, Math.min(2, rawBias));
    return {
        correctedTemperature: roundNumber(temp + boundedBias, 1),
        correctionDelta: roundNumber(boundedBias, 2),
        monthKey,
        note: "Temperature adjusted using 5-year NASA monthly bias against archive reference"
    };
}

async function enrichWithHistoricalValidation(payload, lat, lon) {
    const validation = await getHistoricalValidation(lat, lon);
    const correction = applyHistoricalTemperatureCorrection(payload && payload.temperature, validation);

    return {
        ...payload,
        validation,
        corrected: correction
    };
}

async function getWeatherValidationHistory(lat = DEFAULT_LAT, lon = DEFAULT_LON) {
    const cacheKey = validationCacheKey(lat, lon);
    const validation = await getHistoricalValidation(lat, lon);
    const cacheEntry = historicalValidationCache.get(cacheKey);
    return {
        location: {
            lat: roundNumber(Number(lat), 4),
            lon: roundNumber(Number(lon), 4)
        },
        cacheKey,
        cache: {
            hit: Boolean(cacheEntry),
            expiresAt: cacheEntry && cacheEntry.expiresAt ? new Date(cacheEntry.expiresAt).toISOString() : null
        },
        validation
    };
}

async function warmHistoricalValidationCache(locations = DEFAULT_WARMUP_LOCATIONS) {
    if (!HISTORICAL_WARMUP_ENABLED || !HISTORICAL_VALIDATION_ENABLED) {
        return {
            enabled: false,
            requested: 0,
            success: 0,
            failed: 0,
            details: []
        };
    }

    const list = Array.isArray(locations) ? locations : [];
    const tasks = list
        .map((row) => ({
            name: String((row && row.name) || "location"),
            lat: Number(row && row.lat),
            lon: Number(row && row.lon)
        }))
        .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon));

    const settled = await Promise.allSettled(
        tasks.map((row) => getHistoricalValidation(row.lat, row.lon))
    );

    const details = settled.map((result, idx) => {
        const meta = tasks[idx];
        if (result.status === "fulfilled") {
            const status = result.value && result.value.status ? result.value.status : "unknown";
            return { ...meta, ok: status === "ok", status };
        }
        return { ...meta, ok: false, status: "failed", reason: result.reason ? result.reason.message : "unknown" };
    });

    return {
        enabled: true,
        requested: tasks.length,
        success: details.filter((d) => d.ok).length,
        failed: details.filter((d) => !d.ok).length,
        details
    };
}

/**
 * WMO weather interpretation codes (Open-Meteo).
 * Returns { description, main } for tip logic (main matches OpenWeather-style buckets).
 */
function wmoCodeToWeather(code) {
    const c = Number(code);
    if (c === 0) return { description: "Clear sky", main: "clear" };
    if (c === 1) return { description: "Mainly clear", main: "clear" };
    if (c === 2) return { description: "Partly cloudy", main: "cloud" };
    if (c === 3) return { description: "Overcast", main: "cloud" };
    if (c === 45 || c === 48) return { description: "Fog", main: "cloud" };
    if (c >= 51 && c <= 67) return { description: "Rain", main: "rain" };
    if (c >= 71 && c <= 77) return { description: "Snow", main: "cloud" };
    if (c >= 80 && c <= 82) return { description: "Rain showers", main: "rain" };
    if (c === 85 || c === 86) return { description: "Snow showers", main: "cloud" };
    if (c >= 95 && c <= 99) return { description: "Thunderstorm", main: "rain" };
    return { description: "Variable conditions", main: "cloud" };
}

function openWeatherLocationLabel(weatherData) {
    const name = weatherData.name;
    const country = weatherData.sys && weatherData.sys.country;
    if (name && country) return `${name}, ${country}`;
    if (name) return name;
    return LOCATION_LABEL;
}

/**
 * Human-readable place name for coordinates (Open-Meteo path). Uses OpenStreetMap Nominatim.
 */
async function reverseGeocodeLabel(lat, lon) {
    try {
        const { data } = await axios.get("https://nominatim.openstreetmap.org/reverse", {
            params: { lat, lon, format: "json" },
            headers: {
                "User-Agent": "RuralGuards/1.0 (student hackathon project; not bulk)"
            },
            timeout: 5000
        });
        const a = data.address || {};
        const place =
            a.city ||
            a.town ||
            a.village ||
            a.municipality ||
            a.county ||
            a.state_district;
        const region = a.state || a.country;
        if (place && region) return `${place}, ${region}`;
        if (place) return place;
        if (data.display_name) {
            const parts = data.display_name.split(",").map((s) => s.trim());
            return parts.slice(0, 2).join(", ");
        }
    } catch (e) {
        console.log("Reverse geocode skipped:", e.message);
    }
    return `${Number(lat).toFixed(2)}°, ${Number(lon).toFixed(2)}°`;
}

async function fetchOpenWeather(lat, lon, apiKey) {
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const response = await axios.get(weatherUrl);
    const weatherData = response.data;
    const temp = Math.round(weatherData.main.temp);
    const humidity = weatherData.main.humidity;
    const windSpeed = weatherData.wind.speed;
    const description = weatherData.weather[0].description;
    const mainWeather = weatherData.weather[0].main.toLowerCase();
    const tips = generateWeatherTips(temp, humidity, windSpeed, mainWeather, description);
    return {
        location: openWeatherLocationLabel(weatherData),
        source: "openweather",
        temperature: temp,
        humidity,
        windSpeed,
        description,
        tips
    };
}

async function fetchOpenMeteo(lat, lon) {
    const url =
        "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${lat}&longitude=${lon}` +
        "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code" +
        "&wind_speed_unit=kmh";
    const response = await axios.get(url);
    const cur = response.data.current;
    if (!cur) throw new Error("Open-Meteo: no current data");
    const temp = Math.round(cur.temperature_2m);
    const humidity = cur.relative_humidity_2m;
    const windSpeed = Math.round(cur.wind_speed_10m * 10) / 10;
    const { description, main } = wmoCodeToWeather(cur.weather_code);
    const mainWeather = main.toLowerCase();
    const tips = generateWeatherTips(temp, humidity, windSpeed, mainWeather, description);
    const locationLabel = await reverseGeocodeLabel(lat, lon);
    return {
        location: locationLabel,
        source: "open-meteo",
        temperature: temp,
        humidity,
        windSpeed,
        description,
        tips
    };
}

/**
 * Same response shape as before: { location, temperature, humidity, windSpeed, description, tips }.
 * Tries OpenWeather when OPENWEATHER_API_KEY is set; otherwise uses Open-Meteo (no key).
 * Falls back to mock data on failure.
 */
async function getWeatherPayload(lat = DEFAULT_LAT, lon = DEFAULT_LON) {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    const keyLooksReal = apiKey && apiKey !== "demo_key" && apiKey.length > 8;

    if (keyLooksReal) {
        try {
            const payload = await fetchOpenWeather(lat, lon, apiKey);
            return await enrichWithHistoricalValidation(payload, lat, lon);
        } catch (e) {
            console.log("OpenWeather failed:", e.message);
        }
    }

    try {
        const payload = await fetchOpenMeteo(lat, lon);
        return await enrichWithHistoricalValidation(payload, lat, lon);
    } catch (e) {
        console.log("Open-Meteo failed:", e.message);
    }

    const payload = getMockWeather();
    return await enrichWithHistoricalValidation(payload, lat, lon);
}

module.exports = {
    getWeatherPayload,
    getWeatherValidationHistory,
    warmHistoricalValidationCache,
    generateWeatherTips,
    getMockWeather,
    DEFAULT_LAT,
    DEFAULT_LON
};
