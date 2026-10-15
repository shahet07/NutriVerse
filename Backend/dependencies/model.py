from __future__ import annotations

import logging
import os
from typing import Optional

import torch
import torch.nn as nn
import torchvision.transforms as T
from PIL import Image

import timm

logger = logging.getLogger(__name__)

MODEL_PATH = os.getenv(
    "MODEL_PATH",
    os.path.join("Src", "Image_classifier", "models", "nutrisense_convnext_small_best.pth"),
)

_INFERENCE_TRANSFORM = T.Compose([
    T.Resize(256),
    T.CenterCrop(224),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


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


class ImageModelWrapper:
    def __init__(self, model: nn.Module, class_names: list[str], device: torch.device):
        self._model = model
        self._class_names = class_names
        self._device = device

    def predict(self, image_path: str, top_k: int = 3) -> list[tuple[str, float]]:
        img = Image.open(image_path).convert("RGB")
        tensor = _INFERENCE_TRANSFORM(img).unsqueeze(0).to(self._device)
        with torch.no_grad():
            logits = self._model(tensor)
            probs = torch.softmax(logits, dim=1)[0]
        k = min(top_k, len(self._class_names))
        top_probs, top_indices = torch.topk(probs, k)
        return [
            (self._class_names[idx.item()], float(prob.item()))
            for idx, prob in zip(top_indices, top_probs)
        ]

    @property
    def num_classes(self) -> int:
        return len(self._class_names)

    @property
    def class_names(self) -> list[str]:
        return self._class_names


_wrapper: Optional[ImageModelWrapper] = None


def init() -> None:
    global _wrapper
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    ckpt = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
    class_names: list[str] = list(ckpt["class_names"])
    model = _build_convnext(len(class_names))
    model.load_state_dict(ckpt["model_state_dict"])
    model.to(device)
    model.eval()
    _wrapper = ImageModelWrapper(model, class_names, device)
    logger.info(
        "ConvNeXt-Small loaded — %d classes | device: %s | epoch: %d | val_acc: %.2f%%",
        _wrapper.num_classes,
        device,
        ckpt.get("epoch", -1),
        ckpt.get("val_acc", 0.0) * 100,
    )


def get_image_model() -> ImageModelWrapper:
    if _wrapper is None:
        raise RuntimeError("Image model is not initialized.")
    return _wrapper
