import { useState, useEffect } from 'react';
import logoImg from '../assets/logo/framefolio_logo.png';

export default function InfoBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('framefolioInfoBannerDismissed');
    if (!dismissed) {
      setIsVisible(true);
    }
  }, []);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem('framefolioInfoBannerDismissed', 'true');
    }
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="info-banner-overlay" onClick={handleClose}>
      <div className="info-banner-modal" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button
          className="info-banner-close"
          onClick={handleClose}
          aria-label="Close banner"
        >
          ✕
        </button>

        {/* Logo and Title */}
        <div className="info-banner-header">
          <img src={logoImg} alt="FrameFolio" className="info-banner-logo" />
          <h2>Welcome to FrameFolio</h2>
        </div>

        {/* Content */}
        <div className="info-banner-content">
          <p>
            Take complete control over your art collection for your Samsung Frame TV. 
            Curate, organize, and manage your own images—no subscriptions, no limits.
          </p>
          
          <div className="info-banner-features">
            <div className="feature">
              <span className="feature-icon">🎨</span>
              <span>Upload & organize images</span>
            </div>
            <div className="feature">
              <span className="feature-icon">🏷️</span>
              <span>Tag & categorize collections</span>
            </div>
            <div className="feature">
              <span className="feature-icon">📥</span>
              <span>Download in FrameReady format</span>
            </div>
          </div>
        </div>

        {/* Footer with checkbox and button */}
        <div className="info-banner-footer">
          <label className="info-banner-checkbox">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <span>Don't show again</span>
          </label>
          <button className="info-banner-btn" onClick={handleClose}>
            Get Started
          </button>
        </div>
      </div>
    </div>
  );
}
