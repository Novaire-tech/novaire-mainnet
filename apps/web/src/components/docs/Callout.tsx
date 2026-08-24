import React from 'react';
import { Info, CheckCircle2, AlertTriangle, Terminal } from 'lucide-react';

interface CalloutProps {
  type: 'info' | 'success' | 'warning' | 'developer';
  title?: string;
  children: React.ReactNode;
}

export function Callout({ type, title, children }: CalloutProps) {
  const styles = {
    info: {
      bg: 'bg-white/5',
      border: 'border-nova-accent/30',
      text: 'text-nova-accent',
      icon: <Info className="w-5 h-5" />,
      defaultTitle: 'Info',
    },
    success: {
      bg: 'bg-nova-accent/10',
      border: 'border-nova-accent/50',
      text: 'text-nova-accent',
      icon: <CheckCircle2 className="w-5 h-5" />,
      defaultTitle: 'Success',
    },
    warning: {
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      text: 'text-amber-400',
      icon: <AlertTriangle className="w-5 h-5" />,
      defaultTitle: 'Warning',
    },
    developer: {
      bg: 'bg-gray-900',
      border: 'border-gray-700',
      text: 'text-gray-300',
      icon: <Terminal className="w-5 h-5" />,
      defaultTitle: 'Developer Note',
    },
  };

  const config = styles[type];

  return (
    <div className={`my-8 p-6 rounded-xl border ${config.bg} ${config.border}`}>
      <h4 className={`font-semibold mb-2 flex items-center gap-2 m-0 ${config.text}`}>
        {config.icon}
        {title || config.defaultTitle}
      </h4>
      <div className="text-sm text-gray-300 m-0 prose-p:m-0 prose-a:text-nova-accent">
        {children}
      </div>
    </div>
  );
}
