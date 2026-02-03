from fastapi import FastAPI
from starlette.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from PIL import Image
import sqlite3
import io
from datetime import datetime

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database
def init_db():
    conn = sqlite3.connect('frametagger.db')
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

# FOLDER FUNCTIONS
def get_folders_from_db():
    conn = sqlite3.connect('frametagger.db')
    cursor = conn.cursor()
    cursor.execute('SELECT id, path FROM folders ORDER BY created_at')
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "path": r[1]} for r in results]

def add_folder_to_db(path):
    conn = sqlite3.connect('frametagger.db')
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
    conn = sqlite3.connect('frametagger.db')
    cursor = conn.cursor()
    cursor.execute('DELETE FROM folders WHERE id = ?', (folder_id,))
    conn.commit()
    conn.close()

# TAG FUNCTIONS
def get_tags_from_db():
    conn = sqlite3.connect('frametagger.db')
    cursor = conn.cursor()
    cursor.execute('SELECT id, name FROM tags ORDER BY name')
    results = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1]} for r in results]

def create_tag(name):
    """Create a single tag"""
    conn = sqlite3.connect('frametagger.db')
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
    conn = sqlite3.connect('frametagger.db')
    cursor = conn.cursor()
    cursor.execute('DELETE FROM tags WHERE id = ?', (tag_id,))
    conn.commit()
    conn.close()

def get_image_tags(image_id):
    """Get all tags for an image"""
    conn = sqlite3.connect('frametagger.db')
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
    conn = sqlite3.connect('frametagger.db')
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
    conn = sqlite3.connect('frametagger.db')
    cursor = conn.cursor()
    cursor.execute('DELETE FROM image_tags WHERE image_id = ? AND tag_id = ?',
                  (image_id, tag_id))
    conn.commit()
    conn.close()

def delete_image_from_db(image_id):
    """Remove image from database only (keep file)"""
    conn = sqlite3.connect('frametagger.db')
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
    conn = sqlite3.connect('frametagger.db')
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
    conn = sqlite3.connect('frametagger.db')
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
    return {
        "id": result[0],
        "name": file_path.name,
        "path": result[1],
        "folder_id": result[2],
        "folder_path": result[4],
        "date_added": result[3],
        "tags": get_image_tags(image_id)
    }

# IMAGE FUNCTIONS
def add_image_to_db(path, folder_id):
    """Add image to database if not already there"""
    conn = sqlite3.connect('frametagger.db')
    cursor = conn.cursor()
    try:
        cursor.execute('INSERT INTO images (path, folder_id, date_added) VALUES (?, ?, ?)',
                      (path, folder_id, datetime.now().isoformat()))
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
        conn = sqlite3.connect('frametagger.db')
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
            all_images.append({
                "id": r[0],
                "name": file_path.name,
                "path": r[1],
                "folder_id": r[2],
                "folder_path": r[4],
                "date_added": r[3],
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

# Mount static files AFTER all API routes (catch-all, must be last)
static_path = Path(__file__).parent / "static"
if static_path.exists():
    app.mount("/", StaticFiles(directory=static_path, html=True), name="static")