import tensorflow as tf
from keras import layers, models, callbacks
import os

def build_efficientnetb4(
    num_classes,
    img_size=(380, 380),
    dropout_rate=0.4,
    base_trainable=False
):
    """
    Build and compile an EfficientNetB4 model.
    NOTE:
    - NO preprocessing inside the model
    - Preprocessing must be done in the dataset pipeline
    - Keras 3 safe (no Lambda layers)
    """

    # Input layer
    inputs = layers.Input(shape=(img_size[0], img_size[1], 3))

    # Backbone (NO input_tensor, NO preprocessing here)
    base = tf.keras.applications.EfficientNetB4(
        include_top=False,
        weights="imagenet",
        input_shape=(img_size[0], img_size[1], 3),
        pooling="avg"
    )

    base.trainable = base_trainable

    # Forward pass
    x = base(inputs, training=False)
    x = layers.Dropout(dropout_rate)(x)
    outputs = layers.Dense(num_classes, activation="softmax")(x)

    model = models.Model(inputs=inputs, outputs=outputs)

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-4),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )

    return model


def get_callbacks(
    save_dir="models",
    model_name="efficientb4_best.h5",
    patience=5
):
    os.makedirs(save_dir, exist_ok=True)

    checkpoint = callbacks.ModelCheckpoint(
        filepath=os.path.join(save_dir, model_name),
        monitor="val_loss",
        save_best_only=True,
        verbose=1
    )

    reduce_lr = callbacks.ReduceLROnPlateau(
        monitor="val_loss",
        factor=0.5,
        patience=3,
        min_lr=1e-7,
        verbose=1
    )

    early_stop = callbacks.EarlyStopping(
        monitor="val_loss",
        patience=patience + 3,
        restore_best_weights=True,
        verbose=1
    )

    return [checkpoint, reduce_lr, early_stop]