import os

import torch
import torch.nn as nn
import torchvision.transforms as T
from PIL import Image
import timm

_INFERENCE_TRANSFORM = T.Compose([
    T.Resize(256),
    T.CenterCrop(224),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

DEFAULT_MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "models", "nutrisense_convnext_small_best.pth"
)


def _build_convnext(num_classes: int) -> nn.Module:
    model = timm.create_model(
        "convnext_small.fb_in22k_ft_in1k",
        pretrained=False,
        drop_path_rate=0.2,
    )
    in_features = model.head.fc.in_features
    model.head.fc = nn.Sequential(
        nn.LayerNorm(in_features),
        nn.Dropout(p=0.3),
        nn.Linear(in_features, 512),
        nn.GELU(),
        nn.Dropout(p=0.2),
        nn.Linear(512, num_classes),
    )
    return model


def load_model(model_path: str = DEFAULT_MODEL_PATH, device: str | None = None):
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    ckpt = torch.load(model_path, map_location="cpu", weights_only=False)
    class_names = list(ckpt["class_names"])
    model = _build_convnext(len(class_names))
    model.load_state_dict(ckpt["model_state_dict"])
    model.to(device)
    model.eval()
    return model, class_names, device


def predict_image(
    model: nn.Module,
    class_names: list,
    device: str,
    img_path: str,
    top_k: int = 3,
) -> list[dict]:
    img = Image.open(img_path).convert("RGB")
    tensor = _INFERENCE_TRANSFORM(img).unsqueeze(0).to(device)
    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)[0]
    k = min(top_k, len(class_names))
    top_probs, top_indices = torch.topk(probs, k)
    return [
        {
            "label_index": int(idx.item()),
            "label": class_names[idx.item()],
            "score": float(prob.item()),
        }
        for idx, prob in zip(top_indices, top_probs)
    ]


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--model_path", default=DEFAULT_MODEL_PATH)
    p.add_argument("--img", required=True)
    p.add_argument("--top_k", type=int, default=3)
    args = p.parse_args()

    _model, _class_names, _device = load_model(args.model_path)
    results = predict_image(_model, _class_names, _device, args.img, top_k=args.top_k)
    for r in results:
        print(f"  {r['label']:30s}  {r['score']*100:.2f}%")
