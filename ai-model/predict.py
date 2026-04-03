import tensorflow as tf
import numpy as np
import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
model = tf.keras.models.load_model(os.path.join(BASE_DIR, "model.h5"))


def get_model_input_size(loaded_model):
    shape = getattr(loaded_model, "input_shape", None)
    if not shape or len(shape) < 4:
        return 160

    height = shape[1]
    width = shape[2]
    if isinstance(height, int) and isinstance(width, int) and height > 0 and width > 0:
        return int(min(height, width))
    return 160

if len(sys.argv) < 2:
    print("Error: Missing image path")
    sys.exit(1)

img_path = sys.argv[1]
crop_type = sys.argv[2].strip().lower() if len(sys.argv) > 2 else "all"

input_size = get_model_input_size(model)
img = tf.keras.utils.load_img(img_path, target_size=(input_size, input_size))
# Model already includes a Rescaling layer, so keep raw pixel range here.
img_array = tf.keras.utils.img_to_array(img)
img_array = np.expand_dims(img_array, axis=0)

prediction = model.predict(img_array)

classes_json = os.path.join(BASE_DIR, 'classes.json')
if os.path.exists(classes_json):
    import json
    with open(classes_json, 'r', encoding='utf-8') as f:
        classes = json.load(f)
else:
    classes = [
        "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot",
        "Corn_(maize)___Common_rust_",
        "Corn_(maize)___Northern_Leaf_Blight",
        "Corn_(maize)___healthy",
        "Potato___Early_blight",
        "Potato___Late_blight",
        "Potato___healthy",
        "Tomato___Bacterial_spot",
        "Tomato___Early_blight",
        "Tomato___Late_blight",
        "Tomato___Leaf_Mold",
        "Tomato___Septoria_leaf_spot",
        "Tomato___Spider_mites Two-spotted_spider_mite",
        "Tomato___Target_Spot",
        "Tomato___Tomato_Yellow_Leaf_Curl_Virus",
        "Tomato___Tomato_mosaic_virus",
        "Tomato___healthy"
    ]


def canonicalize_class_name(name):
    class_name = str(name or "").strip()
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


def class_to_crop(class_name):
    name = str(class_name or "")
    if name.startswith("Corn_(maize)"):
        return "corn"
    if name.startswith("Pepper__bell"):
        return "pepper_bell"
    if name.startswith("Potato___"):
        return "potato"
    if name.startswith("Tomato___"):
        return "tomato"
    if name.startswith("Apple___"):
        return "apple"
    if name.startswith("Blueberry___"):
        return "blueberry"
    if name.startswith("Cherry_(including_sour)"):
        return "cherry"
    if name.startswith("Grape___"):
        return "grape"
    if name.startswith("Orange___"):
        return "orange"
    if name.startswith("Peach___"):
        return "peach"
    if name.startswith("Raspberry___"):
        return "raspberry"
    if name.startswith("Soybean___"):
        return "soybean"
    if name.startswith("Squash___"):
        return "squash"
    return "other"


canonical_classes = [canonicalize_class_name(c) for c in classes]
allowed_crop_types = {
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
}
if crop_type not in allowed_crop_types:
    crop_type = "all"

all_probs = prediction[0]
candidate_indices = [
    i for i in range(min(len(canonical_classes), len(all_probs)))
    if crop_type == "all" or class_to_crop(canonical_classes[i]) == crop_type
]
filter_applied = crop_type != "all" and len(candidate_indices) > 0
if not candidate_indices:
    candidate_indices = [i for i in range(min(len(canonical_classes), len(all_probs)))]
sorted_candidates = sorted(candidate_indices, key=lambda i: all_probs[i], reverse=True)
top1 = sorted_candidates[0]
next1 = sorted_candidates[1] if len(sorted_candidates) > 1 else sorted_candidates[0]

if top1 < len(canonical_classes):
    disease = canonical_classes[top1]
else:
    disease = "Unknown"

alternate = canonical_classes[next1] if next1 < len(canonical_classes) else "Unknown"
top1_raw = float(all_probs[top1])
top2_raw = float(all_probs[next1])
if filter_applied:
    total = float(sum(float(all_probs[i]) for i in candidate_indices))
    confidence = (top1_raw / total) if total > 0 else top1_raw
    confidence_second = (top2_raw / total) if total > 0 else top2_raw
else:
    confidence = top1_raw
    confidence_second = top2_raw

solutions = {
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot": ("Remove infected leaves and apply fungicide", "Medium"),
    "Corn_(maize)___Common_rust_": ("Use rust-resistant varieties and fungicide", "Medium"),
    "Corn_(maize)___Northern_Leaf_Blight": ("Crop rotation and fungicide application", "High"),
    "Corn_(maize)___healthy": ("No disease detected", "Safe"),
    "Pepper__bell___Bacterial_spot": ("Use clean seed, avoid overhead watering, and apply copper-based spray", "Medium"),
    "Pepper__bell___healthy": ("No disease detected", "Safe"),
    "Potato___Early_blight": ("Remove infected leaves and apply copper fungicide", "Medium"),
    "Potato___Late_blight": ("Remove infected plants and spray fungicide", "High"),
    "Potato___healthy": ("No disease detected", "Safe"),
    "Tomato___Bacterial_spot": ("Use copper fungicide and improve air circulation", "Medium"),
    "Tomato___Early_blight": ("Apply fungicide and remove affected leaves", "Medium"),
    "Tomato___Late_blight": ("Remove infected plants immediately", "High"),
    "Tomato___Leaf_Mold": ("Improve ventilation and use fungicide", "Medium"),
    "Tomato___Septoria_leaf_spot": ("Remove lower leaves and apply fungicide", "Medium"),
    "Tomato___Spider_mites Two-spotted_spider_mite": ("Use insecticidal soap or neem oil", "Low"),
    "Tomato___Spider_mites_Two_spotted_spider_mite": ("Use insecticidal soap or neem oil", "Low"),
    "Tomato___Target_Spot": ("Fungicide application and crop rotation", "Medium"),
    "Tomato___Tomato_Yellow_Leaf_Curl_Virus": ("Remove infected plants and control whiteflies", "High"),
    "Tomato___Tomato_mosaic_virus": ("Remove infected plants and disinfect tools", "High"),
    "Tomato___healthy": ("No disease detected", "Safe")
}

solution, urgency = solutions.get(disease, ("Consult expert", "Unknown"))

if crop_type == "all":
    print("Crop filter: all")
elif filter_applied:
    print(f"Crop filter: {crop_type}")
else:
    print(f"Crop filter: {crop_type} requested but not found in model classes; fallback to all")

print(f"Disease: {disease}")
print(f"Confidence: {confidence*100:.2f}%")
print(f"Next candidate: {alternate} ({confidence_second*100:.2f}%)")

# With many similar-looking classes, softmax often spreads mass — low top % is common.
if confidence < 0.5:
    print(
        "Note: Low confidence — model is unsure. Use a sharp, well-lit photo of one affected "
        "leaf (fill the frame), or ask an expert."
    )
elif confidence < 0.65 and (confidence - confidence_second) < 0.15:
    print(
        "Note: Top two classes are close — try another angle or clearer leaf close-up."
    )
print(f"Solution: {solution}")
print(f"Urgency: {urgency}")