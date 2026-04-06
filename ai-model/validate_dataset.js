const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"]);
const IGNORED_DIR_NAMES = new Set(["plantvillage", "__macosx", ".git", ".ipynb_checkpoints"]);

function parseArgs(argv) {
    const out = {
        dataset: path.resolve(__dirname, "../dataset"),
        prepared: path.resolve(__dirname, "./prepared_dataset"),
        valSplit: 0.2,
        jsonOut: path.resolve(__dirname, "./dataset_validation_report.json")
    };

    for (let i = 2; i < argv.length; i += 1) {
        const arg = String(argv[i] || "");
        if (arg === "--dataset" && argv[i + 1]) {
            out.dataset = path.resolve(process.cwd(), argv[i + 1]);
            i += 1;
            continue;
        }
        if (arg === "--prepared" && argv[i + 1]) {
            out.prepared = path.resolve(process.cwd(), argv[i + 1]);
            i += 1;
            continue;
        }
        if (arg === "--val-split" && argv[i + 1]) {
            const v = Number(argv[i + 1]);
            if (Number.isFinite(v) && v > 0 && v < 1) out.valSplit = v;
            i += 1;
            continue;
        }
        if (arg === "--json-out" && argv[i + 1]) {
            out.jsonOut = path.resolve(process.cwd(), argv[i + 1]);
            i += 1;
            continue;
        }
    }

    return out;
}

function isImageFile(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
}

function normalizeClassName(name) {
    return String(name || "").trim();
}

function canonicalizeClassName(name) {
    const className = normalizeClassName(name);
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

function detectClassFromPath(pathParts) {
    for (let i = pathParts.length - 1; i >= 0; i -= 1) {
        const token = String(pathParts[i] || "").trim();
        if (!token) continue;
        if (IGNORED_DIR_NAMES.has(token.toLowerCase())) continue;
        if (token.includes("___")) return canonicalizeClassName(token);
    }

    for (let i = pathParts.length - 1; i >= 0; i -= 1) {
        const token = String(pathParts[i] || "").trim();
        if (!token) continue;
        if (IGNORED_DIR_NAMES.has(token.toLowerCase())) continue;
        return canonicalizeClassName(token);
    }

    return null;
}

function listRecords(rootDir) {
    const records = [];

    function walk(currentDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                if (IGNORED_DIR_NAMES.has(entry.name.toLowerCase())) continue;
                walk(fullPath);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!isImageFile(entry.name)) continue;

            const rel = path.relative(rootDir, fullPath);
            const parts = rel.split(path.sep);
            parts.pop();
            const className = detectClassFromPath(parts);
            if (!className) continue;

            records.push({
                filePath: fullPath,
                relPath: rel,
                className,
                sizeBytes: fs.statSync(fullPath).size
            });
        }
    }

    walk(rootDir);
    return records;
}

function sha256File(filePath) {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(buf).digest("hex");
}

function computeClassCounts(records) {
    const counts = {};
    for (const r of records) {
        counts[r.className] = (counts[r.className] || 0) + 1;
    }
    return counts;
}

function findDuplicateHashes(records) {
    const groups = new Map();
    for (const r of records) {
        const hash = sha256File(r.filePath);
        if (!groups.has(hash)) groups.set(hash, []);
        groups.get(hash).push({
            relPath: r.relPath,
            className: r.className,
            sizeBytes: r.sizeBytes
        });
    }

    const duplicateGroups = [];
    for (const [hash, items] of groups.entries()) {
        if (items.length > 1) {
            duplicateGroups.push({ hash, count: items.length, items });
        }
    }
    return duplicateGroups;
}

function summarizeDuplicates(duplicateGroups) {
    let duplicateFiles = 0;
    let crossClassGroups = 0;
    let sameClassGroups = 0;

    for (const g of duplicateGroups) {
        duplicateFiles += g.count;
        const classes = new Set(g.items.map((x) => x.className));
        if (classes.size > 1) crossClassGroups += 1;
        else sameClassGroups += 1;
    }

    return {
        duplicateGroups: duplicateGroups.length,
        duplicateFiles,
        sameClassGroups,
        crossClassGroups
    };
}

