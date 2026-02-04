import { useState, useEffect, useRef } from 'react'

export function CropPositioningModal({ result, jobId, onComplete }) {
  const [imageScale, setImageScale] = useState(1)
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const containerRef = useRef(null)
  const aspectInfo = result.aspect_info

  // Fixed 16:9 aspect ratio box
  const TARGET_ASPECT = 16 / 9
  const maxWidth = 500
  const maxHeight = 500
  let boxWidth, boxHeight
  if (maxWidth / maxHeight > TARGET_ASPECT) {
    boxHeight = maxHeight
    boxWidth = maxHeight * TARGET_ASPECT
  } else {
    boxWidth = maxWidth
    boxHeight = maxWidth / TARGET_ASPECT
  }

  const handleMouseDown = (e) => {
    if (!containerRef.current) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - imageOffset.x, y: e.clientY - imageOffset.y })
  }

  const handleMouseMove = (e) => {
    if (!isDragging || !containerRef.current) return
    setImageOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, dragStart])

  const handleWheel = (e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setImageScale(prev => Math.max(0.5, Math.min(5, prev * delta)))
  }

  async function handleSubmit() {
    setIsSubmitting(true)
    try {
      // Convert image position/scale to crop_box for the backend
      const scaledWidth = (aspectInfo.width / imageScale)
      const scaledHeight = (aspectInfo.height / imageScale)
      
      const crop_box = {
        x: Math.max(0, -imageOffset.x / boxWidth / (aspectInfo.width / boxWidth)),
        y: Math.max(0, -imageOffset.y / boxHeight / (aspectInfo.height / boxHeight)),
        width: Math.min(1, boxWidth / scaledWidth),
        height: Math.min(1, boxHeight / scaledHeight)
      }

      const response = await fetch(
        `${window.location.origin}/api/images/upload/${jobId}/position`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: result.filename, crop_box }) }
      )
      const data = await response.json()
      if (!data.error) onComplete()
    } catch (err) {
      console.error('Positioning failed:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleCancel() {
    // Actually cancel the upload for this file
    if (window.confirm('Cancel this upload?')) {
      onComplete() // Signal to continue polling (will skip this file)
    }
  }

  const scaledImageWidth = (aspectInfo.width / aspectInfo.height) * boxHeight * imageScale
  const scaledImageHeight = boxHeight * imageScale

  return (
    <div className="modal-overlay">
      <div className="modal positioning-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Position Image for Frame TV</h2></div>
        <div className="modal-content positioning-content">
          <p>Image aspect ratio: {aspectInfo.aspect.toFixed(2)}:1 | Target: 16:9 (1.78:1)</p>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Drag to pan, scroll to zoom</p>
          <div className="positioning-info">
            <p>Original: {aspectInfo.width}×{aspectInfo.height}</p>
            <p>Output: 3840×2160 (4K Frame TV)</p>
            <p>Current zoom: {(imageScale * 100).toFixed(0)}%</p>
          </div>
          
          <div 
            ref={containerRef}
            className="crop-preview-container"
            onMouseDown={handleMouseDown}
            onWheel={handleWheel}
            style={{
              width: `${boxWidth}px`,
              height: `${boxHeight}px`,
              position: 'relative',
              margin: '20px auto',
              borderRadius: '4px',
              overflow: 'hidden',
              backgroundColor: 'var(--bg-secondary)',
              border: '3px solid rgba(255, 215, 0, 0.8)',
              cursor: isDragging ? 'grabbing' : 'grab',
              userSelect: 'none'
            }}
          >
            <img
              src={result.thumbnail}
              alt="Preview"
              style={{
                position: 'absolute',
                width: `${scaledImageWidth}px`,
                height: `${scaledImageHeight}px`,
                left: `${imageOffset.x}px`,
                top: `${imageOffset.y}px`,
                pointerEvents: 'none',
                objectFit: 'cover'
              }}
            />
          </div>
          
          <div style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', marginTop: '10px' }}>
            Yellow box = final 16:9 output. Drag image to pan, scroll to zoom in/out.
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={handleCancel} disabled={isSubmitting}>Cancel Upload</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={isSubmitting}>{isSubmitting ? 'Processing...' : 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}
