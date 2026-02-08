"""Banner image processing service.

Handles upload validation, resizing, WebP conversion, desaturation for kiosk,
and dominant color extraction.
"""

import time
from pathlib import Path

from fastapi import UploadFile
from PIL import Image, ImageEnhance

from app.core.config import get_settings

settings = get_settings()

ALLOWED_FORMATS = {"JPEG", "PNG", "GIF", "WEBP"}


def _get_banners_dir() -> Path:
    """Return banners directory, creating it if needed."""
    banners_dir = Path(settings.resolved_uploads_dir) / "banners"
    banners_dir.mkdir(parents=True, exist_ok=True)
    return banners_dir


def _extract_dominant_colors(img: Image.Image, num_colors: int = 3) -> list[str]:
    """Extract dominant colors from an image using quantization.

    Returns a list of hex color strings like ['#1a2b3c', '#4d5e6f', '#789abc'].
    """
    # Resize small for fast color analysis
    small = img.copy().resize((64, 64), Image.LANCZOS)
    if small.mode != "RGB":
        small = small.convert("RGB")

    # Quantize to find dominant colors
    quantized = small.quantize(colors=num_colors, method=Image.Quantize.MEDIANCUT)
    palette = quantized.getpalette()
    if not palette:
        return ["#1a1a2e", "#16213e", "#0f3460"]

    # Count pixels per color to sort by dominance
    color_counts: dict[int, int] = {}
    for pixel in quantized.getdata():
        color_counts[pixel] = color_counts.get(pixel, 0) + 1

    # Sort by frequency (most common first)
    sorted_indices = sorted(color_counts.keys(), key=lambda i: color_counts[i], reverse=True)

    colors = []
    for idx in sorted_indices[:num_colors]:
        r = palette[idx * 3]
        g = palette[idx * 3 + 1]
        b = palette[idx * 3 + 2]
        # Darken colors for use as background (multiply by 0.4 to keep dark theme)
        r = int(r * 0.4)
        g = int(g * 0.4)
        b = int(b * 0.4)
        colors.append(f"#{r:02x}{g:02x}{b:02x}")

    # Pad with defaults if fewer colors extracted
    defaults = ["#1a1a2e", "#16213e", "#0f3460"]
    while len(colors) < num_colors:
        colors.append(defaults[len(colors) % len(defaults)])

    return colors


def _create_kiosk_variant(img: Image.Image) -> Image.Image:
    """Create a desaturated, slightly blurred variant for the kiosk display.

    Reduces saturation to ~40% and applies a subtle blur for a subdued background feel.
    """
    kiosk = img.copy()
    if kiosk.mode != "RGB":
        kiosk = kiosk.convert("RGB")

    # Reduce saturation to 40%
    enhancer = ImageEnhance.Color(kiosk)
    kiosk = enhancer.enhance(0.4)

    # Slightly reduce brightness
    enhancer = ImageEnhance.Brightness(kiosk)
    kiosk = enhancer.enhance(0.8)

    return kiosk


def process_banner_upload(file: UploadFile, event_code: str) -> tuple[str, str, list[str]]:
    """Process an uploaded banner image.

    Validates, resizes to 1920x480, converts to WebP, creates a desaturated kiosk
    variant, and extracts dominant colors.

    Args:
        file: The uploaded file.
        event_code: Event code for filename generation.

    Returns:
        Tuple of (banner_filename, kiosk_filename, dominant_colors).

    Raises:
        ValueError: If the file is invalid (wrong format, too large, corrupt).
    """
    max_size = settings.max_banner_size_mb * 1024 * 1024

    # Validate file size
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > max_size:
        raise ValueError(f"File size exceeds {settings.max_banner_size_mb}MB limit.")
    if size == 0:
        raise ValueError("File is empty.")

    # Open and validate image format
    try:
        img = Image.open(file.file)
        img.load()  # Force full read to catch truncated files
    except Exception:
        raise ValueError("Invalid or corrupt image file.")

    if img.format not in ALLOWED_FORMATS:
        raise ValueError(f"Unsupported image format '{img.format}'. Use JPEG, PNG, GIF, or WebP.")

    # Convert to RGB (WebP output, drop alpha)
    if img.mode in ("RGBA", "LA", "P", "PA"):
        background = Image.new("RGB", img.size, (26, 26, 46))  # Dark bg matching theme
        if img.mode == "P":
            img = img.convert("RGBA")
        if "A" in img.mode:
            background.paste(img, mask=img.split()[-1])
        else:
            background.paste(img)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    # Extract dominant colors before resizing (more accurate from full image)
    colors = _extract_dominant_colors(img)

    # Resize to target dimensions
    target_w = settings.banner_width
    target_h = settings.banner_height
    img = img.resize((target_w, target_h), Image.LANCZOS)

    # Generate filenames
    timestamp = int(time.time())
    base_name = f"{event_code.lower()}_{timestamp}"
    banner_filename = f"banners/{base_name}.webp"
    kiosk_filename = f"banners/{base_name}_kiosk.webp"

    banners_dir = _get_banners_dir()

    # Save main banner
    img.save(banners_dir / f"{base_name}.webp", "WEBP", quality=92)

    # Create and save kiosk variant (desaturated)
    kiosk_img = _create_kiosk_variant(img)
    kiosk_img.save(banners_dir / f"{base_name}_kiosk.webp", "WEBP", quality=92)

    return banner_filename, kiosk_filename, colors


def delete_banner_files(banner_filename: str | None) -> None:
    """Delete banner and kiosk variant files if they exist.

    Args:
        banner_filename: The main banner filename (e.g., 'banners/abc123_1234.webp').
            The kiosk variant is derived by adding '_kiosk' suffix.
    """
    if not banner_filename:
        return

    uploads_dir = Path(settings.resolved_uploads_dir).resolve()

    for filename in [banner_filename, _kiosk_filename(banner_filename)]:
        filepath = (uploads_dir / filename).resolve()
        # Ensure resolved path stays within uploads directory
        if not filepath.is_relative_to(uploads_dir):
            continue
        try:
            if filepath.exists():
                filepath.unlink()
        except OSError:
            pass  # nosec B110


def _kiosk_filename(banner_filename: str) -> str:
    """Derive the kiosk variant filename from the main banner filename."""
    stem = banner_filename.rsplit(".", 1)[0]
    return f"{stem}_kiosk.webp"
