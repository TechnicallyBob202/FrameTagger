from fastapi import FastAPI, UploadFile, File
from starlette.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pathlib import Path
from PIL import Image
import sqlite3
import io
from datetime import datetime
import zipfile
import shutil
import uuid
import asyncio
from services.image_processor import (
    compute_md5, check_duplicates, detect_orientation_and_aspect,
    generate_thumbnail, get_file_info, crop_and_export_frameready,
    cleanup_staging, cleanup_staging_file, ensure_staging_dir, STAGING_DIR
)

# Request body models
class PositionRequest(BaseModel):
    filename: str
    crop_box: dict

class SkipPositionRequest(BaseModel):
    filename: str

class DuplicateActionRequest(BaseModel):
    filename: str
    action: str

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database path - persists in mounted volume
DB_PATH = '/app/data/frametagger.db'

# In-memory job tracker for upload progress
upload_jobs = {}

# Initialize database
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            md5_hash TEXT,
            folder_id INTEGER NOT NULL,
            date_added TEXT NOT NULL,
            FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS image_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            image_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(image_id) REFERENCES images(id) ON DELETE CASCADE,
            FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE,
            UNIQUE(image_id, tag_id)
        )
    ''')
    
    conn.commit()
    conn.close()

init_db()

# Migration: Add md5_hash column if it doesn't exist
def migrate_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute('ALTER TABLE images ADD COLUMN md5_hash TEXT')
        conn.commit()
    except sqlite3.OperationalError:
        # Column already exists
        pass
    finally:
        conn.close()

migrate_db()
ensure_staging_dir()

# FOLDER FUNCTIONS
def get_folders_from_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT id, path FROM folders ORDER BY created_at')
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "path": r[1]} for r in results]

def add_folder_to_db(path):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute('INSERT INTO folders (path, created_at) VALUES (?, ?)', 
                      (path, datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        conn.close()
        return False

def remove_folder_from_db(folder_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('DELETE FROM folders WHERE id = ?', (folder_id,))
    conn.commit()
    conn.close()

# TAG FUNCTIONS
def get_tags_from_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT id, name FROM tags ORDER BY name')
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1]} for r in results]

def create_tag(name):
    """Create a single tag"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute('INSERT INTO tags (name, created_at) VALUES (?, ?)',
                      (name.strip(), datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        conn.close()
        return False

def delete_tag(tag_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('DELETE FROM tags WHERE id = ?', (tag_id,))
    conn.commit()
    conn.close()

def get_image_tags(image_id):
    """Get all tags for an image"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT t.id, t.name FROM tags t
        JOIN image_tags it ON t.id = it.tag_id
        WHERE it.image_id = ?
        ORDER BY t.name
    ''', (image_id,))
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1]} for r in results]

def add_tag_to_image(image_id, tag_id):
    """Add a tag to an image"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute('INSERT INTO image_tags (image_id, tag_id, created_at) VALUES (?, ?, ?)',
                      (image_id, tag_id, datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        conn.close()
        return False

def remove_tag_from_image(image_id, tag_id):
    """Remove a tag from an image"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?',
                  (image_id, tag_id))
    conn.commit()
    conn.close()

def delete_image_from_db(image_id):
    """Remove image from database only (keep file)"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('DELETE FROM images WHERE id = ?', (image_id,))
    conn.commit()
    conn.close()

def delete_image_completely(image_id):
    """Remove image from database and delete the file"""
    img = get_image_by_id(image_id)
    if not img:
        return False
    
    file_path = Path(img["path"])
    
    # Delete from database first
    delete_image_from_db(image_id)
    
    # Then delete the file
    try:
        if file_path.exists():
            file_path.unlink()
        return True
    except Exception:
        # DB deletion succeeded even if file deletion failed
        return True

def get_image_by_id(image_id):
    """Get image info by ID"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT id, path, folder_id, date_added FROM images WHERE id = ?', (image_id,))
    result = cursor.fetchone()
    conn.close()
    if result:
        return {
            "id": result[0],
            "path": result[1],
            "folder_id": result[2],
            "date_added": result[3]
        }
    return None

