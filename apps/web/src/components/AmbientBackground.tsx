'use client';

import { motion } from 'framer-motion';

export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[-1] overflow-hidden bg-[#050505]">
      
      {/* Layer 1: Soft Atmospheric Depth (Emerald gradients) */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 h-[800px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(190,183,167,0.025)_0%,transparent_70%)] blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 h-[1000px] w-[1000px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,rgba(190,183,167,0.015)_0%,transparent_70%)] blur-[120px]" />
      </div>

      {/* Layer 4: Flowing Texture (Anodized Metal / Brushed Glass) */}
      <div 
        className="absolute inset-0 opacity-[0.015] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
        }}
      />
      
      {/* Large organic blurred shapes for brushed glass feel */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.01)_0%,transparent_100%)] blur-[80px]" />

      {/* Layer 5: Ambient Light (Upper Right) */}
      <div className="absolute -top-[20%] -right-[10%] h-[1200px] w-[1200px] rounded-full bg-[#BEB7A7] opacity-[0.03] blur-[180px]" />

      {/* Layer 2 & 3: Orbital Curves & Constellations with subtle motion */}
      <motion.div 
        className="absolute inset-0"
        animate={{ x: [0, 6, 0], y: [0, -6, 0] }}
        transition={{ duration: 50, repeat: Infinity, ease: 'linear' }}
      >
        <svg className="h-full w-full opacity-[0.035]" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
          {/* Orbital Curves (Layer 2) */}
          <path d="M -200 800 Q 300 100 1200 300" fill="none" stroke="#F5F5F2" strokeWidth="0.75" />
          <path d="M -100 200 Q 500 -100 1100 800" fill="none" stroke="#F5F5F2" strokeWidth="0.75" />
          <path d="M 200 1200 Q 600 400 1200 700" fill="none" stroke="#BEB7A7" strokeWidth="0.75" />

          {/* Constellation Lines (Layer 3) */}
          <line x1="350" y1="280" x2="420" y2="240" stroke="#F5F5F2" strokeWidth="0.5" opacity="0.6" />
          <line x1="420" y1="240" x2="550" y2="260" stroke="#F5F5F2" strokeWidth="0.5" opacity="0.6" />
          <line x1="550" y1="260" x2="620" y2="350" stroke="#F5F5F2" strokeWidth="0.5" opacity="0.6" />
          
          <line x1="750" y1="680" x2="820" y2="610" stroke="#BEB7A7" strokeWidth="0.5" opacity="0.6" />
          <line x1="820" y1="610" x2="880" y2="650" stroke="#BEB7A7" strokeWidth="0.5" opacity="0.6" />

          {/* Constellation Nodes (Layer 3) */}
          <circle cx="350" cy="280" r="1.5" fill="#F5F5F2" />
          <circle cx="420" cy="240" r="2" fill="#F5F5F2" />
          <circle cx="550" cy="260" r="1.5" fill="#F5F5F2" />
          <circle cx="620" cy="350" r="2" fill="#F5F5F2" />
          
          <circle cx="750" cy="680" r="1.5" fill="#BEB7A7" />
          <circle cx="820" cy="610" r="2" fill="#BEB7A7" />
          <circle cx="880" cy="650" r="1.5" fill="#BEB7A7" />

          {/* Sparse lone nodes */}
          <circle cx="200" cy="700" r="1.5" fill="#F5F5F2" />
          <circle cx="850" cy="200" r="1.5" fill="#F5F5F2" />
          <circle cx="150" cy="150" r="1" fill="#BEB7A7" />
        </svg>
      </motion.div>

      {/* Layer 4: Dotted Glow Layer (Ambient Texture) */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          maskImage: 'radial-gradient(ellipse at center, transparent 10%, black 50%, transparent 95%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, transparent 10%, black 50%, transparent 95%)'
        }}
      >
        <style>
          {`
            @keyframes ambientGlowShift {
              0%, 100% { opacity: 0.6; transform: translate(0, 0); }
              50% { opacity: 1; transform: translate(1px, -0.5px); }
            }
            .ambient-dot-1 { animation: ambientGlowShift 16s infinite ease-in-out; }
            .ambient-dot-2 { animation: ambientGlowShift 22s infinite ease-in-out reverse; }
            .ambient-dot-3 { animation: ambientGlowShift 28s infinite ease-in-out 4s; }
          `}
        </style>
        <svg className="h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
          <g className="ambient-dot-1">
            {/* Upper Right */}
            <circle cx="720" cy="140" r="0.8" fill="rgba(245,245,242,0.08)" />
            <circle cx="720" cy="140" r="3" fill="rgba(245,245,242,0.02)" />
            <circle cx="850" cy="220" r="0.9" fill="rgba(245,245,242,0.08)" />
            <circle cx="850" cy="220" r="4" fill="rgba(245,245,242,0.015)" />
            <circle cx="680" cy="300" r="1.0" fill="rgba(190,183,167,0.12)" />
            <circle cx="680" cy="300" r="4" fill="rgba(190,183,167,0.04)" />
            <circle cx="910" cy="110" r="0.8" fill="rgba(245,245,242,0.08)" />
            <circle cx="910" cy="110" r="3" fill="rgba(245,245,242,0.02)" />
            {/* Lower Left */}
            <circle cx="120" cy="740" r="0.9" fill="rgba(245,245,242,0.08)" />
            <circle cx="120" cy="740" r="3.5" fill="rgba(245,245,242,0.02)" />
            <circle cx="280" cy="850" r="0.8" fill="rgba(245,245,242,0.08)" />
            <circle cx="280" cy="850" r="3" fill="rgba(245,245,242,0.02)" />
            <circle cx="150" cy="920" r="0.9" fill="rgba(190,183,167,0.12)" />
            <circle cx="150" cy="920" r="4" fill="rgba(190,183,167,0.04)" />
          </g>
          
          <g className="ambient-dot-2">
            {/* Upper Right */}
            <circle cx="880" cy="290" r="0.9" fill="rgba(245,245,242,0.08)" />
            <circle cx="880" cy="290" r="3.5" fill="rgba(245,245,242,0.02)" />
            <circle cx="790" cy="180" r="0.8" fill="rgba(245,245,242,0.08)" />
            <circle cx="790" cy="180" r="3" fill="rgba(245,245,242,0.02)" />
            <circle cx="950" cy="340" r="1.0" fill="rgba(245,245,242,0.08)" />
            <circle cx="950" cy="340" r="4" fill="rgba(245,245,242,0.015)" />
            <circle cx="620" cy="120" r="0.9" fill="rgba(245,245,242,0.08)" />
            <circle cx="620" cy="120" r="3.5" fill="rgba(245,245,242,0.02)" />
            {/* Lower Left */}
            <circle cx="220" cy="680" r="0.8" fill="rgba(245,245,242,0.08)" />
            <circle cx="220" cy="680" r="3" fill="rgba(245,245,242,0.02)" />
            <circle cx="340" cy="770" r="1.0" fill="rgba(245,245,242,0.08)" />
            <circle cx="340" cy="770" r="4" fill="rgba(245,245,242,0.015)" />
            <circle cx="80" cy="810" r="0.9" fill="rgba(245,245,242,0.08)" />
            <circle cx="80" cy="810" r="3.5" fill="rgba(245,245,242,0.02)" />
          </g>

          <g className="ambient-dot-3">
            {/* Sparse Middle / Edges */}
            <circle cx="450" cy="220" r="0.8" fill="rgba(245,245,242,0.08)" />
            <circle cx="450" cy="220" r="3" fill="rgba(245,245,242,0.02)" />
            <circle cx="650" cy="850" r="0.9" fill="rgba(245,245,242,0.08)" />
            <circle cx="650" cy="850" r="3.5" fill="rgba(245,245,242,0.02)" />
            <circle cx="380" cy="540" r="0.8" fill="rgba(190,183,167,0.12)" />
            <circle cx="380" cy="540" r="3" fill="rgba(190,183,167,0.03)" />
            <circle cx="820" cy="590" r="1.0" fill="rgba(245,245,242,0.08)" />
            <circle cx="820" cy="590" r="4" fill="rgba(245,245,242,0.015)" />
            <circle cx="160" cy="380" r="0.9" fill="rgba(245,245,242,0.08)" />
            <circle cx="160" cy="380" r="3.5" fill="rgba(245,245,242,0.02)" />
          </g>
        </svg>
      </div>

      {/* Stellar Particles Layer */}
      <div className="absolute inset-0">
        <style>
          {`
            @keyframes twinkle {
              0%, 100% { opacity: 0.15; }
              50% { opacity: 0.35; }
            }
            .stellar-particle {
              animation: twinkle 12s infinite ease-in-out;
            }
          `}
        </style>
        <svg className="h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice">
          {/* Upper Right Cluster */}
          <circle cx="800" cy="150" r="1.5" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '10s', animationDelay: '2s' }} />
          <circle cx="850" cy="120" r="1" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '14s', animationDelay: '5s' }} />
          <circle cx="780" cy="200" r="1.2" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '9s', animationDelay: '1s' }} />
          <circle cx="900" cy="250" r="1.8" fill="#BEB7A7" className="stellar-particle" style={{ animationDuration: '15s', animationDelay: '7s' }} />
          <circle cx="720" cy="100" r="1" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '12s', animationDelay: '3s' }} />
          <circle cx="950" cy="180" r="1.5" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '11s', animationDelay: '0s' }} />
          <line x1="800" y1="150" x2="850" y2="120" stroke="#F5F5F2" strokeWidth="0.5" opacity="0.1" />

          {/* Upper Middle Cluster */}
          <circle cx="500" cy="80" r="1.5" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '13s', animationDelay: '4s' }} />
          <circle cx="550" cy="150" r="1" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '9s', animationDelay: '2s' }} />
          <circle cx="450" cy="200" r="1.2" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '14s', animationDelay: '8s' }} />
          <circle cx="600" cy="100" r="1.5" fill="#BEB7A7" className="stellar-particle" style={{ animationDuration: '11s', animationDelay: '1s' }} />
          <circle cx="480" cy="250" r="1" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '10s', animationDelay: '5s' }} />

          {/* Far Left Sparse */}
          <circle cx="100" cy="300" r="1.5" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '15s', animationDelay: '6s' }} />
          <circle cx="150" cy="450" r="1" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '12s', animationDelay: '3s' }} />
          <circle cx="80" cy="600" r="1.2" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '10s', animationDelay: '9s' }} />
          <circle cx="120" cy="800" r="1.5" fill="#BEB7A7" className="stellar-particle" style={{ animationDuration: '14s', animationDelay: '2s' }} />
          <line x1="100" y1="300" x2="150" y2="450" stroke="#F5F5F2" strokeWidth="0.5" opacity="0.1" />

          {/* Bottom Right Sparse */}
          <circle cx="850" cy="800" r="1.5" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '11s', animationDelay: '4s' }} />
          <circle cx="920" cy="700" r="1" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '13s', animationDelay: '1s' }} />
          <circle cx="780" cy="900" r="1.2" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '9s', animationDelay: '7s' }} />
          <circle cx="950" cy="850" r="1.5" fill="#BEB7A7" className="stellar-particle" style={{ animationDuration: '15s', animationDelay: '0s' }} />
          <line x1="850" y1="800" x2="920" y2="700" stroke="#F5F5F2" strokeWidth="0.5" opacity="0.1" />

          {/* Center Sparse (avoiding exact middle text) */}
          <circle cx="400" cy="750" r="1.5" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '12s', animationDelay: '8s' }} />
          <circle cx="600" cy="800" r="1" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '10s', animationDelay: '2s' }} />
          <circle cx="500" cy="900" r="1.2" fill="#F5F5F2" className="stellar-particle" style={{ animationDuration: '14s', animationDelay: '5s' }} />
        </svg>
      </div>

      {/* Layer 6: Vignette (Focusing attention on center) */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,#050505_100%)] opacity-80" />
    </div>
  );
}
