import { useEffect, useState } from 'react'
import './App.css'
import { useImages, useTags, useFolders } from './hooks'
import { useNotifications } from './hooks/useNotifications'
import { Sidebar } from './components/Sidebar'
import { NotificationsContainer } from './components/NotificationsContainer'
import { ConfirmationModal } from './components/modals/ConfirmationModal'
import { UploadProgressModal } from './components/modals/UploadProgressModal'
import { DuplicateModal } from './components/modals/DuplicateModal'
import { CropPositioningModal } from './components/modals/CropPositioningModal'
import * as api from './services/api'
import logoImg from './assets/logo/framefolio_logo.png'
import iconWhite from './assets/icons/framefolio_icon_white.png'
import iconBlack from './assets/icons/framefolio_icon_black.png'

const API_URL = `${window.location.origin}/api`

export default function App() {
  const { images, loadImages, removeImage, deleteImage, addTag, removeTag } = useImages()
  const { tags, loadTags, create: createTag, delete: deleteTag } = useTags()
  const { folders, isScanning, loadFolders, removeFolder, rescan } = useFolders()
  const { notify } = useNotifications()

  const [activeSection, setActiveSection] = useState('images')
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark')
  const [selectedImage, setSelectedImage] = useState(null)
  const [selectedImages, setSelectedImages] = useState(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('filename-asc')
  const [viewMode, setViewMode] = useState('medium')

  // Upload state
  const [uploadState, setUploadState] = useState({ jobId: null, uploadingFile: null, processing: false })
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadFolderId, setUploadFolderId] = useState(null)

  // Library state
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [currentPath, setCurrentPath] = useState('/mnt')
  const [browsingFolders, setBrowsingFolders] = useState([])
  const [parentPath, setParentPath] = useState(null)
  const [folderLoading, setFolderLoading] = useState(false)

  // Tags state
  const [showTagModal, setShowTagModal] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [selectedTags, setSelectedTags] = useState(new Set())

  // Image detail panel state
  const [detailPanelTags, setDetailPanelTags] = useState([])
  const [tagSearchInput, setTagSearchInput] = useState('')

  // Confirmation modal state
  const [confirmation, setConfirmation] = useState(null)

  const showConfirmation = (message, onConfirm, isDanger = false) => {
    setConfirmation({
      message,
      onConfirm: () => {
        onConfirm()
        setConfirmation(null)
      },
      onCancel: () => setConfirmation(null),
      isDanger
    })
  }

  useEffect(() => {
    localStorage.setItem('theme', theme)
    let themeToApply = theme
    if (theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      themeToApply = prefersDark ? 'dark' : 'light'
    }
    document.documentElement.setAttribute('data-theme', themeToApply)
  }, [theme])

  // Update detail panel tags when selectedImage changes
  useEffect(() => {
    if (selectedImage) {
      setDetailPanelTags(selectedImage.tags || [])
    }
  }, [selectedImage])

  async function browseFoldersHandler(path) {
    setFolderLoading(true)
    try {
      const data = await api.browseFolders(path)
      if (data.error) {
        notify('Error browsing folders: ' + data.error, 'error')
        return
      }
      setCurrentPath(data.current_path)
      setBrowsingFolders(data.folders || [])
      setParentPath(data.parent_path)
    } catch (err) {
      notify('Error browsing folders: ' + err.message, 'error')
      console.error(err)
    } finally {
      setFolderLoading(false)
    }
  }

  async function addFolderHandler(path) {
    try {
      const data = await api.addFolder(path)
      if (data.error) {
        notify('Error adding folder: ' + data.error, 'error')
        return
      }
      await loadFolders()
      setShowFolderModal(false)
      await loadImages()
      notify('Folder added successfully!', 'success')
    } catch (err) {
      notify('Error adding folder: ' + err.message, 'error')
      console.error(err)
    }
  }

  async function handleUpload(e) {
    if (!uploadFolderId) return
    const files = e.target.files
    if (files.length === 0) return

    try {
      const startData = await api.startUpload(uploadFolderId, files)
      if (startData.error) {
        notify('Upload failed: ' + startData.error, 'error')
        return
      }
      setUploadState({ jobId: startData.job_id, uploadingFile: null, processing: true })
      pollUploadStatus(startData.job_id)
      e.target.value = ''
    } catch (err) {
      console.error(err)
      notify('Upload failed: ' + err.message, 'error')
    }
  }

  async function pollUploadStatus(jobId) {
    const pollInterval = setInterval(async () => {
      try {
        const status = await api.getUploadStatus(jobId)
        const needsAction = status.results.find(r => r.status === 'duplicate_detected' || r.status === 'needs_positioning')
        if (needsAction) {
          clearInterval(pollInterval)
          setUploadState(prev => ({ ...prev, uploadingFile: needsAction }))
          return
        }
        if (status.status === 'complete') {
          clearInterval(pollInterval)
          await loadImages()
          setShowUploadModal(false)
          setUploadFolderId(null)
          setUploadState({ jobId: null, uploadingFile: null, processing: false })
          const successful = status.results.filter(r => r.status === 'success').length
          notify(`Upload complete! ${successful}/${status.total_files} images uploaded.`, 'success')
        }
      } catch (err) {
        clearInterval(pollInterval)
        console.error(err)
      }
    }, 300)
  }

  async function handleRescan() {
    try {
      const data = await rescan()
      if (data.error) {
        notify('Error rescanning: ' + data.error, 'error')
        return
      }
      await loadImages()
      notify('Library rescanned successfully!', 'success')
    } catch (err) {
      notify('Error rescanning library: ' + err.message, 'error')
      console.error(err)
    }
  }

  async function handleTagCreate(names) {
    try {
      for (const name of names) {
        const data = await createTag(name)
        if (data.error) {
          notify('Error creating tag: ' + data.error, 'error')
          return
        }
      }
      await loadTags()
      setTagInput('')
      setShowTagModal(false)
      notify('Tags created successfully!', 'success')
    } catch (err) {
      notify('Error creating tags: ' + err.message, 'error')
      console.error(err)
    }
  }

  async function handleTagDelete(tagId) {
    try {
      const data = await deleteTag(tagId)
      if (data.error) {
        notify('Error deleting tag: ' + data.error, 'error')
        return
      }
      await loadTags()
      setSelectedTags(new Set())
    } catch (err) {
      notify('Error deleting tag: ' + err.message, 'error')
      console.error(err)
    }
  }

  async function handleBulkTagDelete() {
    try {
      for (const tagId of selectedTags) {
        await deleteTag(tagId)
      }
      await loadTags()
      setSelectedTags(new Set())
      notify('Tags deleted successfully!', 'success')
    } catch (err) {
      notify('Error deleting tags: ' + err.message, 'error')
      console.error(err)
    }
  }

  async function handleAddTagToSelectedImage(tagId) {
    if (!selectedImage) return
    try {
      const data = await addTag(selectedImage.id, tagId)
      if (data && data.error) {
        // Tag already applied, update local state
      }
      // Update selectedImage with new tags
      const updatedImage = images.find(img => img.id === selectedImage.id)
      if (updatedImage) {
        setSelectedImage(updatedImage)
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function handleRemoveTagFromSelectedImage(tagId) {
    if (!selectedImage) return
    try {
      await removeTag(selectedImage.id, tagId)
      // Update selectedImage with new tags
      const updatedImage = images.find(img => img.id === selectedImage.id)
      if (updatedImage) {
        setSelectedImage(updatedImage)
      }
    } catch (err) {
      console.error(err)
    }
  }

  async function handleRemoveImageFromLibrary(imageId) {
    try {
      const data = await removeImage(imageId)
      if (data && data.error) {
        notify('Error removing image: ' + data.error, 'error')
        return
      }
      setSelectedImage(null)
      await loadImages()
      notify('Image removed from library', 'success')
    } catch (err) {
      notify('Error removing image: ' + err.message, 'error')
      console.error(err)
    }
  }

  async function handleDeleteImageCompletely(imageId) {
    try {
      const data = await deleteImage(imageId)
      if (data && data.error) {
        notify('Error deleting image: ' + data.error, 'error')
        return
      }
      setSelectedImage(null)
      await loadImages()
      notify('Image deleted successfully', 'success')
    } catch (err) {
      notify('Error deleting image: ' + err.message, 'error')
      console.error(err)
    }
  }

  async function handleDownloadSelectedImage(imageId, filename) {
    try {
      await api.downloadImage(imageId, filename)
      notify('Image downloaded', 'success')
    } catch (err) {
      notify('Error downloading image: ' + err.message, 'error')
      console.error(err)
    }
  }

  async function handleDownloadMultiple() {
    try {
      await api.downloadMultipleImages(Array.from(selectedImages))
      notify('Download started', 'success')
    } catch (err) {
      notify('Error downloading images: ' + err.message, 'error')
      console.error(err)
    }
  }

  async function handleBulkRemoveFromLibrary() {
    const count = selectedImages.size
    showConfirmation(
      `Remove ${count} image(s) from library (keep files)?`,
      async () => {
        try {
          for (const imageId of selectedImages) {
            await removeImage(imageId)
          }
          setSelectedImages(new Set())
          notify(`${count} image(s) removed from library`, 'success')
          await loadImages()
        } catch (err) {
          notify('Error removing images: ' + err.message, 'error')
          console.error(err)
        }
      },
      false
    )
  }

  async function handleBulkDeleteCompletely() {
    const count = selectedImages.size
    showConfirmation(
      `Delete ${count} image(s) completely (remove files)?`,
      async () => {
        try {
          for (const imageId of selectedImages) {
            await deleteImage(imageId)
          }
          setSelectedImages(new Set())
          notify(`${count} image(s) deleted completely`, 'success')
          await loadImages()
        } catch (err) {
          notify('Error deleting images: ' + err.message, 'error')
          console.error(err)
        }
      },
      true
    )
  }

  const filteredImages = images.filter(img => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return img.name.toLowerCase().includes(query) || img.tags.some(t => t.name.toLowerCase().includes(query))
  })

  const sortedImages = [...filteredImages].sort((a, b) => {
    switch(sortBy) {
      case 'filename-asc': return a.name.localeCompare(b.name)
      case 'filename-desc': return b.name.localeCompare(a.name)
      case 'date-newest': return new Date(b.date_added) - new Date(a.date_added)
      case 'date-oldest': return new Date(a.date_added) - new Date(b.date_added)
      case 'size-largest': return b.size - a.size
      case 'size-smallest': return a.size - b.size
      default: return 0
    }
  })

  const getCommonTags = () => {
    if (selectedImages.size === 0) return []
    const selectedImageList = Array.from(selectedImages).map(id => images.find(img => img.id === id)).filter(img => img)
    if (selectedImageList.length === 0) return []
    const firstImageTags = new Set(selectedImageList[0].tags.map(t => t.id))
    const commonTagIds = Array.from(firstImageTags).filter(tagId => selectedImageList.every(img => img.tags.some(t => t.id === tagId)))
    return tags.filter(tag => commonTagIds.includes(tag.id))
  }

  const getAvailableTags = () => {
    if (!selectedImage) return tags
    const appliedTagIds = new Set(selectedImage.tags.map(t => t.id))
    return tags.filter(tag => !appliedTagIds.has(tag.id))
  }

  const commonTags = getCommonTags()
  const availableTags = getAvailableTags()

  return (
    <div className="app" data-theme={theme}>
      <NotificationsContainer />

      <Sidebar activeSection={activeSection} onSectionChange={setActiveSection} theme={theme} onThemeChange={setTheme} logo={logoImg} icon={{ white: iconWhite, black: iconBlack }} />

      <main className="main-content">
        {activeSection === 'images' && (
          <section className="content-section">
            <div className="header-bar">
              <div className="stats-bar">
                <div className="stat-item">
                  <span className="stat-label">Total Images</span>
                  <span className="stat-value">{images.length}</span>
                </div>
              </div>
              <div className="header-actions">
                {folders.length > 0 && (
                  <button className="btn-primary" onClick={() => setShowUploadModal(true)}>
                    ↑ Upload
                  </button>
                )}
                {selectedImages.size > 0 && (
                  <>
                    <button className="btn-download" onClick={handleDownloadMultiple}>
                      ↓ Download Selected ({selectedImages.size})
                    </button>
                    <button className="btn-secondary" onClick={handleBulkRemoveFromLibrary}>
                      Remove
                    </button>
                    <button className="btn-danger" onClick={handleBulkDeleteCompletely}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>

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
                  <button className="btn-secondary" onClick={() => { setSelectedImages(new Set()); setSearchQuery('') }}>
                    Clear
                  </button>
                </div>
              )}
              {sortedImages.length > 0 && (
                <button className="btn-secondary" onClick={() => setSelectedImages(new Set(sortedImages.map(img => img.id)))}>
                  Select All
                </button>
              )}
            </div>

            <div className="controls-bar">
              <div className="sort-selector">
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="sort-dropdown">
                  <option value="filename-asc">Filename (A-Z)</option>
                  <option value="filename-desc">Filename (Z-A)</option>
                  <option value="date-newest">Date Added (Newest)</option>
                  <option value="date-oldest">Date Added (Oldest)</option>
                  <option value="size-largest">Size (Largest)</option>
                  <option value="size-smallest">Size (Smallest)</option>
                </select>
              </div>
              <div className="view-mode-selector">
                {['list', 'small', 'medium', 'large'].map(mode => (
                  <button key={mode} className={`view-btn ${viewMode === mode ? 'active' : ''}`} onClick={() => setViewMode(mode)}>
                    {mode === 'list' ? '☰' : mode === 'small' ? '⊞⊞⊞' : mode === 'medium' ? '⊞⊞' : '⊞'}
                  </button>
                ))}
              </div>
            </div>

            {selectedImages.size > 0 && commonTags.length > 0 && (
              <div className="common-tags-bar">
                <span className="common-tags-label">Applied to all:</span>
                <div className="common-tags-list">
                  {commonTags.map(tag => (
                    <button key={tag.id} className="common-tag-badge" onClick={() => {
                      selectedImages.forEach(id => removeTag(id, tag.id))
                    }}>
                      {tag.name} <span className="remove-x">✕</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={`images-grid-with-select view-${viewMode}`}>
              {sortedImages.map((img) => (
                <div key={img.id} className={`image-card-wrapper ${selectedImages.has(img.id) ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    className="image-checkbox"
                    checked={selectedImages.has(img.id)}
                    onChange={() => {
                      const newSelected = new Set(selectedImages)
                      if (newSelected.has(img.id)) newSelected.delete(img.id)
                      else newSelected.add(img.id)
                      setSelectedImages(newSelected)
                    }}
                  />
                  <div className="image-card" onClick={() => setSelectedImage(img)}>
                    <img src={`${API_URL}/images/${img.id}/thumbnail`} alt={img.name} className="image-thumbnail" />
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
            {sortedImages.length === 0 && (
              <div className="empty-state">
                {searchQuery ? 'No images match your search.' : 'No images found. Add folders in Library to get started.'}
              </div>
            )}
          </section>
        )}

        {activeSection === 'library' && (
          <section className="content-section">
            <h2>Folder Management</h2>
            <div className="library-controls">
              <button className="btn-primary" onClick={() => { setShowFolderModal(true); browseFoldersHandler('/') }}>
                + Add Folder
              </button>
              <button className="btn-secondary" onClick={handleRescan} disabled={isScanning}>
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
                    <button className="btn-danger" onClick={() => {
                      showConfirmation('Remove folder and all associated images?', () => removeFolder(folder.id), true)
                    }}>
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {activeSection === 'tags' && (
          <section className="content-section">
            <h2>Tag Management</h2>
            <button className="btn-primary" onClick={() => setShowTagModal(true)}>
              + Add Tags
            </button>
            {selectedTags.size > 0 && (
              <div className="tag-selection-bar">
                <span>{selectedTags.size} selected</span>
                <button className="btn-secondary" onClick={() => setSelectedTags(new Set())}>
                  Clear
                </button>
                <button className="btn-danger" onClick={() => {
                  showConfirmation(`Delete ${selectedTags.size} tag(s)?`, handleBulkTagDelete, true)
                }}>
                  Delete Selected
                </button>
              </div>
            )}
            <div className="tags-list">
              {tags.length === 0 ? (
                <p className="empty-state">No tags yet</p>
              ) : (
                tags.map((tag) => (
                  <div key={tag.id} className={`tag-item ${selectedTags.has(tag.id) ? 'selected' : ''}`}>
                    <div className="tag-item-header">
                      <input
                        type="checkbox"
                        className="tag-checkbox"
                        checked={selectedTags.has(tag.id)}
                        onChange={() => {
                          const newSelected = new Set(selectedTags)
                          if (newSelected.has(tag.id)) newSelected.delete(tag.id)
                          else newSelected.add(tag.id)
                          setSelectedTags(newSelected)
                        }}
                      />
                      <span>{tag.name}</span>
                    </div>
                    <button className="btn-danger btn-small" onClick={() => {
                      showConfirmation('Delete this tag?', () => handleTagDelete(tag.id), true)
                    }}>
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {activeSection === 'appearance' && (
          <section className="content-section">
            <h2>UI Management</h2>
            <div className="settings-group">
              <h3>Theme</h3>
              <div className="theme-options">
                <label>
                  <input type="radio" name="theme" value="light" checked={theme === 'light'} onChange={(e) => setTheme(e.target.value)} />
                  ☀️ Light
                </label>
                <label>
                  <input type="radio" name="theme" value="dark" checked={theme === 'dark'} onChange={(e) => setTheme(e.target.value)} />
                  🌙 Dark
                </label>
                <label>
                  <input type="radio" name="theme" value="auto" checked={theme === 'auto'} onChange={(e) => setTheme(e.target.value)} />
                  ⚙️ Auto (System)
                </label>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* IMAGE DETAIL PANEL */}
      {selectedImage && (
        <div className="image-detail-panel">
          <div className="detail-header">
            <h2>{selectedImage.name}</h2>
            <button className="detail-close" onClick={() => setSelectedImage(null)}>✕</button>
          </div>

          <div className="detail-preview">
            <img src={`${API_URL}/images/${selectedImage.id}/preview`} alt={selectedImage.name} />
          </div>

          <div className="detail-info">
            <p><strong>Size:</strong> {(selectedImage.size / 1024 / 1024).toFixed(2)} MB</p>
            <p><strong>Added:</strong> {new Date(selectedImage.date_added).toLocaleDateString()}</p>
          </div>

          <div className="detail-tags">
            <h3>Tags ({detailPanelTags.length})</h3>
            {detailPanelTags.length > 0 ? (
              <div className="tag-list">
                {detailPanelTags.map(tag => (
                  <div key={tag.id} className="tag-item-small">
                    <span>{tag.name}</span>
                    <button className="tag-remove" onClick={() => handleRemoveTagFromSelectedImage(tag.id)}>✕</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-message">No tags yet</p>
            )}

            <div className="add-tags-section">
              <h4>Add Tags</h4>
              {availableTags.length > 0 ? (
                <div className="available-tags">
                  {availableTags.map(tag => (
                    <button
                      key={tag.id}
                      className="tag-add-btn"
                      onClick={() => handleAddTagToSelectedImage(tag.id)}
                    >
                      + {tag.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="empty-message">All tags already applied</p>
              )}
            </div>
          </div>

          <div className="detail-actions">
            <button
              className="btn-secondary"
              onClick={() => handleDownloadSelectedImage(selectedImage.id, selectedImage.name)}
            >
              ↓ Download
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                showConfirmation('Remove from library (keep file)?', () => handleRemoveImageFromLibrary(selectedImage.id), false)
              }}
            >
              Remove
            </button>
            <button
              className="btn-danger"
              onClick={() => {
                showConfirmation('Delete completely (remove file)?', () => handleDeleteImageCompletely(selectedImage.id), true)
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {showFolderModal && (
        <div className="modal-overlay" onClick={() => setShowFolderModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Select Folder</h2>
              <button className="modal-close" onClick={() => setShowFolderModal(false)}>✕</button>
            </div>
            <div className="modal-content">
              <div className="browser-path">
                <button className="btn-secondary" onClick={() => parentPath && browseFoldersHandler(parentPath)} disabled={!parentPath}>
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
                        <span className="folder-name" onClick={() => browseFoldersHandler(folder.path)}>
                          📁 {folder.name}
                        </span>
                        <button className="btn-success" onClick={() => addFolderHandler(folder.path)}>
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

      {showTagModal && (
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
                style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
              />
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>💡 Separate multiple tags with commas</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setShowTagModal(false); setTagInput('') }}>
                Cancel
              </button>
              <button className="btn-primary" onClick={() => {
                const names = tagInput.split(',').map(t => t.trim()).filter(t => t)
                if (names.length === 0) return
                handleTagCreate(names)
              }} disabled={!tagInput.trim()}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {showUploadModal && (
        <div className="modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Upload Images for Frame TV</h2>
              <button className="modal-close" onClick={() => setShowUploadModal(false)}>✕</button>
            </div>
            <div className="modal-content">
              <p>Select folder for upload:</p>
              <div className="folders-select">
                {folders.map(folder => (
                  <button key={folder.id} className={`folder-select-btn ${uploadFolderId === folder.id ? 'selected' : ''}`} onClick={() => setUploadFolderId(folder.id)} disabled={uploadState.processing}>
                    {folder.path}
                  </button>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowUploadModal(false)} disabled={uploadState.processing}>
                Cancel
              </button>
              {uploadFolderId && (
                <>
                  <input type="file" id="file-input" multiple accept="image/*" onChange={handleUpload} style={{ display: 'none' }} disabled={uploadState.processing} />
                  <button className="btn-primary" onClick={() => document.getElementById('file-input').click()} disabled={uploadState.processing}>
                    Select Files
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {uploadState.processing && uploadState.jobId && !uploadState.uploadingFile && (
        <UploadProgressModal jobId={uploadState.jobId} onComplete={() => setUploadState({ jobId: null, uploadingFile: null, processing: false })} onError={() => setUploadState({ jobId: null, uploadingFile: null, processing: false })} />
      )}

      {uploadState.uploadingFile?.status === 'duplicate_detected' && (
        <DuplicateModal result={uploadState.uploadingFile} jobId={uploadState.jobId} onAction={() => {
          setUploadState(prev => ({ ...prev, uploadingFile: null }))
          pollUploadStatus(uploadState.jobId)
        }} />
      )}

      {uploadState.uploadingFile?.status === 'needs_positioning' && (
        <CropPositioningModal result={uploadState.uploadingFile} jobId={uploadState.jobId} onComplete={() => {
          setUploadState(prev => ({ ...prev, uploadingFile: null }))
          pollUploadStatus(uploadState.jobId)
        }} />
      )}

      {confirmation && (
        <ConfirmationModal 
          message={confirmation.message}
          onConfirm={confirmation.onConfirm}
          onCancel={confirmation.onCancel}
          isDanger={confirmation.isDanger}
          confirmText={confirmation.isDanger ? 'Delete' : 'Confirm'}
          cancelText="Cancel"
        />
      )}
    </div>
  )
}