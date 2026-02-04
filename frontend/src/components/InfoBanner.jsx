import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

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
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 flex items-start justify-between gap-3">
      <div className="flex-1">
        <p className="text-blue-900 text-sm">
          <strong>FrameFolio</strong> gives you complete control over your art collection for your Samsung Frame TV. Curate, organize, and manage your own images without subscriptions!
        </p>
        <label className="flex items-center gap-2 mt-2 cursor-pointer">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-xs text-blue-700">Don't show again</span>
        </label>
      </div>
      <button
        onClick={handleClose}
        className="text-blue-400 hover:text-blue-600 flex-shrink-0"
        aria-label="Close banner"
      >
        <X size={18} />
      </button>
    </div>
  );
}
