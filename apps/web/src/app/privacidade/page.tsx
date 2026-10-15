import { StoreInformationPage } from "@/components/shop/information-page";
import { shopInformationMetadata } from "@/lib/shop/information-metadata";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  return shopInformationMetadata("/privacidade", { title: "Privacidade · GWStore", description: "Saiba como a GWStore utiliza os dados da sua conta, pedido e atendimento." });
}
export default function Page() { return <StoreInformationPage section="privacidade" />; }
