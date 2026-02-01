from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Table, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import os
from pathlib import Path

# Database setup
DATABASE_URL = "sqlite:///./imagetagger.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Image-Tag association table
image_tags = Table(
    'image_tags',
    Base.metadata,
    Column('image_id', Integer, ForeignKey('images.id'), primary_key=True),
    Column('tag_id', Integer, ForeignKey('tags.id'), primary_key=True)
)

# Database Models
class Folder(Base):
    __tablename__ = "folders"
    id = Column(Integer, primary_key=True)
    path = Column(String, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    images = relationship("Image", back_populates="folder", cascade="all, delete-orphan")

class Image(Base):
    __tablename__ = "images"
    id = Column(Integer, primary_key=True)
    filename = Column(String, unique=True)
    original_filename = Column(String)
    path = Column(String)
    folder_id = Column(Integer, ForeignKey('folders.id'), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    folder = relationship("Folder", back_populates="images")
    tags = relationship("Tag", secondary=image_tags, back_populates="images")

class Tag(Base):
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True)
    color = Column(String, default="#6366f1")
    images = relationship("Image", secondary=image_tags, back_populates="tags")

# Create tables
Base.metadata.create_all(bind=engine)

# Pydantic models
class FolderSchema(BaseModel):
    id: Optional[int] = None
    path: str
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True

class TagSchema(BaseModel):
    id: Optional[int] = None
    name: str
    color: str = "#6366f1"
    class Config:
        from_attributes = True

class ImageSchema(BaseModel):
    id: Optional[int] = None
    filename: str
    original_filename: str
    created_at: Optional[datetime] = None
    tags: List[TagSchema] = []
    class Config:
        from_attributes = True

class ImageListSchema(BaseModel):
    id: int
    filename: str
    original_filename: str
    created_at: datetime
    tags: List[TagSchema]
    class Config:
        from_attributes = True

# FastAPI app
app = FastAPI(title="FrameTagger")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create default uploads directory
UPLOAD_DIR = Path("./uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def scan_folder(folder_path: str, folder_id: int, db: Session):
    """Scan a folder and register images"""
    added = 0
    try:
        folder_path = Path(folder_path)
        if not folder_path.exists():
            return 0
        
        image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'}
        files_on_disk = {
            f.name for f in folder_path.glob('*')
            if f.is_file() and f.suffix.lower() in image_extensions
        }
        
        registered_files = {
            img.filename for img in db.query(Image).filter(Image.folder_id == folder_id).all()
        }
        
        for filename in files_on_disk - registered_files:
            file_path = folder_path / filename
            db_image = Image(
                filename=filename,
                original_filename=filename,
                path=str(file_path),
                folder_id=folder_id,
                created_at=datetime.fromtimestamp(file_path.stat().st_ctime)
            )
            db.add(db_image)
            added += 1
        
        if added > 0:
            db.commit()
    except Exception as e:
        print(f"Error scanning folder {folder_path}: {e}")
        db.rollback()
    
    return added

@app.on_event("startup")
async def startup_event():
    """Scan all configured folders on startup"""
    db = SessionLocal()
    try:
        folders = db.query(Folder).all()
        total = 0
        for folder in folders:
            added = scan_folder(folder.path, folder.id, db)
            total += added
        if total > 0:
            print(f"[Startup] Registered {total} new image files")
    finally:
        db.close()

# Folder endpoints
@app.get("/api/folders", response_model=List[FolderSchema])
def get_folders(db: Session = Depends(get_db)):
    return db.query(Folder).all()

@app.post("/api/folders", response_model=FolderSchema)
def add_folder(folder: FolderSchema, db: Session = Depends(get_db)):
    existing = db.query(Folder).filter(Folder.path == folder.path).first()
    if existing:
        raise HTTPException(status_code=400, detail="Folder already added")
    
    db_folder = Folder(path=folder.path)
    db.add(db_folder)
    db.commit()
    db.refresh(db_folder)
    
    # Scan it immediately
    scan_folder(folder.path, db_folder.id, db)
    
    return db_folder

@app.delete("/api/folders/{folder_id}")
def remove_folder(folder_id: int, db: Session = Depends(get_db)):
    folder = db.query(Folder).filter(Folder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    # Delete all images in this folder
    db.query(Image).filter(Image.folder_id == folder_id).delete()
    db.delete(folder)
    db.commit()
    
    return {"status": "success"}

# Image endpoints
@app.get("/api/images", response_model=List[ImageListSchema])
def get_images(skip: int = 0, limit: int = 100, tag_ids: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Image)
    if tag_ids:
        tag_list = [int(tid) for tid in tag_ids.split(",")]
        for tag_id in tag_list:
            query = query.filter(Image.tags.any(Tag.id == tag_id))
    return query.offset(skip).limit(limit).all()

@app.get("/api/images/{image_id}", response_model=ImageSchema)
def get_image(image_id: int, db: Session = Depends(get_db)):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return image

@app.post("/api/images/{image_id}/tags")
def add_tag_to_image(image_id: int, tag_id: int, db: Session = Depends(get_db)):
    image = db.query(Image).filter(Image.id == image_id).first()
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not image or not tag:
        raise HTTPException(status_code=404, detail="Image or tag not found")
    if tag not in image.tags:
        image.tags.append(tag)
        db.commit()
    return {"status": "success"}

@app.delete("/api/images/{image_id}/tags/{tag_id}")
def remove_tag_from_image(image_id: int, tag_id: int, db: Session = Depends(get_db)):
    image = db.query(Image).filter(Image.id == image_id).first()
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not image or not tag:
        raise HTTPException(status_code=404, detail="Image or tag not found")
    if tag in image.tags:
        image.tags.remove(tag)
        db.commit()
    return {"status": "success"}

# Tag endpoints
@app.get("/api/tags", response_model=List[TagSchema])
def get_tags(db: Session = Depends(get_db)):
    return db.query(Tag).all()

@app.post("/api/tags", response_model=TagSchema)
def create_tag(tag: TagSchema, db: Session = Depends(get_db)):
    existing = db.query(Tag).filter(Tag.name == tag.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Tag already exists")
    db_tag = Tag(name=tag.name, color=tag.color)
    db.add(db_tag)
    db.commit()
    db.refresh(db_tag)
    return db_tag

@app.put("/api/tags/{tag_id}", response_model=TagSchema)
def update_tag(tag_id: int, tag: TagSchema, db: Session = Depends(get_db)):
    db_tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not db_tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    db_tag.name = tag.name
    db_tag.color = tag.color
    db.commit()
    db.refresh(db_tag)
    return db_tag

@app.delete("/api/tags/{tag_id}")
def delete_tag(tag_id: int, db: Session = Depends(get_db)):
    db_tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not db_tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.delete(db_tag)
    db.commit()
    return {"status": "success"}

@app.post("/api/upload")
async def upload_images(files: List[UploadFile] = File(...), db: Session = Depends(get_db)):
    uploaded = []
    for file in files:
        filename = f"{datetime.utcnow().timestamp()}_{file.filename}"
        filepath = UPLOAD_DIR / filename
        with open(filepath, "wb") as f:
            content = await file.read()
            f.write(content)
        db_image = Image(
            filename=filename,
            original_filename=file.filename,
            path=str(filepath)
        )
        db.add(db_image)
        db.commit()
        db.refresh(db_image)
        uploaded.append(ImageSchema.from_orm(db_image))
    return uploaded

@app.get("/api/images/{image_id}/download")
def download_image(image_id: int, db: Session = Depends(get_db)):
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(
        image.path,
        filename=image.original_filename,
        media_type="image/jpeg"
    )

@app.post("/api/batch/tag")
def batch_tag_images(image_ids: List[int], tag_id: int, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    count = 0
    for image_id in image_ids:
        image = db.query(Image).filter(Image.id == image_id).first()
        if image and tag not in image.tags:
            image.tags.append(tag)
            count += 1
    db.commit()
    return {"tagged": count}

@app.delete("/api/batch/untag")
def batch_untag_images(image_ids: List[int], tag_id: int, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    count = 0
    for image_id in image_ids:
        image = db.query(Image).filter(Image.id == image_id).first()
        if image and tag in image.tags:
            image.tags.remove(tag)
            count += 1
    db.commit()
    return {"untagged": count}

@app.post("/api/rescan")
def rescan_all_folders(db: Session = Depends(get_db)):
    folders = db.query(Folder).all()
    total = 0
    for folder in folders:
        total += scan_folder(folder.path, folder.id, db)
    return {"added": total, "message": f"Registered {total} new image files"}

@app.get("/health")
def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)