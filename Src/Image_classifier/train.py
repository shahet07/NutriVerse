"""
train.py
Script to train EfficientNetB4 on images folder.
"""

import argparse
import os
import json
import tensorflow as tf
import matplotlib.pyplot as plt

from data_loader import make_datasets
from model_utils import build_efficientnetb4, get_callbacks


# --------------------------------------------------
# Argument parsing
# --------------------------------------------------
def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument('--image_dir', required=True, help='Path to images root folder')
    p.add_argument('--img_size', type=int, default=380, help='Image size (square)')
    p.add_argument('--batch_size', type=int, default=32)
    p.add_argument('--val_split', type=float, default=0.2)
    p.add_argument('--epochs', type=int, default=12)
    p.add_argument('--save_dir', default='models')
    p.add_argument('--model_name', default='efficientb4_best.h5')
    p.add_argument('--fine_tune', action='store_true')
    return p.parse_args()


# EfficientNet preprocessing 

def preprocess_image(img, label):
    img = tf.keras.applications.efficientnet.preprocess_input(img)
    return img, label



# Plot training history

def plot_history(history, save_dir):
    plt.figure(figsize=(10, 4))

    plt.subplot(1, 2, 1)
    plt.plot(history.history['loss'], label='train_loss')
    plt.plot(history.history['val_loss'], label='val_loss')
    plt.legend()
    plt.title('Loss')

    plt.subplot(1, 2, 2)
    plt.plot(history.history['accuracy'], label='train_acc')
    plt.plot(history.history['val_accuracy'], label='val_acc')
    plt.legend()
    plt.title('Accuracy')

    os.makedirs(save_dir, exist_ok=True)
    plt.savefig(os.path.join(save_dir, 'training_history.png'))
    plt.close()


# Main training logic

def main():
    args = parse_args()

    # Create datasets 
    train_ds, val_ds, class_names = make_datasets(
        args.image_dir,
        img_size=(args.img_size, args.img_size),
        batch_size=args.batch_size,
        val_split=args.val_split
    )
    # Apply EfficientNet preprocessing at dataset level
    train_ds = train_ds.map(
        preprocess_image,
        num_parallel_calls=tf.data.AUTOTUNE
    )

    val_ds = val_ds.map(
        preprocess_image,
        num_parallel_calls=tf.data.AUTOTUNE
    )

    train_ds = train_ds.prefetch(tf.data.AUTOTUNE)
    val_ds   = val_ds.prefetch(tf.data.AUTOTUNE)
    # --------------------------------------------------

    num_classes = len(class_names)

    # Build model (NO preprocessing inside model)
    model = build_efficientnetb4(
        num_classes=num_classes,
        img_size=(args.img_size, args.img_size),
        base_trainable=args.fine_tune
    )

    callbacks = get_callbacks(
        save_dir=args.save_dir,
        model_name=args.model_name
    )

    # Train
    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=args.epochs,
        callbacks=callbacks
    )

    # Save metadata
    os.makedirs(args.save_dir, exist_ok=True)
    meta = {
        "class_names": class_names,
        "num_classes": num_classes,
        "img_size": args.img_size,
        "model": "EfficientNetB4",
        "preprocessing": "efficientnet"
    }

    with open(os.path.join(args.save_dir, 'meta.json'), 'w') as f:
        json.dump(meta, f, indent=2)

    # Plot training history
    plot_history(history, args.save_dir)

    # Save final model
    model.save(os.path.join(args.save_dir, 'efficientb4_final.h5'))

    print("Training complete.")
    print("Model and metadata saved to:", args.save_dir)


if __name__ == '__main__':
    main()
