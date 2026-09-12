import { reconcileRobuxOrders } from "../src/lib/robux/reconciliation";

// Use the deployment's own credentials, never a different tenant's local env.
if (process.argv.includes("--deployment") && process.env.VERCEL_ENV === "production") {
  reconcileRobuxOrders({ prioritizeRecent: true }).then((result) => {
    console.log("[robux-recovery]", JSON.stringify(result));
  }).catch((error) => {
    console.error("[robux-recovery]", error instanceof Error ? error.message : "failed");
    process.exitCode = 1;
  });
}
