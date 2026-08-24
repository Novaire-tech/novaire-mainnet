'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Bell, Settings, Wallet } from 'lucide-react';
import { SettingsDropdown } from './SettingsDropdown';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { useNotifications } from '../../hooks/useNotifications';
import { useWallet } from '../../hooks/useWallet';

const TOP_LINKS = [
  { label: 'Markets', href: '/app/markets' },
  { label: 'Mint', href: '/app/mint' },
  { label: 'Trade', href: '/app/trade' },
  { label: 'Portfolio', href: '/app/portfolio' },
];

export function TopNav() {
  const pathname = usePathname();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const { unreadCount } = useNotifications();
  const { isConnected, address, connect, disconnect, error } = useWallet();
  const formattedAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : '';

  // If there's an error (e.g. wrong Freighter network), surface it to the user.
  useEffect(() => {
    if (error && error !== 'Wallet not connected') {
      alert(`Wallet Connection Error: ${error}`);
    }
  }, [error]);

  useEffect(() => {
    const handleOpen = () => setIsSettingsOpen(true);
    window.addEventListener('novaire:open_settings', handleOpen);
    return () => window.removeEventListener('novaire:open_settings', handleOpen);
  }, []);

  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: 'easeOut' }}
      className="flex h-[68px] w-full shrink-0 items-center justify-between border-b border-white/10 bg-[#050505] px-6"
    >
      {/* Left: Wordmark & Links */}
      <div className="flex h-full items-center gap-8">
        <Image 
          src="/images/logos-v2.png" 
          alt="Novaire" 
          width={180} 
          height={36} 
          className="h-[36px] w-auto object-contain"
        />
        
        <nav className="hidden h-full md:flex items-center gap-6">
          {TOP_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`relative flex h-full items-center text-[14px] font-medium transition-colors ${
                  isActive ? 'text-[#F5F5F2]' : 'text-[#8E8E8E] hover:text-[#F5F5F2]'
                }`}
              >
                {link.label}
                {isActive && (
                  <motion.div
                    layoutId="activeTopNavIndicator"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#BEB7A7]"
                    transition={{ duration: 0.2 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Connect Wallet */}
        {isConnected ? (
          <button
            onClick={disconnect}
            title="Disconnect Wallet"
            className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[13px] font-medium text-[#F5F5F2] transition-colors hover:border-red-500/30 hover:text-red-500"
          >
            <Wallet className="h-4 w-4" />
            {formattedAddress}
          </button>
        ) : (
          <button
            onClick={connect}
            className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[13px] font-medium text-[#F5F5F2] transition-colors hover:border-[#BEB7A7]/50 hover:text-[#BEB7A7]"
          >
            <Wallet className="h-4 w-4" />
            Connect Wallet
          </button>
        )}

        {/* Notification & Settings */}
        <div className="relative">
          <motion.button 
            whileHover={{ scale: 1.05 }}
            onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-[#8E8E8E] transition-all hover:border-white/10 hover:bg-white/[0.06] hover:text-[#F5F5F2]"
          >
            <Bell className="h-[18px] w-[18px]" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-[#BEB7A7] text-[10px] font-bold text-black ring-2 ring-[#050505]">
              </span>
            )}
          </motion.button>
          
          <NotificationCenter 
            isOpen={isNotificationsOpen} 
            onClose={() => setIsNotificationsOpen(false)} 
          />
        </div>
        
        <div className="relative">
          <motion.button 
            whileHover={{ scale: 1.05 }}
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-[#8E8E8E] transition-all hover:border-white/10 hover:bg-white/[0.06] hover:text-[#F5F5F2]"
          >
            <Settings className="h-[18px] w-[18px]" />
          </motion.button>
          <SettingsDropdown 
            isOpen={isSettingsOpen} 
            onClose={() => setIsSettingsOpen(false)} 
          />
        </div>

        {/* Stellar Network Icon */}
        <button 
          className="ml-1 flex h-9 w-9 items-center justify-center rounded-xl border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.03)] transition-all duration-200 hover:border-[#BEB7A7] hover:bg-[rgba(255,255,255,0.08)]"
        >
          <Image 
            src="/images/stellar.svg" 
            alt="Stellar" 
            width={20} 
            height={20} 
            className="h-[18px] w-[18px] object-contain brightness-0 invert opacity-90"
          />
        </button>
      </div>
    </motion.header>
  );
}
