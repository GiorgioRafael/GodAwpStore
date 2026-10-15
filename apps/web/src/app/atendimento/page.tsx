import { StoreInformationPage } from "@/components/shop/information-page";
import { shopInformationMetadata } from "@/lib/shop/information-metadata";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return shopInformationMetadata("/atendimento", { title: "Atendimento e entrega · GWStore", description: "Como receber sua compra, consultar prazos e falar com a equipe da GWStore." });
}
export default function Page() { return <StoreInformationPage section="atendimento" />; }
