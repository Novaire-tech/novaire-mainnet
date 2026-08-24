import { useSyncExternalStore } from 'react';
import { NotificationService, NotificationCategory } from '../services/notificationService';

function subscribe(callback: () => void) {
  window.addEventListener('novaire:notifications_updated', callback);
  return () => window.removeEventListener('novaire:notifications_updated', callback);
}

// A stable reference, not `() => []`, so getServerSnapshot doesn't return a
// new array identity on every call (React requires a cached snapshot).
const EMPTY_NOTIFICATIONS: ReturnType<typeof NotificationService.getNotifications> = [];
const getServerSnapshot = () => EMPTY_NOTIFICATIONS;

export function useNotifications() {
  const notifications = useSyncExternalStore(
    subscribe,
    NotificationService.getNotifications.bind(NotificationService),
    getServerSnapshot
  );

  const unreadCount = notifications.filter(n => !n.read).length;

  return {
    notifications,
    unreadCount,
    markAllAsRead: () => NotificationService.markAllAsRead(),
    clearAll: () => NotificationService.clearAll(),
    addNotification: (category: NotificationCategory, title: string, desc: string) => NotificationService.addNotification(category, title, desc)
  };
}
