import argparse
import hashlib
import json
import math
import os
import random
import shutil

import tensorflow as tf
from tensorflow.keras.preprocessing.image import ImageDataGenerator

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
IGNORED_DIR_NAMES = {"plantvillage", "__macosx", ".git", ".ipynb_checkpoints"}

CANONICAL_CLASS_NAMES = {
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot",
    "Corn_(maize)___Common_rust_",
    "Corn_(maize)___Northern_Leaf_Blight",
    "Corn_(maize)___healthy",
    "Potato___Early_blight",
    "Potato___Late_blight",
    "Potato___healthy",
    "Pepper__bell___Bacterial_spot",
    "Pepper__bell___healthy",
    "Tomato___Bacterial_spot",
    "Tomato___Early_blight",
    "Tomato___Late_blight",
    "Tomato___Leaf_Mold",
    "Tomato___Septoria_leaf_spot",
    "Tomato___Spider_mites_Two_spotted_spider_mite",
    "Tomato___Target_Spot",
    "Tomato___Tomato_mosaic_virus",
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus",
    "Tomato___healthy",
}


def parse_args():
    parser = argparse.ArgumentParser(description="Advanced training for Rural Guards crop disease model")
    parser.add_argument("--dataset", default="../dataset", help="Path to source dataset root")
    parser.add_argument("--prepared", default="./prepared_dataset", help="Temporary flattened training dataset")
    parser.add_argument("--img-size", type=int, default=160)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument("--min-images-per-class", type=int, default=25)
    parser.add_argument("--max-images-per-class", type=int, default=0, help="Cap samples per class (0 = no cap)")
    parser.add_argument(
        "--focus-crops",
        default="",
        help="Comma-separated crop keys to keep (e.g. corn,pepper_bell,potato,tomato). Empty = all crops"
    )
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def is_image_file(filename):
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_EXTENSIONS


def normalize_class_name(name):
    return str(name).strip().replace(" ", " ")


def canonicalize_class_name(name):
    class_name = normalize_class_name(name)
    if class_name in CANONICAL_CLASS_NAMES:
        return class_name

    low = class_name.lower()

    if "corn" in low and "cercospora" in low:
        return "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot"
    if "corn" in low and "common_rust" in low:
        return "Corn_(maize)___Common_rust_"
    if "corn" in low and "northern" in low:
        return "Corn_(maize)___Northern_Leaf_Blight"
    if "corn" in low and "healthy" in low:
        return "Corn_(maize)___healthy"

    if "pepper" in low and "bacterial" in low:
        return "Pepper__bell___Bacterial_spot"
    if "pepper" in low and "healthy" in low:
        return "Pepper__bell___healthy"

    if "potato" in low and "early_blight" in low:
        return "Potato___Early_blight"
    if "potato" in low and "late_blight" in low:
        return "Potato___Late_blight"
    if "potato" in low and "healthy" in low:
        return "Potato___healthy"

    if "tomato" in low and "bacterial" in low:
        return "Tomato___Bacterial_spot"
    if "tomato" in low and "early_blight" in low:
        return "Tomato___Early_blight"
    if "tomato" in low and "late_blight" in low:
        return "Tomato___Late_blight"
    if "tomato" in low and "leaf_mold" in low:
        return "Tomato___Leaf_Mold"
    if "tomato" in low and "septoria" in low:
        return "Tomato___Septoria_leaf_spot"
    if "tomato" in low and "spider_mites" in low:
        return "Tomato___Spider_mites_Two_spotted_spider_mite"
    if "tomato" in low and "target_spot" in low:
        return "Tomato___Target_Spot"
    if "tomato" in low and "mosaic_virus" in low:
        return "Tomato___Tomato_mosaic_virus"
    if "tomato" in low and ("yellowleaf" in low or "yellow_leaf" in low):
        return "Tomato___Tomato_Yellow_Leaf_Curl_Virus"
    if "tomato" in low and "healthy" in low:
        return "Tomato___healthy"

    return class_name


def class_to_crop_token(class_name):
    name = str(class_name or "").strip()
    if name.startswith("Corn_(maize)"):
        return "corn"
    if name.startswith("Pepper__bell"):
        return "pepper_bell"
    if name.startswith("Potato___"):
        return "potato"
    if name.startswith("Tomato___"):
        return "tomato"
    if "___" in name:
        token = name.split("___")[0]
    else:
        token = name.split("_")[0]
    return (
        token.lower()
        .replace(" ", "_")
        .replace("(", "")
        .replace(")", "")
        .replace("-", "_")
    )