function splitPreparedByFilename(preparedRoot, valSplit) {
    if (!fs.existsSync(preparedRoot)) {
        return { exists: false };
    }

    const classNames = fs.readdirSync(preparedRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b));

    const splitRows = [];
    for (const className of classNames) {
        const classDir = path.join(preparedRoot, className);
        const files = fs.readdirSync(classDir)
            .filter((name) => isImageFile(name))
            .sort((a, b) => a.localeCompare(b));

        const valCount = Math.floor(files.length * valSplit);
        const valSet = new Set(files.slice(0, valCount));

        for (const name of files) {
            splitRows.push({
                className,
                split: valSet.has(name) ? "val" : "train",
                filePath: path.join(classDir, name),
                relPath: path.join(className, name)
            });
        }
    }

    return {
        exists: true,
        rows: splitRows,
        classCount: classNames.length
    };
}

function findLeakageByHash(splitRows) {
    const byHash = new Map();
    for (const row of splitRows) {
        const hash = sha256File(row.filePath);
        if (!byHash.has(hash)) byHash.set(hash, []);
        byHash.get(hash).push({
            split: row.split,
            className: row.className,
            relPath: row.relPath
        });
    }

    const leakageGroups = [];
    for (const [hash, items] of byHash.entries()) {
        const splitSet = new Set(items.map((x) => x.split));
        if (splitSet.size > 1) {
            leakageGroups.push({ hash, count: items.length, items });
        }
    }
    return leakageGroups;
}

function topN(arr, n) {
    return arr.slice(0, Math.max(0, n));
}

function main() {
    const args = parseArgs(process.argv);

    if (!fs.existsSync(args.dataset)) {
        console.error("Dataset folder not found:", args.dataset);
        process.exit(1);
    }

    console.log("Dataset validation started...");
    console.log("Dataset:", args.dataset);
    console.log("Prepared:", args.prepared);
    console.log("Validation split:", args.valSplit);

    const datasetRecords = listRecords(args.dataset);
    const classCounts = computeClassCounts(datasetRecords);
    const classEntries = Object.entries(classCounts).sort((a, b) => b[1] - a[1]);

    const duplicateGroups = findDuplicateHashes(datasetRecords);
    const duplicateSummary = summarizeDuplicates(duplicateGroups);

    const preparedSplit = splitPreparedByFilename(args.prepared, args.valSplit);
    let leakageSummary = {
        preparedExists: preparedSplit.exists,
        leakageGroups: 0,
        leakageFiles: 0,
        sampleLeakage: []
    };

    if (preparedSplit.exists) {
        const leakageGroups = findLeakageByHash(preparedSplit.rows);
        leakageSummary = {
            preparedExists: true,
            leakageGroups: leakageGroups.length,
            leakageFiles: leakageGroups.reduce((sum, g) => sum + g.count, 0),
            sampleLeakage: topN(
                leakageGroups.map((g) => ({
                    hash: g.hash,
                    count: g.count,
                    files: topN(g.items, 4)
                })),
                10
            )
        };
    }

    const report = {
        generatedAt: new Date().toISOString(),
        dataset: args.dataset,
        prepared: args.prepared,
        valSplit: args.valSplit,
        totals: {
            images: datasetRecords.length,
            classes: classEntries.length,
            minClassImages: classEntries.length ? classEntries[classEntries.length - 1][1] : 0,
            maxClassImages: classEntries.length ? classEntries[0][1] : 0
        },
        classCounts: classEntries.map(([name, count]) => ({ className: name, count })),
        duplicates: {
            ...duplicateSummary,
            sampleGroups: topN(
                duplicateGroups
                    .sort((a, b) => b.count - a.count)
                    .map((g) => ({
                        hash: g.hash,
                        count: g.count,
                        classes: Array.from(new Set(g.items.map((x) => x.className))),
                        files: topN(g.items, 4)
                    })),
                20
            )
        },
        splitLeakage: leakageSummary
    };

    fs.writeFileSync(args.jsonOut, JSON.stringify(report, null, 2), "utf-8");

    console.log("\n=== Dataset Validation Summary ===");
    console.log("Images:", report.totals.images);
    console.log("Classes:", report.totals.classes);
    console.log("Class size range:", report.totals.minClassImages, "to", report.totals.maxClassImages);
    console.log("Duplicate groups:", report.duplicates.duplicateGroups);
    console.log("Cross-class duplicate groups:", report.duplicates.crossClassGroups);
    console.log("Prepared split leakage groups:", report.splitLeakage.leakageGroups);
    console.log("Report written:", args.jsonOut);
}

main();