def get_image_info(image_id):
    """Get full image info including tags"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT i.id, i.path, i.folder_id, i.date_added, f.path as folder_path
        FROM images i
        JOIN folders f ON i.folder_id = f.id
        WHERE i.id = ?
    ''', (image_id,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return None
    
    file_path = Path(result[1])
    file_size = file_path.stat().st_size if file_path.exists() else 0
    
    return {
        "id": result[0],
        "name": file_path.name,
        "path": result[1],
        "folder_id": result[2],
        "folder_path": result[4],
        "date_added": result[3],
        "size": file_size,
        "tags": get_image_tags(image_id)
    }

# IMAGE FUNCTIONS
def add_image_to_db(path, folder_id, md5_hash=None):
    """Add image to database if not already there"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute('INSERT INTO images (path, md5_hash, folder_id, date_added) VALUES (?, ?, ?, ?)',
                      (path, md5_hash, folder_id, datetime.now().isoformat()))
        conn.commit()
        image_id = cursor.lastrowid
        conn.close()
        return image_id
    except sqlite3.IntegrityError:
        # Image already in DB, get its ID
        cursor.execute('SELECT id FROM images WHERE path = ?', (path,))
        result = cursor.fetchone()
        conn.close()
        return result[0] if result else None

def rescan_library():
    """Rescan all folders and add new images"""
    folders = get_folders_from_db()
    added_count = 0
    
    IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg'}
    
    for folder in folders:
        folder_path = Path(folder["path"])
        if not folder_path.exists():
            continue
        
        try:
            for file_path in folder_path.rglob('*'):
                try:
                    if file_path.is_file() and file_path.suffix.lower() in IMAGE_EXTENSIONS:
                        image_id = add_image_to_db(str(file_path), folder["id"])
                        if image_id:
                            added_count += 1
                except (PermissionError, Exception):
                    pass
        except PermissionError:
            pass
    
    return added_count

# API ENDPOINTS

@app.get("/health")
def health():
    return {"status": "ok"}

# FOLDERS

@app.get("/api/folders/browse")
def browse_folders(path: str = "/"):
    try:
        p = Path(path)
        if not p.exists():
            return {"error": "Path does not exist"}
        if not p.is_dir():
            return {"error": "Path is not a directory"}
        
        items = []
        for item in sorted(p.iterdir()):
            try:
                if item.is_dir():
                    items.append({
                        "name": item.name,
                        "path": str(item),
                        "is_dir": True
                    })
            except PermissionError:
                pass
        
        return {
            "current_path": str(p),
            "parent_path": str(p.parent) if p.parent != p else None,
            "folders": items
        }
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/folders/add")
def add_folder(path: str):
    try:
        p = Path(path)
        if not p.exists():
            return {"error": "Path does not exist"}
        if not p.is_dir():
            return {"error": "Path is not a directory"}
        
        if add_folder_to_db(path):
            # Immediately rescan this folder
            rescan_library()
            return {"status": "ok", "path": path}
        else:
            return {"error": "Folder already added"}
    except Exception as e:
        return {"error": str(e)}

@app.delete("/api/folders/{folder_id}")
def remove_folder(folder_id: int):
    try:
        remove_folder_from_db(folder_id)
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/folders")
def list_folders():
    try:
        folders = get_folders_from_db()
        return {"folders": folders}
    except Exception as e:
        return {"error": str(e)}

# TAGS

@app.get("/api/tags")
def list_tags():
    try:
        tags = get_tags_from_db()
        return {"tags": tags}
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/tags")
def create_tag_endpoint(name: str):
    try:
        if not name or not name.strip():
            return {"error": "Tag name required"}
        
        if create_tag(name):
            return {"status": "ok", "name": name.strip()}
        else:
            return {"error": "Tag already exists"}
    except Exception as e:
        return {"error": str(e)}

@app.delete("/api/tags/{tag_id}")
def remove_tag(tag_id: int):
    try:
        delete_tag(tag_id)
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}

# IMAGES