def parse_focus_crops(raw_value):
    text = str(raw_value or "").strip()
    if not text:
        return set()
    return {
        part.strip().lower()
        for part in text.split(",")
        if part.strip()
    }


def detect_class_dir_from_path(path_parts):
    for part in reversed(path_parts):
        token = str(part).strip()
        if not token:
            continue
        low = token.lower()
        if low in IGNORED_DIR_NAMES:
            continue
        if "___" in token:
            return normalize_class_name(token)
    # Fallback: use nearest non-ignored parent if no PlantVillage-style class marker exists.
    for part in reversed(path_parts):
        token = str(part).strip()
        if token and token.lower() not in IGNORED_DIR_NAMES:
            return normalize_class_name(token)
    return None


def collect_dataset_records(dataset_root):
    records = []
    for root, _, files in os.walk(dataset_root):
        rel_root = os.path.relpath(root, dataset_root)
        path_parts = [] if rel_root == "." else rel_root.split(os.sep)

        for name in files:
            if not is_image_file(name):
                continue
            class_name = detect_class_dir_from_path(path_parts)
            if not class_name:
                continue
            class_name = canonicalize_class_name(class_name)
            if class_name.lower() in IGNORED_DIR_NAMES:
                continue
            src_path = os.path.join(root, name)
            records.append((src_path, class_name))
    return records


def prepare_training_directory(records, prepared_root, min_images_per_class, max_images_per_class, seed):
    if os.path.exists(prepared_root):
        shutil.rmtree(prepared_root)
    os.makedirs(prepared_root, exist_ok=True)

    by_class = {}
    for src_path, class_name in records:
        by_class.setdefault(class_name, []).append(src_path)

    kept = {}
    dropped = {}
    dedup_dropped = {}
    for class_name, paths in by_class.items():
        unique_paths = []
        seen_hashes = set()
        for src_path in paths:
            try:
                with open(src_path, "rb") as f:
                    content_hash = hashlib.sha256(f.read()).hexdigest()
            except Exception:
                # If hashing fails for a file, keep it so training does not silently lose data.
                unique_paths.append(src_path)
                continue

            if content_hash in seen_hashes:
                dedup_dropped[class_name] = dedup_dropped.get(class_name, 0) + 1
                continue
            seen_hashes.add(content_hash)
            unique_paths.append(src_path)

        paths = unique_paths
        if len(paths) < min_images_per_class:
            dropped[class_name] = len(paths)
        else:
            if max_images_per_class and max_images_per_class > 0 and len(paths) > max_images_per_class:
                random.Random(seed).shuffle(paths)
                kept[class_name] = paths[:max_images_per_class]
            else:
                kept[class_name] = paths

    for class_name, paths in kept.items():
        class_dir = os.path.join(prepared_root, class_name)
        os.makedirs(class_dir, exist_ok=True)

        for idx, src_path in enumerate(paths):
            ext = os.path.splitext(src_path)[1].lower()
            stem_hash = hashlib.md5(src_path.encode("utf-8")).hexdigest()[:12]
            dst_name = f"{idx:06d}_{stem_hash}{ext}"
            dst_path = os.path.join(class_dir, dst_name)

            try:
                os.link(src_path, dst_path)
            except Exception:
                shutil.copy2(src_path, dst_path)

    return kept, dropped, dedup_dropped


def build_model(num_classes, img_size):
    base = tf.keras.applications.MobileNetV2(
        input_shape=(img_size, img_size, 3),
        include_top=False,
        weights="imagenet"
    )
    base.trainable = False

    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(img_size, img_size, 3)),
        tf.keras.layers.Rescaling(1.0 / 255.0),
        base,
        tf.keras.layers.GlobalAveragePooling2D(),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.Dropout(0.35),
        tf.keras.layers.Dense(256, activation="relu"),
        tf.keras.layers.Dropout(0.25),
        tf.keras.layers.Dense(num_classes, activation="softmax")
    ])

    return model, base


def compute_class_weights(generator):
    counts = {}
    for class_idx in generator.classes:
        counts[class_idx] = counts.get(class_idx, 0) + 1

    total = sum(counts.values())
    num_classes = len(counts)
    weights = {}
    for idx, count in counts.items():
        weights[idx] = total / (num_classes * count)
    return weights


