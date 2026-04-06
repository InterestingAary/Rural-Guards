const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"]);
const IGNORED_DIR_NAMES = new Set(["plantvillage", "__macosx", ".git", ".ipynb_checkpoints"]);

function parseArgs(argv) {
    const out = {
        dataset: path.resolve(__dirname, "../dataset"),
        modelScript: path.resolve(__dirname, "predict.py"),
        classesFile: path.resolve(__dirname, "classes.json"),
        pythonBin: process.env.PYTHON_BIN || "python",
        holdoutRatio: 0.2,
        maxSamples: 200,
        deduplicate: true,
        reportOut: path.resolve(__dirname, "live_scan_report.json"),
        seed: 42,
        cropType: "all"
    };

    for (let i = 2; i < argv.length; i += 1) {
        const key = String(argv[i] || "");
        const value = argv[i + 1];
        if (key === "--dataset" && value) {
            out.dataset = path.resolve(process.cwd(), value);
            i += 1;
            continue;
        }
        if (key === "--model-script" && value) {
            out.modelScript = path.resolve(process.cwd(), value);
            i += 1;
            continue;
        }
        if (key === "--python" && value) {
            out.pythonBin = String(value);
            i += 1;
            continue;
        }
        if (key === "--classes" && value) {
            out.classesFile = path.resolve(process.cwd(), value);
            i += 1;
            continue;
        }
        if (key === "--holdout-ratio" && value) {
            const r = Number(value);
            if (Number.isFinite(r) && r > 0 && r < 1) out.holdoutRatio = r;
            i += 1;
            continue;
        }
        if (key === "--max-samples" && value) {
            const n = Number(value);
            if (Number.isFinite(n) && n > 0) out.maxSamples = Math.floor(n);
            i += 1;
            continue;
        }
        if (key === "--deduplicate" && value) {
            out.deduplicate = String(value).toLowerCase() !== "false";
            i += 1;
            continue;
        }
        if (key === "--report-out" && value) {
            out.reportOut = path.resolve(process.cwd(), value);
            i += 1;
            continue;
        }
        if (key === "--seed" && value) {
            const s = Number(value);
            if (Number.isFinite(s)) out.seed = Math.floor(s);
            i += 1;
            continue;
        }
        if (key === "--crop-type" && value) {
            out.cropType = String(value).trim().toLowerCase() || "all";
            i += 1;
            continue;
        }
    }

    return out;
}

function hashText(text) {
    return crypto.createHash("sha256").update(text).digest("hex");
}

function hashFile(filePath) {
    const data = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
}

function isImageFile(fileName) {
    return IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function canonicalizeClassName(name) {
    const className = String(name || "").trim();
    const low = className.toLowerCase();

    if (low.includes("corn") && low.includes("cercospora")) return "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot";
    if (low.includes("corn") && low.includes("common_rust")) return "Corn_(maize)___Common_rust_";
    if (low.includes("corn") && low.includes("northern")) return "Corn_(maize)___Northern_Leaf_Blight";
    if (low.includes("corn") && low.includes("healthy")) return "Corn_(maize)___healthy";

    if (low.includes("pepper") && low.includes("bacterial")) return "Pepper__bell___Bacterial_spot";
    if (low.includes("pepper") && low.includes("healthy")) return "Pepper__bell___healthy";

    if (low.includes("potato") && low.includes("early_blight")) return "Potato___Early_blight";
    if (low.includes("potato") && low.includes("late_blight")) return "Potato___Late_blight";
    if (low.includes("potato") && low.includes("healthy")) return "Potato___healthy";

    if (low.includes("tomato") && low.includes("bacterial")) return "Tomato___Bacterial_spot";
    if (low.includes("tomato") && low.includes("early_blight")) return "Tomato___Early_blight";
    if (low.includes("tomato") && low.includes("late_blight")) return "Tomato___Late_blight";
    if (low.includes("tomato") && low.includes("leaf_mold")) return "Tomato___Leaf_Mold";
    if (low.includes("tomato") && low.includes("septoria")) return "Tomato___Septoria_leaf_spot";
    if (low.includes("tomato") && low.includes("spider_mites")) return "Tomato___Spider_mites_Two_spotted_spider_mite";
    if (low.includes("tomato") && low.includes("target_spot")) return "Tomato___Target_Spot";
    if (low.includes("tomato") && low.includes("mosaic_virus")) return "Tomato___Tomato_mosaic_virus";
    if (low.includes("tomato") && (low.includes("yellowleaf") || low.includes("yellow_leaf"))) {
        return "Tomato___Tomato_Yellow_Leaf_Curl_Virus";
    }
    if (low.includes("tomato") && low.includes("healthy")) return "Tomato___healthy";

    return className;
}

function detectClassFromPathParts(parts) {
    for (let i = parts.length - 1; i >= 0; i -= 1) {
        const token = String(parts[i] || "").trim();
        if (!token) continue;
        if (IGNORED_DIR_NAMES.has(token.toLowerCase())) continue;
        if (token.includes("___") || token.includes("__") || token.includes("_")) return canonicalizeClassName(token);
    }
    return null;
}

function collectDatasetRecords(datasetRoot) {
    const rows = [];

    function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            const fullPath = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (IGNORED_DIR_NAMES.has(e.name.toLowerCase())) continue;
                walk(fullPath);
                continue;
            }
            if (!e.isFile()) continue;
            if (!isImageFile(e.name)) continue;

            const relPath = path.relative(datasetRoot, fullPath);
            const parts = relPath.split(path.sep);
            parts.pop();
            const className = detectClassFromPathParts(parts);
            if (!className) continue;

            rows.push({
                filePath: fullPath,
                relPath,
                className
            });
        }
    }

    walk(datasetRoot);
    return rows;
}

