import { ReactNode } from 'react';
import { TopNav } from '@/components/app-shell/TopNav';
import { AmbientBackground } from '@/components/AmbientBackground';

export const metadata = {
  title: 'Novaire Web Terminal',
  description: 'Novaire protocol web terminal.',
};

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-screen w-full overflow-hidden text-[#F5F5F2] font-inter">
      {/* Background Layer */}
      <AmbientBackground />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-y-auto relative">
        {/* Top Navigation */}
        <TopNav />
        
        {/* Page Content */}
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
