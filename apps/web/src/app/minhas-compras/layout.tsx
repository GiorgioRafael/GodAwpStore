import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { IS_GWSTORE } from "@/lib/brand";

export const metadata: Metadata = { title: "Minhas compras", robots: { index: false, follow: false } };
export default function CustomerOrdersLayout({ children }: { children: ReactNode }) {
  if (!IS_GWSTORE) notFound();
  return children;
}
