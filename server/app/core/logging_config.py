import logging
import logging.handlers
import os

_CONFIGURED = False


def configure_logging() -> None:
    """Install dual-handler logging on the root logger.

    File handler (plain text, rotating) is added only when LOG_DIR env var is set.
    Stream handler (JSON) is always active.

    Call once at application startup before any loggers emit messages.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return
    _CONFIGURED = True

    from pythonjsonlogger.json import JsonFormatter

    log_dir = os.environ.get("LOG_DIR", "")

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(stream_handler)

    if log_dir:
        try:
            os.makedirs(log_dir, exist_ok=True)
            file_handler = logging.handlers.RotatingFileHandler(
                os.path.join(log_dir, "app.log"),
                maxBytes=10 * 1024 * 1024,
                backupCount=5,
                encoding="utf-8",
            )
            file_handler.setFormatter(
                logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
            )
            root.addHandler(file_handler)
        except OSError as exc:
            logging.getLogger(__name__).warning(
                "Could not create log file handler in %s: %s", log_dir, exc
            )
