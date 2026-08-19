import type { Metadata } from "next";

import {
  SobremesasFitView,
  parseSobremesasFitPeriod,
} from "@/components/platform/sobremesas-fit-view";
import { getSobremesasFitDashboard } from "@/lib/data/sobremesas-fit";

export const metadata: Metadata = {
  title: "Sobremesas Fit | 101Devs",
  robots: { index: false, follow: false },
};

export default async function SobremesasFitTabPage({
  searchParams,
}: PageProps<"/admin/sobremesas-fit">) {
  const { periodo } = await searchParams;
  const period = parseSobremesasFitPeriod(typeof periodo === "string" ? periodo : undefined);

  return <SobremesasFitView result={await getSobremesasFitDashboard(period)} period={period} />;
}
