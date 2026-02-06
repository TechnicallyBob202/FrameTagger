import hashlib
import sqlite3
from pathlib import Path
from PIL import Image
import io
import base64
from datetime import datetime

STAGING_DIR = Path('/app/data/_staging')
FRAMEREADY_DIR = 'FrameReady'
VALID_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg'}
TARGET_WIDTH = 3840
TARGET_HEIGHT = 2160
TARGET_ASPECT = TARGET_WIDTH / TARGET_HEIGHT  # 1.777...
ASPECT_TOLERANCE = 0.1  # 1.677 to 1.877


def ensure_staging_dir():
    """Create staging directory if it doesn't exist"""
    STAGING_DIR.mkdir(parents=True, exist_ok=True)


def compute_md5(file_path: str | Path) -> str:
    """Compute MD5 hash of file (chunked to handle large files)"""
    hash_md5 = hashlib.md5()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(4096), b''):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def check_duplicates(db_path: str, md5_hash: str) -> dict | None:
    """
    Check for duplicate in database (already processed files).
    Returns duplicate info if found, None otherwise.
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check main images table only
    cursor.execute('SELECT id, path FROM images WHERE md5_hash = ?', (md5_hash,))
    result = cursor.fetchone()
    conn.close()
    
    if result:
        return {
            'location': 'library',
            'id': result[0],
            'path': result[1]
        }
    
    return None


def get_image_dimensions(file_path: str | Path) -> tuple[int, int]:
    """Get image dimensions (width, height)"""
    image = Image.open(file_path)
    return image.size


def detect_orientation_and_aspect(file_path: str | Path) -> dict:
    """
    Analyze image orientation and aspect ratio.
    Returns: {orientation, width, height, aspect, is_close_to_16_9}
    """
    width, height = get_image_dimensions(file_path)
    
    if height > width:
        return {
            'orientation': 'portrait',
            'width': width,
            'height': height,
            'aspect': width / height,
            'is_close_to_16_9': False
        }
    
    aspect = width / height
    is_close = abs(aspect - TARGET_ASPECT) <= ASPECT_TOLERANCE
    
    return {
        'orientation': 'landscape',
        'width': width,
        'height': height,
        'aspect': aspect,
        'is_close_to_16_9': is_close
    }


def generate_thumbnail(file_path: str | Path, size: int = 300) -> str:
    """
    Generate thumbnail and return as base64 data URL.
    """
    image = Image.open(file_path)
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    
    img_bytes = io.BytesIO()
    image.save(img_bytes, format='JPEG', quality=85)
    img_bytes.seek(0)
    
    b64 = base64.b64encode(img_bytes.getvalue()).decode('utf-8')
    return f"data:image/jpeg;base64,{b64}"


def get_file_info(file_path: str | Path) -> dict:
    """Get file information for display"""
    path = Path(file_path)
    stat = path.stat()
    width, height = get_image_dimensions(file_path)
    
    return {
        'name': path.name,
        'size': stat.st_size,
        'size_mb': round(stat.st_size / (1024 * 1024), 2),
        'width': width,
        'height': height
    }


def crop_and_export_frameready(
    file_path: str | Path,
    library_root: str | Path,
    image_id: int,
    crop_box: dict | None = None,
    frameready_folder: str | None = None,
    original_filename: str | None = None
) -> str:
    """
    Crop image to 16:9 and export to .frameready_* folder at 3840x2160.
    crop_box: {x, y, width, height} in normalized 0-1 coords, or None for auto-center.
    frameready_folder: Name of the frameready folder (e.g., '.frameready_abc123'). Required.
    Filename format: {original_name}_fr{original_ext}. If too long, truncates original_name.
    Returns: path to exported FrameReady file
    """
    library_root = Path(library_root)
    # Use provided frameready_folder, fallback to 'FrameReady' if not given
    folder_name = frameready_folder if frameready_folder else 'FrameReady'
    frameready_dir = library_root / folder_name
    frameready_dir.mkdir(parents=True, exist_ok=True)
    
    image = Image.open(file_path)
    width, height = image.size
    
    # Extract original filename and extension
    if original_filename:
        original_path = Path(original_filename)
    else:
        original_path = Path(file_path)
    original_name = original_path.stem  # filename without extension
    original_ext = original_path.suffix  # .jpg, .png, etc
    
    # Build new filename: original_name_fr.ext
    new_filename = f"{original_name}_fr{original_ext}"
    output_path = frameready_dir / new_filename
    
    # Check if filename exceeds 255 chars (filesystem limit)
    MAX_FILENAME = 255
    if len(output_path.name) > MAX_FILENAME:
        # Truncate the original name to fit
        max_name_len = MAX_FILENAME - len(f"_fr{original_ext}")
        truncated_name = original_name[:max_name_len]
        new_filename = f"{truncated_name}_fr{original_ext}"
        output_path = frameready_dir / new_filename
    
    # Calculate crop region (16:9 aspect)
    target_crop_aspect = TARGET_ASPECT
    current_aspect = width / height
    
    if crop_box:
        # User-specified crop
        x = int(crop_box['x'] * width)
        y = int(crop_box['y'] * height)
        crop_width = int(crop_box['width'] * width)
        crop_height = int(crop_box['height'] * height)
    else:
        # Auto-center crop
        if current_aspect > target_crop_aspect:
            # Image is wider than 16:9, crop width
            crop_height = height
            crop_width = int(height * target_crop_aspect)
            x = (width - crop_width) // 2
            y = 0
        else:
            # Image is taller than 16:9, crop height
            crop_width = width
            crop_height = int(width / target_crop_aspect)
            x = 0
            y = (height - crop_height) // 2
    
    # Crop
    cropped = image.crop((x, y, x + crop_width, y + crop_height))
    
    # Resize to target resolution
    resized = cropped.resize((TARGET_WIDTH, TARGET_HEIGHT), Image.Resampling.LANCZOS)
    
    # Preserve EXIF if available
    try:
        exif_data = image.info.get('exif')
        if exif_data:
            resized.save(output_path, 'JPEG', quality=95, exif=exif_data)
        else:
            resized.save(output_path, 'JPEG', quality=95)
    except Exception:
        # Fallback if EXIF preservation fails
        resized.save(output_path, 'JPEG', quality=95)
    
    return str(output_path)


def cleanup_staging_file(file_path: str | Path):
    """Delete a specific staging file"""
    try:
        Path(file_path).unlink()
    except Exception:
        pass


def cleanup_staging():
    """Delete all files in staging directory"""
    if STAGING_DIR.exists():
        for file in STAGING_DIR.rglob('*'):
            if file.is_file():
                try:
                    file.unlink()
                except Exception:
                    pass
        try:
            STAGING_DIR.rmdir()
        except Exception:
            pass