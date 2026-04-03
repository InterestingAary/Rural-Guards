import os
import shutil

ds = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dataset"))
print("Fixing dataset structure...")

# Define EXACT canonical names for each unique disease / crop
canonical_names = {
    'Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot',
    'Corn_(maize)___Common_rust_',
    'Corn_(maize)___Northern_Leaf_Blight',
    'Corn_(maize)___healthy',
    'Potato___Early_blight',
    'Potato___Late_blight',
    'Potato___healthy',
    'Pepper__bell___Bacterial_spot',
    'Pepper__bell___healthy',
    'Tomato___Bacterial_spot',
    'Tomato___Early_blight',
    'Tomato___Late_blight',
    'Tomato___Leaf_Mold',
    'Tomato___Septoria_leaf_spot',
    'Tomato___Spider_mites_Two_spotted_spider_mite',
    'Tomato___Target_Spot',
    'Tomato___Tomato_mosaic_virus',
    'Tomato___Tomato_Yellow_Leaf_Curl_Virus',
    'Tomato___healthy'
}

folders = list(os.listdir(ds))
merged_count = 0

for folder in folders:
    path = os.path.join(ds, folder)
    if not os.path.isdir(path):
        continue
    
    if folder in canonical_names:
        print(f"✓ {folder}")
        continue
    
    # Map variants to canonical
    canonical = None
    if 'Corn' in folder and 'Cercospora' in folder:
        canonical = 'Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot'
    elif 'Corn' in folder and 'Common_rust' in folder:
        canonical = 'Corn_(maize)___Common_rust_'
    elif 'Corn' in folder and 'Northern' in folder:
        canonical = 'Corn_(maize)___Northern_Leaf_Blight'
    elif 'Corn' in folder and 'healthy' in folder:
        canonical = 'Corn_(maize)___healthy'
    elif 'Tomato' in folder and 'Bacterial' in folder:
        canonical = 'Tomato___Bacterial_spot'
    elif 'Tomato' in folder and 'Early_blight' in folder:
        canonical = 'Tomato___Early_blight'
    elif 'Tomato' in folder and 'Late_blight' in folder:
        canonical = 'Tomato___Late_blight'
    elif 'Tomato' in folder and 'Leaf_Mold' in folder:
        canonical = 'Tomato___Leaf_Mold'
    elif 'Tomato' in folder and 'Septoria' in folder:
        canonical = 'Tomato___Septoria_leaf_spot'
    elif 'Tomato' in folder and 'Spider_mites' in folder:
        canonical = 'Tomato___Spider_mites_Two_spotted_spider_mite'
    elif 'Target_Spot' in folder:
        canonical = 'Tomato___Target_Spot'
    elif 'mosaic_virus' in folder:
        canonical = 'Tomato___Tomato_mosaic_virus'
    elif 'YellowLeaf' in folder or 'Yellow_Leaf' in folder:
        canonical = 'Tomato___Tomato_Yellow_Leaf_Curl_Virus'
    elif 'Tomato' in folder and 'healthy' in folder:
        canonical = 'Tomato___healthy'
    
    if canonical and canonical != folder:
        print(f"→ Merge {folder} into {canonical}")
        canonical_path = os.path.join(ds, canonical)
        
        if not os.path.exists(canonical_path):
            os.makedirs(canonical_path)
        
        for file in os.listdir(path):
            src = os.path.join(path, file)
            dst = os.path.join(canonical_path, file)
            if not os.path.exists(dst):
                shutil.move(src, dst)
        
        shutil.rmtree(path)
        merged_count += 1

print(f"\nMerged {merged_count} variant folders")
print("\nFinal dataset:")
final = sorted([f for f in os.listdir(ds) if os.path.isdir(os.path.join(ds, f))])
for f in final:
    c = len(os.listdir(os.path.join(ds, f)))
    print(f"  {f}: {c} images")
