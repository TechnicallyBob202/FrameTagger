export function ConfirmationModal({ message, onConfirm, onCancel, confirmText = 'Confirm', cancelText = 'Cancel', isDanger = false }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Confirm Action</h2>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-content">
          <p>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel}>
            {cancelText}
          </button>
          <button className={isDanger ? "btn-danger" : "btn-primary"} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}