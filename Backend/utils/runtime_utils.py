import os
import warnings


def configure_runtime_noise() -> None:
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")

    warnings.filterwarnings(
        "ignore",
        message=r"You are using a Python version .* google\.api_core",
        category=FutureWarning,
    )
    warnings.filterwarnings(
        "ignore",
        message=r"Do not pass an `input_shape`/`input_dim` argument to a layer.*",
        category=UserWarning,
    )
    warnings.filterwarnings(
        "ignore",
        message=r"Argument `decay` is no longer supported and will be ignored\.",
        category=UserWarning,
    )


def configure_tensorflow_logging(tf_module) -> None:
    try:
        tf_module.get_logger().setLevel("ERROR")
    except Exception:
        pass

    try:
        from absl import logging as absl_logging

        absl_logging.set_verbosity(absl_logging.ERROR)
    except Exception:
        pass
