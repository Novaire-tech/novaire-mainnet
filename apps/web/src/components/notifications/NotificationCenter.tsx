import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Check, Trash2 } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import { AppNotification } from '../../services/notificationService';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationCenter({ isOpen, onClose }: NotificationCenterProps) {
  const { notifications, markAllAsRead, clearAll } = useNotifications();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  const formatTimeAgo = (timestamp: number) => {
    // eslint-disable-next-line react-hooks/purity -- display-only relative time label; staleness is harmless
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
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
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 p-4 bg-[#050505]">
            <h3 className="font-medium text-[#F5F5F2] flex items-center gap-2">
              <Bell className="w-4 h-4" /> Notifications
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => markAllAsRead()}
                className="text-xs text-[#9A9A9A] hover:text-[#F5F5F2] flex items-center gap-1 transition-colors"
                title="Mark all as read"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={() => clearAll()}
                className="text-xs text-[#9A9A9A] hover:text-red-400 flex items-center gap-1 transition-colors"
                title="Clear all"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto overflow-x-hidden custom-scrollbar">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Bell className="w-8 h-8 text-white/10 mb-3" />
                <p className="text-sm text-[#9A9A9A]">No notifications yet</p>
                <p className="text-xs text-white/40 mt-1">Protocol events will appear here.</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {notifications.map((notif: AppNotification) => (
                  <div 
                    key={notif.id} 
                    className={`relative flex flex-col gap-1 p-4 border-b border-white/5 transition-colors hover:bg-white/5 ${!notif.read ? 'bg-[#BEB7A7]/5' : ''}`}
                  >
                    {!notif.read && (
                      <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[#BEB7A7]" />
                    )}
                    <div className="flex justify-between items-start">
                      <span className="font-medium text-[#F5F5F2] text-sm">{notif.title}</span>
                      {!notif.read && (
                        <span className="flex items-center gap-1 text-[10px] text-[#BEB7A7]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#BEB7A7]" /> Unread
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#9A9A9A] leading-relaxed">{notif.description}</p>
                    <span className="text-[10px] text-white/40 mt-1">{formatTimeAgo(notif.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
