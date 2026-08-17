import type { Metadata } from "next";
import { DM_Sans, Lora } from "next/font/google";
import { BottomNav } from "@/components/bottom-nav";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MealMind",
  description: "MealMind",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg">
        <div className="flex flex-1 flex-col pb-[72px]">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