def main():
    args = parse_args()
    random.seed(args.seed)
    tf.random.set_seed(args.seed)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    dataset_root = os.path.abspath(os.path.join(base_dir, args.dataset))
    prepared_root = os.path.abspath(os.path.join(base_dir, args.prepared))

    print("Current folder:", os.getcwd())
    print("Dataset path:", dataset_root)
    print("Dataset exists:", os.path.exists(dataset_root))

    if not os.path.exists(dataset_root):
        raise FileNotFoundError(f"Dataset folder not found: {dataset_root}")

    print("Collecting images from nested dataset folders...")
    records = collect_dataset_records(dataset_root)
    print(f"Discovered image records: {len(records)}")

    focus_crops = parse_focus_crops(args.focus_crops)
    if focus_crops:
        before = len(records)
        records = [
            (src_path, class_name)
            for (src_path, class_name) in records
            if class_to_crop_token(class_name) in focus_crops
        ]
        print(f"Applied focus crops: {sorted(focus_crops)}")
        print(f"Records after crop focus filter: {len(records)} (from {before})")

    kept, dropped, dedup_dropped = prepare_training_directory(
        records,
        prepared_root,
        args.min_images_per_class,
        args.max_images_per_class,
        args.seed
    )
    print(f"Prepared dataset classes: {len(kept)}")
    if dedup_dropped:
        print("Removed exact duplicate images:", dedup_dropped)
    if dropped:
        print("Dropped small classes:", dropped)

    if len(kept) < 2:
        raise RuntimeError("Need at least 2 classes with enough images to train")

    train_datagen = ImageDataGenerator(
        validation_split=args.val_split,
        rotation_range=20,
        width_shift_range=0.15,
        height_shift_range=0.15,
        shear_range=0.12,
        zoom_range=0.2,
        horizontal_flip=True,
        fill_mode="nearest"
    )
    val_datagen = ImageDataGenerator(validation_split=args.val_split)

    train_data = train_datagen.flow_from_directory(
        prepared_root,
        target_size=(args.img_size, args.img_size),
        batch_size=args.batch_size,
        class_mode="categorical",
        subset="training",
        seed=args.seed,
        shuffle=True
    )
    val_data = val_datagen.flow_from_directory(
        prepared_root,
        target_size=(args.img_size, args.img_size),
        batch_size=args.batch_size,
        class_mode="categorical",
        subset="validation",
        seed=args.seed,
        shuffle=False
    )

    model, base = build_model(train_data.num_classes, args.img_size)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="categorical_crossentropy",
        metrics=["accuracy"]
    )

    class_weights = compute_class_weights(train_data)
    print("Class weights:", class_weights)

    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True),
        tf.keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=2, min_lr=1e-6),
        tf.keras.callbacks.ModelCheckpoint(os.path.join(base_dir, "model.h5"), monitor="val_accuracy", save_best_only=True)
    ]

    stage1_epochs = max(2, math.ceil(args.epochs * 0.4))
    stage2_epochs = max(1, args.epochs - stage1_epochs)

    print(f"Stage 1 training (frozen backbone) for {stage1_epochs} epochs...")
    model.fit(
        train_data,
        validation_data=val_data,
        epochs=stage1_epochs,
        callbacks=callbacks,
        class_weight=class_weights
    )

    print(f"Stage 2 fine-tuning (last MobileNetV2 layers) for {stage2_epochs} epochs...")
    base.trainable = True
    for layer in base.layers[:-40]:
        layer.trainable = False

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-4),
        loss="categorical_crossentropy",
        metrics=["accuracy"]
    )

    model.fit(
        train_data,
        validation_data=val_data,
        epochs=stage1_epochs + stage2_epochs,
        initial_epoch=stage1_epochs,
        callbacks=callbacks,
        class_weight=class_weights
    )

    print("Evaluating model...")
    val_loss, val_acc = model.evaluate(val_data)
    print(f"Validation accuracy: {val_acc:.4f}")

    classes = [None] * len(train_data.class_indices)
    for name, idx in train_data.class_indices.items():
        classes[idx] = name

    classes_path = os.path.join(base_dir, "classes.json")
    with open(classes_path, "w", encoding="utf-8") as f:
        json.dump(classes, f, ensure_ascii=False, indent=2)
    print("Saved classes.json with", len(classes), "classes")

    model.save(os.path.join(base_dir, "model.h5"))
    print("Model saved as model.h5")


if __name__ == "__main__":
    main()