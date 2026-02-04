import { useState } from 'react'

export function TagDialog({ 
  isOpen, 
  onClose, 
  selectedImage, 
  selectedImages,
  tags, 
  onAddTag,
  onCreateTag,
  existingTags 
}) {
  const [tagInput, setTagInput] = useState('')
  const [searchInput, setSearchInput] = useState('')

  if (!isOpen) return null

  // Determine what we're tagging
  const isSingleImage = selectedImage && selectedImages.size === 0
  const isMultiSelect = selectedImages.size > 0
  const itemCount = isSingleImage ? 1 : selectedImages.size
  const itemLabel = isSingleImage ? 'image' : 'images'

  // Get tags that aren't already applied
  let appliedTagIds = new Set()
  if (isSingleImage && selectedImage) {
    appliedTagIds = new Set(selectedImage.tags.map(t => t.id))
  } else if (isMultiSelect) {
    // For multi-select, only show tags applied to ALL selected images
    const selectedImagesList = Array.from(selectedImages)
      .map(id => tags.find(img => img.id === id))
      .filter(img => img)
    
    if (selectedImagesList.length > 0) {
      const firstImageTagIds = new Set(selectedImagesList[0].tags.map(t => t.id))
      appliedTagIds = new Set(
        Array.from(firstImageTagIds).filter(tagId =>
          selectedImagesList.every(img => img.tags.some(t => t.id === tagId))
        )
      )
    }
  }

  const availableTags = existingTags.filter(tag => !appliedTagIds.has(tag.id))
  const filteredTags = availableTags.filter(tag =>
    tag.name.toLowerCase().includes(searchInput.toLowerCase())
  )

  async function handleCreateAndApply() {
    if (!tagInput.trim()) return
    
    try {
      // Create the tag
      const newTag = await onCreateTag(tagInput.trim())
      
      // Apply to selected image(s)
      if (isSingleImage && selectedImage) {
        await onAddTag(selectedImage.id, newTag.id)
      } else if (isMultiSelect) {
        for (const imageId of selectedImages) {
          await onAddTag(imageId, newTag.id)
        }
      }
      
      setTagInput('')
      setSearchInput('')
    } catch (err) {
      console.error('Error creating/applying tag:', err)
    }
  }

  async function handleApplyTag(tagId) {
    try {
      if (isSingleImage && selectedImage) {
        await onAddTag(selectedImage.id, tagId)
      } else if (isMultiSelect) {
        for (const imageId of selectedImages) {
          await onAddTag(imageId, tagId)
        }
      }
    } catch (err) {
      console.error('Error applying tag:', err)
    }
  }

  return (
    <div className="tag-dialog-overlay" onClick={onClose}>
      <div className="tag-dialog" onClick={e => e.stopPropagation()}>
        <div className="tag-dialog-header">
          <h3>Apply Tags</h3>
          <span className="tag-dialog-count">{itemCount} {itemLabel}</span>
          <button className="tag-dialog-close" onClick={onClose}>✕</button>
        </div>

        <div className="tag-dialog-content">
          {/* Search existing tags */}
          <div className="tag-dialog-section">
            <label>Search tags:</label>
            <input
              type="text"
              placeholder="Find a tag..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="tag-dialog-search"
            />
          </div>

          {/* Available tags */}
          {filteredTags.length > 0 && (
            <div className="tag-dialog-section">
              <label>Available tags ({filteredTags.length}):</label>
              <div className="tag-dialog-list">
                {filteredTags.map(tag => (
                  <button
                    key={tag.id}
                    className="tag-dialog-item"
                    onClick={() => handleApplyTag(tag.id)}
                  >
                    <span>+ {tag.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredTags.length === 0 && searchInput && (
            <p className="tag-dialog-empty">No tags match "{searchInput}"</p>
          )}

          {/* Create new tag */}
          <div className="tag-dialog-section tag-dialog-create">
            <label>Create & apply new tag:</label>
            <div className="tag-dialog-input-group">
              <input
                type="text"
                placeholder="New tag name..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateAndApply()
                }}
                className="tag-dialog-input"
              />
              <button
                className="tag-dialog-create-btn"
                onClick={handleCreateAndApply}
                disabled={!tagInput.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>

        <div className="tag-dialog-footer">
          <button className="btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}