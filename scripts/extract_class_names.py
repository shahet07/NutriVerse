"""
Extract the EXACT class order that your model was trained with.
This replicates how TensorFlow/Keras ImageDataGenerator orders classes.
"""

import os
import json
import numpy as np
from PIL import Image
import tensorflow as tf


MODEL_PATH = r"Src\Image_classifier\models\efficientb4_best.h5"
DATASET_PATH = r"D:\Projects\NutriSense-AI\Dataset\Images"  
IMG_SIZE = 256

# STEP 1: Get class names in the EXACT order TensorFlow uses

print("="*60)
print(" EXTRACTING CLASS ORDER")
print("="*60)

# TensorFlow's ImageDataGenerator uses sorted() on class folders
class_folders = []
for item in os.listdir(DATASET_PATH):
    item_path = os.path.join(DATASET_PATH, item)
    if os.path.isdir(item_path):
        # Check if folder has images
        has_images = any(f.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.bmp')) 
                        for f in os.listdir(item_path))
        if has_images:
            class_folders.append(item)

class_names = sorted(class_folders)

print(f"\n Found {len(class_names)} classes (alphabetically sorted):\n")
for idx, name in enumerate(class_names):
    print(f"   [{idx:3d}] {name}")


# STEP 2: Save to JSON file for main.py to use

output_file = "class_names.json"
with open(output_file, 'w') as f:
    json.dump(class_names, f, indent=2)

print(f"\n Saved class names to: {output_file}")


# STEP 3: Verify with the model

print("\n" + "="*60)
print(" TESTING MODEL PREDICTIONS")
print("="*60)

try:
    model = tf.keras.models.load_model(MODEL_PATH)
    print(f" Model loaded: {MODEL_PATH}")
    print(f"   Input shape: {model.input_shape}")
    print(f"   Output classes: {model.output_shape[1]}")
    
    if model.output_shape[1] != len(class_names):
        print(f"\n WARNING: Model outputs {model.output_shape[1]} classes but found {len(class_names)} folders!")
        print(f"   Some folders might be empty or have no valid images.")
    
    # Test with a random image from the first class
    first_class = class_names[0]
    first_class_path = os.path.join(DATASET_PATH, first_class)
    
    # Find first valid image
    test_image = None
    for f in os.listdir(first_class_path):
        if f.lower().endswith(('.jpg', '.jpeg', '.png')):
            test_image = os.path.join(first_class_path, f)
            break
    
    if test_image:
        print(f"\n Testing with image from class: {first_class}")
        print(f"   Image: {os.path.basename(test_image)}")
        
        # Predict
        img = Image.open(test_image)
        img = img.convert('RGB')
        img = img.resize((IMG_SIZE, IMG_SIZE))
        img_array = np.array(img) / 255.0
        img_array = np.expand_dims(img_array, axis=0)
        
        predictions = model.predict(img_array, verbose=0)
        predicted_idx = np.argmax(predictions[0])
        confidence = predictions[0][predicted_idx]
        
        print(f"\n   Predicted index: {predicted_idx}")
        print(f"   Predicted class: {class_names[predicted_idx]}")
        print(f"   Confidence: {confidence:.2%}")
        
        if predicted_idx == 0:
            print(f"\n    GOOD! Model correctly predicted index 0 for '{first_class}'")
        else:
            print(f"\n    UNEXPECTED! Model predicted index {predicted_idx} ('{class_names[predicted_idx]}')")
            print(f"   Expected index 0 ('{first_class}')")
        
        # Show top 5
        print(f"\n   Top 5 predictions:")
        top5_idx = np.argsort(predictions[0])[-5:][::-1]
        for idx in top5_idx:
            print(f"      [{idx:3d}] {class_names[idx]:30s} {predictions[0][idx]:6.2%}")
    
except Exception as e:
    print(f" Error testing model: {e}")
    import traceback
    traceback.print_exc()


# STEP 4: Generate code for main.py

print("\n" + "="*60)
print(" CODE FOR main.py")
print("="*60)

print("""
# Add this near the top of main.py (after imports):

import json

# Load class names from file
with open('class_names.json', 'r') as f:
    CLASS_NAMES = json.load(f)

print(f" Loaded {len(CLASS_NAMES)} class names")
""")

print("\n" + "="*60)
print(" SUMMARY")
print("="*60)
print(f" Found {len(class_names)} classes")
print(f" Saved to: {output_file}")
print(f" First class: {class_names[0]}")
print(f" Last class: {class_names[-1]}")
print("\nNext steps:")
print("1. Copy 'class_names.json' to your project root")
print("2. Update main.py to load from this file")
print("3. Test with different images!")