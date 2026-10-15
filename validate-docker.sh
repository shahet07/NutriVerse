#!/bin/bash
# Docker Build Validation Script
# Run this before deploying to catch issues early

set -e  # Exit on any error

echo "🔍 Docker Build Validation for NutriSense-AI Backend"
echo "=================================================="
echo ""

# 1. Check if ConvNeXt model exists
echo "✓ Checking ConvNeXt model file..."
if [ ! -f "Src/Image_classifier/models/nutrisense_convnext_small_best.pth" ]; then
    echo "❌ ERROR: ConvNeXt model file not found!"
    echo "   Expected: Src/Image_classifier/models/nutrisense_convnext_small_best.pth"
    exit 1
fi
echo "  ✅ ConvNeXt model found"
echo ""

# 2. Check if Dockerfile exists
echo "✓ Checking Dockerfile..."
if [ ! -f "Dockerfile" ]; then
    echo "❌ ERROR: Dockerfile not found!"
    exit 1
fi
echo "  ✅ Dockerfile found"
echo ""

# 3. Check if .dockerignore exists
echo "✓ Checking .dockerignore..."
if [ ! -f ".dockerignore" ]; then
    echo "⚠️  WARNING: .dockerignore not found (optional but recommended)"
else
    echo "  ✅ .dockerignore found"
fi
echo ""

# 4. Check if requirements.txt exists
echo "✓ Checking requirements.txt..."
if [ ! -f "requirements.txt" ]; then
    echo "❌ ERROR: requirements.txt not found!"
    exit 1
fi
echo "  ✅ requirements.txt found"
echo ""

# 5. Check if Backend directory exists
echo "✓ Checking Backend directory..."
if [ ! -d "Backend" ]; then
    echo "❌ ERROR: Backend directory not found!"
    exit 1
fi
echo "  ✅ Backend directory found"
echo ""

# 6. Validate critical environment variables template
echo "✓ Required environment variables checklist:"
echo "  - GROQ_API_KEY"
echo "  - NEO4J_URI"
echo "  - NEO4J_USERNAME"
echo "  - NEO4J_PASSWORD"
echo "  - FIREBASE_PROJECT_ID"
echo "  - AUTH_SECRET_KEY"
echo "  - ALLOWED_ORIGINS"
echo ""
echo "  📝 See DEPLOYMENT.md for full configuration guide"
echo ""

# 7. Estimate image size
echo "✓ Estimating Docker image size..."
CONVNEXT_SIZE=$(du -h "Src/Image_classifier/models/nutrisense_convnext_small_best.pth" | cut -f1)
echo "  ConvNeXt model: $CONVNEXT_SIZE"
echo "  Base image + deps: ~1.7 GB"
echo "  Whisper (runtime): ~500 MB"
echo "  Total estimate: ~2.3 GB"
echo ""

echo "✅ Pre-flight checks complete!"
echo ""
echo "🚀 Next steps:"
echo "   1. Build: docker build -t nutrisense-backend:latest ."
echo "   2. Test locally with environment variables (see DEPLOYMENT.md)"
echo "   3. Deploy to Render/Railway"
echo ""
