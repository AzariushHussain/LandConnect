import io
import logging
import re
import uuid
from pathlib import Path
from typing import BinaryIO

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Listing, ListingImage
from app.models.common import now

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 12_000_000
MAX_LISTING_IMAGES = 10
logger = logging.getLogger(__name__)


class InvalidImageError(ValueError):
    pass


class ImageTooLargeError(ValueError):
    pass


class ImageLimitError(ValueError):
    pass


def upload_directory() -> Path:
    directory = Path(get_settings().upload_dir)
    if not directory.is_absolute():
        directory = Path(__file__).resolve().parents[2] / directory
    return directory.resolve()


def image_path(filename: str) -> Path | None:
    if not re.fullmatch(r"[a-f0-9]{32}\.jpg", filename):
        return None
    root = upload_directory()
    path = (root / filename).resolve()
    return path if path.parent == root else None


def prepare_image(file: BinaryIO) -> bytes:
    content = file.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise ImageTooLargeError("Images must be at most 5 MiB")
    try:
        with Image.open(io.BytesIO(content), formats=["JPEG", "PNG", "WEBP"]) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise InvalidImageError("Images must contain at most 12 million pixels")
            if getattr(source, "is_animated", False):
                raise InvalidImageError("Animated images are not supported")
            source.load()
            oriented = ImageOps.exif_transpose(source)
            oriented.thumbnail((2048, 2048))
            clean = Image.new("RGB", oriented.size, "white")
            if oriented.mode in ("RGBA", "LA") or "transparency" in oriented.info:
                rgba = oriented.convert("RGBA")
                clean.paste(rgba, mask=rgba.getchannel("A"))
            else:
                clean.paste(oriented.convert("RGB"))
            result = io.BytesIO()
            clean.save(result, format="JPEG", quality=85)
            return result.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        if isinstance(exc, InvalidImageError):
            raise
        raise InvalidImageError("Upload a valid JPEG PNG or WebP image") from None


def add_image(db: Session, listing: Listing, file: BinaryIO) -> ListingImage:
    if len(listing.images) >= MAX_LISTING_IMAGES:
        raise ImageLimitError("A listing can have at most 10 images")
    content = prepare_image(file)
    directory = upload_directory()
    directory.mkdir(parents=True, exist_ok=True)
    filename = uuid.uuid4().hex + ".jpg"
    path = directory / filename
    created = False
    # shortcut: crashes can leave unreferenced files; add reconciliation for sustained deployments.
    try:
        with path.open("xb") as output:
            created = True
            output.write(content)
        image = ListingImage(listing_id=listing.id, filename=filename)
        listing.images.append(image)
        listing.updated_at = now()
        db.commit()
    except Exception:
        try:
            db.rollback()
        finally:
            if created:
                path.unlink(missing_ok=True)
        raise
    return image


def remove_image(db: Session, listing: Listing, image: ListingImage) -> None:
    path = image_path(image.filename)
    listing.images.remove(image)
    listing.updated_at = now()
    db.commit()
    if path:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            # The committed metadata removal already makes the file inaccessible through the API.
            logger.warning("Could not remove an unreferenced image file", exc_info=True)