function uniqueByHash(rows) {
    const seen = new Set();
    const out = [];
    let dropped = 0;

    for (const row of rows) {
        const h = hashFile(row.filePath);
        if (seen.has(h)) {
            dropped += 1;
            continue;
        }
        seen.add(h);
        out.push({ ...row, fileHash: h });
    }

    return { rows: out, dropped };
}

function assignHoldout(rows, holdoutRatio, seed) {
    const holdout = [];
    const trainLike = [];

    for (const row of rows) {
        const hv = hashText(`${seed}:${row.relPath}`).slice(0, 12);
        const bucket = parseInt(hv, 16) / 0xffffffffffff;
        if (bucket < holdoutRatio) holdout.push(row);
        else trainLike.push(row);
    }

    return { holdout, trainLike };
}

function pickDeterministicSample(rows, maxSamples, seed) {
    const scored = rows
        .map((r) => ({ r, score: hashText(`${seed}:sample:${r.relPath}`) }))
        .sort((a, b) => a.score.localeCompare(b.score));
    return scored.slice(0, Math.min(maxSamples, scored.length)).map((x) => x.r);
}

function loadSupportedClasses(classesFile) {
    if (!fs.existsSync(classesFile)) {
        return new Set();
    }
    try {
        const raw = JSON.parse(fs.readFileSync(classesFile, "utf-8"));
        const arr = Array.isArray(raw) ? raw : [];
        return new Set(arr.map((name) => canonicalizeClassName(name)));
    } catch (error) {
        return new Set();
    }
}

function runPredict(pythonBin, scriptPath, imagePath, cropType) {
    return new Promise((resolve, reject) => {
        execFile(pythonBin, [scriptPath, imagePath, cropType], { windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`predict.py failed for ${imagePath}: ${stderr || error.message}`));
                return;
            }
            const out = String(stdout || "");
            const lines = out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

            const diseaseLine = lines.find((line) => line.startsWith("Disease:"));
            const confLine = lines.find((line) => line.startsWith("Confidence:"));
            const altLine = lines.find((line) => line.startsWith("Next candidate:"));

            const disease = diseaseLine ? diseaseLine.replace(/^Disease:\s*/, "").trim() : "Unknown";
            const confidencePct = confLine ? Number(confLine.replace(/^Confidence:\s*/, "").replace("%", "").trim()) : null;

            resolve({
                disease,
                confidencePct: Number.isFinite(confidencePct) ? confidencePct : null,
                nextCandidate: altLine ? altLine.replace(/^Next candidate:\s*/, "").trim() : "",
                rawOutput: out
            });
        });
    });
}

