"""
One-time script: exports BAAI/bge-reranker-base to ONNX and quantizes to INT8.
Run once before starting the API server:
    python -m recommender.offline.export_reranker_onnx
"""

import os
import logging
import shutil

from sentence_transformers import CrossEncoder
from optimum.onnxruntime import ORTModelForSequenceClassification, ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig
from recommender.config import ARTIFACTS_DIR

logger = logging.getLogger(__name__)

RERANKER_MODEL = "BAAI/bge-reranker-base"
FP32_DIR = str(ARTIFACTS_DIR / "bge-reranker-onnx-fp32")
INT8_DIR = str(ARTIFACTS_DIR / "bge-reranker-onnx-int8")


def main():
    # Step 1: Export PyTorch → ONNX FP32
    logger.info("Exporting %s to ONNX FP32...", RERANKER_MODEL)
    model = CrossEncoder(RERANKER_MODEL, backend="onnx")
    model.save(FP32_DIR)
    logger.info("Saved FP32 ONNX to %s", FP32_DIR)

    # Step 2: Quantize FP32 → INT8 (dynamic, no calibration data needed)
    logger.info("Quantizing to INT8...")
    onnx_model = ORTModelForSequenceClassification.from_pretrained(FP32_DIR)
    quantizer = ORTQuantizer.from_pretrained(onnx_model)
    dqconfig = AutoQuantizationConfig.avx2(is_static=False, per_channel=False)
    quantizer.quantize(save_dir=INT8_DIR, quantization_config=dqconfig)

    # Quantizer only saves the ONNX model — copy tokenizer files so CrossEncoder can load
    for fname in ("tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"):
        src = os.path.join(FP32_DIR, fname)
        if os.path.exists(src):
            shutil.copy2(src, INT8_DIR)

    logger.info("Saved INT8 ONNX to %s", INT8_DIR)

    logger.info("Done. Reranker is ready for ONNX inference.")


if __name__ == "__main__":
    main()
