"""
Dataset Cleaning Script for NutriSense-AI
==========================================
Cleans:
  1. Final_unified_dataset.csv   â†’ recipes with nutrition
  2. OFF_Indian_Products.csv     â†’ packaged Indian food products
"""

import pandas as pd
import numpy as np
from pathlib import Path

RAW_RECIPES   = Path("Dataset/processed/Final_unified_dataset.csv")
RAW_PRODUCTS  = Path("Dataset/processed/OFF_Indian_Products.csv")
OUT_DIR       = Path("Dataset/processed")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# 1. RECIPE DATASET
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("=" * 60)
print("Cleaning RECIPE dataset â€¦")
df_r = pd.read_csv(RAW_RECIPES)
print(f"  Original shape : {df_r.shape}")

RECIPE_KEEP = [
    # Identity / description
    "recipe_original",
    "final_food_name",
    "Cuisine",
    "TotalTimeInMins",
    # Text content
    "TranslatedIngredients",
    "Cleaned-Ingredients",
    "TranslatedInstructions",
    # Core macros
    "Calories (kcal)",
    "Carbohydrates (g)",
    "Protein (g)",
    "Fats (g)",
    "Free Sugar (g)",
    "Fibre (g)",
    # Micronutrients
    "Sodium (mg)",
    "Calcium (mg)",
    "Iron (mg)",
    "Vitamin C (mg)",
    "Folate (Âµg)",
]

# Keep only columns that actually exist
RECIPE_KEEP = [c for c in RECIPE_KEEP if c in df_r.columns]

df_r_clean = df_r[RECIPE_KEEP].copy()

# Rename for clarity
df_r_clean.rename(columns={
    "recipe_original"      : "original_name",
    "final_food_name"      : "food_name",
    "TotalTimeInMins"      : "total_time_mins",
    "TranslatedIngredients": "ingredients",
    "Cleaned-Ingredients"  : "ingredients_clean",
    "TranslatedInstructions": "instructions",
}, inplace=True)

# Drop exact duplicates
df_r_clean.drop_duplicates(subset=["food_name"], keep="first", inplace=True)

# Reset index
df_r_clean.reset_index(drop=True, inplace=True)

print(f"  Cleaned shape  : {df_r_clean.shape}")
print(f"  Columns kept   : {list(df_r_clean.columns)}")
print(f"  Null summary:\n{df_r_clean.isnull().sum().to_string()}")

out_r = OUT_DIR / "recipes_clean.csv"
df_r_clean.to_csv(out_r, index=False)
print(f"  Saved â†’ {out_r}")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# 2. PRODUCTS DATASET (Open Food Facts â€“ Indian products)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("\n" + "=" * 60)
print("Cleaning PRODUCTS dataset â€¦")
df_p = pd.read_csv(RAW_PRODUCTS, low_memory=False)
print(f"  Original shape : {df_p.shape}")

PRODUCT_KEEP = [
    # Identity
    "code",                   # barcode
    "product_name",
    "brands",
    "generic_name",
    "quantity",
    "serving_size",
    "serving_quantity",       # numeric serving size in grams
    # Categories / grouping
    "categories_en",
    "pnns_groups_1",          # broad food group (Beverages, Cereals â€¦)
    "pnns_groups_2",          # narrower food group
    "nova_group",             # processing level 1-4
    "nutriscore_grade",       # A-E health score
    "environmental_score_grade",
    # Ingredients & allergens
    "ingredients_text",
    "allergens_en",
    "traces_en",
    "additives_en",
    # Images (keeping for reference even if broken)
    "image_url",
    "image_small_url",
    "image_nutrition_url",
    "image_ingredients_url",
    # Core nutrition per 100 g
    "energy-kcal_100g",
    "fat_100g",
    "saturated-fat_100g",
    "trans-fat_100g",
    "carbohydrates_100g",
    "sugars_100g",
    "fiber_100g",
    "proteins_100g",
    "salt_100g",
    "sodium_100g",
    # Key micronutrients
    "calcium_100g",
    "iron_100g",
    "vitamin-c_100g",
    "vitamin-a_100g",
    "potassium_100g",
    "magnesium_100g",
    "zinc_100g",
    "vitamin-b12_100g",
    "vitamin-d_100g",
    "folates_100g",
]

# Keep only columns that actually exist in this export
PRODUCT_KEEP = [c for c in PRODUCT_KEEP if c in df_p.columns]

df_p_clean = df_p[PRODUCT_KEEP].copy()

# Rename for consistency
df_p_clean.rename(columns={
    "code"                    : "barcode",
    "energy-kcal_100g"        : "calories_100g",
    "fat_100g"                : "fat_g_100g",
    "saturated-fat_100g"      : "saturated_fat_g_100g",
    "trans-fat_100g"          : "trans_fat_g_100g",
    "carbohydrates_100g"      : "carbohydrates_g_100g",
    "sugars_100g"             : "sugars_g_100g",
    "fiber_100g"              : "fiber_g_100g",
    "proteins_100g"           : "proteins_g_100g",
    "salt_100g"               : "salt_g_100g",
    "sodium_100g"             : "sodium_mg_100g",
    "calcium_100g"            : "calcium_mg_100g",
    "iron_100g"               : "iron_mg_100g",
    "vitamin-c_100g"          : "vitamin_c_mg_100g",
    "vitamin-a_100g"          : "vitamin_a_ug_100g",
    "potassium_100g"          : "potassium_mg_100g",
    "magnesium_100g"          : "magnesium_mg_100g",
    "zinc_100g"               : "zinc_mg_100g",
    "vitamin-b12_100g"        : "vitamin_b12_ug_100g",
    "vitamin-d_100g"          : "vitamin_d_ug_100g",
    "folates_100g"            : "folate_ug_100g",
}, inplace=True)

# Drop rows where both product_name AND barcode are null
df_p_clean = df_p_clean[
    ~(df_p_clean["product_name"].isnull() & df_p_clean["barcode"].isnull())
]

# Drop exact duplicate barcodes (keep first occurrence which tends to be most complete)
df_p_clean.drop_duplicates(subset=["barcode"], keep="first", inplace=True)

# Reset index
df_p_clean.reset_index(drop=True, inplace=True)

print(f"  Cleaned shape  : {df_p_clean.shape}")
print(f"  Columns kept   : {list(df_p_clean.columns)}")

# Null summary â€“ show only columns with > 0 nulls
null_summary = df_p_clean.isnull().sum()
print(f"\n  Null counts (non-zero only):")
print(null_summary[null_summary > 0].to_string())

out_p = OUT_DIR / "products_clean.csv"
df_p_clean.to_csv(out_p, index=False)
print(f"  Saved â†’ {out_p}")

print("\nCleaning complete.")
print(f"   recipes_clean.csv   â†’ {df_r_clean.shape[0]:,} rows Ã— {df_r_clean.shape[1]} cols")
print(f"   products_clean.csv  â†’ {df_p_clean.shape[0]:,} rows Ã— {df_p_clean.shape[1]} cols")
