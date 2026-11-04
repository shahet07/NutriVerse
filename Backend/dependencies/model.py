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


def _is_lfs_pointer(path: str) -> bool:
    with open(path, "rb") as f:
        return f.read(40).startswith(b"version https://git-lfs")


def init() -> None:
    """Load the classifier. If it is unavailable, only photo recognition is off."""
    global _wrapper
    if not os.path.isfile(MODEL_PATH) or _is_lfs_pointer(MODEL_PATH):
        logger.warning(
            "No model weights at %s (missing or a Git LFS pointer): "
            "photo recognition is disabled. Set MODEL_PATH to enable it.",
            MODEL_PATH,
        )
        return
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    try:
        # weights_only=True: a checkpoint is data and must not be able to run code.
        ckpt = torch.load(MODEL_PATH, map_location="cpu", weights_only=True)
    except Exception:
        logger.exception("Could not load %s: photo recognition is disabled.", MODEL_PATH)
        return
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


def get_image_model() -> Optional[ImageModelWrapper]:
    """Return the classifier, or None when photo recognition is disabled."""
    return _wrapper
