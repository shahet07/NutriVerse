"""
evaluate.py

Usage (from project root or Src/Image_classifier):
python Src/Image_classifier/evaluate.py \
    --model_path Src/Image_classifier/models/efficientb4_best.h5 \
    --meta_path Src/Image_classifier/models/meta.json \
    --image_dir images \
    --batch_size 32 \
    --top_k 3 \
    --out_dir Src/Image_classifier/models/eval_results
"""

import argparse
import os
import json
import numpy as np
from sklearn.metrics import classification_report, confusion_matrix, f1_score, accuracy_score
import matplotlib.pyplot as plt
import csv

# local imports (ensure current working dir allows import)
from Inference import load_model_and_meta
from data_loader import make_datasets

def top_k_accuracy(y_true, y_preds_probs, k=3):
    # y_preds_probs: numpy array shape (N, C)
    topk = np.argsort(y_preds_probs, axis=1)[:, -k:][:, ::-1]  # top k indices
    hits = 0
    for i, true in enumerate(y_true):
        if true in topk[i]:
            hits += 1
    return hits / len(y_true)

def per_class_accuracy(y_true, y_pred, class_names):
    class_acc = {}
    y_true = np.array(y_true)
    y_pred = np.array(y_pred)
    for i, cname in enumerate(class_names):
        idx = np.where(y_true == i)[0]
        if len(idx) == 0:
            class_acc[cname] = None
        else:
            class_acc[cname] = float((y_pred[idx] == i).sum()) / len(idx)
    return class_acc

def plot_confusion_matrix(cm, classes, out_path):
    plt.figure(figsize=(10,10))
    plt.imshow(cm, interpolation='nearest')
    plt.title('Confusion matrix')
    plt.colorbar()
    tick_marks = np.arange(len(classes))
    plt.xticks(tick_marks, classes, rotation=90, fontsize=6)
    plt.yticks(tick_marks, classes, fontsize=6)
    plt.tight_layout()
    plt.ylabel('True label')
    plt.xlabel('Predicted label')
    plt.savefig(out_path, dpi=200, bbox_inches='tight')
    plt.close()

def main(args):
    model, meta = load_model_and_meta(args.model_path, args.meta_path)
    img_size = meta.get('img_size', 380)
    class_names = meta['class_names']
    num_classes = meta['num_classes']

    # build validation dataset only
    _, val_ds, _ = make_datasets(args.image_dir, img_size=(img_size, img_size),
                                batch_size=args.batch_size, val_split=args.val_split)

    y_true = []
    y_pred = []
    y_pred_probs = []

    for batch_imgs, batch_labels in val_ds:
        probs = model.predict(batch_imgs)
        preds = probs.argmax(axis=1)
        y_true.extend(batch_labels.numpy().tolist())
        y_pred.extend(preds.tolist())
        y_pred_probs.extend(probs.tolist())

    y_true = np.array(y_true)
    y_pred = np.array(y_pred)
    y_pred_probs = np.array(y_pred_probs)

    # Metrics
    acc_top1 = accuracy_score(y_true, y_pred)
    acc_topk = top_k_accuracy(y_true, y_pred_probs, k=args.top_k)
    macro_f1 = f1_score(y_true, y_pred, average='macro', zero_division=0)
    micro_f1 = f1_score(y_true, y_pred, average='micro', zero_division=0)
    cls_report = classification_report(y_true, y_pred, target_names=class_names, zero_division=0, output_dict=True)
    cm = confusion_matrix(y_true, y_pred)
    class_acc = per_class_accuracy(y_true, y_pred, class_names)

    os.makedirs(args.out_dir, exist_ok=True)

    # Save metrics summary
    summary = {
        'top1_accuracy': float(acc_top1),
        f'top{args.top_k}_accuracy': float(acc_topk),
        'macro_f1': float(macro_f1),
        'micro_f1': float(micro_f1),
        'num_samples': int(len(y_true)),
        'num_classes': int(num_classes)
    }
    with open(os.path.join(args.out_dir, 'metrics_summary.json'), 'w') as f:
        json.dump(summary, f, indent=2)

    # Save classification report (CSV)
    report_csv = os.path.join(args.out_dir, 'classification_report.csv')
    with open(report_csv, 'w', newline='') as csvfile:
        writer = csv.writer(csvfile)
        header = ['class','precision','recall','f1-score','support','per_class_accuracy']
        writer.writerow(header)
        for k, v in cls_report.items():
            if k == 'accuracy' or k == 'macro avg' or k == 'weighted avg' or k == 'micro avg':
                continue
            writer.writerow([k, v.get('precision'), v.get('recall'), v.get('f1-score'), v.get('support'), class_acc.get(k)])
        # add aggregate rows
        writer.writerow(['accuracy', cls_report.get('accuracy'), '', '', '', ''])
        if 'macro avg' in cls_report:
            ma = cls_report['macro avg']
            writer.writerow(['macro avg', ma.get('precision'), ma.get('recall'), ma.get('f1-score'), ma.get('support'), ''])
        if 'weighted avg' in cls_report:
            wa = cls_report['weighted avg']
            writer.writerow(['weighted avg', wa.get('precision'), wa.get('recall'), wa.get('f1-score'), wa.get('support'), ''])

    # Save confusion matrix plot
    plot_confusion_matrix(cm, class_names, os.path.join(args.out_dir, 'confusion_matrix.png'))

    # Save raw confusion matrix and arrays
    np.save(os.path.join(args.out_dir, 'confusion_matrix.npy'), cm)
    np.save(os.path.join(args.out_dir, 'y_true.npy'), y_true)
    np.save(os.path.join(args.out_dir, 'y_pred.npy'), y_pred)

    print("Evaluation complete. Results saved to:", args.out_dir)
    print("Top-1 accuracy:", acc_top1)
    print(f"Top-{args.top_k} accuracy:", acc_topk)
    print("Macro F1:", macro_f1)
    print("Micro F1:", micro_f1)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--model_path', required=True)
    p.add_argument('--meta_path', required=True)
    p.add_argument('--image_dir', required=True)
    p.add_argument('--batch_size', type=int, default=32)
    p.add_argument('--val_split', type=float, default=0.2)
    p.add_argument('--top_k', type=int, default=3)
    p.add_argument('--out_dir', type=str, default='Src/Image_classifier/models/eval_results')
    args = p.parse_args()
    main(args)
