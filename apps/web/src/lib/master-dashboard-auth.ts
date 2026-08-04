import "server-only";

import { timingSafeEqual } from "node:crypto";

const MINIMUM_SECRET_LENGTH = 32;

export function isValidMasterDashboardSecret(candidate: string | null): boolean {
  const configured = process.env.MASTER_DASHBOARD_SHARED_SECRET?.trim();
  if (!configured || configured.length < MINIMUM_SECRET_LENGTH || !candidate) return false;

  const expected = Buffer.from(configured);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

