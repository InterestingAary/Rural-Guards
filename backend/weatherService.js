const axios = require("axios");

const DEFAULT_LAT = 15.9129;
const DEFAULT_LON = 79.74;
const LOCATION_LABEL = "Andhra Pradesh (Central)";

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
            return await fetchOpenWeather(lat, lon, apiKey);
        } catch (e) {
            console.log("OpenWeather failed:", e.message);
        }
    }

    try {
        return await fetchOpenMeteo(lat, lon);
    } catch (e) {
        console.log("Open-Meteo failed:", e.message);
    }

    return getMockWeather();
}

module.exports = {
    getWeatherPayload,
    generateWeatherTips,
    getMockWeather,
    DEFAULT_LAT,
    DEFAULT_LON
};
