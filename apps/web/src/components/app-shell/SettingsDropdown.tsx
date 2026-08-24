import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SettingsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsDropdown({ isOpen, onClose }: SettingsDropdownProps) {
  const [notifications, setNotifications] = useState({
    transaction: true,
    yield: true
  });
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const savedNotifs = localStorage.getItem('novaire_notifications');
      if (savedNotifs) {
        try {
          const parsed = JSON.parse(savedNotifs);
          queueMicrotask(() => setNotifications(parsed));
        } catch {
          // Ignore
        }
      }
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEsc);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen, onClose]);

  const toggleNotification = (key: keyof typeof notifications) => {
    const next = { ...notifications, [key]: !notifications[key] };
    setNotifications(next);
    localStorage.setItem('novaire_notifications', JSON.stringify(next));
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-2xl border border-white/10 bg-[#050505] shadow-2xl origin-top-right"
        >
          <div className="p-5 space-y-6">
            {/* Notifications */}
            <div>
              <h3 className="mb-3 text-sm font-medium text-[#F5F5F2]">Notification Preferences</h3>
              <div className="space-y-3">
                {[
                  { key: 'transaction', label: 'Transaction Notifications' },
                  { key: 'yield', label: 'Yield Notifications' },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-sm text-[#9A9A9A]">{label}</span>
                    <button
                      onClick={() => toggleNotification(key as keyof typeof notifications)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        notifications[key as keyof typeof notifications] ? 'bg-[#BEB7A7]' : 'bg-white/10'
                      }`}
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                          notifications[key as keyof typeof notifications] ? 'translate-x-5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* About */}
            <div className="border-t border-white/10 pt-5">
              <h3 className="mb-3 text-sm font-medium text-[#F5F5F2]">About Novaire</h3>
              <div className="space-y-2 text-sm text-[#9A9A9A]">
                <div className="flex justify-between">
                  <span>Version</span>
                  <span className="text-[#F5F5F2]">1.0.0 (Mainnet)</span>
                </div>
                <div className="flex justify-between">
                  <span>Network</span>
                  <span className="text-[#BEB7A7]">Stellar Mainnet</span>
                </div>
                <div className="flex justify-between">
                  <span>Current Epoch</span>
                  <span className="text-[#F5F5F2]">Epoch 1</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
