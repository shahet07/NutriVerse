
import tensorflow as tf

AUTOTUNE = tf.data.AUTOTUNE

def make_datasets(image_dir,
                  img_size=(380, 380),   # EfficientNetB4 default input size is 380x380
                  batch_size=32,
                  val_split=0.2,
                  seed=123,
                  subset='both'):
    """
    Returns: (train_ds, val_ds, class_names)
    If subset == 'both' returns train and val datasets.
    If subset == 'train' or 'val' returns that one dataset and class_names.
    """

    if subset not in ('both', 'train', 'val'):
        raise ValueError("subset must be one of 'both','train','val'")

    # Use image_dataset_from_directory to build datasets and preserve folder names as labels
    if subset in ('both', 'train'):
        train_ds = tf.keras.preprocessing.image_dataset_from_directory(
            image_dir,
            labels='inferred',
            label_mode='int',
            batch_size=batch_size,
            image_size=img_size,
            shuffle=True,
            seed=seed,
            validation_split=val_split,
            subset='training'
        )
    else:
        train_ds = None

    if subset in ('both', 'val'):
        val_ds = tf.keras.preprocessing.image_dataset_from_directory(
            image_dir,
            labels='inferred',
            label_mode='int',
            batch_size=batch_size,
            image_size=img_size,
            shuffle=True,
            seed=seed,
            validation_split=val_split,
            subset='validation'
        )
    else:
        val_ds = None

    # class_names are consistent across both subsets
    # Quick method: read one dataset to get class_names
    sample_ds = tf.keras.preprocessing.image_dataset_from_directory(
        image_dir,
        labels='inferred',
        label_mode='int',
        batch_size=1,
        image_size=img_size,
        shuffle=False
    )
    class_names = sample_ds.class_names

    # Prefetch
    if train_ds is not None:
        train_ds = train_ds.cache().prefetch(buffer_size=AUTOTUNE)
    if val_ds is not None:
        val_ds = val_ds.cache().prefetch(buffer_size=AUTOTUNE)

    return train_ds, val_ds, class_names
