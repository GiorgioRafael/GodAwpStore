import { NextResponse, type NextRequest } from "next/server";

import { getLocalServiceDashboardSnapshot } from "@/lib/data/service-dashboard-snapshot";
import { isValidMasterDashboardSecret } from "@/lib/master-dashboard-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isValidMasterDashboardSecret(request.headers.get("x-101devs-master-secret"))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const snapshot = await getLocalServiceDashboardSnapshot();
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível gerar o resumo deste serviço." },
      { status: 503 },
    );
  }
}

