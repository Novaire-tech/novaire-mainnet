export type NotificationCategory = 'transaction' | 'yield' | 'network';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  description: string;
  timestamp: number;
  read: boolean;
}

const STORAGE_KEY = 'novaire_notifications_data';
const MAX_NOTIFICATIONS = 50;

class NotificationServiceClass {
  private cachedRaw: string | null = null;
  private cachedNotifications: AppNotification[] = [];

  private getPreferences() {
    try {
      const prefs = localStorage.getItem('novaire_notifications');
      if (prefs) {
        return JSON.parse(prefs);
      }
    } catch {
      // Ignore parse error
    }
    return {
      transaction: true,
      yield: true,
      network: true // Implicitly true if not in settings
    };
  }

  getNotifications(): AppNotification[] {
    if (typeof window === 'undefined') return this.cachedNotifications;
    const data = localStorage.getItem(STORAGE_KEY);
    if (data === this.cachedRaw) {
      return this.cachedNotifications;
    }
    try {
      this.cachedNotifications = data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to parse notifications', e);
      this.cachedNotifications = [];
    }
    this.cachedRaw = data;
    return this.cachedNotifications;
  }

  private saveNotifications(notifications: AppNotification[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
    window.dispatchEvent(new CustomEvent('novaire:notifications_updated'));
  }

  addNotification(category: NotificationCategory, title: string, description: string) {
    const prefs = this.getPreferences();
    if (prefs[category] === false) {
      return; // Skip if user disabled this category
    }

    const current = this.getNotifications();
    const newNotification: AppNotification = {
      id: crypto.randomUUID(),
      category,
      title,
      description,
      timestamp: Date.now(),
      read: false
    };

    const updated = [newNotification, ...current].slice(0, MAX_NOTIFICATIONS);
    this.saveNotifications(updated);
  }

  markAllAsRead() {
    const current = this.getNotifications();
    const updated = current.map(n => ({ ...n, read: true }));
    this.saveNotifications(updated);
  }

  clearAll() {
    this.saveNotifications([]);
  }
}

export const NotificationService = new NotificationServiceClass();