@app.get("/api/images")
def get_images():
    """Return all images from database"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('''
            SELECT i.id, i.path, i.folder_id, i.date_added, f.path as folder_path
            FROM images i
            JOIN folders f ON i.folder_id = f.id
            ORDER BY i.id
        ''')
        results = cursor.fetchall()
        conn.close()
        
        all_images = []
        for r in results:
            file_path = Path(r[1])
            file_size = file_path.stat().st_size if file_path.exists() else 0
            all_images.append({
                "id": r[0],
                "name": file_path.name,
                "path": r[1],
                "folder_id": r[2],
                "folder_path": r[4],
                "date_added": r[3],
                "size": file_size,
                "tags": get_image_tags(r[0])
            })
        
        return {
            "total_images": len(all_images),
            "library_folders": len(get_folders_from_db()),
            "images": all_images
        }
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/rescan")
def rescan():
    """Rescan all folders for new images"""
    try:
        added = rescan_library()
        return {"status": "ok", "added": added}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/images/{image_id}")
def get_image(image_id: int):
    """Get image details"""
    try:
        img_info = get_image_info(image_id)
        if img_info:
            return img_info
        return {"error": "Image not found"}
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/images/{image_id}/thumbnail")
def get_thumbnail(image_id: int):
    """Get 100x100 thumbnail"""
    try:
        img = get_image_by_id(image_id)
        if not img:
            return {"error": "Image not found"}
        
        file_path = Path(img["path"])
        if not file_path.exists():
            return {"error": "File not found"}
        
        image = Image.open(file_path)
        image.thumbnail((100, 100), Image.Resampling.LANCZOS)
        
        img_bytes = io.BytesIO()
        image.save(img_bytes, format='JPEG', quality=85)
        img_bytes.seek(0)
        
        return StreamingResponse(img_bytes, media_type="image/jpeg")
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/images/{image_id}/preview")
def get_preview(image_id: int):
    """Get 600x600 preview"""
    try:
        img = get_image_by_id(image_id)
        if not img:
            return {"error": "Image not found"}
        
        file_path = Path(img["path"])
        if not file_path.exists():
            return {"error": "File not found"}
        
        image = Image.open(file_path)
        image.thumbnail((600, 600), Image.Resampling.LANCZOS)
        
        img_bytes = io.BytesIO()
        image.save(img_bytes, format='JPEG', quality=90)
        img_bytes.seek(0)
        
        return StreamingResponse(img_bytes, media_type="image/jpeg")
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/images/{image_id}/file")
def get_file(image_id: int):
    """Get original image file"""
    try:
        img = get_image_by_id(image_id)
        if not img:
            return {"error": "Image not found"}
        
        file_path = Path(img["path"])
        if not file_path.exists():
            return {"error": "File not found"}
        
        return FileResponse(file_path)
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/images/{image_id}/tag")
def tag_image(image_id: int, tag_id: int):
    try:
        if add_tag_to_image(image_id, tag_id):
            return {"status": "ok"}
        else:
            return {"error": "Tag already applied"}
    except Exception as e:
        return {"error": str(e)}

@app.delete("/api/images/{image_id}/tag")
def untag_image(image_id: int, tag_id: int):
    try:
        remove_tag_from_image(image_id, tag_id)
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}

@app.delete("/api/images/{image_id}/remove")
def remove_image(image_id: int):
    """Remove image from FrameFolio (database only, keeps file)"""
    try:
        delete_image_from_db(image_id)
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}

@app.delete("/api/images/{image_id}/delete")
def delete_image(image_id: int):
    """Delete image completely (database and file)"""
    try:
        delete_image_completely(image_id)
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}

# UPLOAD - NEW FLOW WITH DUPLICATE DETECTION + ASPECT HANDLING

@app.post("/api/images/upload/start")
async def start_upload(folder_id: int, files: list[UploadFile] = File(...)):
    """
    Start upload job. Returns job_id for polling progress.
    Handles: duplicate detection, portrait rejection, aspect ratio dialog.
    """
    job_id = str(uuid.uuid4())
    
    # Initialize job state
    upload_jobs[job_id] = {
        "status": "processing",
        "current_step": "initializing",
        "progress": 0,
        "total_files": len(files),
        "folder_id": folder_id,
        "results": [],
        "errors": []
    }
    
    # Get folder path
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT path FROM folders WHERE id = ?', (folder_id,))
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        upload_jobs[job_id]["status"] = "error"
        upload_jobs[job_id]["errors"].append("Folder not found")
        return {"job_id": job_id}
    
    folder_path = Path(result[0])
    if not folder_path.exists():
        upload_jobs[job_id]["status"] = "error"
        upload_jobs[job_id]["errors"].append("Folder path does not exist")
        return {"job_id": job_id}
    
    # READ file contents BEFORE returning (while request context is open)
    file_contents = []
    for file in files:
        try:
            content = await file.read()
            file_contents.append((file.filename, content))
        except Exception as e:
            upload_jobs[job_id]["errors"].append(f"Failed to read {file.filename}: {str(e)}")
    
    # Process files asynchronously with bytes
    asyncio.create_task(process_upload(job_id, file_contents, folder_path, folder_id))
    
    return {"job_id": job_id}

@app.get("/api/images/upload/{job_id}/status")
def get_upload_status(job_id: str):
    """Poll upload job progress"""
    if job_id not in upload_jobs:
        return {"error": "Job not found"}
    return upload_jobs[job_id]

async def process_upload(job_id: str, file_contents: list, folder_path: Path, folder_id: int):
    """
    Process upload with duplicate detection, portrait rejection, aspect analysis.
    file_contents: list of (filename, bytes) tuples
    """
    try:
        for idx, (filename, content) in enumerate(file_contents):
            upload_jobs[job_id]["progress"] = int((idx / len(file_contents)) * 100)
            upload_jobs[job_id]["current_step"] = f"Processing {filename}"
            
            try:
                # Write content to staging
                upload_jobs[job_id]["current_step"] = f"Reading {filename}"
                staging_file = STAGING_DIR / f"{uuid.uuid4()}_{filename}"
                
                with open(staging_file, 'wb') as f:
                    f.write(content)
                
                # Compute MD5
                upload_jobs[job_id]["current_step"] = f"Computing hash for {filename}"
                md5_hash = compute_md5(staging_file)
                
                # Check duplicates
                upload_jobs[job_id]["current_step"] = f"Checking duplicates for {filename}"
                dup = check_duplicates(DB_PATH, md5_hash)
                
                if dup:
                    dup_info = get_file_info(dup['path'])
                    dup_thumb = generate_thumbnail(dup['path'])
                    incoming_thumb = generate_thumbnail(staging_file)
                    
                    upload_jobs[job_id]["results"].append({
                        "filename": filename,
                        "status": "duplicate_detected",
                        "staging_path": str(staging_file),
                        "duplicate": {
                            "location": dup['location'],
                            "id": dup.get('id'),
                            "path": dup['path'],
                            "info": dup_info,
                            "thumbnail": dup_thumb
                        },
                        "incoming": {
                            "info": get_file_info(staging_file),
                            "thumbnail": incoming_thumb
                        }
                    })
                    continue
                
                # Check orientation
                upload_jobs[job_id]["current_step"] = f"Analyzing {filename}"
                aspect_info = detect_orientation_and_aspect(staging_file)
                
                if aspect_info['orientation'] == 'portrait':
                    upload_jobs[job_id]["results"].append({
                        "filename": filename,
                        "status": "portrait_rejected",
                        "error": "Portrait orientation not supported"
                    })
                    cleanup_staging_file(staging_file)
                    continue
                
                # If not close to 16:9, need user input
                if not aspect_info['is_close_to_16_9']:
                    upload_jobs[job_id]["results"].append({
                        "filename": filename,
                        "status": "needs_positioning",
                        "aspect_info": aspect_info,
                        "thumbnail": generate_thumbnail(staging_file, size=600),
                        "staging_path": str(staging_file)
                    })
                    continue
                
                # Auto-crop and export FrameReady
                upload_jobs[job_id]["current_step"] = f"Finalizing {filename}"
                
                # Add to database
                image_id = add_image_to_db(
                    str(folder_path / filename),
                    folder_id,
                    md5_hash
                )
                
                if not image_id:
                    upload_jobs[job_id]["errors"].append(f"Failed to add {filename} to database")
                    cleanup_staging_file(staging_file)
                    continue
                
                # Crop and export to FrameReady
                frameready_path = crop_and_export_frameready(staging_file, folder_path, image_id)
                
                # Move original to final location
                final_path = folder_path / filename
                staging_file.rename(final_path)
                
                # Update database with final path
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute('UPDATE images SET path = ? WHERE id = ?', (str(final_path), image_id))
                conn.commit()
                conn.close()
                
                upload_jobs[job_id]["results"].append({
                    "filename": filename,
                    "status": "success",
                    "id": image_id,
                    "frameready": frameready_path
                })
                
            except Exception as e:
                upload_jobs[job_id]["errors"].append(f"{filename}: {str(e)}")
                try:
                    cleanup_staging_file(staging_file)
                except:
                    pass
        
        # Check if any files still need user action
        files_needing_action = any(r["status"] in ["duplicate_detected", "needs_positioning"] for r in upload_jobs[job_id]["results"])
        
        if files_needing_action:
            upload_jobs[job_id]["status"] = "waiting_for_user_action"
        else:
            upload_jobs[job_id]["status"] = "complete"
        
        upload_jobs[job_id]["progress"] = 100
        
    except Exception as e:
        upload_jobs[job_id]["status"] = "error"
        upload_jobs[job_id]["errors"].append(str(e))

@app.post("/api/images/upload/{job_id}/duplicate-action")
async def handle_duplicate(job_id: str, req: DuplicateActionRequest):
    """
    Handle user's duplicate decision: skip, overwrite, or import_anyway.
    """
    filename = req.filename
    action = req.action
    
    if job_id not in upload_jobs:
        return {"error": "Job not found"}
    
    try:
        result = next((r for r in upload_jobs[job_id]["results"] if r["filename"] == filename), None)
        if not result or result["status"] != "duplicate_detected":
            return {"error": "File not found or not in duplicate state"}
        
        staging_path = Path(result["staging_path"])
        if not staging_path.exists():
            return {"error": "Staging file not found"}
        
        folder_id = upload_jobs[job_id]["folder_id"]
        
        # Get folder path
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('SELECT path FROM folders WHERE id = ?', (folder_id,))
        folder_result = cursor.fetchone()
        conn.close()
        
        if not folder_result:
            return {"error": "Folder not found"}
        
        folder_path = Path(folder_result[0])
        
        if action == "skip":
            cleanup_staging_file(staging_path)
            result["status"] = "skipped"
            # Check if all files are done
            files_needing_action = any(r["status"] in ["duplicate_detected", "needs_positioning"] for r in upload_jobs[job_id]["results"])
            if not files_needing_action:
                upload_jobs[job_id]["status"] = "complete"
            return {"status": "ok", "action": "skipped"}
        
        elif action == "overwrite":
            # Delete old image file and DB entry
            old_image_id = result["duplicate"]["id"]
            if old_image_id:
                delete_image_completely(old_image_id)
            
            # Process new file like normal
            md5_hash = compute_md5(staging_path)
            image_id = add_image_to_db(str(folder_path / filename), folder_id, md5_hash)
            
            if not image_id:
                return {"error": "Failed to add image to database"}
            
            frameready_path = crop_and_export_frameready(staging_path, folder_path, image_id)
            final_path = folder_path / filename
            staging_path.rename(final_path)
            
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('UPDATE images SET path = ? WHERE id = ?', (str(final_path), image_id))
            conn.commit()
            conn.close()
            
            result["status"] = "success"
            result["id"] = image_id
            result["frameready"] = frameready_path
            # Check if all files are done
            files_needing_action = any(r["status"] in ["duplicate_detected", "needs_positioning"] for r in upload_jobs[job_id]["results"])
            if not files_needing_action:
                upload_jobs[job_id]["status"] = "complete"
            return {"status": "ok", "id": image_id}
        
        elif action == "import_anyway":
            # Rename file to avoid conflict
            base, ext = filename.rsplit('.', 1) if '.' in filename else (filename, '')
            new_filename = f"{base}_1.{ext}" if ext else f"{filename}_1"
            
            md5_hash = compute_md5(staging_path)
            image_id = add_image_to_db(str(folder_path / new_filename), folder_id, md5_hash)
            
            if not image_id:
                return {"error": "Failed to add image to database"}
            
            frameready_path = crop_and_export_frameready(staging_path, folder_path, image_id)
            final_path = folder_path / new_filename
            staging_path.rename(final_path)
            
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('UPDATE images SET path = ? WHERE id = ?', (str(final_path), image_id))
            conn.commit()
            conn.close()
            
            result["status"] = "success"
            result["id"] = image_id
            result["frameready"] = frameready_path
            # Check if all files are done
            files_needing_action = any(r["status"] in ["duplicate_detected", "needs_positioning"] for r in upload_jobs[job_id]["results"])
            if not files_needing_action:
                upload_jobs[job_id]["status"] = "complete"
            return {"status": "ok", "id": image_id, "renamed_to": new_filename}
        
        else:
            return {"error": "Invalid action"}
        
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/images/upload/{job_id}/position")
async def finalize_positioned_upload(job_id: str, req: PositionRequest):
    """
    User has positioned the crop box. Finalize this file.
    crop_box: {x, y, width, height} in normalized 0-1 coords
    """
    filename = req.filename
    crop_box = req.crop_box
    
    if job_id not in upload_jobs:
        return {"error": "Job not found"}
    
    try:
        result = next((r for r in upload_jobs[job_id]["results"] if r["filename"] == filename), None)
        if not result or result["status"] != "needs_positioning":
            return {"error": "File not found in positioning queue"}
        
        staging_path = Path(result["staging_path"])
        if not staging_path.exists():
            return {"error": "Staging file not found"}
        
        folder_id = upload_jobs[job_id]["folder_id"]
        
        # Get folder path
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('SELECT path FROM folders WHERE id = ?', (folder_id,))
        folder_result = cursor.fetchone()
        conn.close()
        
        if not folder_result:
            return {"error": "Folder not found"}
        
        folder_path = Path(folder_result[0])
        
        # Create image record
        md5_hash = compute_md5(staging_path)
        image_id = add_image_to_db(str(folder_path / filename), folder_id, md5_hash)
        
        if not image_id:
            return {"error": "Failed to add image to database"}
        
        # Crop with user positioning
        frameready_path = crop_and_export_frameready(staging_path, folder_path, image_id, crop_box)
        
        # Move to final location
        final_path = folder_path / filename
        staging_path.rename(final_path)
        
        # Update DB
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('UPDATE images SET path = ? WHERE id = ?', (str(final_path), image_id))
        conn.commit()
        conn.close()
        
        # Update job result
        result["status"] = "success"
        result["id"] = image_id
        result["frameready"] = frameready_path
        
        # Check if all files are now done
        files_needing_action = any(r["status"] in ["duplicate_detected", "needs_positioning"] for r in upload_jobs[job_id]["results"])
        if not files_needing_action:
            upload_jobs[job_id]["status"] = "complete"
        
        return {"status": "ok", "id": image_id, "frameready": frameready_path}
        
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/images/upload/{job_id}/position-skip")
async def skip_positioned_upload(job_id: str, req: SkipPositionRequest):
    """
    User skipped positioning. Mark file as skipped.
    """
    filename = req.filename
    
    if job_id not in upload_jobs:
        return {"error": "Job not found"}
    
    try:
        result = next((r for r in upload_jobs[job_id]["results"] if r["filename"] == filename), None)
        if not result or result["status"] != "needs_positioning":
            return {"error": "File not found in positioning queue"}
        
        staging_path = Path(result["staging_path"])
        cleanup_staging_file(staging_path)
        
        result["status"] = "skipped"
        
        # Check if all files are now done
        files_needing_action = any(r["status"] in ["duplicate_detected", "needs_positioning"] for r in upload_jobs[job_id]["results"])
        if not files_needing_action:
            upload_jobs[job_id]["status"] = "complete"
        
        return {"status": "ok", "action": "skipped"}
        
    except Exception as e:
        return {"error": str(e)}

@app.get("/api/images/{image_id}/download")
def download_image(image_id: int):
    """Download original image file"""
    try:
        img = get_image_by_id(image_id)
        if not img:
            return {"error": "Image not found"}
        
        file_path = Path(img["path"])
        if not file_path.exists():
            return {"error": "File not found"}
        
        return FileResponse(
            file_path,
            media_type="application/octet-stream",
            filename=file_path.name
        )
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/images/download-zip")
def download_zip(image_ids: list[int]):
    """Download multiple images as zip"""
    try:
        if not image_ids or len(image_ids) == 0:
            return {"error": "No images selected"}
        
        # Create zip in memory
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for image_id in image_ids:
                img = get_image_by_id(image_id)
                if not img:
                    continue
                
                file_path = Path(img["path"])
                if file_path.exists():
                    # Add file to zip with just the filename
                    zip_file.write(file_path, arcname=file_path.name)
        
        zip_buffer.seek(0)
        return StreamingResponse(
            iter([zip_buffer.getvalue()]),
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=images.zip"}
        )
    except Exception as e:
        return {"error": str(e)}

# Mount static files AFTER all API routes (catch-all, must be last)
static_path = Path(__file__).parent / "static"
if static_path.exists():
    app.mount("/", StaticFiles(directory=static_path, html=True), name="static")