import { useEffect, useState } from 'react'
import './App.css'
import logoImg from './assets/logo/framefolio_logo.png'
import iconWhite from './assets/icons/framefolio_icon_white.png'
import iconBlack from './assets/icons/framefolio_icon_black.png'

const API_URL = `${window.location.origin}/api`

function ImageModal({ image, tags, onClose, onTagImage, onUntagImage, onCreateTag, onRemoveImage, onDeleteImage }) {
  const [tagSearch, setTagSearch] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null) // 'remove' or 'delete' or null
  
  if (!image) return null
  
  const availableTags = tags.filter(tag => !image.tags.some(t => t.id === tag.id))
  const searchQuery = tagSearch.toLowerCase().trim()
  const filteredTags = searchQuery 
    ? tags.filter(tag => tag.name.toLowerCase().includes(searchQuery))
    : []
  const tagExists = tags.some(tag => tag.name.toLowerCase() === searchQuery)
  const canCreateTag = searchQuery.length > 0 && !tagExists

  async function handleAddTag(tagId) {
    await onTagImage(image.id, tagId)
    setTagSearch('')
  }

  async function handleCreateTag(name) {
    await onCreateTag(name)
  }

  async function confirmDelete(type) {
    if (type === 'remove') {
      await onRemoveImage(image.id)
    } else if (type === 'delete') {
      await onDeleteImage(image.id)
    }
    setDeleteConfirm(null)
    onClose()
  }

  const dateAdded = new Date(image.date_added).toLocaleDateString()

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="image-modal" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close" onClick={onClose}>✕</button>
          
          <div className="modal-image-preview">
            <img src={`${API_URL}/images/${image.id}/preview`} alt={image.name} />
          </div>

          <div className="modal-image-info">
              <div className="modal-properties">
                <div className="property">
                  <span className="property-label">Filename</span>
                  <span className="property-value">{image.name}</span>
                </div>
                
                <div className="property">
                  <span className="property-label">Folder</span>
                  <span className="property-value">{image.folder_path}</span>
                </div>
                
                <div className="property">
                  <span className="property-label">Date Added</span>
                  <span className="property-value">{dateAdded}</span>
                </div>
              </div>

              <div className="modal-tags-section">
                <div className="modal-tag-search">
                  <input
                    type="text"
                    placeholder="Search or create tags..."
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    className="modal-tag-input"
                  />
                  
                  {tagSearch && (
                    <div className="modal-tag-dropdown">
                      {filteredTags.length > 0 && (
                        <div>
                          {filteredTags.map(tag => (
                            <button
                              key={tag.id}
                              className="modal-tag-option"
                              onClick={() => handleAddTag(tag.id)}
                            >
                              + {tag.name}
                            </button>
                          ))}
                        </div>
                      )}
                      
                      {canCreateTag && (
                        <button
                          className="modal-tag-create"
                          onClick={() => handleCreateTag(tagSearch)}
                        >
                          + Create "{tagSearch}"
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="modal-current-tags">
                  {image.tags.length === 0 ? (
                    <p className="no-tags">No tags yet</p>
                  ) : (
                    <div className="tags-list">
                      {image.tags.map(tag => (
                        <span key={tag.id} className="tag-badge-modal">
                          {tag.name}
                          <button
                            className="tag-remove"
                            onClick={() => onUntagImage(image.id, tag.id)}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
              </div>
            </div>

            <div className="modal-delete-actions">
              <button 
                className="btn-delete-secondary"
                onClick={() => setDeleteConfirm('remove')}
              >
                Remove from FrameFolio
              </button>
              <button 
                className="btn-delete-danger"
                onClick={() => setDeleteConfirm('delete')}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-confirm" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm {deleteConfirm === 'remove' ? 'Removal' : 'Deletion'}</h3>
            {deleteConfirm === 'remove' ? (
              <p>Remove <strong>{image.name}</strong> from FrameFolio? The file will be kept.</p>
            ) : (
              <p>Delete <strong>{image.name}</strong> completely? This cannot be undone.</p>
            )}
            <div className="modal-confirm-buttons">
              <button className="btn-secondary" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </button>
              <button 
                className={deleteConfirm === 'remove' ? 'btn-secondary' : 'btn-danger'}
                onClick={() => confirmDelete(deleteConfirm)}
              >
                {deleteConfirm === 'remove' ? 'Remove' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function App() {
  const [images, setImages] = useState([])
  const [tags, setTags] = useState([])
  const [folders, setFolders] = useState([])
  const [selectedImage, setSelectedImage] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')
  
  // Navigation state
  const [activeSection, setActiveSection] = useState('images')
  
  // Multi-select state
  const [selectedImages, setSelectedImages] = useState(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [batchTagSearch, setBatchTagSearch] = useState('')
  const [viewMode, setViewMode] = useState('medium')
  
  // Folder browser modal
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [currentPath, setCurrentPath] = useState('/')
  const [browsingFolders, setBrowsingFolders] = useState([])
  const [parentPath, setParentPath] = useState(null)
  const [folderLoading, setFolderLoading] = useState(false)
  
  // Tag creation modal
  const [showTagModal, setShowTagModal] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tagPreview, setTagPreview] = useState(null)
  
  // Rescan state
  const [isScanning, setIsScanning] = useState(false)

  // Load data on mount
  useEffect(() => {
    loadImages()
    loadTags()
    loadFolders()
  }, [])

  // Apply theme
  useEffect(() => {
    localStorage.setItem('theme', theme)
    
    let themeToApply = theme
    if (theme === 'auto') {
      // Detect system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      themeToApply = prefersDark ? 'dark' : 'light'
    }
    
    document.documentElement.setAttribute('data-theme', themeToApply)
    
    // If auto, listen for system theme changes
    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e) => {
        const newTheme = e.matches ? 'dark' : 'light'
        document.documentElement.setAttribute('data-theme', newTheme)
      }
      
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [theme])

  // Browse folders on modal open
  useEffect(() => {
    if (showFolderModal) {
      browseFolders(currentPath)
    }
  }, [showFolderModal])

  async function loadImages() {
    try {
      const response = await fetch(`${API_URL}/images`)
      const data = await response.json()
      setImages(data.images || [])
    } catch (err) {
      console.error(err)
    }
  }

  async function loadTags() {
    try {
      const response = await fetch(`${API_URL}/tags`)
      const data = await response.json()
      setTags(data.tags || [])
    } catch (err) {
      console.error(err)
    }
  }

  async function loadFolders() {
    try {
      const response = await fetch(`${API_URL}/folders`)
      const data = await response.json()
      setFolders(data.folders || [])
    } catch (err) {
      console.error(err)
    }
  }

  async function rescanLibrary() {
    setIsScanning(true)
    try {
      const response = await fetch(`${API_URL}/rescan`, { method: "POST" })
      const data = await response.json()
      if (!data.error) {
        await loadImages()
      }
    } catch (err) {
      console.error("Rescan failed:", err)
    } finally {
      setIsScanning(false)
    }
  }

  async function browseFolders(path) {
    setFolderLoading(true)
    try {
      const response = await fetch(`${API_URL}/folders/browse?path=${encodeURIComponent(path)}`)
      const data = await response.json()
      if (!data.error) {
        setCurrentPath(data.current_path)
        setBrowsingFolders(data.folders || [])
        setParentPath(data.parent_path)
      }
    } catch (err) {
      console.error(err)
    }
    setFolderLoading(false)
  }

  async function selectFolder(path) {
    try {
      const response = await fetch(
        `${API_URL}/folders/add?path=${encodeURIComponent(path)}`,
        { method: 'POST' }
      )
      const data = await response.json()
      if (!data.error) {
        await loadFolders()
        setShowFolderModal(false)
        await loadImages()
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function removeFolder(folderId) {
    if (!window.confirm('Remove folder and all associated images?')) return
    try {
      const response = await fetch(`${API_URL}/folders/${folderId}`, { method: 'DELETE' })
      const data = await response.json()
      if (!data.error) {
        await loadFolders()
        await loadImages()
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function createTag(name) {
    try {
      const response = await fetch(
        `${API_URL}/tags?name=${encodeURIComponent(name.trim())}`,
        { method: 'POST' }
      )
      const data = await response.json()
      if (!data.error) {
        await loadTags()
        return true
      }
    } catch (err) {
      console.error('Error:', err.message)
    }
    return false
  }

  async function handleCreateTags() {
    if (!tagInput.trim()) return
    const newTagNames = tagInput.split(',').map(t => t.trim()).filter(t => t)
    if (newTagNames.length === 0) return
    setTagPreview(newTagNames)
  }

  async function confirmCreateTags() {
    if (!tagPreview) return
    try {
      for (const name of tagPreview) {
        await fetch(`${API_URL}/tags?name=${encodeURIComponent(name)}`, { method: 'POST' })
      }
      await loadTags()
      setTagInput('')
      setTagPreview(null)
      setShowTagModal(false)
    } catch (err) {
      console.error('Error:', err.message)
    }
  }

  async function deleteTag(tagId) {
    if (!window.confirm('Delete this tag?')) return
    try {
      await fetch(`${API_URL}/tags/${tagId}`, { method: 'DELETE' })
      await loadTags()
      await loadImages()
    } catch (err) {
      console.error('Error:', err.message)
    }
  }

  // Multi-select functions
  function toggleSelectImage(imageId) {
    const newSelected = new Set(selectedImages)
    if (newSelected.has(imageId)) {
      newSelected.delete(imageId)
    } else {
      newSelected.add(imageId)
    }
    setSelectedImages(newSelected)
  }

  function selectAllImages() {
    setSelectedImages(new Set(filteredImages.map(img => img.id)))
  }

  function clearSelection() {
    setSelectedImages(new Set())
  }

  async function addTagToImage(imageId, tagId) {
    try {
      const response = await fetch(
        `${API_URL}/images/${imageId}/tag?tag_id=${tagId}`,
        { method: 'POST' }
      )
      const data = await response.json()
      if (!data.error) {
        await loadImages()
        if (selectedImage?.id === imageId) {
          const updated = await fetch(`${API_URL}/images/${imageId}`).then(r => r.json())
          setSelectedImage(updated)
        }
      }
    } catch (err) {
      console.error('Error:', err.message)
    }
  }

  async function removeTagFromImage(imageId, tagId) {
    try {
      await fetch(
        `${API_URL}/images/${imageId}/tag?tag_id=${tagId}`,
        { method: 'DELETE' }
      )
      await loadImages()
      if (selectedImage?.id === imageId) {
        const updated = await fetch(`${API_URL}/images/${imageId}`).then(r => r.json())
        setSelectedImage(updated)
      }
    } catch (err) {
      console.error('Error:', err.message)
    }
  }

  async function addTagToSelected(tagId) {
    try {
      for (const imageId of selectedImages) {
        await fetch(
          `${API_URL}/images/${imageId}/tag?tag_id=${tagId}`,
          { method: 'POST' }
        )
      }
      await loadImages()
      setBatchTagSearch('')
    } catch (err) {
      console.error('Error:', err.message)
    }
  }

  async function removeTagFromSelected(tagId) {
    try {
      for (const imageId of selectedImages) {
        await fetch(
          `${API_URL}/images/${imageId}/tag?tag_id=${tagId}`,
          { method: 'DELETE' }
        )
      }
      await loadImages()
    } catch (err) {
      console.error('Error:', err.message)
    }
  }

  async function removeImageFromDb(imageId) {
    try {
      const response = await fetch(`${API_URL}/images/${imageId}/remove`, { method: 'DELETE' })
      if (response.ok) {
        await loadImages()
      }
    } catch (err) {
      console.error('Error:', err.message)
    }
  }

  async function deleteImageCompletely(imageId) {
    try {
      const response = await fetch(`${API_URL}/images/${imageId}/delete`, { method: 'DELETE' })
      if (response.ok) {
        await loadImages()
      }
    } catch (err) {
      console.error('Error:', err.message)
    }
  }

  async function removeSelectedFromDb() {
    if (!window.confirm(`Remove ${selectedImages.size} image(s) from FrameFolio? Files will be kept.`)) return
    try {
      for (const imageId of selectedImages) {
        await fetch(`${API_URL}/images/${imageId}/remove`, { method: 'DELETE' })
      }
      await loadImages()
      setSelectedImages(new Set())
    } catch (err) {
      console.error('Error:', err.message)
    }
  }

  async function deleteSelectedCompletely() {
    if (!window.confirm(`Delete ${selectedImages.size} image(s) completely? This cannot be undone.`)) return
    try {
      for (const imageId of selectedImages) {
        await fetch(`${API_URL}/images/${imageId}/delete`, { method: 'DELETE' })
      }
      await loadImages()
      setSelectedImages(new Set())
    } catch (err) {
      console.error('Error:', err.message)
    }
  }

  // Search and filter
  const filteredImages = images.filter(img => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const matchesFilename = img.name.toLowerCase().includes(query)
    const matchesTags = img.tags.some(tag => tag.name.toLowerCase().includes(query))
    return matchesFilename || matchesTags
  })

  // Get common tags across all selected images
  function getCommonTags() {
    if (selectedImages.size === 0) return []
    
    const selectedImageList = Array.from(selectedImages).map(id => 
      images.find(img => img.id === id)
    ).filter(img => img)
    
    if (selectedImageList.length === 0) return []
    
    const firstImageTags = new Set(selectedImageList[0].tags.map(t => t.id))
    
    const commonTagIds = Array.from(firstImageTags).filter(tagId => 
      selectedImageList.every(img => img.tags.some(t => t.id === tagId))
    )
    
    return tags.filter(tag => commonTagIds.includes(tag.id))
  }

  // Filter logic for tag search
  const batchSearchQuery = batchTagSearch.toLowerCase().trim()
  const batchFilteredTags = batchSearchQuery 
    ? tags.filter(tag => tag.name.toLowerCase().includes(batchSearchQuery))
    : []
  const batchTagExists = tags.some(tag => tag.name.toLowerCase() === batchSearchQuery)
  const batchCanCreateTag = batchSearchQuery.length > 0 && !batchTagExists

  const commonTags = getCommonTags()

  return (
    <div className="app" data-theme={theme}>
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <img src={logoImg} alt="FrameFolio" style={{ height: '40px', width: 'auto' }} />
        </div>
        
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeSection === 'images' ? 'active' : ''}`}
            onClick={() => setActiveSection('images')}
          >
            🖼️ Images
          </button>
          <button
            className={`nav-item ${activeSection === 'library' ? 'active' : ''}`}
            onClick={() => setActiveSection('library')}
          >
            📁 Library
          </button>
          <button
            className={`nav-item ${activeSection === 'tags' ? 'active' : ''}`}
            onClick={() => setActiveSection('tags')}
          >
            🏷️ Tags
          </button>
          <button
            className={`nav-item ${activeSection === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveSection('appearance')}
          >
            ⚙️ Appearance
          </button>
        </nav>
        
        <div className="sidebar-footer">
          <img src={theme === 'light' ? iconBlack : iconWhite} alt="FrameFolio Icon" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Images Section */}
        {activeSection === 'images' && (
          <section className="content-section">
            {/* Stats */}
            <div className="stats-bar">
              <div className="stat-item">
                <span className="stat-label">Total Images</span>
                <span className="stat-value">{images.length}</span>
              </div>
            </div>

            {/* Search & Controls */}
            <div className="images-controls">
              <input
                type="text"
                placeholder="Search by filename or tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
              
              {selectedImages.size > 0 && (
                <div className="selection-info">
                  <span>{selectedImages.size} selected</span>
                  <button className="btn-secondary" onClick={clearSelection}>
                    Clear
                  </button>
                </div>
              )}
              
              {filteredImages.length > 0 && (
                <button className="btn-secondary" onClick={selectAllImages}>
                  Select All
                </button>
              )}
            </div>

            {/* View Mode Selector */}
            <div className="view-mode-selector">
              <button
                className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
                title="List view"
              >
                ☰
              </button>
              <button
                className={`view-btn ${viewMode === 'small' ? 'active' : ''}`}
                onClick={() => setViewMode('small')}
                title="Small thumbnails"
              >
                ⊞⊞⊞
              </button>
              <button
                className={`view-btn ${viewMode === 'medium' ? 'active' : ''}`}
                onClick={() => setViewMode('medium')}
                title="Medium thumbnails"
              >
                ⊞⊞
              </button>
              <button
                className={`view-btn ${viewMode === 'large' ? 'active' : ''}`}
                onClick={() => setViewMode('large')}
                title="Large thumbnails"
              >
                ⊞
              </button>
            </div>

            {/* Batch Tag Bar */}
            {selectedImages.size > 0 && (
              <div className="batch-tag-section">
                {/* Common Tags (for removal) */}
                {commonTags.length > 0 && (
                  <div className="common-tags-bar">
                    <span className="common-tags-label">Applied to all:</span>
                    <div className="common-tags-list">
                      {commonTags.map(tag => (
                        <button
                          key={tag.id}
                          className="common-tag-badge"
                          onClick={() => removeTagFromSelected(tag.id)}
                          title="Click to remove from all selected"
                        >
                          {tag.name} <span className="remove-x">✕</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Delete Actions */}
                <div className="batch-delete-bar">
                  <button 
                    className="btn-delete-secondary"
                    onClick={removeSelectedFromDb}
                  >
                    Remove from FrameFolio
                  </button>
                  <button 
                    className="btn-delete-danger"
                    onClick={deleteSelectedCompletely}
                  >
                    Delete
                  </button>
                </div>

                {/* Add Tags */}
                <div className="batch-tag-bar">
                  <input
                    type="text"
                    placeholder="Search tags to apply..."
                    value={batchTagSearch}
                    onChange={(e) => setBatchTagSearch(e.target.value)}
                    className="batch-tag-input"
                  />
                  
                  {batchTagSearch && (
                    <div className="batch-tag-options">
                      {batchFilteredTags.length > 0 && (
                        <div>
                          {batchFilteredTags.map(tag => (
                            <button
                              key={tag.id}
                              className="batch-tag-option"
                              onClick={() => addTagToSelected(tag.id)}
                            >
                              + {tag.name}
                            </button>
                          ))}
                        </div>
                      )}
                      
                      {batchCanCreateTag && (
                        <button
                          className="batch-tag-create"
                          onClick={() => createTag(batchTagSearch)}
                        >
                          + Create "{batchTagSearch}"
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Images Grid */}
            <div className={`images-grid-with-select view-${viewMode}`}>
              {filteredImages.map((img) => (
                <div 
                  key={img.id}
                  className={`image-card-wrapper ${selectedImages.has(img.id) ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="image-checkbox"
                    checked={selectedImages.has(img.id)}
                    onChange={() => toggleSelectImage(img.id)}
                  />
                  <div 
                    className="image-card"
                    onClick={() => setSelectedImage(img)}
                  >
                    <img 
                      src={`${API_URL}/images/${img.id}/thumbnail`} 
                      alt={img.name}
                      className="image-thumbnail"
                    />
                    <p>{img.name}</p>
                    {img.tags.length > 0 && (
                      <div className="image-tags">
                        {img.tags.slice(0, 3).map(t => <span key={t.id}>#{t.name}</span>)}
                        {img.tags.length > 3 && <span>+{img.tags.length - 3}</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {filteredImages.length === 0 && (
              <div className="empty-state">
                {searchQuery ? 'No images match your search.' : 'No images found. Add folders in Library to get started.'}
              </div>
            )}
          </section>
        )}

        {/* Library Section */}
        {activeSection === 'library' && (
          <section className="content-section">
            <h2>Folder Management</h2>
            <div className="library-controls">
              <button className="btn-primary" onClick={() => setShowFolderModal(true)}>
                + Add Folder
              </button>
              <button 
                className="btn-secondary" 
                onClick={rescanLibrary}
                disabled={isScanning}
              >
                {isScanning ? '⟳ Scanning...' : '⟳ Rescan Library'}
              </button>
            </div>
            
            <div className="folders-list">
              {folders.length === 0 ? (
                <p className="empty-state">No folders configured yet</p>
              ) : (
                folders.map((folder) => (
                  <div key={folder.id} className="folder-item">
                    <div className="folder-path">{folder.path}</div>
                    <button
                      className="btn-danger"
                      onClick={() => removeFolder(folder.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* Manage Tags Section */}
        {activeSection === 'tags' && (
          <section className="content-section">
            <h2>Tag Management</h2>
            <button className="btn-primary" onClick={() => setShowTagModal(true)}>
              + Add Tags
            </button>
            
            <div className="tags-list">
              {tags.length === 0 ? (
                <p className="empty-state">No tags yet</p>
              ) : (
                tags.map((tag) => (
                  <div key={tag.id} className="tag-item">
                    <span>{tag.name}</span>
                    <button
                      className="btn-danger"
                      onClick={() => deleteTag(tag.id)}
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* Settings Section */}
        {activeSection === 'appearance' && (
          <section className="content-section">
            <h2>UI Management</h2>
            
            <div className="settings-group">
              <h3>Theme</h3>
              <div className="theme-options">
                <label>
                  <input
                    type="radio"
                    name="theme"
                    value="light"
                    checked={theme === 'light'}
                    onChange={(e) => setTheme(e.target.value)}
                  />
                  ☀️ Light
                </label>
                <label>
                  <input
                    type="radio"
                    name="theme"
                    value="dark"
                    checked={theme === 'dark'}
                    onChange={(e) => setTheme(e.target.value)}
                  />
                  🌙 Dark
                </label>
                <label>
                  <input
                    type="radio"
                    name="theme"
                    value="auto"
                    checked={theme === 'auto'}
                    onChange={(e) => setTheme(e.target.value)}
                  />
                  ⚙️ Auto (System)
                </label>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Image Modal */}
      <ImageModal 
        image={selectedImage}
        tags={tags}
        onClose={() => setSelectedImage(null)}
        onTagImage={addTagToImage}
        onUntagImage={removeTagFromImage}
        onCreateTag={createTag}
        onRemoveImage={removeImageFromDb}
        onDeleteImage={deleteImageCompletely}
      />

      {/* Folder Browser Modal */}
      {showFolderModal && (
        <div className="modal-overlay" onClick={() => setShowFolderModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Select Folder</h2>
              <button className="modal-close" onClick={() => setShowFolderModal(false)}>✕</button>
            </div>
            
            <div className="modal-content">
              <div className="browser-path">
                <button 
                  className="btn-secondary"
                  onClick={() => parentPath && browseFolders(parentPath)}
                  disabled={!parentPath}
                >
                  ← Back
                </button>
                <span className="path-text">{currentPath}</span>
              </div>
              
              {folderLoading ? (
                <div className="loading">Loading...</div>
              ) : (
                <div className="folders-browser">
                  {browsingFolders.length === 0 ? (
                    <p className="empty-state">No subdirectories</p>
                  ) : (
                    browsingFolders.map((folder) => (
                      <div key={folder.path} className="browser-item">
                        <span 
                          className="folder-name"
                          onClick={() => browseFolders(folder.path)}
                        >
                          📁 {folder.name}
                        </span>
                        <button
                          className="btn-success"
                          onClick={() => selectFolder(folder.path)}
                        >
                          Add
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowFolderModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tag Creation Modal */}
      {showTagModal && !tagPreview && (
        <div className="modal-overlay" onClick={() => setShowTagModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Create Tags</h2>
              <button className="modal-close" onClick={() => setShowTagModal(false)}>✕</button>
            </div>
            
            <div className="modal-content">
              <label>Tag names (comma-separated):</label>
              <input
                type="text"
                placeholder="Portrait, Landscape, Monet"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  marginBottom: '10px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)'
                }}
              />
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                💡 Separate multiple tags with commas
              </p>
            </div>
            
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setShowTagModal(false); setTagInput('') }}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreateTags} disabled={!tagInput.trim()}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tag Preview Modal */}
      {tagPreview && (
        <div className="modal-overlay" onClick={() => setTagPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Confirm</h2>
              <button className="modal-close" onClick={() => setTagPreview(null)}>✕</button>
            </div>
            
            <div className="modal-content">
              <p>Create {tagPreview.length} tag{tagPreview.length > 1 ? 's' : ''}?</p>
              <div className="tag-preview-list">
                {tagPreview.map((name, i) => (
                  <div key={i} className="tag-preview-item">
                    {name}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setTagPreview(null)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={confirmCreateTags}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App