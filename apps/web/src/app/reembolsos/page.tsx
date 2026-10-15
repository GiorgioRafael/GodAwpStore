import { StoreInformationPage } from "@/components/shop/information-page";
import { shopInformationMetadata } from "@/lib/shop/information-metadata";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return shopInformationMetadata("/reembolsos", { title: "Cancelamento e reembolso · GWStore", description: "Como solicitar ajuda com pagamentos, cancelamento e reembolso na GWStore." });
}
export default function Page() { return <StoreInformationPage section="reembolsos" />; }
