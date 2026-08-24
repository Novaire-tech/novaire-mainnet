'use client';

import React, { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

interface MermaidDiagramProps {
  chart: string;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'dark',
      themeVariables: {
        primaryColor: '#064e3b',
        primaryTextColor: '#fff',
        primaryBorderColor: '#BEB7A7',
        lineColor: '#BEB7A7',
        secondaryColor: '#065f46',
        tertiaryColor: '#111827',
      }
    });

    if (ref.current) {
      mermaid.render(`mermaid-${Math.random().toString(36).substring(7)}`, chart).then(({ svg }) => {
        if (ref.current) {
          ref.current.innerHTML = svg;
        }
      });
    }
  }, [chart]);

  return <div ref={ref} className="flex justify-center my-8 p-4 bg-white/5 rounded-xl border border-nova-border" />;
}