async function evaluateSample(config, sampleRows, supportedClasses) {
    let correct = 0;
    let supportedTotal = 0;
    let supportedCorrect = 0;
    let unsupportedTotal = 0;
    let confidenceSum = 0;
    let confidenceCount = 0;
    const perClass = {};
    const mistakes = [];

    for (let i = 0; i < sampleRows.length; i += 1) {
        const row = sampleRows[i];
        const predicted = await runPredict(config.pythonBin, config.modelScript, row.filePath, config.cropType);
        const expected = row.className;
        const predClass = canonicalizeClassName(predicted.disease);
        const isCorrect = expected === predClass;
        const isSupportedExpected = supportedClasses.size === 0 || supportedClasses.has(expected);

        if (!perClass[expected]) {
            perClass[expected] = { total: 0, correct: 0 };
        }
        perClass[expected].total += 1;

        if (isSupportedExpected) {
            supportedTotal += 1;
        } else {
            unsupportedTotal += 1;
        }

        if (isCorrect) {
            correct += 1;
            perClass[expected].correct += 1;
            if (isSupportedExpected) supportedCorrect += 1;
        } else if (mistakes.length < 50) {
            mistakes.push({
                file: row.relPath,
                expected,
                expectedInModelClasses: isSupportedExpected,
                predicted: predClass,
                confidencePct: predicted.confidencePct,
                nextCandidate: predicted.nextCandidate
            });
        }

        if (Number.isFinite(predicted.confidencePct)) {
            confidenceSum += predicted.confidencePct;
            confidenceCount += 1;
        }

        if ((i + 1) % 20 === 0 || i + 1 === sampleRows.length) {
            console.log(`Evaluated ${i + 1}/${sampleRows.length}...`);
        }
    }

    const perClassAccuracy = Object.entries(perClass)
        .map(([className, stats]) => ({
            className,
            total: stats.total,
            correct: stats.correct,
            accuracyPct: stats.total > 0 ? Number(((100 * stats.correct) / stats.total).toFixed(2)) : null
        }))
        .sort((a, b) => b.total - a.total);

    return {
        total: sampleRows.length,
        correct,
        accuracyPct: sampleRows.length > 0 ? Number(((100 * correct) / sampleRows.length).toFixed(2)) : null,
        supportedTotal,
        supportedCorrect,
        supportedAccuracyPct: supportedTotal > 0 ? Number(((100 * supportedCorrect) / supportedTotal).toFixed(2)) : null,
        unsupportedTotal,
        avgConfidencePct: confidenceCount > 0 ? Number((confidenceSum / confidenceCount).toFixed(2)) : null,
        perClassAccuracy,
        mistakes
    };
}

async function main() {
    const config = parseArgs(process.argv);

    if (!fs.existsSync(config.dataset)) {
        throw new Error(`Dataset folder not found: ${config.dataset}`);
    }
    if (!fs.existsSync(config.modelScript)) {
        throw new Error(`Model script not found: ${config.modelScript}`);
    }

    const supportedClasses = loadSupportedClasses(config.classesFile);

    console.log("Live scan validation started...");
    console.log("Dataset:", config.dataset);
    console.log("Model script:", config.modelScript);
    console.log("Python:", config.pythonBin);
    console.log("Classes file:", config.classesFile, `(supported classes: ${supportedClasses.size})`);

    const allRecords = collectDatasetRecords(config.dataset);
    console.log("Discovered images:", allRecords.length);

    const dedup = config.deduplicate ? uniqueByHash(allRecords) : { rows: allRecords, dropped: 0 };
    const usableRows = dedup.rows;
    console.log("After deduplicate:", usableRows.length, "(dropped", dedup.dropped + ")");

    const split = assignHoldout(usableRows, config.holdoutRatio, config.seed);
    const holdoutRows = split.holdout;
    console.log("Holdout pool:", holdoutRows.length);

    if (!holdoutRows.length) {
        throw new Error("No holdout rows available; adjust holdout ratio");
    }

    const sampleRows = pickDeterministicSample(holdoutRows, config.maxSamples, config.seed);
    console.log("Sample size for live scan validation:", sampleRows.length);

    const startedAt = Date.now();
    const evalResult = await evaluateSample(config, sampleRows, supportedClasses);
    const elapsedSec = Number(((Date.now() - startedAt) / 1000).toFixed(1));

    const report = {
        generatedAt: new Date().toISOString(),
        config: {
            dataset: config.dataset,
            modelScript: config.modelScript,
            classesFile: config.classesFile,
            pythonBin: config.pythonBin,
            holdoutRatio: config.holdoutRatio,
            maxSamples: config.maxSamples,
            deduplicate: config.deduplicate,
            seed: config.seed,
            cropType: config.cropType
        },
        dataSummary: {
            totalRecords: allRecords.length,
            dedupDropped: dedup.dropped,
            usableRecords: usableRows.length,
            holdoutPool: holdoutRows.length,
            evaluatedSamples: sampleRows.length
        },
        result: {
            ...evalResult,
            elapsedSec
        }
    };

    fs.writeFileSync(config.reportOut, JSON.stringify(report, null, 2), "utf-8");

    console.log("\n=== Live Scan Validation Summary ===");
    console.log("Evaluated:", report.dataSummary.evaluatedSamples);
    console.log("Overall accuracy:", report.result.accuracyPct + "%");
    console.log("Supported-class accuracy:", report.result.supportedAccuracyPct + "%");
    console.log("Average confidence:", report.result.avgConfidencePct + "%");
    console.log("Report:", config.reportOut);
}

main().catch((error) => {
    console.error("Validation failed:", error.message);
    process.exit(1);
});
