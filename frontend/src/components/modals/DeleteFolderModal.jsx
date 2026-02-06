import { useState } from 'react'

export function DeleteFolderModal({ folderName, onConfirm, onCancel }) {
  const [step, setStep] = useState(1) // 1, 2, or 3
  const [deleteOriginals, setDeleteOriginals] = useState(false)
  const [deleteFrameready, setDeleteFrameready] = useState(false)

  const handleStep1Confirm = () => {
    setStep(2)
  }

  const handleStep2Confirm = (value) => {
    setDeleteOriginals(value)
    setStep(3)
  }

  const handleStep3Confirm = (value) => {
    setDeleteFrameready(value)
    onConfirm(deleteOriginals, value)
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Delete Folder</h2>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-content">
          {step === 1 && (
            <>
              <p>This will remove <strong>{folderName}</strong> from your database.</p>
              <p>Proceed?</p>
            </>
          )}
          {step === 2 && (
            <>
              <p>Do you want to delete your original image files?</p>
            </>
          )}
          {step === 3 && (
            <>
              <p>Do you want to delete the FrameReady images?</p>
            </>
          )}
        </div>
        <div className="modal-footer">
          {step === 1 && (
            <>
              <button className="btn-secondary" onClick={onCancel}>
                Cancel
              </button>
              <button className="btn-danger" onClick={handleStep1Confirm}>
                Proceed
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button className="btn-secondary" onClick={() => handleStep2Confirm(false)}>
                No
              </button>
              <button className="btn-danger" onClick={() => handleStep2Confirm(true)}>
                Yes, Delete
              </button>
            </>
          )}
          {step === 3 && (
            <>
              <button className="btn-secondary" onClick={() => handleStep3Confirm(false)}>
                No
              </button>
              <button className="btn-danger" onClick={() => handleStep3Confirm(true)}>
                Yes, Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}