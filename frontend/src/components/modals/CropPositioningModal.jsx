import { useState, useEffect, useRef } from 'react'

export function CropPositioningModal({ result, jobId, onComplete }) {
  const [cropBox, setCropBox] = useState({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(null) // 'tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r', or null
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const containerRef = useRef(null)
  const aspectInfo = result.aspect_info

  const displayAspect = aspectInfo.width / aspectInfo.height
  const maxWidth = 400, maxHeight = 400
  let previewWidth, previewHeight
  if (displayAspect > maxWidth / maxHeight) {
    previewWidth = maxWidth
    previewHeight = maxWidth / displayAspect
  } else {
    previewHeight = maxHeight
    previewWidth = maxHeight * displayAspect
  }

  const handleMouseDown = (e, type) => {
    if (!containerRef.current) return
    if (type === 'move') {
      setIsDragging(true)
    } else {
      setIsResizing(type)
    }
    const rect = containerRef.current.getBoundingClientRect()
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }

  const handleMouseMove = (e) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const currentX = e.clientX - rect.left
    const currentY = e.clientY - rect.top
    const deltaX = (currentX - dragOffset.x) / previewWidth
    const deltaY = (currentY - dragOffset.y) / previewHeight

    if (isDragging) {
      // Move the entire box
      setCropBox(prev => ({
        ...prev,
        x: Math.max(0, Math.min(1 - prev.width, prev.x + deltaX)),
        y: Math.max(0, Math.min(1 - prev.height, prev.y + deltaY))
      }))
    } else if (isResizing) {
      // Resize from the handle
      setCropBox(prev => {
        let newBox = { ...prev }
        
        if (isResizing.includes('l')) {
          const newX = prev.x + deltaX
          const newWidth = prev.width - deltaX
          if (newWidth > 0.1 && newX >= 0) {
            newBox.x = newX
            newBox.width = newWidth
          }
        }
        if (isResizing.includes('r')) {
          const newWidth = prev.width + deltaX
          if (newWidth > 0.1 && prev.x + newWidth <= 1) {
            newBox.width = newWidth
          }
        }
        if (isResizing.includes('t')) {
          const newY = prev.y + deltaY
          const newHeight = prev.height - deltaY
          if (newHeight > 0.1 && newY >= 0) {
            newBox.y = newY
            newBox.height = newHeight
          }
        }
        if (isResizing.includes('b')) {
          const newHeight = prev.height + deltaY
          if (newHeight > 0.1 && prev.y + newHeight <= 1) {
            newBox.height = newHeight
          }
        }
        
        return newBox
      })
    }

    setDragOffset({ x: currentX, y: currentY })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    setIsResizing(null)
  }

  useEffect(() => {
    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, isResizing, dragOffset, previewWidth, previewHeight])

  async function handleSubmit() {
    setIsSubmitting(true)
    try {
      const response = await fetch(
        `${window.location.origin}/api/images/upload/${jobId}/position`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: result.filename, crop_box: cropBox }) }
      )
      const data = await response.json()
      if (!data.error) onComplete()
    } catch (err) {
      console.error('Positioning failed:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const cropStyle = {
    position: 'absolute',
    left: `${cropBox.x * 100}%`,
    top: `${cropBox.y * 100}%`,
    width: `${cropBox.width * 100}%`,
    height: `${cropBox.height * 100}%`,
    border: '2px solid rgba(255, 215, 0, 0.8)',
    boxSizing: 'border-box',
    cursor: isDragging ? 'grabbing' : 'grab'
  }

  const resizeHandleStyle = (position) => ({
    position: 'absolute',
    background: 'rgba(255, 215, 0, 0.6)',
    zIndex: 10,
    ...(['tl', 'tr', 'bl', 'br'].includes(position) && { width: '10px', height: '10px' }),
    ...(position === 'tl' && { top: '-5px', left: '-5px', cursor: 'nwse-resize' }),
    ...(position === 'tr' && { top: '-5px', right: '-5px', cursor: 'nesw-resize' }),
    ...(position === 'bl' && { bottom: '-5px', left: '-5px', cursor: 'nesw-resize' }),
    ...(position === 'br' && { bottom: '-5px', right: '-5px', cursor: 'nwse-resize' }),
    ...(['t', 'b'].includes(position) && { left: '0', right: '0', height: '5px' }),
    ...(position === 't' && { top: '-2px', cursor: 'ns-resize' }),
    ...(position === 'b' && { bottom: '-2px', cursor: 'ns-resize' }),
    ...(['l', 'r'].includes(position) && { top: '0', bottom: '0', width: '5px' }),
    ...(position === 'l' && { left: '-2px', cursor: 'ew-resize' }),
    ...(position === 'r' && { right: '-2px', cursor: 'ew-resize' })
  })

  return (
    <div className="modal-overlay">
      <div className="modal positioning-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Position Image for Frame TV</h2></div>
        <div className="modal-content positioning-content">
          <p>This image's aspect ratio ({aspectInfo.aspect.toFixed(2)}:1) isn't close to 16:9 (1.78:1).</p>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Drag to move, use handles to resize.</p>
          <div className="positioning-info">
            <p>Original: {aspectInfo.width}×{aspectInfo.height}</p>
            <p>Will be: 3840×2160 (4K Frame TV)</p>
          </div>
          <div ref={containerRef} className="crop-preview-container" style={{ width: `${previewWidth}px`, height: `${previewHeight}px`, position: 'relative', margin: '20px auto', borderRadius: '4px', overflow: 'hidden', backgroundColor: 'var(--bg-secondary)', border: '2px solid var(--border-color)' }}>
            <img src={result.thumbnail} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', userSelect: 'none', pointerEvents: 'none' }} />
            <div style={cropStyle} onMouseDown={(e) => handleMouseDown(e, 'move')}>
              {/* Resize handles */}
              <div style={resizeHandleStyle('tl')} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'tl') }} />
              <div style={resizeHandleStyle('tr')} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'tr') }} />
              <div style={resizeHandleStyle('bl')} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'bl') }} />
              <div style={resizeHandleStyle('br')} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'br') }} />
              <div style={resizeHandleStyle('t')} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 't') }} />
              <div style={resizeHandleStyle('b')} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'b') }} />
              <div style={resizeHandleStyle('l')} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'l') }} />
              <div style={resizeHandleStyle('r')} onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'r') }} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={() => onComplete()} disabled={isSubmitting}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={isSubmitting}>{isSubmitting ? 'Processing...' : 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}
