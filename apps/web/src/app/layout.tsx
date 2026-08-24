import type { Metadata } from "next";
import { Inter, Antic_Didone, Poppins } from "next/font/google";
import SmoothScrollProvider from "@/components/SmoothScrollProvider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const anticDidone = Antic_Didone({
  variable: "--font-antic",
  weight: "400",
  subsets: ["latin"],
});

const poppins = Poppins({
  variable: "--font-poppins-google",
  weight: ["400", "700", "800"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Novaire | Autonomous Yield Infrastructure",
  description: "The first Autonomous Yield Operating System on Stellar. Invest by Goal. Not by Complexity.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${anticDidone.variable} ${poppins.variable}`}
    >
      <body className="antialiased text-nova-text bg-nova-bg w-full min-h-screen">
        <SmoothScrollProvider>{children}</SmoothScrollProvider>
      </body>
    </html>
  );
}
